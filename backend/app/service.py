"""Logique métier (indépendante de FastAPI, donc testable seule)."""
import re, time
from datetime import datetime, timezone
from . import ai, db, security

class ServiceError(Exception):
    def __init__(self, status, msg):
        self.status, self.msg = status, msg

ROLES = ("astronaut", "doctor", "admin")
PREFIX = {"astronaut": "A-", "doctor": "MED-", "admin": "ADM-"}
_fails = {}
_last_level = {}   # dernier niveau global connu par astronaute (pour détecter les changements)

def mkey(m): return re.sub(r"\s+", " ", (m or "").strip()).lower()
def public(r): return {"id": r["id"], "name": r["name"], "age": r["age"], "mission": r["mission"], "role": r["role"]}

def _user(uid):
    with db.conn() as c:
        return c.execute("SELECT * FROM users WHERE lower(id)=?", (uid.strip().lower(),)).fetchone()

def register(name, age, mission, role, password, access_code=""):
    import hmac
    if role not in ROLES: raise ServiceError(400, "Rôle invalide")
    if len(name.strip()) < 2 or not 18 <= age <= 80: raise ServiceError(400, "Nom ou âge invalide")
    if len(password) < 8: raise ServiceError(400, "Mot de passe : 8 caractères minimum")
    if role in ("astronaut", "doctor") and not mission.strip(): raise ServiceError(400, "La mission est obligatoire")
    if role != "astronaut" and not hmac.compare_digest(access_code or "", security.access_codes()[role]):
        raise ServiceError(403, "Code d'accès invalide pour ce rôle")
    with db.conn() as c:
        pre = PREFIX[role]
        ids = [int(r["id"][len(pre):]) for r in c.execute("SELECT id FROM users WHERE role=?", (role,))]
        uid = f"{pre}{(max(ids) + 1 if ids else 1):02d}"
        c.execute("INSERT INTO users VALUES(?,?,?,?,?,?,?,?)",
                  (uid, name.strip(), age, mission.strip(), mkey(mission), role, security.hash_password(password), time.time()))
    row = _user(uid)
    return {"user": public(row), "token": security.make_token(uid, role)}

def login(uid, password):
    k, now = uid.strip().lower(), time.time()
    f = [t for t in _fails.get(k, []) if now - t < 900]
    if len(f) >= 5: raise ServiceError(429, "Trop de tentatives, réessayez dans quelques minutes")
    row = _user(uid)
    if not row or not security.verify_password(password, row["pass_hash"]):
        _fails[k] = f + [now]
        raise ServiceError(401, "Identifiant ou mot de passe incorrect")
    _fails.pop(k, None)
    return {"user": public(row), "token": security.make_token(row["id"], row["role"])}

def user_from_token(token):
    p = security.read_token(token)
    row = _user(p["sub"]) if p else None
    if not row: raise ServiceError(401, "Session expirée, reconnectez-vous")
    return dict(row)

def audit(actor, action, target):
    with db.conn() as c:
        c.execute("INSERT INTO audit(ts,actor,action,target) VALUES(?,?,?,?)", (time.time(), actor["id"], action, target))

# ---- ingestion (capteurs) : chiffrée dès l'entrée ----
def ingest_vitals(d):
    u = _user(d["astronaut_id"])
    if not u or u["role"] != "astronaut": raise ServiceError(404, "Astronaute inconnu")
    with db.conn() as c:
        c.execute("INSERT INTO measurements(owner,kind,ts,blob) VALUES(?,?,?,?)",
                  (u["id"], "vitals", time.time(), security.encrypt(d, u["id"])))
    _check_alert(u)

def ingest_env(d):
    k = mkey(d["mission"])
    with db.conn() as c:
        c.execute("INSERT INTO measurements(owner,kind,ts,blob) VALUES(?,?,?,?)", (k, "env", time.time(), security.encrypt(d, k)))

