// Popup: what the recorder is doing in this tab, what was saved for each match, and
// the buttons that used to be the toolbar click (stop + save) plus a screenshot.
const SITE = "https://agentic-football.aws.dev";
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const hhmm = ms => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const num = n => Number(n || 0).toLocaleString("en-GB");

let tab = null, cur = null;   // active tab, its match (history entry + live status)

function teamsLine(h) {
  if (h && h.home && h.away) {
    const sc = h.score ? `${h.score[0]} — ${h.score[1]}` : "—";
    return `<span>${esc(h.home)}</span><span class="score">${sc}</span><span>${esc(h.away)}</span>`;
  }
  if (h && h.score) return `<span>Match ${esc(h.id.slice(0, 8))}</span><span class="score">${h.score[0]} — ${h.score[1]}</span>`;
  return h ? `<span>Match ${esc(h.id.slice(0, 8))}</span>` : "";
}

function renderCurrent(st, h, onSite, reportId) {
  const el = $("current");
  if (!onSite) {
    el.innerHTML = `<div class="pill idle"><span class="dot"></span>This tab is not a match</div>
      <div class="hint">Recording runs by itself in the match viewer tab on agentic-football.aws.dev.
      Open the viewer <b>before kick-off</b>.</div>`;
    return;
  }
  if (!st && !h) {
    el.innerHTML = `<div class="pill idle"><span class="dot"></span>Not recording</div>
      <div class="hint">Open the match viewer (before kick-off) and recording starts by itself.
      If the viewer is open and this stays empty, reload the page.</div>`;
    return;
  }
  const now = Date.now();
  const saved = h && h.rec;
  const stale = st && !saved && !st.stopped && st.lastWall && now - st.lastWall > 8000 && st.t < 118;
  const late = (st ? st.t0 : h && h.t0) > 3;
  let pill;
  if (saved) pill = `<div class="pill ok"><span class="dot"></span>Recording saved</div>`;
  else if (st && st.stopped) pill = `<div class="pill idle"><span class="dot"></span>Recording stopped</div>`;
  else if (stale) pill = `<div class="pill warn"><span class="dot"></span>No frames for ${Math.round((now - st.lastWall) / 1000)} s</div>`;
  else if (st && st.n) pill = `<div class="pill rec"><span class="dot"></span>Recording</div>`;
  else pill = `<div class="pill idle"><span class="dot"></span>Waiting for kick-off</div>`;

  const t = st ? st.t : h && h.t, n = (saved && saved.n) || (st ? st.n : h && h.n);
  const meta = n ? `${Math.round(t || 0)} s of play · ${num(n)} frames` : "";
  const check = (ok, label, when, pending) =>
    `<li><span class="mark ${ok ? "ok" : "wait"}">${ok ? "✓" : pending ? "…" : "○"}</span>${label}` +
    `<span class="when">${ok && when ? hhmm(when) : ""}</span></li>`;
  const onReport = !!reportId;
  const checks = `<ul class="checks">
      ${check(saved, "Match recording" + (saved && saved.n ? ` (${num(saved.n)} frames)` : ""), saved && saved.at, st && !st.stopped)}
      ${check(h && h.report, h && h.report && h.report.full === false ? "Report (no AI summary yet)" : "Report", h && h.report && h.report.at, onReport)}
      ${check(h && (h.shot || h.manualShot), "Score screenshot", h && (h.shot || h.manualShot || {}).at, onReport)}
    </ul>`;
  const warns = [];
  if (late) warns.push(`Recording started at second ${Math.round(st ? st.t0 : h.t0)}: the start of the match is missing.`);
  if (stale) warns.push("The socket is silent: check the match is not paused, or reload the tab (recording continues).");
  if ((st ? st.reloads : h && h.reloads) > 0) warns.push(`Reloads: ${st ? st.reloads : h.reloads}; recording continued, nothing lost.`);
  if (h && h.err && h.err.length) warns.push(...h.err.slice(-2).map(esc));
  let hint = "";
  if (onReport && h && !h.report) hint = `<div class="hint">Waiting for the AI summary on the report page; it saves by itself (up to 3 min).</div>`;
  else if (onReport && h && h.report && !h.shot && !h.manualShot) hint = `<div class="hint">The screenshot is taken when this tab is visible.</div>`;
  else if (saved && !(h && h.report)) hint = `<div class="hint">The report and screenshot are saved on the report page; the viewer goes there by itself (or click the match below).</div>`;
  else if (st && st.auto && st.auto.on && !st.auto.pressed && !saved) hint = `<div class="hint">Auto-START: ${
    st.auto.clicks ? `pressing START (${st.auto.clicks})` : "waiting for the START screen"}. The tab must be visible.</div>`;
  else if (!saved && st && !st.stopped && st.n) hint = `<div class="hint">Saves by itself after the final whistle. Do not open another match in this tab.</div>`;
  const oppName = h && h.home && h.away ? (normName(h.home) === normName(usName()) ? h.away : h.home) : null;
  el.innerHTML = `${pill}<div class="teams">${teamsLine(h || { id: st.id })}</div>${oppName ? `<div class="opp">${oppLine(oppName, null)}</div>` : ""}
    <div class="meta">${meta}</div>${checks}
    ${warns.length ? `<div class="warns">${warns.map(w => `<div>⚠ ${w}</div>`).join("")}</div>` : ""}${hint}`;
}

