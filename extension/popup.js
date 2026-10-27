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
  el.innerHTML = items.map(x => {
    const left = x.expires ? Math.max(0, Math.round((Date.parse(x.expires) - Date.now()) / 1000)) : null;
    return `<div class="inv"><div><div class="who">Challenge from ${esc(x.from)}</div><div class="opp">${oppLine(x.from, x.fromId)}</div>
      <div class="left">${left !== null ? `${left} s left` : ""}</div></div>
      <button data-accept="${esc(x.matchId)}" title="Accept the match and open the viewer">Accept</button></div>`;
  }).join("");
}
$("invites").addEventListener("click", ev => {
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
const loadH2H = () => chrome.runtime.sendMessage({ type: "popup-h2h" }, r => { if (r && r.ok) { H2H = r; refresh(); renderInvites(); } });
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
refresh();
setInterval(refresh, 1500);

// ---- emulator site (tools/simulator/live.py) via the native host com.drunkards.emulator (native/install.sh)
const HOST = "com.drunkards.emulator";
let emuBusy = false;
// team package: no native helper — its sections (emulator site, AWS keys) are hidden
const HAS_NATIVE = typeof chrome.runtime.sendNativeMessage === "function";
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
    <div class="meta">table ${p.teams} teams · ${p.matches} matches · changed ${hhmm(p.saved)} · checked ${hhmm(p.checked)}</div>`;
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
