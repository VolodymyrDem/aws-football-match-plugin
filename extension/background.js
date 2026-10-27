// Writes recordings to Downloads/agentic-football-matches/match-<id>.json.gz and the
// portal's report text to report-<id>.txt, and a screenshot of the report page (final
// score with both team names, for the tournament result) to final-<id>.png, and the
// portal's data (our team, the whole table, our matches) to portal.json for the emulator site.
// It also keeps what the popup shows (popup.html): the live status of each tab
// (chrome.storage.session) and, per match, which files were saved (chrome.storage.local).
// gzip first: a raw match is ~3 MB of JSON and Chrome rejects data URLs past ~2 MB.
// If Chrome asks where to save each file, turn off chrome://settings/downloads →
// "Ask where to save each file before downloading": an extension cannot skip that dialog.
const FOLDER = "agentic-football-matches";

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gzipBase64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return bytesToB64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function gunzipB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

// Chrome may refuse very long data URLs: past this size the sampled whole frames are
// dropped (the frames around goals and shots stay), then everything v4 added if still too big.
const MAX_B64 = 1.8e6;
async function fit(b64, data) {
  if (b64.length <= MAX_B64) return b64;
  try {
    const j = JSON.parse(data || await gunzipB64(b64));
    j.full = (j.full || []).filter(f => f[1] !== 0);   // keep the goal and shot windows
    j.trimmed = 1;
    let out = await gzipBase64(JSON.stringify(j));
    if (out.length <= MAX_B64) return out;
    delete j.full; delete j.other; delete j.sent;
    j.trimmed = 2;
    return await gzipBase64(JSON.stringify(j));
  } catch (e) { return b64; }
}

function badge(tabId, text, color) {
  if (tabId === undefined) return;
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
}

const RED = "#c62828", GREEN = "#2e7d32", ORANGE = "#ef6c00", GREY = "#9e9e9e", BLUE = "#0e7490";
// 1.34: the live score on the icon, ours first ("2:1"): green ahead, red behind, blue level. Also as the
// icon's default for every tab, so it shows while you are on another tab; cleared once the match is saved.
let scoreOwner = null;
function scoreBadge(tabId, id, score, usIdx) {
  if (!score) return;
  const a = score[usIdx], b = score[1 - usIdx], text = `${a}:${b}`, color = a > b ? GREEN : a < b ? RED : BLUE;
  badge(tabId, text, color);
  scoreOwner = id;
  chrome.action.setBadgeText({ text }); chrome.action.setBadgeBackgroundColor({ color });
}
function clearScoreBadge(id) {
  if (scoreOwner !== id) return;
  scoreOwner = null;
  chrome.action.setBadgeText({ text: "" });
}
// which side we are, from the team names in the viewer's header and our name from the portal table
async function ourSide(h) {
  const { lb } = await chrome.storage.local.get("lb");
  const me = String((lb && lb.us && lb.us.name) || "The Drunkards").trim().toLowerCase();
  const n = x => String(x || "").replace(/\s*\((людина|human)\)/i, "").trim().toLowerCase();
  return h && n(h.away) === me ? 1 : 0;
}
const safe = id => String(id).replace(/[^0-9a-zA-Z-]/g, "");

// ---- match history: {id: {id, first, last, home, away, score, t, t0, n, reloads,
//      rec: {at, n, dl, trimmed?}, report: {at, dl}, shot: {at, dl}, err: [...]}}
let chain = Promise.resolve();
function updateHist(id, fn) {
  chain = chain.then(async () => {
    const { hist = {} } = await chrome.storage.local.get("hist");
    const h = hist[id] || (hist[id] = { id, first: Date.now() });
    fn(h);
    h.last = Date.now();
    const ids = Object.keys(hist).sort((a, b) => hist[b].first - hist[a].first);
    for (const old of ids.slice(80)) delete hist[old];   // keep the newest 80
    await chrome.storage.local.set({ hist });
  }).catch(() => {});
  return chain;
}

// "Home\n2 — 1\nAway" in the viewer header or the report text.
function parseTeams(text) {
  const L = String(text || "").split("\n").map(x => x.trim()).filter(Boolean);
  for (let i = 1; i < L.length - 1; i++) {
    const m = L[i].match(/^(\d+)\s*[—–-]\s*(\d+)$/);
    if (m) return { home: L[i - 1], away: L[i + 1], score: [+m[1], +m[2]] };
  }
  return null;
}