// ---- Last match (1.34): the newest finished match — result ours first, live stats as bars, silent agents.
const POS5 = ["GK", "DEF", "MID", "FWD1", "FWD2"];
async function renderLast(hist, liveId) {
  const el = $("last");
  const h = Object.values(hist).filter(x => x.id !== liveId && x.score && (x.rec || x.notifiedEnd)).sort((a, b) => (b.first || 0) - (a.first || 0))[0];
  if (!h) { el.innerHTML = `<div class="meta">No finished match recorded yet.</div>`; return; }
  const { lb } = await chrome.storage.local.get("lb");
  const me = String((lb && lb.us && lb.us.name) || "The Drunkards").trim().toLowerCase();
  const us = String(h.away || "").replace(/\s*\((людина|human)\)/i, "").trim().toLowerCase() === me ? 1 : 0;
  const a = h.score[us], b = h.score[1 - us], opp = (us ? h.home : h.away) || "?";
  const res = a > b ? ["Won", "ok"] : a < b ? ["Lost", "bad"] : ["Draw", "warn"];
  const S = h.sum;
  const bar = (label, x, y, f = v => v) => { const t = (x || 0) + (y || 0), w = t ? Math.round(100 * (x || 0) / t) : 50;
    return `<div class="bar"><span class="v">${f(x)}</span><span class="t"><i class="us" style="width:${w}%"></i><i class="th" style="width:${100 - w}%"></i><b>${label}</b></span><span class="v r">${f(y)}</span></div>`; };
  const silent = Object.entries(h.off || {}).filter(([k, v]) => +k.split(":")[0] === us && +k.split(":")[1] > 0 && v >= 20).map(([k, v]) => `${POS5[+k.split(":")[1]]} ${v} s`);
  el.innerHTML = `<div class="sumhead"><span><span class="${res[1]}" style="font-weight:700">${res[0]}</span> vs ${esc(opp)}</span><span class="sc">${a}:${b}</span></div>
    <div class="meta">${hhmm(h.first)} · ${[h.rec ? "recording ✓" : "recording ✗", h.report ? "report ✓" : "report ✗", h.shot || h.manualShot ? "screenshot ✓" : "screenshot ✗"].join(" · ")}</div>
    ${S ? `<div class="bars">${bar("shots", S.sh[us], S.sh[1 - us])}${bar("xG", S.xg[us], S.xg[1 - us], v => (v || 0).toFixed(1))}${S.pos ? bar("possession", S.pos[us], S.pos[1 - us], v => v + "%") : ""}${S.third ? bar("attacking third", S.third[us], S.third[1 - us], v => v + "%") : ""}</div>` : `<div class="meta" style="margin-top:6px">No live stats for this one (recorded before 1.34).</div>`}
    ${silent.length ? `<div class="warns">Silent agents (20+ s without a command): ${esc(silent.join(", "))}</div>` : ""}`;
  el.onclick = () => chrome.tabs.create({ url: `${SITE}/matches/${h.id}/report` });
  el.style.cursor = "pointer"; el.title = "Open the report";
}

function renderList(hist, liveId) {
  const rows = Object.values(hist).filter(h => !String(h.id).startsWith("unknown"))
    .sort((a, b) => b.first - a.first).slice(0, 12);
  if (!rows.length) { $("list").innerHTML = `<div class="empty">Nothing recorded yet.</div>`; return; }
  // ✓ saved, ✗ missing, … still being recorded (the match open in this tab)
  const f = (ok, label, live) => ok ? `<td class="f y" title="${label}: saved">✓</td>`
    : live ? `<td class="f p" title="${label}: in progress">…</td>` : `<td class="f n" title="${label}: missing">✗</td>`;
  $("list").innerHTML = `<table><colgroup><col style="width:40px"><col><col style="width:40px"><col style="width:40px"><col style="width:40px"></colgroup>
    <tr><th></th><th></th><th class="f">rec</th><th class="f">report</th><th class="f">shot</th></tr>${rows.map(h => {
    // still recording: open in this tab, or a status came in the last 15 s (another tab)
    const live = !h.rec && (h.id === liveId || Date.now() - (h.last || 0) < 15000);
    const name = h.home && h.away ? `${esc(h.home)} ${h.score ? h.score.join("—") : ""} ${esc(h.away)}`
      : `${esc(h.id.slice(0, 8))}${h.score ? " · " + h.score.join("—") : ""}`;
    return `<tr class="match" data-id="${esc(h.id)}" title="Open the report (saves a missing report and screenshot)">
      <td class="time">${hhmm(h.first)}</td><td class="name">${name}</td>
      ${f(h.rec, "recording", live)}${f(h.report, "report", live)}${f(h.shot || h.manualShot, "screenshot", live)}</tr>`;
  }).join("")}</table>`;
}

async function refresh() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = (tab && tab.url) || "";
  const onSite = url.startsWith(SITE);
  const reportM = url.match(/\/matches\/([0-9a-f-]{36})\/report/);
  const key = "tab:" + (tab ? tab.id : -1);
  const st = (await chrome.storage.session.get(key))[key] || null;
  const { hist = {} } = await chrome.storage.local.get("hist");
  const id = (st && st.id) || (reportM && reportM[1]) || ((url.match(UUID) || [])[1]);
  const h = id ? hist[id] || null : null;
  cur = { id, st, h };
  renderCurrent(st, h, onSite, reportM && reportM[1]);
  renderList(hist, st && !st.stopped ? st.id : null);
  renderLast(hist, st && !st.stopped && !(h && h.rec) ? st.id : null);
  renderAuto();
  renderAA();
  $("save").hidden = !(onSite && st && !st.stopped && st.n && !(h && h.rec));
  $("shot").disabled = !tab || !/^https?:/.test(url);
}

