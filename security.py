"""Sécurité locale : AES-256-GCM (données médicales), mots de passe PBKDF2, jetons JWT HS256.
Les clés sont générées au premier lancement dans backend/data/ (à ne JAMAIS committer)."""
import base64, hashlib, hmac, json, os, secrets, time
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from . import db

def _file(name, make):
    os.makedirs(db.DATA_DIR, exist_ok=True)
    p = os.path.join(db.DATA_DIR, name)
    if not os.path.exists(p):
        with open(p, "wb") as f:
            f.write(make())
        try: os.chmod(p, 0o600)
        except OSError: pass
    with open(p, "rb") as f:
        return f.read()

def _aes(): return AESGCM(_file("aes256.key", lambda: os.urandom(32)))
def _jwt_key(): return _file("jwt.key", lambda: os.urandom(32))
def ingest_key(): return _file("ingest.key", lambda: secrets.token_urlsafe(24).encode()).decode()

def access_codes():
    """Codes à fournir pour créer un compte médecin / administration."""
    make = lambda: json.dumps({"doctor": secrets.token_urlsafe(9), "admin": secrets.token_urlsafe(9)}).encode()
    return json.loads(_file("access_codes.json", make))

# ---- chiffrement AES-256-GCM (l'identifiant du propriétaire est authentifié avec la donnée) ----
def encrypt(obj, owner):
    nonce = os.urandom(12)
    return nonce + _aes().encrypt(nonce, json.dumps(obj).encode(), owner.encode())

def decrypt(blob, owner):
    blob = bytes(blob)
    return json.loads(_aes().decrypt(blob[:12], blob[12:], owner.encode()))

# ---- mots de passe ----
def hash_password(pw):
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)
    return f"pbkdf2$200000${salt.hex()}${h.hex()}"

def verify_password(pw, stored):
    try:
        _, it, salt, h = stored.split("$")
        c = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(it))
        return hmac.compare_digest(c.hex(), h)
    except Exception:
        return False

# ---- JWT HS256 ----
def _b64(b): return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
def _unb64(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
def _sig(msg): return _b64(hmac.new(_jwt_key(), msg.encode(), hashlib.sha256).digest())

def make_token(sub, role, ttl=12 * 3600):
    h = _b64(b'{"alg":"HS256","typ":"JWT"}')
    p = _b64(json.dumps({"sub": sub, "role": role, "exp": int(time.time()) + ttl}).encode())
    return f"{h}.{p}.{_sig(h + '.' + p)}"

def read_token(t):
    try:
        h, p, s = t.split(".")
        if not hmac.compare_digest(s, _sig(h + "." + p)): return None
        d = json.loads(_unb64(p))
        return d if d.get("exp", 0) > time.time() else None
    except Exception:
        return None
