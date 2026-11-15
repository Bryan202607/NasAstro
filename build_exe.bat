@echo off
REM Compile l'application en exécutable Windows (dossier dist\NasAstro).
REM Prérequis : Python 3.10+ installé (cocher "Add to PATH").
cd /d "%~dp0"
pip install -r requirements.txt pyinstaller || goto :err
python telecharger_librairies.py || goto :err
pyinstaller --noconfirm --windowed --icon icon.ico --name NasAstro --add-data "..\frontend;frontend" --add-data "icon.ico;." --collect-submodules uvicorn --collect-submodules anyio --collect-all webview --hidden-import simulate_sensors launcher.py || goto :err
echo @echo off> dist\NasAstro\Lancer_avec_simulateur.bat
echo start "" "%%~dp0NasAstro.exe" --simulate>> dist\NasAstro\Lancer_avec_simulateur.bat
copy ..\frontend\guide.html dist\NasAstro\GUIDE_UTILISATEUR.html >nul
echo.
echo Termine : dist\NasAstro\NasAstro.exe
pause
exit /b 0
:err
echo Echec de la compilation.
pause