// ---- macOS notifications: end of a match (what was saved) and problems while recording.
const SITE = "https://agentic-football.aws.dev";
const title = h => h.home && h.away ? `${h.home} ${h.score ? h.score.join("—") : ""} ${h.away}` : `Match ${h.id.slice(0, 8)}`;
const missing = h => [!h.rec && "recording", !h.report && "report", !(h.shot || h.manualShot) && "screenshot"].filter(Boolean);
function notify(id, key, t, message) {
  try {
    chrome.notifications.create(`${key}:${id}`, { type: "basic", iconUrl: "icons/icon128.png", title: t, message, priority: 1 });
  } catch (e) {}
}
const ending = new Set();   // two saves landing together must not notify twice
async function endCheck(id, final) {
  if (ending.has(id)) return;
  ending.add(id);
  try {
    const { hist = {} } = await chrome.storage.local.get("hist");
    const h = hist[id];
    if (!h || h.notifiedEnd) return;
    const miss = missing(h);
    if (miss.length && !final) return;   // the alarm comes back for it
    await updateHist(id, x => { x.notifiedEnd = Date.now(); });
    sendEnd(id, h, miss);
  } finally { ending.delete(id); }
}
// 1.34: the end-of-match notification is a summary — result ours first, xG, shots, possession, our
// players that went 20+ s without an agent command — then what was saved.
const POS5 = ["GK", "DEF", "MID", "FWD1", "FWD2"];
function summaryLines(h, us) {
  const out = [];
  const S = h.sum, f = (arr, k = v => v) => arr ? `${k(arr[us])}:${k(arr[1 - us])}` : "";
  if (S) out.push([`xG ${f(S.xg, v => (v || 0).toFixed(1))}`, `shots ${f(S.sh)}`, S.pos ? `possession ${S.pos[us]}%` : ""].filter(Boolean).join(" · "));
  const silent = Object.entries(h.off || {}).filter(([k, v]) => +k.split(":")[0] === us && +k.split(":")[1] > 0 && v >= 20)
    .map(([k, v]) => `${POS5[+k.split(":")[1]]} ${v} s`);
  if (silent.length) out.push(`Silent agents: ${silent.join(", ")}`);
  return out;
}
async function sendEnd(id, h, miss) {
  chrome.alarms.clear("check:" + id);
  clearScoreBadge(id);
  const us = await ourSide(h);
  let head = title(h);
  if (h.score && h.home && h.away) {
    const a = h.score[us], b = h.score[1 - us], opp = us ? h.home : h.away;
    head = `${a > b ? "Won" : a < b ? "Lost" : "Draw"} ${a}:${b} vs ${opp}`;
  }
  const lines = summaryLines(h, us);
  if (miss.length) notify(id, "end", `⚠ ${head}`, [...lines, `Missing: ${miss.join(", ")} — click to save from the report.`].join("\n"));
  else notify(id, "end", head, [...lines, "Saved: recording ✓ report ✓ screenshot ✓" +
    (h.report && h.report.full === false ? " (AI summary comes later)" : "")].join("\n"));
}
chrome.alarms.onAlarm.addListener(a => { if (a.name.startsWith("check:")) endCheck(a.name.slice(6), true); });
chrome.notifications.onClicked.addListener(nid => {
  if (nid.startsWith("inv:")) return;   // challenge notifications: handled below
  const id = nid.split(":")[1];
  if (id && /^[0-9a-f-]{36}$/.test(id)) chrome.tabs.create({ url: `${SITE}/matches/${id}/report` });
  chrome.notifications.clear(nid);
});

