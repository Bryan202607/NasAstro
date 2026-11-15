"""Simulateur de capteurs (combinaison + cabine) pour tester le mode normal.
Usage : python simulate_sensors.py   (serveur déjà lancé)  — Ctrl+C pour arrêter."""
import json, math, os, random, time, urllib.request
from app import db, security


def post(path, payload, BASE=None, KEY=None):
    req = urllib.request.Request((BASE or os.environ.get("ASTRO_URL", "http://127.0.0.1:8000")) + path, json.dumps(payload).encode(), {"Content-Type": "application/json", "X-Ingest-Key": KEY or security.ingest_key()})
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as e:
        print("Erreur d'envoi :", e)

def main():
    db.init()
    walk = lambda v, s, lo, hi: max(lo, min(hi, v + (random.random() - 0.5) * s))
    st, t, co2 = {}, 0, {}
    print("Simulation lancée. Les astronautes sont lus dans la base locale. Ctrl+C pour arrêter.")
    while True:
        t += 1
        astros = db.list_astronauts()
        if not astros: print("Aucun astronaute inscrit : créez un compte astronaute dans l'application.")
        for a in astros:
            s = st.setdefault(a["id"], dict(hr=72, spo2=98, hrv=50, temp=36.8, resp=15, hyd=92, load=0.5))
            s["hr"] = s["hr"] + (72 - s["hr"]) * 0.2 + (random.random() - 0.5) * 4    # FC stable autour de 72
            c = (t * 2) % 360                                                         # cycle de 6 min : 60-105 s = fausse urgence ; 200-340 s = FC élevée soutenue
            off = 100 if 60 <= c < 105 else 28 if 200 <= c < 340 else 0
            hr_out = s["hr"] + off
            if c in (60, 200) and a["id"] == astros[0]["id"]: print(f"[simu] {'FAUSSE URGENCE (FC ~170)' if c == 60 else 'FC élevée soutenue (+28 bpm)'} -> l'IA doit réagir")
            s["spo2"] = walk(s["spo2"], 0.8, 91, 100); s["hrv"] = walk(s["hrv"], 4, 15, 75)
            s["temp"] = walk(s["temp"], 0.06, 36.3, 37.8); s["resp"] = walk(s["resp"], 1.2, 11, 24)
            s["hyd"] = walk(s["hyd"], 0.4, 82, 98); s["load"] = walk(s["load"], 0.1, 0.05, 0.9)
            post("/api/ingest/biometrics", dict(astronaut_id=a["id"], heart_rate=round(hr_out, 1), spo2=round(s["spo2"], 1),
                 hrv=round(s["hrv"], 1), body_temp=round(s["temp"], 2), skin_temp=round(s["temp"] - 3.5, 1), resp_rate=round(s["resp"]),
                 bp_sys=round(118 + (s["hr"] - 70) * 0.25), bp_dia=round(76 + (s["hr"] - 70) * 0.12),
                 hydration_pct=round(s["hyd"]), muscle_load=round(s["load"], 2)))
        for m in {a["mission"] for a in astros}:
            spike = (t % 90) > 70                              # pic de CO2 périodique (pour voir les alertes)
            co2[m] = min(3000, co2.get(m, 900) + 180) if spike else max(800, co2.get(m, 900) - 60)
            post("/api/ingest/environment", dict(mission=m, co2_ppm=round(co2[m]), cabin_temp=round(22 + math.sin(t / 40), 1),
                 radiation_mgy_h=round(random.uniform(0.01, 0.06), 3)))
        time.sleep(2)

if __name__ == "__main__":
    main()