// auto-START switch (off by default) and what it knows about the button position
async function renderAuto() {
  const { autoStart = false } = await chrome.storage.local.get("autoStart");
  $("autoStart").checked = !!autoStart;
  $("autoInfo").textContent = autoStart ? "· presses START when it sees the title screen (tab must be visible)" : "· off";
}
// Auto-accept (1.13): workshop day only. Switching it on lasts until 23:59 today; it cannot be
// switched on during the tournament (28-29.10.2026: every challenge is accepted by hand).
const TOURNAMENT = [Date.parse("2026-10-28T00:00:00Z"), Date.parse("2026-10-30T00:00:00Z")];
const inTournament = () => Date.now() >= TOURNAMENT[0] && Date.now() < TOURNAMENT[1];
async function renderAA() {
  const { autoAccept } = await chrome.storage.local.get("autoAccept");
  const on = !!(autoAccept && autoAccept.on && Date.now() < (autoAccept.until || 0) && !inTournament());
  $("autoAccept").checked = on;
  $("autoAccept").disabled = inTournament();
  $("aaInfo").textContent = inTournament() ? "· not available during the tournament (rules: by hand only)"
    : on ? `· on until ${new Date(autoAccept.until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "· off";
}
$("autoAccept").addEventListener("change", async e => {
  if (e.target.checked && inTournament()) { e.target.checked = false; return; }
  const end = new Date(); end.setHours(23, 59, 0, 0);
  await chrome.storage.local.set({ autoAccept: e.target.checked ? { on: true, until: Math.min(end.getTime(), TOURNAMENT[0]), at: Date.now() } : { on: false, offAt: Date.now() } });
  renderAA();
  toast(e.target.checked ? "Auto-accept is on until the end of the day. Keep a portal tab open." : "Auto-accept is off.");
});
renderAA();

$("autoStart").addEventListener("change", async e => {
  await chrome.storage.local.set({ autoStart: e.target.checked });
  renderAuto();
  toast(e.target.checked ? "Auto-START is on: works in new and already open viewers." : "Auto-START is off.");
});
renderAuto();

// Chime on challenge (1.28, on by default); switching it on plays it once as a test.
async function renderSound() {
  const { inviteSound = true } = await chrome.storage.local.get("inviteSound");
  $("inviteSound").checked = !!inviteSound;
  $("soundInfo").textContent = inviteSound ? "· every 12 s while one waits" : "· off";
}
$("inviteSound").addEventListener("change", async e => {
  await chrome.storage.local.set({ inviteSound: e.target.checked });
  if (e.target.checked) chrome.runtime.sendMessage({ type: "popup-chime-test" }).catch(() => {});
  renderSound();
});
renderSound();

// Save portal data (1.30): portal.json for the emulator and scripts. With the helper it is written
// directly (no download in Chrome); without it, a Chrome download — so off by default there.
const TEAM_BUILD = true;   // package.sh: true (nativeMessaging is there for the updater only)
const HAS_HELPER = !TEAM_BUILD && typeof chrome.runtime.sendNativeMessage === "function";
async function renderPS() {
  const { portalSave = HAS_HELPER } = await chrome.storage.local.get("portalSave");
  $("portalSave").checked = !!portalSave;
  $("psInfo").textContent = !portalSave ? "· off" : HAS_HELPER ? "· written quietly by the helper" : "· as a Chrome download";
}
$("portalSave").addEventListener("change", async e => { await chrome.storage.local.set({ portalSave: e.target.checked }); renderPS(); });
renderPS();

// Record in background (1.28, on by default).
async function renderBg() {
  const { bgRec = true } = await chrome.storage.local.get("bgRec");
  $("bgRec").checked = !!bgRec;
  $("bgInfo").textContent = bgRec ? "· opens a missing viewer in a background tab" : "· off";
}
$("bgRec").addEventListener("change", async e => { await chrome.storage.local.set({ bgRec: e.target.checked }); renderBg(); });
renderBg();

// ---- Our form (1.28): did the newest agent version do better than the ones before? Per version
// when the local helper knows which version played (match-work metrics), else per block of 10
// matches. Real opponents only (practice matches against the sample bots are left out).
function formRows(list) {
  const n = list.length, w = list.filter(m => m.us > m.them).length, l = list.filter(m => m.us < m.them).length;
  const gf = n ? list.reduce((a, m) => a + m.us, 0) / n : 0, ga = n ? list.reduce((a, m) => a + m.them, 0) / n : 0;
  return { n, w, d: n - w - l, l, wr: n ? Math.round(100 * w / n) : 0, gf, ga };
}
function renderForm(h) {
  const el = $("form");
  if (!h || !h.ok) { el.innerHTML = `<div class="meta">no data yet: open the portal once</div>`; return; }
  const ts = m => { const s = String(m.at || ""); const t = Date.parse(s.replace(/^(\d{4}-\d\d-\d\d)_(\d\d)(\d\d)$/, "$1T$2:$3")); return isNaN(t) ? 0 : t; };
  let all = Object.values(h.matches || {}).filter(m => typeof m.us === "number" && typeof m.them === "number");
  const BOTS = /^(Fort Knox Athletic|Total Attack United|The Benchmark FC)$/i;
  const real = all.filter(m => !m.practice && !BOTS.test(String(m.opp || "").trim()));
  if (real.length >= 5) all = real;
  all.sort((a, b) => ts(b) - ts(a));
  if (!all.length) { el.innerHTML = `<div class="meta">no finished matches yet</div>`; return; }
  const groups = [];
  const byVer = all.filter(m => m.version);
  if (byVer.length >= 5) {
    for (const m of byVer) { let g = groups.find(x => x.k === m.version); if (!g) groups.push(g = { k: m.version, list: [] }); g.list.push(m); }
  } else {
    for (let i = 0; i < Math.min(all.length, 40); i += 10) groups.push({ k: i ? `${i + 1}–${i + 10}` : "last 10", list: all.slice(i, i + 10) });
  }
  const rows = groups.slice(0, 5).map(g => ({ k: g.k, ...formRows(g.list) }));
  // 1.35: fixed columns; a row is compared with the next row that has 3+ matches, and rows with fewer
  // than 3 matches are greyed and not coloured (1 match says nothing)
  const MIN = 3;
  const cls = (a, b, hi = true) => b == null ? "" : (hi ? a > b : a < b) ? "ok" : (hi ? a < b : a > b) ? "bad" : "";
  el.innerHTML = `<table class="form"><colgroup><col style="width:26%"><col style="width:10%"><col style="width:22%"><col style="width:16%"><col style="width:26%"></colgroup>
    <tr><th>version</th><th>n</th><th>W-D-L</th><th>win</th><th title="goals per match, for : against">goals</th></tr>${rows.map((r, i) => {
    const p = r.n >= MIN ? rows.slice(i + 1).find(x => x.n >= MIN) : null;
    return `<tr class="${r.n < MIN ? "few" : ""}"><td>${esc(r.k)}</td><td>${r.n}</td><td>${r.w}-${r.d}-${r.l}</td><td class="${cls(r.wr, p && p.wr)}">${r.wr}%</td>
      <td><span class="${cls(r.gf, p && p.gf)}">${r.gf.toFixed(1)}</span><span class="muted"> : </span><span class="${cls(r.ga, p && p.ga, false)}">${r.ga.toFixed(1)}</span></td></tr>`; }).join("")}</table>
    <div class="meta">${byVer.length >= 5 ? "per agent version" : "blocks of 10 matches"}, newest first · green / red = better / worse than the next row with ${MIN}+ matches · grey = under ${MIN} matches</div>`;
}
chrome.runtime.sendMessage({ type: "popup-h2h" }).then(renderForm).catch(() => renderForm(null));

// ---- Incoming challenges: shown here, accepted only by your click on "Accept".
async function renderInvites() {
  const inv = (await chrome.storage.session.get("invites")).invites;
  const el = $("invites");
  if (!inv) { el.innerHTML = `<div class="invnote">Challenges: checking…</div>`; return; }
  const items = (inv.items || []).filter(x => !x.expires || Date.parse(x.expires) > Date.now());
  const when = inv.at ? new Date(inv.at).toLocaleTimeString("en-GB") : "";
  if (!items.length) {
    el.innerHTML = `<div class="invnote">${inv.ok ? `No incoming challenges · checked ${when}`
      : inv.why === "no portal tab" ? "Challenges show while a portal tab (agentic-football.aws.dev) is open."
      : inv.why === "signed out" ? "Challenges: sign in to the portal." : `Challenges: ${esc(inv.why || "error")}`}</div>`;
    return;
  }
  const { invMuted = [] } = await chrome.storage.session.get("invMuted");
  const { inviteSound = true } = await chrome.storage.local.get("inviteSound");
  el.innerHTML = items.map(x => {
    const left = x.expires ? Math.max(0, Math.round((Date.parse(x.expires) - Date.now()) / 1000)) : null;
    const muted = !inviteSound || invMuted.includes(x.matchId);
    const grp = H2H && H2H.group && H2H.group.teams.includes(normName(x.from)) ? H2H.group.name : null;
    return `<div class="inv"><div><div class="who">Challenge from ${esc(x.from)}${grp ? ` <span class="grp">⚑ Group ${esc(grp)}</span>` : ""}</div><div class="opp">${oppLine(x.from, x.fromId)}</div>
      <div class="left">${left !== null ? `${left} s left` : ""}${muted ? " · 🔇 silent" : ""}</div></div>
      <div style="display:flex;gap:6px">${muted ? "" : `<button data-silence="${esc(x.matchId)}" title="Stop the chime for this challenge (new ones still ring)">🔇</button>`}
      <button data-accept="${esc(x.matchId)}" title="Accept the match and open the viewer">Accept</button></div></div>`;
  }).join("");
}
$("invites").addEventListener("click", ev => {
  const m = ev.target.closest("button[data-silence]");
  if (m) { chrome.runtime.sendMessage({ type: "popup-silence", matchId: m.dataset.silence }, () => { toast("Silenced. New challenges still ring."); renderInvites(); }); return; }
  const b = ev.target.closest("button[data-accept]");
  if (!b) return;
  b.disabled = true; b.textContent = "Accepting…";
  chrome.runtime.sendMessage({ type: "popup-accept", matchId: b.dataset.accept }, r => {
    toast(r && r.ok ? "Accepted, opening the viewer." : `Failed: ${(r && r.why) || "error"}`);
    renderInvites();
  });
});
chrome.runtime.sendMessage({ type: "popup-invites-now" }, () => renderInvites());
renderInvites();
setInterval(renderInvites, 1000);

// ---- Agents' ping (1.14): per position, this match (us / them) and the portal's recent figures.
const POS = ["GK", "DEF", "MID", "FWD1", "FWD2"];
const lat = v => v == null ? `<span class="muted">—</span>`
  : `<span class="${v < 300 ? "lat-ok" : v < 900 ? "lat-mid" : "lat-bad"}">${Math.round(v)}</span>`;
function renderPing(p) {
  const el = $("ping");
  if (!p) { el.innerHTML = `<div class="meta">loading…</div>`; return; }
  if (!p.ok) {
    el.innerHTML = `<div class="meta">${p.why === "no portal tab" ? "Ping shows while a portal tab is open." : p.why === "signed out" ? "Sign in to the portal." : "Failed: " + esc(p.why)}</div>`;
    return;
  }
  const m = p.match, a = p.agents || [];
  const hasMatch = !!(m && ((m.us || []).some(v => v != null) || (m.them || []).some(v => v != null)));
  const rows = POS.map((name, i) => {
    const ag = a.find(x => x.pos === i) || {};
    return `<tr><td>${name}</td>${hasMatch ? `<td>${lat(m.us ? m.us[i] : null)}</td><td>${lat(m.them ? m.them[i] : null)}</td>` : ""}
      <td>${lat(ag.latency_ms)}</td><td>${lat(ag.p99_latency_ms)}</td>
      <td>${ag.errors || ag.throttles ? `<span class="lat-bad">${(ag.errors || 0) + (ag.throttles || 0)}</span>` : `<span class="muted">0</span>`}</td></tr>`;
  }).join("");
  const mLine = m ? `Match vs ${esc(m.opp || "?")}${m.status === "in_progress" ? " (live)" : ""}: us ${m.usAvg ?? "—"} ms, them ${m.themAvg ?? "—"} ms` : "No match yet";
  const fetched = p.fetched ? new Date(p.fetched).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
  el.innerHTML = `<div class="meta">${mLine}</div>
    <table class="ping"><tr><th></th>${hasMatch ? "<th>match</th><th>opponent</th>" : ""}<th>avg</th><th>p99</th><th>err</th></tr>${rows}</table>
    <div class="meta" style="margin-top:6px">ms · avg and p99: our agents, portal figures for recent hours${fetched ? ` (${fetched})` : ""}${hasMatch ? "" : " · per-match figures come after full time"}</div>`;
}
const loadPing = () => chrome.runtime.sendMessage({ type: "popup-ping", matchId: (cur && cur.id) || null }, r => renderPing(r));
chrome.storage.session.get("ping").then(x => renderPing(x.ping || null));
setTimeout(loadPing, 300);
setInterval(loadPing, 20000);

// ---- Opponent (1.15): place, win rate, our record against them (portal table + all our results).
let H2H = null;
const normName = n => String(n || "").replace(/\s*\((\u043b\u044e\u0434\u0438\u043d\u0430|human)\)/i, "").trim().toLowerCase();
const usName = () => (H2H && H2H.lb && H2H.lb.us && H2H.lb.us.name) || "The Drunkards";
function oppLine(name, id) {
  if (!H2H) return "";
  const lb = H2H.lb, key = normName(name);
  const t = lb && (lb.teams || []).find(x => (id && x.id === id) || normName(x.name) === key);
  const parts = [];
  if (t) parts.push(`#${t.rank} of ${lb.total || lb.teams.length}`, `${t.p ? Math.round(100 * t.w / t.p) : 0}% wins (${t.w}-${t.d}-${t.l})`);
  else parts.push(lb ? "not in the table" : "the table appears once the portal is read");
  const ms = Object.values(H2H.matches || {}).filter(m => (id && m.oppId === id) || normName(m.opp) === key)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
  if (ms.length) {
    const w = ms.filter(m => m.us > m.them).length, l = ms.filter(m => m.us < m.them).length, d = ms.length - w - l;
    const gf = ms.reduce((a, m) => a + m.us, 0), ga = ms.reduce((a, m) => a + m.them, 0), last = ms[ms.length - 1];
    const cls = w > l ? "lat-ok" : w < l ? "lat-bad" : "lat-mid";
    parts.push(`us vs them <b class="${cls}">${w}-${d}-${l}</b> (${gf}:${ga}), last ${last.us}:${last.them}`);
  } else parts.push("never played");
  return parts.join(" · ");
}
const loadH2H = () => chrome.runtime.sendMessage({ type: "popup-h2h" }, r => { if (r && r.ok) { H2H = r; refresh(); renderInvites(); renderGroup(); } });

