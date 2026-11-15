"""Branchement de l'IA cardiaque (surveillance du rythme cardiaque) : voir Guide_branchement_equipe.docx.

Deux moteurs, choisis automatiquement :
 1. MOTEUR RÉEL  : les fichiers de Steve (interface_logiciel.py, moniteur_sante.py, garde_fou.py, couche_2min.py,
                   couche_nuits_jours.py + dossier modeles/) copiés dans backend/ia/ -> SurveillanceSante(...)
 2. MOTEUR DE SECOURS : si les fichiers sont absents (ou si un astronaute n'a pas de modèle), une version simplifiée
                   (garde-fou 30 s + couche 2 min) qui permet de voir l'IA réagir. Ce n'est PAS le vrai modèle.
Un seul objet pour tout le logiciel (il garde la mémoire de la nuit). Appels : process() à chaque mesure,
fin_de_nuit() le matin, nouvelle_nuit() après une longue interruption de sommeil."""
import json, os, sys, threading, time
from collections import deque
from datetime import datetime, timezone
from statistics import median

IA_DIR = os.environ.get("ASTRO_IA_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ia")
CALIB_S = float(os.environ.get("IA_CALIB_S", "45"))      # secours : durée de calibration (le vrai système : 30 min)
SEUILS = dict(fc_haute=150, fc_basse=35, med2_haute=120, med2_basse=40, ecart_jaune=20, ecart_rouge=30)  # valeurs d'exemple (à valider par un médecin)

_lock = threading.Lock()
_real = None; _real_err = None; _tried = False
_state = {}       # astronaute -> état affiché
_secours = {}     # astronaute -> MoteurSecours
_corresp = None

def _iso(ts): return datetime.fromtimestamp(ts, timezone.utc).isoformat()

def _load_real():
    global _real, _real_err, _tried
    if _tried: return _real
    _tried = True
    try:
        if IA_DIR not in sys.path: sys.path.insert(0, IA_DIR)
        from interface_logiciel import SurveillanceSante   # fichier de Steve
        _real = SurveillanceSante(os.path.join(IA_DIR, "modeles"), on_alerte=lambda a, r: None)
    except Exception as e:                                  # fichiers absents, scikit-learn différent, etc.
        _real, _real_err = None, f"{type(e).__name__}: {e}"
    return _real

def moteur_reel_actif(): return _load_real() is not None

def _nom_modele(astro_id, name):
    """Nom de l'astronaute côté IA = nom du fichier dans modeles/. Par défaut : l'identifiant ; sinon ia/correspondance.json."""
    global _corresp
    if _corresp is None:
        try: _corresp = json.load(open(os.path.join(IA_DIR, "correspondance.json"), encoding="utf-8"))
        except Exception: _corresp = {}
    return _corresp.get(astro_id) or _corresp.get(name) or astro_id


class MoteurSecours:
    """Garde-fou 30 s + couche 2 min, version simplifiée. Renvoie None (rien de neuf) ou un dict avec 'etat'."""
    def __init__(self):
        self.buf = deque(); self.calib = []; self.t0 = None; self.base = None; self.urg = False; self.a2 = None
    def mesure(self, ts, fc):
        if not 30 <= fc <= 220: return None
        first = self.t0 is None
        if first: self.t0 = ts
        self.buf.append((ts, fc))
        while self.buf and ts - self.buf[0][0] > 120: self.buf.popleft()
        out = []
        if self.base is None:
            self.calib.append(fc)
            if ts - self.t0 >= CALIB_S and len(self.calib) >= 5:
                self.base = median(self.calib)
                out.append({"etat": "VERT", "type": "CALIBRATION_FIN", "message": f"Calibration terminée : niveau habituel {self.base:.0f} bpm"})
            elif first: out.append({"etat": "CALIBRATION", "message": "Calibration en cours : l'IA apprend le niveau habituel"})
        w = [h for t, h in self.buf if ts - t <= 30]
        if ts - self.buf[0][0] >= 20 and len(w) >= 5:                               # garde-fou 30 s
            m = median(w); urg = m > SEUILS["fc_haute"] or m < SEUILS["fc_basse"]
            if urg and not self.urg: out.append({"etat": "ROUGE", "type": "URGENCE_IMMEDIATE", "message": f"Urgence : rythme cardiaque extrême ({m:.0f} bpm)"})
            if self.urg and not urg: out.append({"etat": "RETOUR_NORMAL", "type": "URGENCE_IMMEDIATE", "message": "Fin de l'urgence : le rythme est redevenu normal"})
            self.urg = urg
        if self.base is not None and ts - self.buf[0][0] >= 90:                    # couche 2 min
            m = median(h for _, h in self.buf); d = m - self.base
            lv = ("ROUGE" if abs(d) >= SEUILS["ecart_rouge"] or m > SEUILS["med2_haute"] or m < SEUILS["med2_basse"]
                  else "JAUNE" if abs(d) >= SEUILS["ecart_jaune"] else None)
            if lv != self.a2:
                if lv: out.append({"etat": lv, "type": "ALERTE_2MIN", "message": f"Rythme médian sur 2 min : {m:.0f} bpm ({d:+.0f} par rapport à son niveau habituel de {self.base:.0f})"})
                else: out.append({"etat": "RETOUR_NORMAL", "type": "ALERTE_2MIN", "message": "Fin de l'alerte 2 min : le rythme est revenu à son niveau habituel"})
                self.a2 = lv
        if not out: return None
        rang = {"ROUGE": 3, "JAUNE": 2, "RETOUR_NORMAL": 1}
        return max(out, key=lambda r: rang.get(r["etat"], 0))
    def garde(self):
        return {"30 secondes": "ROUGE" if self.urg else "VERT",
                "2 minutes": self.a2 or ("CALIBRATION" if self.base is None else "VERT")}


