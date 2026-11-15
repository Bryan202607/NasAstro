# NasAstro · Santé équipage

Deux modes dans la même application :

| | Mode démo | Mode normal |
|---|---|---|
| Données | simulées | capteurs réels (combinaison + cabine) |
| Comptes | localStorage du navigateur | base SQLite locale, mots de passe PBKDF2, jetons JWT |
| Stockage | navigateur | `backend/data/` sur votre machine, mesures chiffrées AES-256-GCM |
| IA | règles du mock | analyse locale hors ligne (`backend/app/ai.py`) |
| Hébergement | GitHub Pages possible | PC / Raspberry Pi local |

Fonctions : jumeau 3D, tableau de bord équipage trié par gravité, **alertes persistantes** (changement de niveau détecté à la réception des mesures), bandeau + son + vibration, **rapport imprimable**, **journal d'accès** (admin), PWA installable et hors ligne.

Rôles : **astronaute** (ses données), **médecin** (les astronautes de sa mission = son équipage), **administration** (tout, + liste des comptes).

## Interface PC
Barre latérale (Équipage, Alertes, Comptes, Journal), raccourcis clavier **1 à 4** pour changer de page, **Échap** pour revenir à la liste, vue **Cartes / Tableau**, flux d'alertes en direct à droite. Sur petit écran, la barre du haut et les onglets reviennent.

## 100 % hors ligne
Aucune librairie n'est chargée depuis Internet : React est dans `frontend/vendor/react.bundle.js`. Pour le jumeau **3D**, lancer **une seule fois** `Telecharger_3D.bat` (ou `python backend/telecharger_librairies.py`, avec internet) : three.js est copié dans `frontend/vendor/`. Sans cette étape, une silhouette 2D (zones colorées, cliquable) remplace le 3D. L'exécutable Windows embarque tout (le téléchargement est fait à la compilation).

## IA cardiaque (guide de branchement)
Chaque mesure reçue passe par `backend/app/ia_cardiaque.py` (appel de `mesure()` ; `fin_de_nuit()` via `POST /api/ingest/night-end`). Résultat : panneau **IA cardiaque** dans le jumeau (état, 5 gardiens, dernières réactions), torse/niveau global qui réagissent, alertes enregistrées.
- **Moteur réel** : copier les fichiers de Steve dans `backend/ia/` (voir `backend/ia/LISEZMOI.txt`) puis `pip install -r backend/requirements-ia.txt`.
- **Sans ces fichiers** : moteur de secours simplifié (30 s + 2 min) pour voir l'IA réagir. Le simulateur (`simulate_sensors.py`) fait une fausse urgence puis une FC élevée toutes les 6 min. Le mode démo les rejoue aussi.

## Exécutable Windows
Onglet **Actions** de GitHub → *Build Windows exe* → *Run workflow* : télécharger `NasAstro-windows.zip` (artefact). Ou, sur un PC Windows avec Python : double-cliquer `backend/build_exe.bat`.
Résultat : `NasAstro.exe` + `GUIDE_UTILISATEUR.html`. Voir le guide : `frontend/guide.html`.

## Lancer le mode normal (sans exécutable)
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Au démarrage, la console affiche la **clé capteurs** et les **codes de création** des comptes médecin et administration.
Ouvrez `http://localhost:8000` (ou `http://IP-DU-PC:8000` depuis un téléphone sur le même Wi-Fi) → « Mode normal ».

1. Créez un compte astronaute (nom, âge, mission), puis un compte médecin avec la même mission (avec son code).
2. Lancez le simulateur de capteurs, dans un autre terminal : `python simulate_sensors.py`
3. Vrais capteurs : envoyez en POST `/api/ingest/biometrics` et `/api/ingest/environment` avec l'en-tête `X-Ingest-Key`.

## Mode démo sur GitHub Pages
Settings → Pages → Source : **GitHub Actions**, puis push sur `main`. Le workflow publie `frontend/`.
Sur Pages seul le mode démo fonctionne (pas de serveur) ; pour le mode normal, ouvrez l'app depuis le serveur local.

## Sécurité
- `backend/data/` contient la base, les clés AES/JWT et les codes : déjà dans `.gitignore`, ne jamais le publier.
- Sauvegardez `aes256.key` : sans elle, les mesures chiffrées sont illisibles.
- Les seuils de `ai.py` sont des valeurs de prototype, à valider par un médecin. Ce n'est pas un dispositif médical.
