"""Analyse IA locale (hors ligne) : scores par zone du corps à partir des capteurs.
Méthode : seuils physiologiques + écart à la ligne de base PERSONNELLE de l'astronaute (z-score)
+ tendances récentes + corrélations capteurs/cabine. Aucun appel réseau.
Les seuils sont des valeurs de prototype : à faire valider par l'équipe médicale."""
import statistics as st
import time
from datetime import datetime, timezone

def clamp(x, lo=0.0, hi=1.0): return max(lo, min(hi, x))
def ramp(x, ok, bad): return clamp((x - ok) / (bad - ok))        # 0 à "ok", 1 à "bad" (marche dans les 2 sens)
def level(s): return "green" if s < 0.4 else "yellow" if s < 0.7 else "red"
def avg(xs): return sum(xs) / len(xs) if xs else None
def col(rows, k): return [r[k] for r in rows if r.get(k) is not None]
def zone(score, reasons):
    s = round(clamp(score), 2)
    return {"level": level(s), "score": s, "reasons": reasons}

ACTIONS = {
    "head": "Vérifier la ventilation / purge du CO₂, puis session de relaxation guidée",
    "torso": "Repos, contrôle de la fréquence cardiaque et de la SpO₂ ; prévenir le médecin de bord",
    "legs": "Programmer une séance d'exercice résistif (tapis / vélo) dans les prochaines heures",
    "skin": "Limiter l'exposition : rejoindre la zone abritée et suivre la dose cumulée",
}

def _empty(user, msg):
    z = zone(0, [])
    return {"astronaut_id": user["id"], "name": user["name"], "session_id": user.get("mission", ""), "role": "astronaut",
            "ts": datetime.now(timezone.utc).isoformat(), "overall_level": "green",
            "zones": {"head": z, "torso": z, "legs": z}, "radiation": z,
            "vitals": {"hr": 0, "spo2": 0, "hrv": 0}, "cabin": {"co2_ppm": 0, "temp_c": 0},
            "correlations": [{"zone": "torso", "cause": "capteurs", "message": msg}],
            "countermeasures": [], "body": None, "parts": {}}

def analyze(user, vit, env, now=None):
    """vit : mesures de l'astronaute (anciennes -> récentes, avec "_ts"), env : dernière mesure de cabine ou None."""
    now = now or time.time()
    if not vit:
        return _empty(user, "Aucune mesure reçue pour cet astronaute (capteurs hors ligne ?)")
    last, recent = vit[-1], vit[-3:]
    hr, spo2 = avg(col(recent, "heart_rate")), avg(col(recent, "spo2"))
    hrv, temp = avg(col(recent, "hrv")), last["body_temp"]
    co2 = env["co2_ppm"] if env else None
    rad = env["radiation_mgy_h"] if env else None

    # ligne de base personnelle (mesures plus anciennes que les 10 dernières)
    base = vit[:-10] if len(vit) >= 40 else []
    base_hr = st.median(col(base, "heart_rate")) if base else 70.0

    # ---- tête : HRV bas + CO2 cabine élevé ----
    r_head = []
    hrv_s = ramp(hrv, 50, 20) if hrv is not None else 0
    co2_s = ramp(co2, 1000, 4000) if co2 is not None else 0
    if hrv is not None and hrv < 35: r_head.append(f"HRV bas ({hrv:.0f} ms)")
    if co2 is not None and co2 > 1500: r_head.append(f"CO₂ cabine élevé ({co2:.0f} ppm)")
    head = 0.6 * hrv_s + 0.6 * co2_s

    # ---- torse : FC (écart à SA base), SpO2, température centrale, tendances ----
    r_torso = []
    hr_s = ramp(abs(hr - base_hr), 10, 45)
    spo2_s = ramp(spo2, 97, 90)
    temp_s = max(ramp(temp, 37.3, 38.5), ramp(temp, 36.0, 34.5))
    if hr > 100: r_torso.append(f"FC élevée ({hr:.0f} bpm)")
    if hr < 50: r_torso.append(f"FC basse ({hr:.0f} bpm)")
    if spo2 < 94: r_torso.append(f"SpO₂ basse ({spo2:.0f} %)")
    if temp > 37.8: r_torso.append(f"Température centrale élevée ({temp:.1f} °C)")
    if temp < 36.0: r_torso.append(f"Température centrale basse ({temp:.1f} °C)")
    torso = 0.7 * hr_s + spo2_s + 0.8 * temp_s
    hrs = col(vit, "heart_rate")
    if len(hrs) >= 20:
        before, now5 = avg(hrs[-20:-5]), avg(hrs[-5:])
        if before and now5 > before * 1.15:
            r_torso.append("FC en hausse sur les dernières minutes"); torso += 0.1
        if len(base) >= 30:
            sd = st.pstdev(col(base, "heart_rate")) or 1.0
            if abs(last["heart_rate"] - st.mean(col(base, "heart_rate"))) / sd > 3:
                r_torso.append("Valeur inhabituelle pour cet astronaute (FC)"); torso += 0.15

    # ---- jambes : déconditionnement (charge musculaire faible) ----
    r_legs = []
    load = avg(col(vit[-60:], "muscle_load"))
    legs = 0.1 if load is None else 0.1 + 0.8 * ramp(load, 0.4, 0.1)
    if load is not None and legs > 0.4: r_legs.append("Faible charge musculaire récente")

    # ---- radiations ----
    r_rad = []
    rad_s = ramp(rad, 0.05, 0.30) if rad is not None else 0
    if rad_s >= 0.4: r_rad.append(f"Dose de rayonnement élevée ({rad:.3f} mGy/h)")

    zones = {"head": zone(head, r_head), "torso": zone(torso, r_torso), "legs": zone(legs, r_legs)}
    radiation = zone(rad_s, r_rad)

    corr = []
    if co2 is not None and co2 > 2000 and hrv is not None and hrv < 35:
        corr.append({"zone": "head", "cause": "co2", "message": "HRV en baisse pendant un pic de CO₂ cabine"})
    age = now - last["_ts"]
    if age > 30: corr.append({"zone": "torso", "cause": "capteurs", "message": f"Dernière mesure il y a {int(age)} s : vérifier les capteurs"})
    if env is None: corr.append({"zone": "head", "cause": "cabine", "message": "Aucune donnée de cabine reçue pour cette mission"})

    cm = [{"zone": k, "level": z["level"], "action": ACTIONS[k]} for k, z in list(zones.items()) + [("skin", radiation)] if z["level"] != "green"]
    order = {"green": 0, "yellow": 1, "red": 2}
    overall = max([z["level"] for z in zones.values()] + [radiation["level"]], key=order.get)

    body = None
    if all(last.get(k) is not None for k in ("skin_temp", "resp_rate", "bp_sys", "bp_dia", "hydration_pct")):
        body = {"core_temp_c": temp, "skin_temp_c": last["skin_temp"], "resp_rate": last["resp_rate"],
                "bp_sys": last["bp_sys"], "bp_dia": last["bp_dia"], "hydration_pct": last["hydration_pct"]}

    return {"astronaut_id": user["id"], "name": user["name"], "session_id": user.get("mission", ""), "role": "astronaut",
            "ts": datetime.fromtimestamp(last["_ts"], timezone.utc).isoformat(), "overall_level": overall,
            "zones": zones, "radiation": radiation,
            "vitals": {"hr": round(hr, 1), "spo2": round(spo2, 1), "hrv": round(hrv or 0, 1)},
            "cabin": {"co2_ppm": co2 or 0, "temp_c": env["cabin_temp"] if env else 0},
            "correlations": corr, "countermeasures": cm, "body": body, "parts": {}}
