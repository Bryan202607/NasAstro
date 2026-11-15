"""Lanceur de l'application (point d'entrée de l'exécutable Windows).
Démarre le serveur local et ouvre l'application dans sa propre fenêtre (Edge/Chrome en mode application : ni onglets ni barre d'adresse).
Option --browser : ouvre un onglet de navigateur normal. Affiche aussi l'adresse pour le téléphone.
Option : --simulate lance aussi le simulateur de capteurs."""
import os, socket, subprocess, sys, threading, time, traceback, webbrowser

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

def app_browser():
    """Cherche Edge (présent sur Windows 10/11) puis Chrome, pour ouvrir l'appli dans sa propre fenêtre."""
    roots = [os.environ.get(k) for k in ("ProgramFiles(x86)", "ProgramFiles", "LocalAppData")]
    for rel in (r"Microsoft\Edge\Application\msedge.exe", r"Google\Chrome\Application\chrome.exe"):
        for r in roots:
            if r and os.path.exists(os.path.join(r, rel)): return os.path.join(r, rel)
    return None

def start_server(uvicorn, app, port):
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning", log_config=None)

def wait_server(port, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return True
        time.sleep(0.2)
    return False

def main():
    if sys.stdout is None or sys.stderr is None:
        os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
        sys.stdout = sys.stderr = open(os.path.join(HERE, "data", "nasastro.log"), "a", encoding="utf8", buffering=1)
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
    if "--simulate" in sys.argv:
        threading.Thread(target=run_sim, daemon=True).start()
    url = f"http://127.0.0.1:{port}"
    if "--browser" not in sys.argv:
        exe = app_browser()
        if exe:  # fenêtre "application" (sans barre d'adresse ni onglets) : Edge ou Chrome en mode --app
            threading.Thread(target=start_server, args=(uvicorn, app, port), daemon=True).start()
            wait_server(port)
            prof = os.path.join(os.environ["ASTRO_DATA_DIR"], "ui-profile")
            try:
                subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={prof}", "--window-size=1366,850", "--no-first-run", "--no-default-browser-check"]).wait()
                os._exit(0)  # fermer la fenêtre arrête l'application
            except Exception:
                traceback.print_exc()
            webbrowser.open(url)
            while True: time.sleep(3600)
    threading.Timer(1.5, webbrowser.open, [url]).start()
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning", log_config=None)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        if sys.stdin: input("\nErreur au démarrage. Appuyez sur Entrée pour fermer.")
