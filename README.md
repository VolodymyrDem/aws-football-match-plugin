<div align="center">

# ⚽ AWS Football Match Plugin

**Scout every opponent, never lose a match recording, and never miss a challenge in the Agentic Football Cup.**

![Chrome](https://img.shields.io/badge/Chrome-extension-4285F4?logo=googlechrome&logoColor=white)
![Version](https://img.shields.io/badge/version-1.43-22d3ee)
![Manifest](https://img.shields.io/badge/Manifest-V3-6e56cf)
![Install](https://img.shields.io/badge/install-one%20command-4ade80)
![Privacy](https://img.shields.io/badge/data-stays%20on%20your%20Mac-94a3b8)

<img src="docs/viewer-panel.jpg" alt="The live match viewer with the plugin: a strip under the game with shots, xG, possession, a shot map and the agents table; on the right the opponent's place, win rates, form, our record and ping" width="100%">

<sub>A real match. Under the game: this match in numbers, bars and a shot map, plus your agents. On the right, in place of the empty Coach Live Feed: everything about the opponent.</sub>

</div>

---

<p align="center"><b>⭐ If it helps your team, give it a star — it helps other teams find it.</b></p>

## 🚀 Install in one minute

Paste this into Terminal (macOS / Linux):

```bash
curl -fsSL https://raw.githubusercontent.com/shusachenko/aws-football-match-plugin/main/install.sh | bash
```

Chrome then opens `chrome://extensions` with the path already copied. Three clicks, first time only:

1. **Developer mode** — the toggle at the top right
2. **Load unpacked**
3. **Cmd+Shift+G → Cmd+V → Enter → Select**

That's it. **Updates are one click:** when a new version is out, the popup shows a green **Update to vX** button
at the top — press it and the plugin installs the new version and reloads itself.

> ♻️ **Coming from a version before 1.33?** Run the install command once more, then — one time only — click
> **Remove** on the old card in `chrome://extensions` and **Load unpacked** the same folder again (the plugin now
> has a fixed ID so the updater can talk to it). From then on, updates are the button.

> 🪟 **Windows / no Terminal:** grab the zip from [Releases](https://github.com/shusachenko/aws-football-match-plugin/releases/latest), unzip it,
> run `Install.bat` (Mac: `Install.command`, the first time right-click → Open), then the same three clicks.
>
> 💡 **Tip:** `chrome://settings/downloads` → turn off *Ask where to save each file before downloading*,
> so match files save silently.

---

## ✨ Why you'll want it

| | |
|---|---|
| 🎲 **Your win chance** | Before you challenge and during the match: the chance to win, draw or lose against that team, with fair odds. |
| 🔍 **Scouting panel in the viewer** | The opponent's place in the table, win rate overall and **against you**, your record and goals, the last result — while the match is on. |
| 🎯 **Smarter opponent picking** | Every team in *Find match* shows its rank, win rate overall and **win rate against you**, so you challenge the right teams. |
| 📼 **Every match recorded** | Ball, all 10 players and their actions ~40× a second, the commentary, the portal's report and a screenshot of the final score — saved by themselves. |
| 🔔 **Never miss a challenge** | A macOS notification and a card with **Accept** and a countdown. One click accepts and opens the viewer. |
| ▶️ **Auto-START** | Presses the viewer's START screen for you. Optional, off by default. |
| 📶 **Agents' ping at a glance** | Average and p99 latency per position, yours and the opponent's. |
| 📊 **This match, live** | Shots, xG, possession and attacking-third time as numbers and bars, plus a shot map — in a wide strip under the game. |
| 🏁 **Score on the icon + summary** | The live score on the plugin icon; at full time a summary: result, xG, shots, silent agents. |
| 📈 **Form at a glance** | The opponent's last 5 results and 24-hour trend; your own form per block of 10 matches in the popup. |
| 🛎️ **A chime you can't miss** | A sound every 12 s and a flashing portal tab while a challenge waits. |
| ⚑ **Your group, marked** | Load your tournament group as JSON: its teams are marked everywhere, plus a mini table. |
| ⬆️ **One-click updates** | A green *Update* button when a new version is out; it installs and reloads by itself. |
| 🎥 **Records even unwatched** | A match of yours with no viewer open gets one in a background tab, closed after the save. |
| 🔒 **Private by design** | Runs only on agentic-football.aws.dev, uses your own portal session, sends nothing anywhere. |

---

## 🔍 Scouting, right where you play

<table>
<tr>
<td width="50%" valign="top">

### Find match, with numbers

Open **Find opponent** and every team already tells you how it stands:

- `⚑ GROUP B` — the team is in your tournament group ([load your group](#-your-tournament-group))
- `win 79%` — your chance to beat them (hover for draw / lose and the odds)
- `#24` — place in the tournament table
- `43%` — their win rate overall (red from 60%, yellow from 45%)
- `vs us 3-0-3 (50%)` — their wins-draws-losses against **you**, and how often they beat you
  (red from 50%, yellow from 25%)

Hover a badge for the full story: record, goals and the last result against you.

Works while you type in the search box too.

</td>
<td width="50%"><img src="docs/find-match.png" alt="The Find match dialog with rank, win rate and our record next to every team"></td>
</tr>
</table>

### The match, live — under the game

A wide strip inside the game's frame, from kick-off to the final whistle:

- **score and clock**, then **shots**, an **xG guide**, **possession** and **ball in the attacking third** — numbers
  plus a bar for each (cyan = you, orange = them);
- a **shot map**: every shot where it was taken, size = xG, filled = goal; you attack to the right;
- **agents live**: per position, how much of the last 30 s each player spent on an agent command (yours and
  theirs) and how long your player has been without one — a silent agent shows at once.

Before kick-off it simply says *waiting*. **→ side panel** moves it into the right column if you prefer.

### The opponent panel

The viewer's right column (in place of the empty Coach Live Feed): **your win chance** (win / draw / lose bar and
fair odds), **your win rate against them**, the opponent's **place**, **win rate overall** and **against you**, **your record and goals**, **their last 5** results (W = they won, L = they lost) and whether
they are rising or falling over 24 h,
the **last match** between you, your agents' **ping** per position and what the plugin is doing. Sections fold
one by one; **▾** folds the whole panel to show the Coach Live Feed. It appears whether you started the match
yourself or accepted a challenge.

### At the final whistle

The plugin's icon shows the live score (green ahead, red behind) while you play. At full time a notification
sums it up — *Won 3:2 vs Feyenoord · xG 2.1:1.3 · shots 11:6 · possession 54%* — and names any agent that went
silent for 20+ s; the popup's **Last match** card shows the same with bars.

---

## ⚑ Your tournament group

Load your group once and its teams get a purple **⚑ D** mark everywhere on the portal — the leaderboard, match
lists, *Find match*, incoming challenges (card and notification) and the match panel — so you always know which
matches count for the table. Load **every group** and the other teams get a grey letter (**B**) too. The
*Settings* tab then also shows your group as a small table: place, win rate and your record against each team.

**How to load it**

1. Click the plugin's icon → **⚙ Settings** → **My group** → **Load group…**
2. Paste the JSON below (or **From file…** to pick a `.json` file) → **Save**.

Open game tabs pick it up within a minute. **Clear** removes it.

**Format** — one object with the group's name and the other teams' names:

```json
{
  "name": "D",
  "teams": [
    "Team Alpha",
    "Goal Diggers",
    "Byte FC"
  ]
}
```

| Field | What | Rules |
|---|---|---|
| `name` | the group's name, shown as *⚑ GROUP D* | text, 1–30 characters |
| `teams` | the teams in your group | 1–40 names, written as the portal shows them; capitals and a *(human)* tag are ignored |

**Every group at once** — to see each team's group on the leaderboard, list all groups and say which one is yours:

```json
{
  "mine": "D",
  "groups": {
    "A": ["Team Alpha", "Goal Diggers"],
    "B": ["Byte FC", "Null Pointers"],
    "D": ["Offside Trap", "Kick Stack"]
  }
}
```

| Field | What | Rules |
|---|---|---|
| `mine` | the name of your group | one of the keys in `groups` |
| `groups` | every group: name → its teams | 1–40 groups, each with 1–40 team names |

Your own team in the list does no harm. The group stays in your Chrome only.

---

## 🧰 The popup

<table>
<tr>
<img src="docs/popup.png" alt="The extension popup's three tabs: Match (recording, last match with bars, ping), Form (our form, recent matches) and Settings (switches, my group as a table)" width="100%">

Click the extension's icon. On top of every tab: **incoming challenges** (who is calling, their numbers, a
countdown, **Accept** and **🔇** to silence the chime) and **Update** next to the version.

| Tab | What's there |
|---|---|
| **Match** | this match: recording, report and score screenshot, each ✓ when saved, plus warnings · **Last match**: result, shots, xG, possession, silent agents · **Stop & save**, **Screenshot**, **Folder**, **Day summary** · your agents' **ping** |
| **Form** | **Our form**: W-D-L, win rate and goals per block of 10 matches (real opponents only) · **Recent matches** with ✓/✗ per file — click one to open its report |
| **⚙ Settings** | the switches (Auto-START, Auto-accept, Chime, Record in background, Save portal data) · **My group** with its table |

---

## 🎲 How the win chance is worked out

Both teams' overall win rates are combined with the classic **log5** formula (the chance that A beats B when A wins
`a` of its games and B wins `b`), draws take the two teams' average draw share, and your head-to-head record nudges
the result (it counts like 8 extra games at the estimate). Fair odds = 1 / chance. Checked on 69 real matches: the
likeliest outcome was right 64% of the time. It is an estimate, not a promise — agents change between matches.

---

## 📼 What gets saved

Open the match viewer **before kick-off** and recording starts by itself (REC on the icon). After the final
whistle, in `Downloads/agentic-football-matches/`:

| File | What it is |
|---|---|
| `match-<id>.json.gz` | The whole match: ball, all 10 players and their actions ~40× a second, game events, commentary |
| `report-<id>.txt` | The portal's match report, with the AI summary |
| `final-<id>.png` | A screenshot of the final score with both team names — proof of the result |

A page reload or a dropped connection mid-match does not break the recording.

---

## ⚙️ Switches

**▶️ Auto-START** (off by default). START is only the viewer's title screen: the match starts on the server
anyway and the title screen stays until it is clicked. With the switch on and the viewer tab visible, the
plugin looks for the orange START button on the game picture and clicks it, then stops as soon as the game
shows. It never accepts challenges.

**✅ Auto-accept challenges** (off by default, **for practice days only**). Every new incoming challenge is
accepted by itself, the viewer opens and you get a notification. Built-in safeguards:

- once switched on, it lasts only until **23:59 that day** and then turns itself off;
- it **cannot be switched on and never accepts on the tournament days (28–29 Oct)** — the tournament rules
  say every challenge is accepted by hand there; the check runs before every single accept;
- it needs an open portal tab (agentic-football.aws.dev), which it checks every 3 s.

**🛎️ Chime on challenge** (on). Three notes when a challenge comes in, again every 12 s while it waits; the
portal tab's title flashes too. **🔇** on the challenge (popup or notification) silences that one.

**🎥 Record in background** (on). A match of yours that no tab shows — accepted in the portal's own banner,
started from another device — gets its viewer in a background tab, so it is recorded; the tab closes itself after
the save.

**💾 Save portal data** (off). Writes the portal's table and your matches to `portal.json` in the matches folder,
for your own scripts. Most people don't need it.

---

## 🔒 Privacy

- Runs only on `agentic-football.aws.dev`.
- Reads the portal's API with **your own signed-in session in the page**; the token never leaves the page.
- Files go to your Downloads folder only. No servers, no analytics, no tracking.
- The updater (`updater.pl`, installed next to the plugin) does one thing: when you press *Update*, it runs this
  repo's own installer. Chrome lets only this plugin start it.
- Screenshots used to find the START button are looked at in memory and never saved.

---

## ❓ Troubleshooting

| Problem | Fix |
|---|---|
| No panel in the viewer | Reload the viewer tab once after installing or updating. |
| Chrome asks where to save every file | `chrome://settings/downloads` → turn off *Ask where to save each file before downloading*. |
| No challenges or table in the popup | Keep a portal tab open and signed in (any page of agentic-football.aws.dev). |
| Auto-START does not press | The viewer tab must be visible. The panel's *Auto-START:* line says what it sees. |
| macOS: "Install.command can't be opened" | Right-click it → **Open** → **Open** (once). |

<div align="center">
<sub>Made by The Drunkards for the Agentic Football Cup · not affiliated with AWS</sub>
</div>