function download(url, filename, tabId, okBadge, reply, onDone) {
  chrome.downloads.download({ url, filename, conflictAction: "overwrite", saveAs: false }, id => {
    const ok = !chrome.runtime.lastError && id !== undefined;
    if (okBadge) badge(tabId, ok ? okBadge : "ERR", ok ? GREEN : RED);
    if (onDone) onDone(ok, id);
    if (reply) reply({ ok });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab ? sender.tab.id : undefined;
  if (!msg) return;
  if (msg.type === "recording") {
    badge(tabId, "REC", RED);   // recording this match
    return;
  }
  if (msg.type === "status" && msg.id && tabId !== undefined) {
    const st = { ...msg, url: sender.tab.url, ts: Date.now() };
    chrome.storage.session.set({ ["tab:" + tabId]: st }).catch(() => {});
    updateHist(msg.id, h => {
      const tm = parseTeams(msg.header);
      if (tm && !h.report) Object.assign(h, tm);
      if (msg.score && !h.report) h.score = msg.score;
      Object.assign(h, { t: msg.t, t0: msg.t0, n: msg.n, reloads: msg.reloads });
      // 1.34: the live stats for the end-of-match summary (home / away order, like score)
      if (msg.st && msg.st.sh) h.sum = { sh: msg.st.sh, xg: msg.st.xg, pos: msg.st.pos, third: msg.st.third,
        goals: (msg.st.map || []).filter(m => m[6]).map(m => [m[0], m[1], m[2]]) };
      if (msg.ctl) {   // seconds our players went without an agent command, worst seen (silent agents)
        h.off = h.off || {};
        for (const [k, v] of Object.entries(msg.ctl)) if (v && v[1] != null && v[1] > (h.off[k] || 0)) h.off[k] = v[1];
      }
    }).then(async () => {
      const { hist = {} } = await chrome.storage.local.get("hist");
      const h = hist[msg.id];
      if (h && h.rec) { clearScoreBadge(msg.id); return; }   // saved: keep OK / REP
      const late = msg.t0 !== null && msg.t0 > 3;      // started after kick-off
      const stale = msg.lastWall && Date.now() - msg.lastWall > 8000 && msg.t < 118;
      if (h && late && msg.n > 0 && !h.notifiedLate) {
        updateHist(msg.id, x => { x.notifiedLate = 1; });
        notify(msg.id, "late", `⚠ Recording started at second ${Math.round(msg.t0)}`, `${title(h)}: the start of the match is missing. Next time open the viewer before kick-off.`);
      }
      if (h && stale && Date.now() - msg.lastWall > 15000 && !h.notifiedStale) {
        updateHist(msg.id, x => { x.notifiedStale = 1; });
        notify(msg.id, "stale", "⚠ No match frames", `${title(h)}: ${Math.round((Date.now() - msg.lastWall) / 1000)} s without frames. Reload the viewer tab; recording continues.`);
      }
      if (msg.stopped) return;
      if (stale) badge(tabId, "!", ORANGE);
      else if (msg.score && msg.n > 40) scoreBadge(tabId, msg.id, msg.score, await ourSide(h));
      else badge(tabId, "REC", late ? ORANGE : RED);
    });
    return;
  }
  if (!msg.id) return;
  const safeId = safe(msg.id);
  if (msg.type === "save" && (msg.data || msg.b64)) {
    const b64 = (msg.b64 ? Promise.resolve(msg.b64) : gzipBase64(msg.data)).then(b => fit(b, msg.data));
    b64.then(b => download("data:application/gzip;base64," + b, `${FOLDER}/match-${safeId}.json.gz`, tabId, "OK", reply,
      (ok, dl) => updateHist(msg.id, h => {
        if (ok) {
          h.rec = { at: Date.now(), n: msg.n || (h.rec && h.rec.n) || h.n, dl, why: msg.why };
          chrome.alarms.create("check:" + msg.id, { delayInMinutes: 5 });   // report + screenshot by then
        }
        else (h.err = h.err || []).push("recording: could not save");
      })))
      .catch(() => { badge(tabId, "ERR", RED); reply({ ok: false }); });
    return true;
  }
  if (msg.type === "report" && msg.text) {
    const b = bytesToB64(new TextEncoder().encode(msg.text));
    download("data:text/plain;charset=utf-8;base64," + b, `${FOLDER}/report-${safeId}.txt`, tabId, "REP", reply,
      (ok, dl) => updateHist(msg.id, h => {
        if (!ok) return;
        h.report = { at: Date.now(), dl, full: msg.full !== false };
        const k = msg.text.indexOf("Behind the Scenes");
        const tm = parseTeams(k >= 0 ? msg.text.slice(k) : msg.text);
        if (tm) Object.assign(h, tm);
      }).then(() => endCheck(msg.id, false)));
    return true;
  }
});

// Portal data (bridge.js) → portal.json beside the matches, read by the emulator site.
// Written only when something in it changed; the popup shows when and what.
async function digest(text) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)));
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "portal" || !msg.data) return;
  (async () => {
    const d = msg.data, body = JSON.stringify(d);
    await keepTableAndResults(d).catch(() => {});
    const hash = await digest(body);
    const { portal: old = {} } = await chrome.storage.local.get("portal");
    const info = { checked: Date.now(), name: d.team && d.team.name, rank: d.standing && d.standing.rank,
                   total: d.total_teams, teams: d.table.length, matches: d.matches.length };
    if (old.hash === hash && old.saved) {
      await chrome.storage.local.set({ portal: { ...old, ...info } });
      reply({ ok: true, same: true, ...info });
      return;
    }
    // 1.30: switch "Save portal data" (storage.local portalSave; on with the helper, off in the team
    // build). The helper writes the file itself, so nothing shows in Chrome's downloads; without the
    // helper (or if it fails) it is a Chrome download, only while the switch is on.
    const { portalSave = HAS_NATIVE } = await chrome.storage.local.get("portalSave");
    if (!portalSave) { await chrome.storage.local.set({ portal: { ...old, ...info, hash: null, off: true } }); reply({ ok: true, off: true, ...info }); return; }
    const text = JSON.stringify({ ...d, saved: new Date().toISOString() });
    const done = async (ok, how) => {
      if (ok) await chrome.storage.local.set({ portal: { ...info, hash, saved: Date.now(), how } });
      reply({ ok, how, ...info });
    };
    const nr = await nativeCall({ cmd: "portal_save", text });
    if (nr && nr.ok) return done(true, "helper");
    const b = bytesToB64(new TextEncoder().encode(text));
    download("data:application/json;charset=utf-8;base64," + b, `${FOLDER}/portal.json`, undefined, null, null, ok => done(ok, "download"));
  })();
  return true;
});

// Screenshot of the tab that asked, only while it is the visible tab of its window
// (captureVisibleTab can only see that one); otherwise the page asks again when shown.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "shot" || !msg.id || !sender.tab) return;
  const tab = sender.tab;
  chrome.tabs.query({ active: true, windowId: tab.windowId }, act => {
    if (!act || !act[0] || act[0].id !== tab.id) { reply({ ok: false, hidden: true }); return; }
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }, url => {
      if (chrome.runtime.lastError || !url) { reply({ ok: false }); return; }
      download(url, `${FOLDER}/final-${safe(msg.id)}.png`, tab.id, null, reply,
        (ok, dl) => ok && updateHist(msg.id, h => { h.shot = { at: Date.now(), dl }; }).then(() => endCheck(msg.id, false)));
    });
  });
  return true;
});

// Popup buttons.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || sender.tab) return;   // only from the popup
  if (msg.type === "popup-save") {
    // Stop recording in that tab and save everything it has.
    chrome.tabs.sendMessage(msg.tabId, { type: "save-now" }, resp => {
      const ok = !chrome.runtime.lastError && resp && resp.ok;
      if (!ok) badge(msg.tabId, "—", GREY);
      reply({ ok: !!ok });
    });
    return true;
  }
  if (msg.type === "popup-shot") {
    // Screenshot of the visible tab right now (e.g. the final score on the viewer).
    chrome.tabs.captureVisibleTab(msg.windowId, { format: "png" }, url => {
      if (chrome.runtime.lastError || !url) { reply({ ok: false }); return; }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      const name = msg.id ? `shot-${safe(msg.id)}-${stamp}.png` : `shot-${stamp}.png`;
      download(url, `${FOLDER}/${name}`, undefined, null, reply,
        (ok, dl) => ok && msg.id && updateHist(msg.id, h => { h.manualShot = { at: Date.now(), dl }; })
          .then(() => endCheck(msg.id, false)));
    });
    return true;
  }
  if (msg.type === "popup-folder") {
    if (msg.dl) chrome.downloads.show(msg.dl); else chrome.downloads.showDefaultFolder();
    reply({ ok: true });
    return;
  }
});

chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove("tab:" + tabId).catch(() => {}));

// ---- AWS credentials: Workshop Studio gives short-lived keys. Every 15 min the native helper checks
// the keys in the project's .env; when they no longer work (or on "Refresh now" in the popup), the
// dashboard opens in a background tab, its "Get AWS CLI credentials" panel is opened, the export block
// is read and the tab closes. The helper checks the keys with AWS and only then writes .env.
// The keys pass through memory only: never chrome.storage, never the console.
const CRED_HOST = "com.drunkards.emulator";
const DASH = "https://catalog.us-east-1.prod.workshops.aws/event/dashboard/en-US";
// The team package (package.sh) has no native helper and no nativeMessaging permission: then
// everything that needs it (AWS keys, coach name, emulator site, local results) stays off.
const TEAM_BUILD = true;   // package.sh: true (nativeMessaging is there for the updater only)
const HAS_NATIVE = !TEAM_BUILD && typeof chrome.runtime.sendNativeMessage === "function";
const nativeCall = msg => !HAS_NATIVE ? Promise.resolve({ ok: false, missing: true, error: "no native helper" })
  : new Promise(res => chrome.runtime.sendNativeMessage(CRED_HOST, msg, r =>
    res(chrome.runtime.lastError ? { ok: false, missing: true, error: chrome.runtime.lastError.message } : r)));
const credState = st => chrome.storage.local.set({ creds: { ...st, at: Date.now() } });

// runs inside the dashboard tab
async function grabCreds() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const block = () => [...document.querySelectorAll("code, pre")].map(c => c.textContent)
    .find(t => /AWS_ACCESS_KEY_ID/.test(t) && /AWS_SECRET_ACCESS_KEY/.test(t));
  for (let i = 0; i < 60; i++) {                       // up to 30 s for the page and the panel
    if (!/workshops\.aws$/.test(location.hostname)) return { login: true };
    const t = block();
    if (t) return { text: t };
    const b = [...document.querySelectorAll("a, button")].find(x => x.textContent.trim() === "Get AWS CLI credentials");
    if (b && i % 6 === 0) b.click();                   // a link in the side menu; again every 3 s until the panel shows
    await sleep(500);
  }
  return { error: /sign.?in|log.?in/i.test(document.body.innerText.slice(0, 2000)) ? "login" : "no credentials panel" };
}

let credBusy = null;
function refreshCreds(force) {
  if (!credBusy) credBusy = doRefresh(force).finally(() => { credBusy = null; });
  return credBusy;
}
async function doRefresh(force) {
  if (!force) {
    const c = await nativeCall({ cmd: "creds_check" });
    if (c.missing) return credState({ ok: false, msg: "helper not installed" });
    if (c.works) return credState({ ok: true, msg: "keys work", saved: c.saved });
    if (c.kind === "network") return credState({ ok: false, msg: "AWS does not answer: no network?" });
  }
  await credState({ busy: true, msg: "taking new keys from Workshop Studio…" });
  let tab;
  try {
    tab = await chrome.tabs.create({ url: DASH, active: false });
    await new Promise(res => {
      const t = setTimeout(res, 30000);
      const on = (id, info) => { if (id === tab.id && info.status === "complete") { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); res(); } };
      chrome.tabs.onUpdated.addListener(on);
    });
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grabCreds });
    const got = (r && r.result) || {};
    if (!got.text) {
      const msg = got.login || got.error === "login" ? "sign in to Workshop Studio, then Refresh now" : "no keys found on the dashboard";
      chrome.notifications.create("creds", { type: "basic", iconUrl: "icons/icon128.png", title: "AWS keys not refreshed", message: msg });
      return credState({ ok: false, msg });
    }
    const s = await nativeCall({ cmd: "creds_save", text: got.text });
    if (!s.ok) {
      chrome.notifications.create("creds", { type: "basic", iconUrl: "icons/icon128.png", title: "AWS keys not refreshed", message: s.error || "error" });
      return credState({ ok: false, msg: s.missing ? "helper not installed" : s.error });
    }
    return credState({ ok: true, msg: "new keys saved to .env", saved: s.saved });
  } catch (e) {
    return credState({ ok: false, msg: String(e.message || e) });
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

if (HAS_NATIVE) chrome.alarms.get("creds").then(a => { if (!a) chrome.alarms.create("creds", { periodInMinutes: 15, delayInMinutes: 1 }); });   // not reset on every wake-up
chrome.alarms.onAlarm.addListener(a => { if (a.name === "creds") refreshCreds(false); });
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg && msg.type === "creds-refresh" && !sender.tab) { refreshCreds(!!msg.force).then(() => reply(true)); return true; }
});

// Coach name = the version that plays (1.8): bridge.js asks on the portal page which name is wanted and
// reports how saving it went; both go through the native helper (scripts/coach_name.py).
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !sender.tab) return;
  if (msg.type === "coach-wanted") { nativeCall({ cmd: "coach" }).then(reply); return true; }
  if (msg.type === "coach-report") {
    chrome.storage.local.set({ coach: { name: msg.name, ok: !!msg.ok, error: msg.error || null, was: msg.was || null, at: Date.now() } });
    nativeCall({ cmd: "coach_report", name: msg.name, ok: !!msg.ok, error: msg.error || null, was: msg.was || null }).then(() => reply(true));
    return true;
  }
});