// ---- My group (1.41): load your tournament group as JSON {"name": "D", "teams": ["…", …]}; its teams get
// ⚑ GROUP <name> in Find match, on challenges and on the match panel. Kept in storage.local userGroup.
function parseGroup(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error("not valid JSON: " + e.message); }
  if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error('expected an object: {"name": "D", "teams": [...]}');
  const name = String(j.name ?? j.group ?? "").trim();
  if (!name || name.length > 30) throw new Error('"name": the group name, 1–30 characters');
  if (!Array.isArray(j.teams) || !j.teams.length) throw new Error('"teams": a list of team names');
  const teams = [...new Set(j.teams.map(t => String(t).trim()).filter(Boolean))];
  if (!teams.length || teams.length > 40) throw new Error('"teams": 1–40 team names');
  return { name, teams, at: Date.now() };
}
async function renderGroup() {
  const { userGroup } = await chrome.storage.local.get("userGroup");
  const g = userGroup || (H2H && H2H.group ? { name: H2H.group.name, teams: H2H.group.teams, file: true } : null);
  const el = $("group");
  $("groupClear").hidden = !userGroup || $("groupEdit").hidden;
  if (!g) { el.innerHTML = `<div class="meta">No group loaded. Load it as JSON to see ⚑ GROUP next to those teams in Find match, on challenges and on the match panel.</div>`; return; }
  const lb = H2H && H2H.lb, ms = Object.values((H2H && H2H.matches) || {});
  const rows = g.teams.map(t => {
    const k = normName(t), row = lb && (lb.teams || []).find(x => normName(x.name) === k);
    const mm = ms.filter(m => normName(m.opp) === k), w = mm.filter(m => m.us > m.them).length, l = mm.filter(m => m.us < m.them).length;
    const wr = row && row.p ? Math.round(100 * row.w / row.p) : null;
    return { t: row ? row.name : t, rank: row ? row.rank : 999, html: `<tr><td title="${esc(t)}">${esc(row ? row.name : t)}</td><td>${row ? "#" + row.rank : "—"}</td>
      <td class="${wr == null ? "" : wr >= 60 ? "bad" : wr >= 45 ? "warn" : "ok"}">${wr == null ? "—" : wr + "%"}</td>
      <td class="${!mm.length ? "muted" : w > l ? "ok" : w < l ? "bad" : "warn"}">${mm.length ? `${w}-${mm.length - w - l}-${l}` : "—"}</td></tr>` };
  }).sort((a, b) => a.rank - b.rank);
  el.innerHTML = `<div class="pill ok"><span class="dot"></span>Group ${esc(g.name)} · ${g.teams.length} teams${g.file ? ` <span class="muted" style="font-weight:400">(helper file)</span>` : ""}</div>
    <table class="gtab"><colgroup><col style="width:46%"><col style="width:16%"><col style="width:16%"><col style="width:22%"></colgroup>
    <tr><th>team</th><th>place</th><th>win</th><th title="our record against them, W-D-L">vs us</th></tr>${rows.map(r => r.html).join("")}</table>`;
}
$("groupEditBtn").addEventListener("click", async () => {
  const open = $("groupEdit").hidden;
  $("groupEdit").hidden = !open; $("groupSave").hidden = !open; $("groupFile").hidden = !open;
  $("groupEditBtn").textContent = open ? "Cancel" : "Load group…";
  if (open) {
    const { userGroup } = await chrome.storage.local.get("userGroup");
    const g = userGroup || (H2H && H2H.group) || null;
    if (g && !$("groupText").value) $("groupText").value = JSON.stringify({ name: g.name, teams: userGroup ? g.teams : g.teams }, null, 2);
  }
  renderGroup();
});
$("groupSave").addEventListener("click", async () => {
  try {
    const g = parseGroup($("groupText").value);
    await chrome.storage.local.set({ userGroup: g });
    toast(`Group ${g.name} saved: ${g.teams.length} teams. Open game tabs show it within a minute.`);
    $("groupEditBtn").click();
  } catch (e) { toast("Group not saved — " + e.message); }
});
$("groupFile").addEventListener("click", () => $("groupFileIn").click());
$("groupFileIn").addEventListener("change", async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  $("groupText").value = await f.text();
  e.target.value = "";
});
$("groupClear").addEventListener("click", async () => {
  await chrome.storage.local.remove("userGroup");
  toast("Group cleared.");
  $("groupText").value = "";
  renderGroup();
});
renderGroup();
loadH2H();
setInterval(loadH2H, 60000);

