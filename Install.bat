@echo off
rem AWS Football Match Plugin - installer / updater for Windows. Double-click it.
rem Copies the extension to %LOCALAPPDATA%\AwsFootballMatchPlugin, copies that path and opens
rem Chrome's extensions page. Chrome itself does not let any program add an extension.
chcp 65001 >nul
set "SRC=%~dp0extension"
set "DEST=%LOCALAPPDATA%\AwsFootballMatchPlugin"
if not exist "%SRC%\manifest.json" (
  echo No extension folder next to the installer. Unzip the whole archive first.
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
  echo Updated. In Chrome press reload ^(the round arrow^) on the "AWS Football Match Plugin" card.
) else (
  echo Almost done. In the chrome://extensions tab:
  echo   1. Turn on "Developer mode" ^(toggle, top right^).
  echo   2. Click "Load unpacked".
  echo   3. Paste the path ^(Ctrl+V^) into the dialog's address field, Enter, then "Select Folder".
  echo The path is already copied: %DEST%
)
echo.
pause
