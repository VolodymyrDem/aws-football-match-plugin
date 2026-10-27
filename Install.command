#!/bin/bash
# AWS Football Match Plugin — installer / updater for macOS. Double-click it (the first time:
# right-click → Open, macOS asks once for files from the internet).
# Copies the extension to ~/Library/Application Support/AwsFootballMatchPlugin (a fixed place, so the zip
# can be deleted and updates land in the same spot), copies that path, opens Chrome's extensions page
# and says which three things to click. Chrome itself does not let any program add an extension.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/AwsFootballMatchPlugin"
SRC="$HERE/extension"
if [ ! -f "$SRC/manifest.json" ]; then
  osascript -e 'display alert "AWS Football Match Plugin" message "No extension folder next to the installer. Unzip the whole archive and run Install again."'
  exit 1
fi
UPDATE=0
[ -f "$DEST/manifest.json" ] && UPDATE=1
mkdir -p "$DEST"
rsync -a --delete "$SRC/" "$DEST/"
VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DEST/manifest.json" | head -1)"
# 1.33: the one-click updater (see install.sh), registered for this plugin's fixed ID
if [ -f "$HERE/updater.pl" ]; then
  mkdir -p "$DEST-updater"
  sed "s#@REPO@#shusachenko/aws-football-match-plugin#g; s#@DEST@#$DEST#g" "$HERE/updater.pl" > "$DEST-updater/updater.pl" && chmod +x "$DEST-updater/updater.pl"
  for H in "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"; do
    [ -d "$(dirname "$H")" ] || continue
    mkdir -p "$H"
    printf '{"name": "com.awsfootball.updater", "description": "AWS Football Match Plugin updater", "path": "%s", "type": "stdio", "allowed_origins": ["chrome-extension://cmliiifpnbhojabdafknaipjemeakdak/"]}\n' "$DEST-updater/updater.pl" > "$H/com.awsfootball.updater.json"
  done
fi
printf '%s' "$DEST" | pbcopy
open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || open "https://www.google.com/chrome/"
if [ "$UPDATE" = 1 ]; then
  osascript -e "display dialog \"Updated to version $VER.\n\nIn Chrome press ↻ (reload) on the AWS Football Match Plugin card. Open game tabs pick up the new version by themselves.\" with title \"AWS Football Match Plugin\" buttons {\"Done\"} default button 1"
else
  osascript -e "display dialog \"Almost done (version $VER). In the chrome://extensions tab that opened:\n\n1. Turn on Developer mode (toggle, top right).\n2. Click Load unpacked.\n3. In the file dialog press Cmd+Shift+G, Cmd+V, Enter, then Select.\n\nThe path is already copied. Tip: chrome://settings/downloads → turn off Ask where to save each file.\" with title \"AWS Football Match Plugin\" buttons {\"Done\"} default button 1"
fi
