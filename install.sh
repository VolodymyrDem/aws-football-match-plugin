#!/bin/bash
# AWS Football Match Plugin — install or update with one command (macOS / Linux):
#   curl -fsSL https://raw.githubusercontent.com/shusachenko/aws-football-match-plugin/main/install.sh | bash
# Downloads the newest extension from GitHub (the main branch), puts it in a fixed folder, copies
# that path and opens Chrome's extensions page. Chrome itself lets no program add an extension, so
# three clicks are left there (Developer mode, Load unpacked, paste the path) — only the first time.
set -euo pipefail
REPO="${FMH_REPO:-shusachenko/aws-football-match-plugin}"
case "$(uname -s)" in
  Darwin) DEST="$HOME/Library/Application Support/AwsFootballMatchPlugin" ;;
  *)      DEST="${XDG_DATA_HOME:-$HOME/.local/share}/AwsFootballMatchPlugin" ;;
esac
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "⚽ AWS Football Match Plugin: downloading from github.com/$REPO …"
curl -fsSL "${FMH_TARBALL:-https://codeload.github.com/$REPO/tar.gz/refs/heads/main}" | tar -xz -C "$TMP"
SRC="$(find "$TMP" -maxdepth 3 -type f -name manifest.json -path '*/extension/*' | head -1)"
[ -n "$SRC" ] || { echo "No extension found in the $REPO archive." >&2; exit 1; }
SRC="$(dirname "$SRC")"

UPDATE=0; [ -f "$DEST/manifest.json" ] && UPDATE=1
HAD_UPDATER=0; [ -f "$DEST-updater/updater.pl" ] && HAD_UPDATER=1
mkdir -p "$DEST"
rm -rf "${DEST:?}/"*
cp -R "$SRC/." "$DEST/"
VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$DEST/manifest.json" | head -1)"

# One-click updates (1.33): a small helper (perl, built into macOS / Linux) that the plugin's Update button
# calls; it runs this installer again. Chrome starts it only for this plugin's fixed ID.
EXT_ID="cmliiifpnbhojabdafknaipjemeakdak"
if [ -f "$SRC/../updater.pl" ] && command -v perl >/dev/null; then
  mkdir -p "$DEST-updater"
  sed "s#@REPO@#$REPO#g; s#@DEST@#$DEST#g" "$SRC/../updater.pl" > "$DEST-updater/updater.pl"
  chmod +x "$DEST-updater/updater.pl"
  case "$(uname -s)" in
    Darwin) HOSTS=("$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" "$HOME/Library/Application Support/Chromium/NativeMessagingHosts") ;;
    *)      HOSTS=("$HOME/.config/google-chrome/NativeMessagingHosts" "$HOME/.config/chromium/NativeMessagingHosts") ;;
  esac
  for H in "${HOSTS[@]}"; do
    [ -d "$(dirname "$H")" ] || continue
    mkdir -p "$H"
    cat > "$H/com.awsfootball.updater.json" <<JSON
{"name": "com.awsfootball.updater", "description": "AWS Football Match Plugin updater",
 "path": "$DEST-updater/updater.pl", "type": "stdio", "allowed_origins": ["chrome-extension://$EXT_ID/"]}
JSON
  done
fi
[ -n "${FMH_QUIET:-}" ] && { echo "updated to $VER"; exit 0; }   # the Update button: no Chrome tab, no text

if command -v pbcopy >/dev/null; then printf '%s' "$DEST" | pbcopy; COPIED=" (already copied)"
elif command -v xclip >/dev/null; then printf '%s' "$DEST" | xclip -selection clipboard; COPIED=" (already copied)"
else COPIED=""; fi

if [ "$(uname -s)" = Darwin ]; then open -a "Google Chrome" "chrome://extensions/" 2>/dev/null || true
elif command -v google-chrome >/dev/null; then (google-chrome "chrome://extensions/" >/dev/null 2>&1 &) || true; fi

echo
if [ "$UPDATE" = 1 ] && [ "$HAD_UPDATER" = 0 ]; then
  echo "✅ Updated to version $VER — with one-click updates from now on."
  echo "   One time only: in chrome://extensions click \"Remove\" on the old \"AWS Football Match Plugin\" card,"
  echo "   then \"Load unpacked\" and pick the same folder$COPIED: $DEST"
  echo "   After that, new versions install from the plugin's own Update button."
elif [ "$UPDATE" = 1 ]; then
  echo "✅ Updated to version $VER."
  echo "   In chrome://extensions press ↻ on the \"AWS Football Match Plugin\" card (or Update in the plugin)."
else
  echo "✅ Version $VER installed in: $DEST"
  echo "   Path$COPIED. In the chrome://extensions tab that opened:"
  echo "   1. Turn on \"Developer mode\" (toggle, top right)."
  echo "   2. Click \"Load unpacked\"."
  echo "   3. Mac: Cmd+Shift+G → Cmd+V → Enter → \"Select\". Linux: paste the path into the location field."
  echo "   Tip: chrome://settings/downloads → turn off \"Ask where to save each file before downloading\"."
fi
echo "   To update later: the plugin's Update button (or run the same command)."
