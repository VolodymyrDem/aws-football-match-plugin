#!/bin/bash
# Football Match Helper — installer / updater for macOS. Double-click it (the first time:
# right-click → Open, macOS asks once for files from the internet).
# Copies the extension to ~/Library/Application Support/FootballMatchHelper (a fixed place, so the zip
# can be deleted and updates land in the same spot), copies that path, opens Chrome's extensions page
# and says which three things to click. Chrome itself does not let any program add an extension.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/FootballMatchHelper"
SRC="$HERE/extension"
if [ ! -f "$SRC/manifest.json" ]; then
  osascript -e 'display alert "Football Match Helper" message "Не знайшов папку extension поруч з інсталятором. Розпакуй zip повністю і запусти Install ще раз."'
  exit 1
fi
UPDATE=0
[ -f "$DEST/manifest.json" ] && UPDATE=1
mkdir -p "$DEST"
rsync -a --delete "$SRC/" "$DEST/"
VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DEST/manifest.json" | head -1)"
printf '%s' "$DEST" | pbcopy
open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || open "https://www.google.com/chrome/"
if [ "$UPDATE" = 1 ]; then
  osascript -e "display dialog \"Оновлено до версії $VER.\n\nУ Chrome на картці «Drunkards match recorder» натисни ↻ (оновити). Відкриті вкладки гри підхоплять нову версію самі.\" with title \"Football Match Helper\" buttons {\"Готово\"} default button 1"
else
  osascript -e "display dialog \"Майже готово (версія $VER). У вкладці chrome://extensions, що відкрилась:\n\n1. Увімкни «Developer mode» (перемикач справа вгорі).\n2. Натисни «Load unpacked».\n3. У вікні вибору натисни Cmd+Shift+G, Cmd+V, Enter, потім «Select».\n\nШлях уже скопійовано. Порада: chrome://settings/downloads → вимкни «Ask where to save each file».\" with title \"Football Match Helper\" buttons {\"Готово\"} default button 1"
fi