// 1.9: every minute the background asks the helper for the wanted name; when a deploy changed it, a portal
// tab applies it right away, even a hidden one. No portal tab open: one is opened in the background and
// closed after (at most once per name per 30 min). The portal's sign-in stays in the page.
const PORTAL = "https://agentic-football.aws.dev/";
const askTab = (tabId, tries = 5) => new Promise(res => {
  const go = n => chrome.tabs.sendMessage(tabId, { type: "coach-now" }, r => {
    if (chrome.runtime.lastError || !r) { if (n > 1) setTimeout(() => go(n - 1), 2000); else res(null); }
    else res(r);
  });
  go(tries);
});
async function coachCheck() {
  const w = await nativeCall({ cmd: "coach" });
  if (!w || !w.enabled || !w.name) return;
  const { coach = {}, coachTab = {} } = await chrome.storage.local.get(["coach", "coachTab"]);
  if (coach.ok && coach.name === w.name) return;
  let tabs = await chrome.tabs.query({ url: PORTAL + "*" });
  let opened = null;
  if (!tabs.length) {
    if (coachTab.name === w.name && Date.now() - (coachTab.at || 0) < 30 * 60e3) return;
    await chrome.storage.local.set({ coachTab: { name: w.name, at: Date.now() } });
    opened = await chrome.tabs.create({ url: PORTAL + "v2/player", active: false });
    await new Promise(res => {
      const t = setTimeout(res, 30000);
      const on = (id, info) => { if (id === opened.id && info.status === "complete") { chrome.tabs.onUpdated.removeListener(on); clearTimeout(t); res(); } };
      chrome.tabs.onUpdated.addListener(on);
    });
    tabs = [opened];
  }
  try {
    for (const t of tabs) {
      const r = await askTab(t.id, opened ? 5 : 1);
      if (!r) continue;
      if (r.have === w.name) await chrome.storage.local.set({ coach: { ...coach, name: w.name, ok: true, error: null, at: Date.now() } });
      break;
    }
  } finally {
    if (opened) setTimeout(() => chrome.tabs.remove(opened.id).catch(() => {}), 3000);
  }
}
if (HAS_NATIVE) chrome.alarms.get("coach").then(a => { if (!a) chrome.alarms.create("coach", { periodInMinutes: 1, delayInMinutes: 1 }); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === "coach") coachCheck().catch(() => {}); });