function toast(text) { $("toast").textContent = text; setTimeout(() => { if ($("toast").textContent === text) $("toast").textContent = ""; }, 4000); }

$("save").addEventListener("click", () => {
  if (!tab) return;
  chrome.runtime.sendMessage({ type: "popup-save", tabId: tab.id }, r =>
    toast(r && r.ok ? "Saved. Recording in this tab stopped." : "Nothing to save in this tab."));
});
$("shot").addEventListener("click", () => {
  if (!tab) return;
  chrome.runtime.sendMessage({ type: "popup-shot", windowId: tab.windowId, id: cur && cur.id }, r =>
    toast(r && r.ok ? "Screenshot saved." : "Could not take a screenshot."));
});
$("folder").addEventListener("click", () => {
  const h = cur && cur.h;
  const dl = h && ((h.shot && h.shot.dl) || (h.report && h.report.dl) || (h.rec && h.rec.dl));
  chrome.runtime.sendMessage({ type: "popup-folder", dl });
});
// Today's matches as a tab-separated table (pastes into a sheet or a message) + our W-D-L.
const US = "The Drunkards";
$("day").addEventListener("click", async () => {
  const { hist = {} } = await chrome.storage.local.get("hist");
  const today = new Date().toDateString();
  const rows = Object.values(hist).filter(h => !String(h.id).startsWith("unknown") && new Date(h.first).toDateString() === today)
    .sort((a, b) => a.first - b.first);
  if (!rows.length) { toast("No matches today yet."); return; }
  let w = 0, d = 0, l = 0;
  const yn = x => (x ? "✓" : "✗");
  const lines = ["time\thome\tscore\taway\trecording\treport\tscreenshot\tid"];
  for (const h of rows) {
    const sc = h.score ? h.score.join("—") : "?";
    if (h.rec && h.score && (h.home === US || h.away === US)) {   // finished matches only
      const [a, b] = h.home === US ? h.score : [h.score[1], h.score[0]];
      if (a > b) w++; else if (a === b) d++; else l++;
    }
    lines.push([hhmm(h.first), h.home || "?", sc, h.away || "?", yn(h.rec), yn(h.report), yn(h.shot || h.manualShot), h.id].join("\t"));
  }
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    toast(`Copied ${rows.length} match(es) · ${US}: ${w}-${d}-${l} (W-D-L)`);
  } catch (e) { toast("Could not copy to the clipboard."); }
});

