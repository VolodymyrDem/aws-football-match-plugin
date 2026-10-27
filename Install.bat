@echo off
rem Football Match Helper - installer / updater for Windows. Double-click it.
rem Copies the extension to %LOCALAPPDATA%\FootballMatchHelper, copies that path and opens
rem Chrome's extensions page. Chrome itself does not let any program add an extension.
chcp 65001 >nul
set "SRC=%~dp0extension"
set "DEST=%LOCALAPPDATA%\FootballMatchHelper"
if not exist "%SRC%\manifest.json" (
  echo Ne znaishov papku extension poruch z instalyatorom. Rozpakui zip povnistyu.
  pause
  exit /b 1
)
set UPDATE=0
if exist "%DEST%\manifest.json" set UPDATE=1
robocopy "%SRC%" "%DEST%" /MIR /NFL /NDL /NJH /NJS /NP >nul
echo|set /p="%DEST%"|clip
start "" chrome "chrome://extensions/"
echo.
if "%UPDATE%"=="1" (
  echo Onovleno. U Chrome na kartci "Drunkards match recorder" natysny "onovyty" ^(kruhla strilka^).
) else (
  echo Maizhe hotovo. U vkladci chrome://extensions:
  echo   1. Uvimkny "Developer mode" ^(peremykach sprava vhori^).
  echo   2. Natysny "Load unpacked".
  echo   3. Vstav shlyakh ^(Ctrl+V^) u pole adresy vikna vyboru, Enter, potim "Select Folder".
  echo Shlyakh uzhe skopiyovano: %DEST%
)
echo.
pause