// ---- Incoming challenges (1.11). A portal tab reads them (bridge.js, the portal's own sign-in);
// here they are kept for the popup (storage.session "invites"), each new one is announced once,
// and an invite is accepted on your click: the popup's "Accept" or the notification's button.
// 1.13: an auto-accept switch for the workshop day only (storage.local autoAccept {on, until}):
// off by default, it turns itself off at the end of the day it was switched on, and it never
// works on the tournament days 28-29.10.2026 (OrgCrew: every challenge there is accepted by hand).
// After accepting, the viewer opens in a new tab.
const portalTabs = () => chrome.tabs.query({ url: SITE + "/*" });
// tournament days: auto-accept never runs (UTC, a little wider than the published schedule)
const TOURNAMENT = [Date.parse("2026-10-28T00:00:00Z"), Date.parse("2026-10-30T00:00:00Z")];
const inTournament = (t = Date.now()) => t >= TOURNAMENT[0] && t < TOURNAMENT[1];
async function autoAcceptActive() {
  const { autoAccept } = await chrome.storage.local.get("autoAccept");
  if (!autoAccept || !autoAccept.on) return false;
  if (Date.now() >= (autoAccept.until || 0) || inTournament()) {
    await chrome.storage.local.set({ autoAccept: { on: false, offAt: Date.now() } });   // expired: off for good
    return false;
  }
  return true;
}
async function storeInvites(res) {
  if (!res) return;
  const prev = (await chrome.storage.session.get("invites")).invites || {};
  const inv = res.ok ? { ok: true, items: res.items, eventId: res.eventId, teamId: res.teamId, at: res.at || Date.now() }
                     : { ...prev, ok: false, why: res.why, at: Date.now() };
  await chrome.storage.session.set({ invites: inv });
  if (!res.ok) return;
  const { invSeen = [] } = await chrome.storage.session.get("invSeen");
  const auto = await autoAcceptActive();
  const grp = res.items.some(it => !invSeen.includes(it.matchId)) ? await myGroup().catch(() => null) : null;
  for (const it of res.items) {
    if (invSeen.includes(it.matchId)) continue;
    invSeen.push(it.matchId);
    if (auto) {
      const r = await acceptInvite(it.matchId);
      chrome.notifications.create("invauto:" + it.matchId, { type: "basic", iconUrl: "icons/icon128.png",
        title: r && r.ok ? `Accepted automatically: ${it.from}` : `Could not accept: ${it.from}`,
        message: r && r.ok ? "Viewer opened. Auto-accept turns itself off at 23:59." : (r && r.why) || "error" });
      if (r && r.ok) continue;
    }
    const until = it.expires ? " · until " + new Date(it.expires).toLocaleTimeString("en-GB") : "";
    try {
      chrome.notifications.create("inv:" + it.matchId, {
        type: "basic", iconUrl: "icons/icon128.png", priority: 2, requireInteraction: true,
        title: `Challenge from ${it.from}${inGroup(grp, it.from) ? ` · ⚑ Group ${grp.name}` : ""}`, message: `${inGroup(grp, it.from) ? "Group match: it counts for the table. " : ""}Accept the match?${until}\nThe viewer opens after you accept.`,
        buttons: [{ title: "Accept" }, { title: "Silence" }] });
    } catch (e) {}
  }
  for (const id of invSeen) if (!res.items.some(x => x.matchId === id)) chrome.notifications.clear("inv:" + id);
  const { invMuted = [] } = await chrome.storage.session.get("invMuted");
  ring(res.items.some(x => !invMuted.includes(x.matchId))).catch(() => {});
  await chrome.storage.session.set({ invSeen: invSeen.slice(-50) });
}
// 1.28: a chime (offscreen page, Web Audio) when a challenge comes in, again every 12 s while one
// waits to be accepted (an invite lasts ~2 min). Switch: storage.local inviteSound (on by default).
let lastRing = 0;
async function ring(waiting) {
  if (!waiting || Date.now() - lastRing < 12000) return;
  const { inviteSound = true } = await chrome.storage.local.get("inviteSound");
  if (!inviteSound || !chrome.offscreen) return;
  lastRing = Date.now();
  try {
    if (!(await chrome.offscreen.hasDocument()))
      await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["AUDIO_PLAYBACK"], justification: "chime for an incoming match challenge" });
    chrome.runtime.sendMessage({ type: "chime" }).catch(() => {});
  } catch (e) {}
}
// 1.32: "Silence" (notification button or popup) stops the chime for that challenge; new ones still ring.
async function silenceInvite(matchId) {
  const { invMuted = [] } = await chrome.storage.session.get("invMuted");
  const inv = (await chrome.storage.session.get("invites")).invites || {};
  const ids = matchId ? [matchId] : (inv.items || []).map(x => x.matchId);
  for (const id of ids) if (!invMuted.includes(id)) invMuted.push(id);
  await chrome.storage.session.set({ invMuted: invMuted.slice(-50) });
  return { ok: true, muted: ids.length };
}
async function pollInvites() {
  const tabs = await portalTabs();
  if (!tabs.length) {
    const prev = (await chrome.storage.session.get("invites")).invites || {};
    await chrome.storage.session.set({ invites: { ...prev, ok: false, why: "no portal tab", items: [], at: Date.now() } });
    return;
  }
  // prefer a tab that is not a match viewer (its page is busy with the game)
  const t = tabs.find(x => !/\/viewer/.test(x.url || "")) || tabs[0];
  const res = await new Promise(r => chrome.tabs.sendMessage(t.id, { type: "invites-now" }, x => r(chrome.runtime.lastError ? null : x)));
  await storeInvites(res || { ok: false, why: "portal tab not ready (reload it)" });
}
async function acceptInvite(matchId) {
  const inv = (await chrome.storage.session.get("invites")).invites || {};
  const it = (inv.items || []).find(x => x.matchId === matchId);
  if (!it || !inv.eventId) return { ok: false, why: "the challenge is gone" };
  const tabs = await portalTabs();
  const t = tabs.find(x => !/\/viewer/.test(x.url || "")) || tabs[0];
  if (!t) return { ok: false, why: "no portal tab" };
  const res = await new Promise(r => chrome.tabs.sendMessage(t.id, { type: "invite-accept", eventId: inv.eventId, matchId },
    x => r(chrome.runtime.lastError ? { ok: false, why: "the portal tab did not answer" } : x)));
  if (res && res.ok) {
    chrome.notifications.clear("inv:" + matchId);
    await chrome.storage.session.set({ invites: { ...inv, items: (inv.items || []).filter(x => x.matchId !== matchId) } });
    // viewer in a visible tab: the recording starts at once and auto-START (if on) can click
    await chrome.tabs.create({ url: `${SITE}/v2/player/matches/${res.matchId || matchId}/viewer`, active: true });
  }
  return res || { ok: false, why: "no answer" };
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  if (msg.type === "invites" && sender.tab) { storeInvites(msg.res); return; }
  if (sender.tab) return;   // the rest only from the popup
  if (msg.type === "popup-invites-now") { pollInvites().then(() => reply({ ok: true })); return true; }
  if (msg.type === "popup-silence") { silenceInvite(msg.matchId).then(reply); return true; }
  if (msg.type === "popup-chime-test") { lastRing = 0; ring(true).then(() => reply({ ok: true })); return true; }
  if (msg.type === "popup-accept" && msg.matchId) { acceptInvite(msg.matchId).then(reply); return true; }
});
chrome.notifications.onButtonClicked.addListener((nid, idx) => {
  if (nid.startsWith("inv:") && idx === 1) { silenceInvite(nid.slice(4)); return; }
  if (!nid.startsWith("inv:") || idx !== 0) return;
  acceptInvite(nid.slice(4)).then(r => {
    if (!r.ok) chrome.notifications.create("invfail:" + Date.now(), { type: "basic", iconUrl: "icons/icon128.png",
      title: "Could not accept the challenge", message: r.why || "error" });
  });
});
chrome.notifications.onClicked.addListener(nid => {
  if (!nid.startsWith("inv:")) return;
  // the notification body: show the portal (its own Accept is there too); accepting stays a click
  portalTabs().then(tabs => {
    const t = tabs.find(x => /\/v2\/player\/?$/.test(x.url || ""));
    if (t) { chrome.tabs.update(t.id, { active: true }); chrome.windows.update(t.windowId, { focused: true }); }
    else chrome.tabs.create({ url: SITE + "/v2/player" });
  });
});
chrome.alarms.get("invites").then(a => { if (!a) chrome.alarms.create("invites", { periodInMinutes: 0.5, delayInMinutes: 0.1 }); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === "invites") pollInvites().catch(() => {}); });