$("list").addEventListener("click", ev => {
  const tr = ev.target.closest("tr.match");
  if (tr) chrome.tabs.create({ url: `${SITE}/matches/${tr.dataset.id}/report` });
});

$("ver").textContent = "v" + chrome.runtime.getManifest().version;

// ---- Tabs (1.34): Match / Form / Settings; the last one is remembered. Challenges stay on top of all.
function showTab(name) {
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  for (const p of document.querySelectorAll("section[data-pane]")) p.hidden = p.dataset.pane !== name;
  try { localStorage.setItem("__tab", name); } catch (e) {}
}
$("tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab); });
{ let t = "match"; try { t = localStorage.getItem("__tab") || "match"; } catch (e) {} showTab(["match", "form", "settings"].includes(t) ? t : "match"); }

// ---- Update (1.31). An unpacked extension serves its files from disk, so manifest.json read through
// the extension shows the version on disk; when it is newer than the one Chrome runs, "Update" reloads the
// plugin (same as ↻ on chrome://extensions; open portal tabs pick it up, the recorder keeps recording).
// The team build (package.sh fills UPDATE_REPO) also checks the GitHub repo: a newer version there gives
// the one-line install command to copy (the plugin cannot write its own files), then "Update" reloads.
const UPDATE_REPO = "shusachenko/aws-football-match-plugin";
const vnum = v => String(v || "0").split(".").map(Number);
const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate() {
  const run = chrome.runtime.getManifest().version, btn = $("upd"), note = $("updNote");
  let disk = run, remote = null;
  try { disk = (await (await fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), { cache: "no-store" })).json()).version || run; } catch (e) {}
  if (!UPDATE_REPO.startsWith("__")) {
    try { remote = (await (await fetch(`https://raw.githubusercontent.com/${UPDATE_REPO}/main/extension/manifest.json?t=${Date.now()}`, { cache: "no-store" })).json()).version; } catch (e) {}
  }
  btn.hidden = false;
  if (newer(disk, run)) {
    btn.textContent = `Update to v${disk}`; btn.className = "upd new"; btn.title = "Reload the plugin with the new files";
  } else {
    btn.textContent = "↻"; btn.className = "upd"; btn.title = `Reload the plugin (v${run} is the newest${remote ? "" : " on disk"})`;
  }
  if (remote && newer(remote, disk)) {
    const cmd = `curl -fsSL https://raw.githubusercontent.com/${UPDATE_REPO}/main/install.sh | bash`;
    note.hidden = false;
    note.innerHTML = `<b>v${esc(remote)} is out.</b> Run this in Terminal, then press the button again: <code>${esc(cmd)}</code> <button id="updCopy">Copy</button>`;
    btn.textContent = TEAM_BUILD ? `Update to v${remote}` : "Check again"; btn.className = "upd new";
    btn.title = TEAM_BUILD ? "Download and install the new version, then reload" : "After the install command: reload with the new files";
    if (TEAM_BUILD) note.innerHTML = `<b>v${esc(remote)} is out.</b> Press <b>Update</b>. No updater on this computer (Windows, or installed before 1.33)? Run this once: <code>${esc(cmd)}</code> <button id="updCopy">Copy</button>`;
    $("updCopy").onclick = async () => { try { await navigator.clipboard.writeText(cmd); toast("Copied. Paste it into Terminal."); } catch (e) {} };
  }
  btn.onclick = async () => {
    let d = run;
    try { d = (await (await fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), { cache: "no-store" })).json()).version || run; } catch (e) {}
    if (remote && newer(remote, d) && TEAM_BUILD) {   // 1.33: the updater helper installs it, then reload
      btn.disabled = true; btn.textContent = "Installing…";
      const r = await new Promise(res => { try { chrome.runtime.sendNativeMessage("com.awsfootball.updater", { cmd: "update" }, x => res(chrome.runtime.lastError ? null : x)); } catch (e) { res(null); } });
      btn.disabled = false;
      if (r && r.ok && r.version && !newer(remote, r.version)) { toast(`Installed v${r.version}, reloading…`); setTimeout(() => chrome.runtime.reload(), 300); return; }
      btn.textContent = "Check again";
      toast(r ? `Update failed: ${(r.log || r.error || "").slice(-80)}` : "No updater here (Windows or an old install): run the command once.");
      return;
    }
    if (remote && newer(remote, d)) { toast("Not installed yet: run the command first."); return; }
    toast(newer(d, run) ? `Updating to v${d}…` : "Reloading…");
    setTimeout(() => chrome.runtime.reload(), 300);
  };
}
checkUpdate();
refresh();
setInterval(refresh, 1500);