def _new_state(moteur):
    return {"etat": "CALIBRATION", "message": "Calibration en cours : l'IA apprend le niveau habituel", "type": None, "moteur": moteur,
            "since": _iso(time.time()), "g5": None, "nuit": None, "evenements": deque(maxlen=15), "last_hr": None}

def process(astro_id, name, ts, fc):
    """À appeler à CHAQUE mesure. Renvoie l'événement (dict avec 'etat') seulement s'il y a du nouveau, sinon None."""
    with _lock:
        real = _load_real(); res = None; moteur = "secours"
        if real is not None:
            try: res = real.mesure(_nom_modele(astro_id, name), ts, fc); moteur = "reel"
            except KeyError: real = None                   # astronaute sans modèle -> secours
        if moteur == "secours":
            res = _secours.setdefault(astro_id, MoteurSecours()).mesure(ts, fc)
        st = _state.setdefault(astro_id, _new_state(moteur)); st["moteur"] = moteur; st["last_hr"] = fc
        if not res or not res.get("etat"): return None
        etat = "VERT" if res["etat"] == "RETOUR_NORMAL" else res["etat"]
        typ = res.get("type")
        if typ not in ("URGENCE_IMMEDIATE", "ALERTE_2MIN") and etat in ("VERT", "JAUNE", "ROUGE"): st["g5"] = etat
        ev = {"ts": _iso(ts), "etat": res["etat"], "type": typ, "message": res.get("message") or ""}
        if (etat, ev["message"]) != (st["etat"], st["message"]): st["since"] = _iso(ts)
        st["etat"], st["message"], st["type"] = etat, ev["message"], typ
        if res["etat"] != "CALIBRATION": st["evenements"].appendleft(ev)
        return ev

def fin_de_nuit(astro_id, name=""):
    with _lock:
        real = _load_real()
        if real is None: return {"etat": "IGNOREE", "message": "Moteur réel absent : pas de bilan de nuit"}
        try: bilan = real.fin_de_nuit(_nom_modele(astro_id, name))
        except KeyError: return {"etat": "IGNOREE", "message": "Astronaute sans modèle"}
        st = _state.get(astro_id)
        if st: st["nuit"] = {"etat": bilan.get("etat"), "message": bilan.get("message")}
        return bilan

def nouvelle_nuit(astro_id, name=""):
    with _lock:
        real = _load_real()
        if real is not None:
            try: real.nouvelle_nuit(_nom_modele(astro_id, name))
            except KeyError: pass
        _secours.pop(astro_id, None); _state.pop(astro_id, None)

def snapshot(astro_id):
    """Photo de l'état de l'IA pour l'interface (None si aucune mesure traitée)."""
    with _lock:
        st = _state.get(astro_id)
        if not st: return None
        sec = _secours.get(astro_id); g = sec.garde() if sec and st["moteur"] == "secours" else {}
        cal = st["etat"] == "CALIBRATION"
        guardiens = [
            {"nom": "30 secondes", "role": "Urgence franche (cœur qui s'emballe ou s'effondre)", "etat": g.get("30 secondes", "ROUGE" if st["type"] == "URGENCE_IMMEDIATE" and st["etat"] == "ROUGE" else "VERT")},
            {"nom": "2 minutes", "role": "Écart moyen qui dure", "etat": g.get("2 minutes", "ROUGE" if st["type"] == "ALERTE_2MIN" and st["etat"] == "ROUGE" else "JAUNE" if st["type"] == "ALERTE_2MIN" and st["etat"] == "JAUNE" else "VERT")},
            {"nom": "5 minutes", "role": "Changements discrets (réseau de neurones)", "etat": st["g5"] or ("CALIBRATION" if cal else "INDISPONIBLE" if st["moteur"] == "secours" else "VERT")},
            {"nom": "32 minutes", "role": "Forme de la courbe (réseau convolutif)", "etat": "EN_TEST"},
            {"nom": "Nuits et jours", "role": "Dérive lente d'une nuit à l'autre", "etat": (st["nuit"] or {}).get("etat") or "EN_ATTENTE"},
        ]
        return {"etat": st["etat"], "message": st["message"], "type": st["type"], "moteur": st["moteur"], "since": st["since"],
                "fc": st["last_hr"], "guardiens": guardiens, "evenements": list(st["evenements"]), "nuit": st["nuit"]}

def apply_to_status(astro_id, status):
    """Ajoute le panneau IA au statut et fait réagir le torse (+ niveau global) quand l'IA est JAUNE ou ROUGE."""
    snap = snapshot(astro_id)
    if not snap: return status
    status["heart_ai"] = snap
    lv = {"ROUGE": "red", "JAUNE": "yellow"}.get(snap["etat"])
    if lv:
        z = status["zones"]["torso"]
        z["score"] = max(z["score"], 0.85 if lv == "red" else 0.55)
        z["level"] = max([z["level"], lv], key=lambda x: {"green": 0, "yellow": 1, "red": 2}[x])
        z["reasons"] = ["IA cardiaque : " + snap["message"]] + z["reasons"]
        order = {"green": 0, "yellow": 1, "red": 2}
        status["overall_level"] = max([status["overall_level"], z["level"]], key=order.get)
        if not any(c["zone"] == "torso" for c in status["countermeasures"]):
            status["countermeasures"].append({"zone": "torso", "level": z["level"], "action": "Repos, contrôle de la fréquence cardiaque ; prévenir le médecin de bord"})
    return status
