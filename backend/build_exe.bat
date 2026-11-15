@echo off
REM Compile l'application en exécutable Windows (dossier dist\JumeauNumerique).
REM Prérequis : Python 3.10+ installé (cocher "Add to PATH").
cd /d "%~dp0"
pip install -r requirements.txt pyinstaller || goto :err
pyinstaller --noconfirm --name JumeauNumerique --add-data "..\frontend;frontend" --collect-submodules uvicorn --collect-submodules anyio --hidden-import simulate_sensors launcher.py || goto :err
echo @echo off> dist\JumeauNumerique\Lancer_avec_simulateur.bat
echo start "" "%%~dp0JumeauNumerique.exe" --simulate>> dist\JumeauNumerique\Lancer_avec_simulateur.bat
copy ..\frontend\guide.html dist\JumeauNumerique\GUIDE_UTILISATEUR.html >nul
echo.
echo Termine : dist\JumeauNumerique\JumeauNumerique.exe
pause
exit /b 0
:err
echo Echec de la compilation.
pause
