"""Lanceur de l'application (point d'entrée de l'exécutable Windows).
Démarre le serveur local, ouvre le navigateur et affiche l'adresse pour le téléphone.
Option : --simulate lance aussi le simulateur de capteurs."""
import os, socket, sys, threading, time, traceback, webbrowser

FROZEN = getattr(sys, "frozen", False)
HERE = os.path.dirname(sys.executable) if FROZEN else os.path.dirname(os.path.abspath(__file__))

def free_port(start):
    for p in range(start, start + 20):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return start

def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except Exception:
        return None

def run_sim():
    time.sleep(3)
    import simulate_sensors
    simulate_sensors.main()

def main():
    # dossiers : données à côté de l'exécutable (jamais dans l'archive), interface embarquée
    os.environ.setdefault("ASTRO_DATA_DIR", os.path.join(HERE, "data"))
    os.environ["ASTRO_FRONT_DIR"] = os.path.join(sys._MEIPASS, "frontend") if FROZEN else os.path.join(HERE, "..", "frontend")
    port = free_port(int(os.environ.get("ASTRO_PORT", "8000")))
    os.environ["ASTRO_URL"] = f"http://127.0.0.1:{port}"
    import uvicorn
    from app.main import app
    ip = lan_ip()
    print(f"Application : http://localhost:{port}")
    if ip: print(f"Depuis un téléphone (même Wi-Fi) : http://{ip}:{port}")
    print(f"Données (locales, chiffrées) : {os.environ['ASTRO_DATA_DIR']}")
    print("Fermez cette fenêtre pour arrêter l'application.")
    threading.Timer(1.5, webbrowser.open, [f"http://localhost:{port}"]).start()
    if "--simulate" in sys.argv:
        threading.Thread(target=run_sim, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        input("\nErreur au démarrage. Appuyez sur Entrée pour fermer.")