def _load(owner, kind, n):
    out = []
    for r in reversed(db.recent(owner, kind, n)):
        d = security.decrypt(r["blob"], owner); d["_ts"] = r["ts"]; out.append(d)
    return out

def status_for(row):
    env = _load(row["mission_key"], "env", 1)
    return ai.analyze(public(row), _load(row["id"], "vitals", 120), env[-1] if env else None)

# ---- lecture avec contrôle d'accès par rôle ----
def body_status(user, astronaut_id=None):
    role = user["role"]
    if role == "astronaut":
        if astronaut_id and astronaut_id.lower() != user["id"].lower(): raise ServiceError(403, "Accès refusé")
        return status_for(user)
    if astronaut_id:
        t = _user(astronaut_id)
        if not t or t["role"] != "astronaut": raise ServiceError(404, "Astronaute inconnu")
        if role == "doctor" and t["mission_key"] != user["mission_key"]: raise ServiceError(403, "Hors de votre équipage")
        audit(user, "lecture", t["id"])
        return status_for(t)
    rows = db.list_astronauts(None if role == "admin" else user["mission_key"])
    audit(user, "liste", "*" if role == "admin" else user["mission_key"])
    return {"patients": [status_for(r) for r in rows]}

def all_users(user):
    if user["role"] != "admin": raise ServiceError(403, "Réservé à l'administration")
    with db.conn() as c:
        return [public(r) for r in c.execute("SELECT * FROM users ORDER BY role, id")]


# ---- alertes : enregistrées quand le niveau global d'un astronaute CHANGE ----
def _reasons(st):
    out = [r for z in list(st["zones"].values()) + [st["radiation"]] for r in z["reasons"]]
    return out + [c["message"] for c in st["correlations"] if c["cause"] != "capteurs"]

def _known_level(owner):
    if owner not in _last_level:
        with db.conn() as c:
            r = c.execute("SELECT blob FROM alerts WHERE owner=? ORDER BY ts DESC LIMIT 1", (owner,)).fetchone()
        _last_level[owner] = security.decrypt(r["blob"], owner)["level"] if r else "green"
    return _last_level[owner]

def _check_alert(row):
    st = status_for(row)
    if any(c["cause"] == "capteurs" for c in st["correlations"]): return      # pas de données = pas d'alerte santé
    prev, now_lv = _known_level(row["id"]), st["overall_level"]
    if now_lv == prev: return
    entry = {"name": row["name"], "level": now_lv, "from": prev, "reasons": _reasons(st)[:6]}
    with db.conn() as c:
        c.execute("INSERT INTO alerts(ts,owner,mission_key,blob) VALUES(?,?,?,?)",
                  (time.time(), row["id"], row["mission_key"], security.encrypt(entry, row["id"])))
    _last_level[row["id"]] = now_lv

def alerts(user, limit=50):
    with db.conn() as c:
        if user["role"] == "astronaut":
            rows = c.execute("SELECT * FROM alerts WHERE owner=? ORDER BY ts DESC LIMIT ?", (user["id"], limit)).fetchall()
        elif user["role"] == "doctor":
            rows = c.execute("SELECT * FROM alerts WHERE mission_key=? ORDER BY ts DESC LIMIT ?", (user["mission_key"], limit)).fetchall()
        else:
            rows = c.execute("SELECT * FROM alerts ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
    out = []
    for r in rows:
        d = security.decrypt(r["blob"], r["owner"])
        out.append({"ts": datetime.fromtimestamp(r["ts"], timezone.utc).isoformat(), "astronaut_id": r["owner"], **d})
    return out

def audit_log(user, limit=100):
    if user["role"] != "admin": raise ServiceError(403, "Réservé à l'administration")
    with db.conn() as c:
        rows = c.execute("SELECT * FROM audit ORDER BY ts DESC LIMIT ?", (limit,)).fetchall()
    return [{"ts": datetime.fromtimestamp(r["ts"], timezone.utc).isoformat(), "actor": r["actor"], "action": r["action"], "target": r["target"]} for r in rows]