// ---- emulator site (tools/simulator/live.py) via the native host com.drunkards.emulator (native/install.sh)
const HOST = "com.drunkards.emulator";
let emuBusy = false;
// team package: no native helper — its sections (emulator site, AWS keys) are hidden
const HAS_NATIVE = HAS_HELPER;
if (!HAS_NATIVE) for (const id of ["emu", "creds"]) {
  const card = $(id);
  if (!card) continue;
  for (const el of [card.previousElementSibling, card, card.nextElementSibling]) if (el) el.style.display = "none";
}
function emuCall(cmd) {
  if (!HAS_NATIVE) return Promise.resolve({ ok: false, missing: true });
  return new Promise(res => chrome.runtime.sendNativeMessage(HOST, { cmd }, r =>
    res(chrome.runtime.lastError ? { ok: false, missing: true, error: chrome.runtime.lastError.message } : r)));
}
function renderEmu(r, busyText) {
  const el = $("emu"), on = r && r.running;
  if (busyText) el.innerHTML = `<div class="pill warn"><span class="dot"></span>${esc(busyText)}</div>`;
  else if (!r || r.missing) el.innerHTML = `<div class="pill idle"><span class="dot"></span>Helper not installed</div>
      <div class="hint">Run <b>tools/match-recorder/native/install.sh</b> once in a terminal
      and reload the plugin on chrome://extensions.</div>` +
      (r && r.error ? `<div class="meta">Chrome: ${esc(r.error)}</div>` : "");
  else {
    const up = r.since ? ` · since ${hhmm(r.since * 1000)}` : "";
    el.innerHTML = (on ? `<div class="pill ok"><span class="dot"></span>Running · localhost:${r.port}${up}</div>`
        : `<div class="pill idle"><span class="dot"></span>Off</div>`) +
      `<div class="meta">code ${esc(r.commit || "")}</div>` +
      (on && r.stale ? `<div class="warns">The code changed since start: restart to see it.</div>` : "") +
      (r.ok === false && r.error ? `<div class="warns">${esc(r.error)}</div>` : "");
  }
  const miss = !r || r.missing;
  $("emuOpen").disabled = emuBusy || miss;
  $("emuRestart").disabled = emuBusy || miss || !on;
  $("emuStop").disabled = emuBusy || miss || !on;
}
async function emuDo(cmd, busyText) {
  emuBusy = true; renderEmu(null, busyText);
  const r = await emuCall(cmd); emuBusy = false; renderEmu(r); return r;
}
$("emuOpen").addEventListener("click", async () => {
  const r = await emuDo("start", "Starting…");
  if (!r || !r.running) return;
  const open = await chrome.tabs.query({ url: `http://localhost:${r.port}/*` });
  if (open.length) { await chrome.tabs.update(open[0].id, { active: true }); await chrome.windows.update(open[0].windowId, { focused: true }); }
  else await chrome.tabs.create({ url: r.url });
});
$("emuRestart").addEventListener("click", async () => {
  const r = await emuDo("restart", "Restarting…");
  if (r && r.running) { for (const t of await chrome.tabs.query({ url: `http://localhost:${r.port}/*` })) chrome.tabs.reload(t.id); toast("Emulator restarted."); }
});
$("emuStop").addEventListener("click", async () => { const r = await emuDo("stop", "Stopping…"); if (r && !r.running) toast("Emulator stopped."); });
emuCall("status").then(r => renderEmu(r));

