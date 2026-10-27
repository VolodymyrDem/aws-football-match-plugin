# aws-football-match-plugin — a Chrome extension for the Agentic Football Cup

Records every match you watch on agentic-football.aws.dev, shows the opponent's numbers right in the
match viewer, announces incoming challenges and can press START for you. It runs only on
agentic-football.aws.dev and sends nothing anywhere: files go to your Downloads folder.

## Install with one command (macOS / Linux)

Paste into Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/shusachenko/aws-football-match-plugin/main/install.sh | bash
```

It downloads the latest version, puts it in a fixed folder, copies that path and opens
`chrome://extensions`. Three clicks are left there (first time only): **Developer mode** (toggle,
top right) → **Load unpacked** → Cmd+Shift+G, Cmd+V, Enter → **Select**. Chrome lets no program add
an extension by itself, so these clicks are yours.

**Update: run the same command**, then press ↻ on the extension's card in `chrome://extensions`.

Tip: `chrome://settings/downloads` → turn off "Ask where to save each file before downloading",
otherwise Chrome asks about every match file.

### Windows, or without Terminal

Download the zip (Code → Download ZIP, or Releases), unzip it and run `Install.bat` (Windows) or
`Install.command` (Mac: the first time right-click → Open). Then the same three clicks.

The extension lives in a fixed folder (`~/Library/Application Support/AwsFootballMatchPlugin`, or
`%LOCALAPPDATA%\AwsFootballMatchPlugin`), so the download can be deleted afterwards. Open portal tabs
pick up a new version by themselves after ↻.

## What it does

**Match recording.** Open a match viewer and recording starts by itself (REC on the icon). After the
final whistle `Downloads/agentic-football-matches/` gets:
- `match-<id>.json.gz` — the whole match: ball, all 10 players and their actions ~40 times a second, commentary;
- `report-<id>.txt` — the portal's match report (with the AI summary);
- `final-<id>.png` — a screenshot of the final score with both team names (proof of the result).
Reloading the page mid-match does not break the recording. Open the viewer **before kick-off**.

**Panel in the viewer** (in place of "Coach Live Feed"): the opponent and their place, win rate
overall and against you, your record against them, ping per position, recording status. ▾ folds the
panel so the coach feed shows.

**Find match list**: next to every team, its place, win rate and your record against it (also while
searching).

**Extension popup** (click the icon):
- the current match: what is recorded and saved (recording / report / screenshot), warnings;
- **incoming challenges** with an Accept button and a countdown; the viewer opens after accepting;
- **Auto-START** (switch, off by default): presses START in the viewer for you;
- **Auto-accept challenges** (switch, workshop day only): turns itself off at 23:59 and never works on
  28–29 Oct — in the tournament every challenge is accepted by hand;
- agents' ping: average and p99, per match for both teams;
- "Day summary" copies a table of today's matches; recent matches with ✓/✗ per file.

**macOS notifications**: a new challenge, the end of a match (what was saved or what is missing), a
late start of the recording.

The table and opponents come from the portal with your own session (keep a portal tab open; see
"Portal data" in the popup). The record against a team counts the ~100 latest matches the portal
returns and keeps growing from there.
