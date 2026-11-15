"""À lancer UNE SEULE FOIS (avec internet) : télécharge three.js dans frontend/vendor/ pour le jumeau 3D.
Ensuite l'application fonctionne sans aucune connexion. (React est déjà fourni dans vendor/.)
Sans ces fichiers, l'appli marche quand même : une silhouette 2D remplace le 3D."""
import os, urllib.request
VENDOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "vendor")
FILES = {
    "three.min.js": "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
    "OrbitControls.js": "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js",
    "GLTFLoader.js": "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js",
    "SkeletonUtils.js": "https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/utils/SkeletonUtils.js",
}
os.makedirs(VENDOR, exist_ok=True)
for name, url in FILES.items():
    dest = os.path.join(VENDOR, name)
    if os.path.exists(dest) and os.path.getsize(dest) > 1000: print("déjà là :", name); continue
    try:
        urllib.request.urlretrieve(url, dest); print("téléchargé :", name)
    except Exception as e:
        print("ÉCHEC", name, "->", e); raise SystemExit(1)
print("Terminé : le jumeau 3D fonctionne maintenant hors ligne.")