// Portal data for the emulator site (bridge.js reads it on any open portal tab, background.js saves portal.json).
async function renderPortal(text) {
  const { portal: p } = await chrome.storage.local.get("portal");
  const el = $("portal");
  if (!p) el.innerHTML = `<div class="meta">Not saved yet. Open the portal (any page where you are signed in) and the data comes by itself.</div>`;
  else el.innerHTML = `<div class="pill ok"><span class="dot"></span>${esc(p.name || "?")}${p.rank ? ` · #${p.rank} of ${p.total}` : ""}</div>
    <div class="meta">table ${p.teams} teams · ${p.matches} matches · changed ${hhmm(p.saved)} · checked ${hhmm(p.checked)}${p.off ? " · portal.json not saved (switch off)" : p.how ? ` · ${p.how === "helper" ? "written by the helper" : "Chrome download"}` : ""}</div>`;
  if (text) el.insertAdjacentHTML("beforeend", `<div class="hint">${esc(text)}</div>`);
}
$("portalNow").addEventListener("click", async () => {
  const tabs = await chrome.tabs.query({ url: "https://agentic-football.aws.dev/*" });
  if (!tabs.length) { renderPortal("No portal tab open: open agentic-football.aws.dev and press again."); return; }
  $("portalNow").disabled = true;
  const r = await new Promise(res => chrome.tabs.sendMessage(tabs[0].id, { type: "portal-now" }, x => res(chrome.runtime.lastError ? null : x)));
  $("portalNow").disabled = false;
  renderPortal(!r ? "The portal tab did not answer: reload it (the plugin was updated)." :
    r.ok ? (r.same ? "Nothing changed." : "Saved portal.json.") :
    r.why === "signed out" ? "Not signed in to the portal." : `Failed: ${r.why || "error"}`);
});
renderPortal();

// ---- AWS credentials (background.js keeps them fresh; this shows the last result)
function renderCreds(c) {
  const el = $("creds");
  if (!c) { el.innerHTML = `<div class="pill idle"><span class="dot"></span>not checked yet</div><div class="hint">The plugin checks the keys every 15 min and takes new ones from Workshop Studio when the old ones stop working.</div>`; return; }
  const cls = c.busy ? "warn" : c.ok ? "ok" : "bad";
  const saved = c.saved && c.saved.t ? `<div class="meta">keys in .env from ${hhmm(c.saved.t * 1000)}${c.saved.source === "plugin" ? " · by the plugin" : " · by hand"}</div>` : "";
  el.innerHTML = `<div class="pill ${cls}"><span class="dot"></span>${esc(c.msg || "")}</div><div class="meta">checked ${hhmm(c.at)}</div>${saved}`;
  $("credsNow").disabled = $("credsCheck").disabled = !!c.busy;
}
chrome.storage.local.get("creds").then(x => renderCreds(x.creds));
chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.creds) renderCreds(ch.creds.newValue); });
$("credsNow").addEventListener("click", () => chrome.runtime.sendMessage({ type: "creds-refresh", force: true }));
$("credsCheck").addEventListener("click", () => chrome.runtime.sendMessage({ type: "creds-refresh", force: false }));