// ---- Background recording (1.28): a match of ours is on and no tab shows it (a challenge accepted in
// the portal's own banner, a match started from another device...) → its viewer opens in a background
// tab of the portal's window, so the recorder hooks the game socket. That tab closes by itself once the
// recording and the report are saved (or after 12 min). Switch: storage.local bgRec (on by default).
let bgBusy = false;
async function bgRecord() {
  if (bgBusy) return;
  bgBusy = true;
  try { await bgRecordOnce(); } finally { bgBusy = false; }
}
async function bgRecordOnce() {
  const { bgRec = true } = await chrome.storage.local.get("bgRec");
  const { bgTabs = {}, bgSeen = {} } = await chrome.storage.session.get(["bgTabs", "bgSeen"]);   // the worker sleeps between rounds
  const { hist = {} } = await chrome.storage.local.get("hist");
  for (const [id, b] of Object.entries(bgTabs)) {   // done or too old: close what we opened
    const h = hist[id];
    if ((h && h.rec && h.report) || Date.now() - b.at > 12 * 60e3) {
      if (!b.closed) { try { const t = await chrome.tabs.get(b.tab); if (t && !t.active) await chrome.tabs.remove(b.tab); } catch (e) {} b.closed = true; }
      if (Date.now() - b.at > 60 * 60e3) delete bgTabs[id];
    }
  }
  if (bgRec) {
    const tabs = await portalTabs();
    const t = tabs.find(x => !/\/viewer|\/report/.test(x.url || ""));
    const res = t && await new Promise(r => chrome.tabs.sendMessage(t.id, { type: "live-now" }, x => r(chrome.runtime.lastError ? null : x)));
    for (const m of (res && res.ok && res.items) || []) {
      if (bgTabs[m.id] || tabs.some(x => (x.url || "").includes(m.id))) continue;
      // a fresh match: give the portal 15 s to open its own viewer (Start match / Accept do at once)
      if (!bgSeen[m.id]) bgSeen[m.id] = Date.now();
      if (Date.now() - Math.min(bgSeen[m.id], m.created || Infinity) < 15000) continue;
      try {
        const nt = await chrome.tabs.create({ url: `${SITE}/v2/player/matches/${m.id}/viewer`, active: false, windowId: t.windowId, index: t.index + 1 });
        bgTabs[m.id] = { tab: nt.id, at: Date.now(), opp: m.opp };
        notify(m.id, "bgrec", `Recording ${m.opp || "a match"} in the background`, "A match of ours started without a viewer: its viewer opened in a background tab and closes by itself after the save.");
      } catch (e) {}
    }
  }
  for (const k in bgSeen) if (Date.now() - bgSeen[k] > 60 * 60e3) delete bgSeen[k];
  await chrome.storage.session.set({ bgTabs, bgSeen });
}
// a portal tab also asks every ~10 s (bridge.js), so a match is caught well before kick-off
chrome.runtime.onMessage.addListener((msg, sender) => { if (msg && msg.type === "bg-live" && sender.tab) bgRecord().catch(() => {}); });
chrome.alarms.get("bgrec").then(a => { if (!a) chrome.alarms.create("bgrec", { periodInMinutes: 0.5, delayInMinutes: 0.2 }); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === "bgrec") bgRecord().catch(() => {}); });

// ---- auto-START screen check (1.12): is the orange START button on the viewer's canvas?
// bridge.js sends the 16:9 picture's rectangle (CSS px); the visible tab is captured and looked
// at in memory only (never saved). Answer: found + where its centre is (fractions of the picture).
const isOrange = (r, g, b) => r > 200 && g > 90 && g < 215 && b < 110 && r - b > 120;
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "start-check" || !sender.tab || !msg.pic) return;
  const tab = sender.tab;
  chrome.tabs.query({ active: true, windowId: tab.windowId }, act => {
    if (!act || !act[0] || act[0].id !== tab.id) { reply({ ok: false, why: "not the visible tab" }); return; }
    chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 }, async url => {
      try {
        if (chrome.runtime.lastError || !url) { reply({ ok: false, why: "capture failed" }); return; }
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = cv.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const k = bmp.width / msg.vw, p = msg.pic;
        const px = (fx, fy) => {
          const x = Math.round((p.x + p.w * fx) * k), y = Math.round((p.y + p.h * fy) * k);
          if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) return false;
          const d = ctx.getImageData(x, y, 1, 1).data;
          return isOrange(d[0], d[1], d[2]);
        };
        // 1) where it was on 27.10: centre, 85% down (samples around the label)
        const pts = [];
        for (const dx of [-0.09, -0.06, -0.03, 0.03, 0.06, 0.09]) for (const dy of [-0.025, 0, 0.025]) pts.push([0.5 + dx, 0.85 + dy]);
        const share = pts.filter(([x, y]) => px(x, y)).length / pts.length;
        if (share >= 0.5) { reply({ ok: true, found: true, fx: 0.5, fy: 0.85, share }); return; }
        // 2) moved a little: centre of the orange points in the lower middle of the picture
        let n = 0, sx = 0, sy = 0;
        for (let fy = 0.6; fy <= 0.97; fy += 0.01) for (let fx = 0.25; fx <= 0.75; fx += 0.01) if (px(fx, fy)) { n++; sx += fx; sy += fy; }
        if (n >= 60) reply({ ok: true, found: true, fx: sx / n, fy: sy / n, share, n });
        else reply({ ok: true, found: false, share, n });
      } catch (e) { reply({ ok: false, why: String(e && e.message || e) }); }
    });
  });
  return true;
});

// ---- Ping (1.14): the popup asks, a portal tab reads it with the portal's sign-in.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "popup-ping" || sender.tab) return;
  (async () => {
    const tabs = await chrome.tabs.query({ url: SITE + "/*" });
    const t = tabs.find(x => !/\/viewer/.test(x.url || "")) || tabs[0];
    if (!t) return { ok: false, why: "no portal tab" };
    return await new Promise(r => chrome.tabs.sendMessage(t.id, { type: "ping-now", matchId: msg.matchId || null },
      x => r(chrome.runtime.lastError ? { ok: false, why: "portal tab not ready (reload it)" } : x)));
  })().then(r => { chrome.storage.session.set({ ping: r }); reply(r); });
  return true;
});

// ---- Opponents (1.15): place, win rate and our record against them, for the popup.
// The table (all teams) and our results come with every portal read (bridge.js portalSync);
// the portal lists only our newest 100 matches, so results are kept here by match id and grow,
// and the older ones come from the ingested matches through the native helper ("h2h").
async function keepTableAndResults(d) {
  const lb = (d.table || []).map(t => ({ rank: t.rank, id: t.team_id, name: t.team_name, p: t.matches_played,
                                         w: t.wins, d: t.draws, l: t.losses, pts: t.points }));
  const us = d.team ? { id: d.team.team_id, name: d.team.name } : null;
  const { h2hPortal = {} } = await chrome.storage.local.get("h2hPortal");
  for (const m of d.matches || []) {
    const r = m.result;
    if (m.status !== "completed" || !r || !us) continue;
    const home = m.home_team_id === us.id;
    h2hPortal[m.match_id] = { opp: home ? m.away_team_name : m.home_team_name, oppId: home ? m.away_team_id : m.home_team_id,
      us: home ? r.home_score : r.away_score, them: home ? r.away_score : r.home_score, at: m.completed_at || m.created_at,
      practice: !!m.is_practice };
  }
  await chrome.storage.local.set({ lb: { at: Date.now(), total: d.total_teams, us, teams: lb }, h2hPortal });
}
// 1.36: our tournament group, from the local helper (native/group.json) — own build only; the team
// build has no helper, so nobody else gets the mark. {name, teams: [lower-case names]} or null.
async function myGroup() {
  let { groupInfo } = await chrome.storage.local.get("groupInfo");
  if (!groupInfo || Date.now() - groupInfo.at > 10 * 60e3) {
    const r = await nativeCall({ cmd: "group" });
    groupInfo = { at: Date.now(), g: r && r.ok && Array.isArray(r.teams) ? { name: r.name, teams: r.teams.map(t => String(t).trim().toLowerCase()) } : null };
    if (!(r && r.missing && groupInfo.g === null && HAS_NATIVE)) await chrome.storage.local.set({ groupInfo });
  }
  return groupInfo.g;
}
const inGroup = (g, name) => !!(g && g.teams.includes(String(name || "").replace(/\s*\((людина|human)\)/i, "").trim().toLowerCase()));
async function h2hData() {
    let { h2hLocal } = await chrome.storage.local.get("h2hLocal");
    if (!h2hLocal || Date.now() - h2hLocal.at > 10 * 60e3) {
      const r = await nativeCall({ cmd: "h2h" });
      if (r && r.ok) { h2hLocal = { at: Date.now(), matches: r.matches }; await chrome.storage.local.set({ h2hLocal }); }
    }
    const { lb = null, h2hPortal = {} } = await chrome.storage.local.get(["lb", "h2hPortal"]);
    const all = { ...Object.fromEntries(((h2hLocal && h2hLocal.matches) || []).map(m => [m.id, { opp: m.opp, us: m.us, them: m.them, at: m.date, version: m.version }])) };
    for (const [id, m] of Object.entries(h2hPortal)) all[id] = { ...(all[id] || {}), ...m };
    const { autoAccept = null, autoStart = false } = await chrome.storage.local.get(["autoAccept", "autoStart"]);
    return { ok: true, lb, matches: all, local: !!h2hLocal, autoStart, autoAccept, group: await myGroup() };
}
// read-only data: the popup and (1.16) the match panel on the viewer page ask for it
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || (msg.type !== "popup-h2h" && msg.type !== "panel-h2h")) return;
  if (msg.type === "popup-h2h" && sender.tab) return;
  h2hData().then(reply);
  return true;
});

// ---- After the extension is reloaded or updated (1.21): open portal tabs lose the old bridge.js
// (panel, challenges, auto-START, saving), so it is injected again; the recorder in the page itself
// (recorder.js, page world) keeps running and keeps recording through the reload.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: SITE + "/*" });
    for (const t of tabs) chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["bridge.js"] }).catch(() => {});
  } catch (e) {}
});

// ---- Our agents' live call cadence (1.27): the match panel asks every 15 s; the native helper reads
// the last minute of TRACE from CloudWatch (scripts/live_trace.py). No helper (team build): "missing".
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "live-trace" || !sender.tab || !msg.matchId) return;
  nativeCall({ cmd: "live_trace", match: msg.matchId }).then(reply);
  return true;
});
