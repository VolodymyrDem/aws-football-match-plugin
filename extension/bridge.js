// Extension side of the page (isolated world): passes recordings from recorder.js
// to background.js, which writes the files. A save goes out only when it has more
// frames than the last one saved for that match, so an early partial save never
// blocks the full one. On the report page it also saves the report text.
(() => {
  // 1.21: the background injects this file again into open portal tabs after the extension is
  // reloaded (the old copy is cut off then); one live copy per page.
  // A copy cut off by a reload keeps running but its chrome.runtime is gone: it steps aside.
  const CH = globalThis.chrome;   // this copy's own extension handle
  const alive = () => { try { return !!(CH && CH.runtime && CH.runtime.id); } catch (e) { return false; } };
  if (window.__drkBridgeAlive && window.__drkBridgeAlive()) return;
  window.__drkBridgeAlive = alive;
  const SAVED = "__rec_saved";   // {id, n}: frames in the last saved file of this tab
  const savedN = id => {
    try { const s = JSON.parse(sessionStorage.getItem(SAVED) || "null"); return s && s.id === id ? s.n : 0; }
    catch (e) { return 0; }
  };
  const send = (msg, n) => {
    if (!msg.id || n <= savedN(msg.id)) return false;
    chrome.runtime.sendMessage(msg, resp => {
      if (resp && resp.ok) try { sessionStorage.setItem(SAVED, JSON.stringify({ id: msg.id, n })); } catch (e) {}
    });
    return true;
  };

  let lastLiveSave = 0;
  window.addEventListener("message", ev => {
    const d = ev.data;
    if (ev.source !== window || !d || d.source !== "drunkards-rec") return;
    if (d.type === "recording") chrome.runtime.sendMessage({ type: "recording", id: d.id });
    if (d.type === "status") {
      lastStatus = d;
      const { source, ...st } = d;
      st.auto = { on: autoOn, clicks: autoClicks, pressed: autoDone, title: titleSeen };
      try { chrome.runtime.sendMessage(st); } catch (e) { /* extension reloaded: page needs a reload */ }
    }
    if (d.type === "save") {
      lastLiveSave = Date.now();
      send({ type: "save", id: d.id, data: d.data, why: d.why, n: d.n }, d.why === "button" ? Infinity : d.n);
    }
  });

  // ---- auto-START (popup switch, off by default; 1.12). START is a title screen that Unity
  // draws on the canvas; the match itself runs on the server without it (it starts ~30 s after
  // the invite), so the screen can still be up mid-match. While the switch is on, the viewer's
  // frames flow and this tab is visible, every 2 s the background looks at a capture of the tab
  // (kept in memory only) for the orange START button over the canvas; if it is there, this page
  // clicks its centre (Unity takes such clicks: checked on the live viewer 27.10). It stops when
  // the button is gone after a click or after 15 clicks. 1.17: it no longer gives up after ~10 s
  // without a button — frames start while Unity is still loading, before the title is drawn —
  // and keeps looking while the viewer is open (every 2 s for 3 min, then every 6 s).
  let autoOn = false, autoClicks = 0, autoDone = false, titleSeen = false, noTitle = 0, lastStatus = null;
  let autoChecks = 0, autoLast = "", autoT0 = 0;
  const loadAuto = async () => {
    try { autoOn = !!(await chrome.storage.local.get("autoStart")).autoStart; } catch (e) {}
  };
  loadAuto();
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.autoStart) loadAuto(); }); } catch (e) {}
  const pictureRect = () => {
    let best = null, area = 0;
    for (const c of document.querySelectorAll("canvas")) {
      const r = c.getBoundingClientRect();
      if (r.width * r.height > area) { area = r.width * r.height; best = r; }
    }
    if (!best || area < 40000) return null;
    let w = best.width, h = best.height;   // the 16:9 picture, centred if the canvas is wider/taller
    if (w / h > 16 / 9) w = h * 16 / 9; else h = w * 9 / 16;
    return { x: best.left + (best.width - w) / 2, y: best.top + (best.height - h) / 2, w, h };
  };
  const tapAt = (x, y) => {
    const c = document.elementFromPoint(x, y);
    if (!c || c.tagName !== "CANVAS") return false;
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: window };
    const P = (type, b) => c.dispatchEvent(new PointerEvent(type, { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons: b }));
    const M = (type, b) => c.dispatchEvent(new MouseEvent(type, { ...base, button: 0, buttons: b }));
    P("pointerover", 0); P("pointerenter", 0); P("pointermove", 0); M("mousemove", 0);
    P("pointerdown", 1); M("mousedown", 1);
    setTimeout(() => { P("pointerup", 0); M("mouseup", 0); M("click", 0); }, 90);
    return true;
  };
  let autoBusy = false;
  setInterval(async () => {
    if (!autoOn || autoDone || autoBusy || !alive()) return;
    if (document.visibilityState !== "visible") { autoLast = "tab not visible"; return; }
    if (!lastStatus || !lastStatus.lastWall || Date.now() - lastStatus.lastWall > 3000) { autoLast = "waiting for frames"; return; }   // frames must flow
    const pic = pictureRect();
    if (!pic) { autoLast = "no canvas"; return; }
    if (!autoT0) autoT0 = Date.now();
    if (Date.now() - autoT0 > 180e3 && autoChecks % 3 !== 0) { autoChecks++; return; }   // after 3 min: every 6 s
    autoBusy = true;
    try {
      // 1.18: first from Unity's canvas in the page (any visible tab), else a capture of the tab
      let r = await new Promise(res => {
        const t = setTimeout(() => { removeEventListener("message", on); res(null); }, 1500);
        function on(ev) {
          if (ev.source !== window || !ev.data || ev.data.source !== "drunkards-rec" || ev.data.type !== "start-seen") return;
          clearTimeout(t); removeEventListener("message", on); res({ ok: true, ...ev.data, via: "canvas" });
        }
        addEventListener("message", on);
        window.postMessage({ source: "drunkards-rec-bridge", type: "start-sample" }, location.origin);
      });
      if (!r) r = await new Promise(res => chrome.runtime.sendMessage({ type: "start-check", pic, vw: innerWidth, vh: innerHeight },
        x => res(chrome.runtime.lastError ? null : x)));
      autoChecks++;
      if (!r || !r.ok) { autoLast = "capture failed: " + ((r && r.why) || "no answer"); return; }
      if (r.found) {
        titleSeen = true; noTitle = 0;
        if (autoClicks >= 15) { autoDone = true; autoLast = "15 clicks, over to you"; return; }
        if (tapAt(pic.x + pic.w * r.fx, pic.y + pic.h * r.fy)) { autoClicks++; autoLast = `pressed (${Math.round(r.share * 100)}% of the button seen)`; }
        else autoLast = "the button is covered by another element";
      } else if (titleSeen) {
        autoDone = true; autoLast = "START pressed, game on screen";   // the button is gone
      } else {
        noTitle++; autoLast = `START button not seen (${noTitle})`;
      }
    } catch (e) {} finally { autoBusy = false; }
  }, 2000);

  // The viewer jumps to /matches/<id>/report at full time; the gzipped copy made in this
  // tab is still in sessionStorage (recorder.js).
  const fromStorage = why => {
    try {
      const st = JSON.parse(sessionStorage.getItem("__rec_v3") || "null");
      if (!st || !st.id || !st.b64) return false;
      send({ type: "save", id: st.id, b64: st.b64, why, n: st.n }, why === "button" ? Infinity : st.n);
      return true;
    } catch (e) { return false; }
  };

  // Screenshot of the report page top (both team names + final score: the tournament
  // result proof), once per match. Only the visible tab can be captured, so a hidden
  // tab tries again when it is shown.
  const shoot = id => {
    const key = "__shot_saved_" + id;
    let tries = 0;
    const go = () => {
      try { if (localStorage.getItem(key) === "1") return; } catch (e) {}
      if (++tries > 6 || document.visibilityState !== "visible") return;
      window.scrollTo(0, 0);
      setTimeout(() => chrome.runtime.sendMessage({ type: "shot", id }, resp => {
        if (resp && resp.ok) try { localStorage.setItem(key, "1"); } catch (e) {}
        else if (resp && !resp.hidden) setTimeout(go, 3000);
      }), 600);
    };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") go(); });
    go();
  };

  // Report page: wait for the AI summary, then save the whole page text once per match.
  const rep = location.pathname.match(/\/matches\/([0-9a-f-]{36})\/report/);
  if (rep) {
    window.addEventListener("load", () => fromStorage("report page"));
    const id = rep[1];
    let key = "__rep_saved_" + id, tries = 0;
    let done = false;
    try { done = localStorage.getItem(key) === "1"; } catch (e) {}
    if (done) shoot(id);
    // After ~90 s without the AI summary the text so far is saved, and saved again (same
    // file) once the summary appears, for up to ~5 min.
    let partial = false, shotAsked = false;
    const iv = setInterval(() => {
      if (done || ++tries > 150) { clearInterval(iv); return; }
      const t = (document.body && document.body.innerText) || "";
      if (!/Behind the Scenes/i.test(t)) return;   // not rendered yet
      const ready = /AGENT PERFORMANCE/i.test(t) && !/Generating summary/i.test(t);
      if (!ready && (tries < 45 || partial)) return;
      if (ready) { done = true; clearInterval(iv); } else partial = true;
      chrome.runtime.sendMessage({ type: "report", id, text: t, full: ready }, resp => {
        if (ready && resp && resp.ok) try { localStorage.setItem(key, "1"); } catch (e) {}
      });
      if (!shotAsked) { shotAsked = true; shoot(id); }
    }, 2000);
  }

  // Portal data for the emulator site (1.6): our team, the whole table, our recent matches.
  // Read with the portal's own sign-in (it stays in the page; only the answers are saved),
  // at most every 3 minutes across tabs; background.js writes portal.json only when it changed.
  const API = "https://l3fmtx4zp0.execute-api.us-east-1.amazonaws.com/prod";
  // Coach name = the agent version that plays (1.8): the native helper says which name is wanted
  // (scripts/coach_name.py, from the deploy logs; off unless switched on); a different one is saved with
  // the portal's own request (PUT /teams/<id> {coach_name}, what its coach-name field sends).
  // One try per name per 30 min; the result goes back to the helper (coach_name.py status).
  // Each step leaves a trace in this page's localStorage (__coach_dbg: steps and names only, never the token).
  const coachTrace = (step, extra) => {
    try {
      const t = JSON.parse(localStorage.getItem("__coach_dbg") || "[]").slice(-9);
      t.push({ at: new Date().toLocaleTimeString(), step, ...(extra || {}) });
      localStorage.setItem("__coach_dbg", JSON.stringify(t));
    } catch (e) {}
  };
  const syncCoach = async (team, id, token) => {
    coachTrace("ask", { have: team.coach_name || null });
    const w = await new Promise(res => chrome.runtime.sendMessage({ type: "coach-wanted" }, r => {
      const le = chrome.runtime.lastError;
      res(r || { none: true, error: le ? le.message : null });
    }));
    coachTrace("wanted", { enabled: !!w.enabled, name: w.name || null, version: w.version || null, error: w.error || null, missing: !!w.missing });
    if (!w || !w.enabled || !w.name || team.coach_name === w.name) return team.coach_name;
    let tried = {};
    try { tried = JSON.parse(localStorage.getItem("__coach_try") || "{}"); } catch (e) {}
    if (tried.name === w.name && Date.now() - (tried.at || 0) < 30 * 60e3) return team.coach_name;
    try { localStorage.setItem("__coach_try", JSON.stringify({ name: w.name, at: Date.now() })); } catch (e) {}
    const was = team.coach_name || null;
    let ok = false, error = null;
    try {
      const r = await fetch(API + "/teams/" + encodeURIComponent(id), { method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ coach_name: w.name }) });
      ok = r.ok;
      if (!ok) error = `${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`;
    } catch (e) { error = String(e.message || e); }
    if (ok) team.coach_name = w.name;
    coachTrace("put", { name: w.name, ok, error });
    chrome.runtime.sendMessage({ type: "coach-report", name: w.name, ok, error, was });
    return team.coach_name;
  };
  // 1.9: the background asks right after a deploy (works in a hidden tab too): coach name only.
  const coachNow = async () => {
    let token = null;
    try { token = localStorage.getItem("world_cup_team_token"); } catch (e) {}
    if (!token) return { ok: false, why: "signed out" };
    const r = await fetch(API + "/teams/mine", { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return { ok: false, why: "/teams/mine: " + r.status };
    const team = ((await r.json()).items || [])[0];
    if (!team) return { ok: false, why: "no team" };
    return { ok: true, have: await syncCoach(team, team.team_id, token) };
  };
  const portalSync = async force => {
    let token = null, last = 0;
    try { token = localStorage.getItem("world_cup_team_token"); last = +localStorage.getItem("__portal_at") || 0; } catch (e) {}
    if (!token || (!force && Date.now() - last < 3 * 60e3)) return { ok: false, why: token ? "recent" : "signed out" };
    try { localStorage.setItem("__portal_at", String(Date.now())); } catch (e) {}
    const get = async p => {
      const r = await fetch(API + p, { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) throw new Error(`${p.split("?")[0]}: ${r.status}`);
      return r.json();
    };
    try {
      const mine = (await get("/teams/mine")).items || [];
      const team = mine[0];
      if (!team) return { ok: false, why: "no team" };
      const T = team.tournament_id, id = team.team_id;
      await syncCoach(team, id, token).catch(e => coachTrace("error", { error: String(e && e.message || e) }));
      const [table, me, matches] = await Promise.all([
        get(`/tournaments/${T}/standings?limit=500`),
        get(`/tournaments/${T}/standings?team_id=${id}`).catch(() => ({})),
        get(`/matches?team_id=${id}&limit=300`)]);
      const drop = ["game_server_url", "vendor_match_id", "auto_start_delay_seconds", "game_id", "updated_at", "startingAt", "MatchId"];
      for (const m of matches.items || []) for (const k of drop) delete m[k];
      delete team.team_code; delete team.owner_id;   // join code and account id: not needed, not saved
      const data = { v: 1, team, teams: mine.map(t => ({ team_id: t.team_id, name: t.name, tournament_id: t.tournament_id })),
                     standing: me.item || null, total_teams: table.total_teams, tournament_id: T,
                     table: table.items || [], matches: matches.items || [], counts: matches.counts || null };
      return await new Promise(res => chrome.runtime.sendMessage({ type: "portal", data }, r => res(r || { ok: false })));
    } catch (e) { return { ok: false, why: String(e.message || e) }; }
  };
  // Incoming challenges (1.11): the same list the portal's own banner reads
  // (GET /events/<tournament>/match-invites?team_id=<us>&status=pending, invites TO us only).
  // Accepting happens only when you click "Accept" (popup or notification): the background
  // asks this page to send the portal's own accept request (PUT …/match-invites/<match>/accept).
  let myTeam = null, myTeamAt = 0;
  const invitesNow = async () => {
    let token = null;
    try { token = localStorage.getItem("world_cup_team_token"); } catch (e) {}
    if (!token) return { ok: false, why: "signed out" };
    const H = { headers: { Authorization: "Bearer " + token } };
    if (!myTeam || Date.now() - myTeamAt > 10 * 60e3) {
      const r = await fetch(API + "/teams/mine", H);
      if (!r.ok) return { ok: false, why: "teams/mine " + r.status };
      myTeam = ((await r.json()).items || [])[0] || null; myTeamAt = Date.now();
    }
    if (!myTeam) return { ok: false, why: "no team" };
    const T = myTeam.tournament_id, id = myTeam.team_id;
    const r = await fetch(`${API}/events/${encodeURIComponent(T)}/match-invites?team_id=${encodeURIComponent(id)}&status=pending`, H);
    if (!r.ok) return { ok: false, why: "match-invites " + r.status };
    const now = Date.now();
    const items = ((await r.json()).items || [])
      .filter(x => x.invitee_team_id === id && (x.status || "pending") === "pending"
        && !(x.invite_expires_at && Date.parse(x.invite_expires_at) < now))
      .map(x => ({ matchId: x.match_id, from: x.inviter_team_name || "?", fromId: x.inviter_team_id || "",
                   expires: x.invite_expires_at || "", created: x.created_at || "" }));
    return { ok: true, eventId: T, teamId: id, items, at: now };
  };
  // Agents' ping (1.14): what the portal shows — /teams/<us>/observability (each agent's recent
  // average and p99 latency, invocations, errors, throttles) and, for a match, every position's
  // average latency for both teams (/matches/<id>: home_/away_agent_stats).
  const pingNow = async matchId => {
    let token = null;
    try { token = localStorage.getItem("world_cup_team_token"); } catch (e) {}
    if (!token) return { ok: false, why: "signed out" };
    const H = { headers: { Authorization: "Bearer " + token } };
    if (!myTeam || Date.now() - myTeamAt > 10 * 60e3) {
      const r = await fetch(API + "/teams/mine", H);
      if (!r.ok) return { ok: false, why: "teams/mine " + r.status };
      myTeam = ((await r.json()).items || [])[0] || null; myTeamAt = Date.now();
    }
    if (!myTeam) return { ok: false, why: "no team" };
    const id = myTeam.team_id;
    const out = { ok: true, at: Date.now() };
    const o = await fetch(`${API}/teams/${encodeURIComponent(id)}/observability`, H);
    if (o.ok) {
      const j = await o.json();
      out.fetched = j.fetched_at || null;
      out.agents = (j.agents || []).map(a => ({ pos: a.position, name: a.agent_name, ...(a.metrics || {}) }))
        .sort((a, b) => a.pos - b.pos);
    } else out.obsError = o.status;
    if (!matchId) {   // the newest match of ours
      const r = await fetch(`${API}/matches?team_id=${encodeURIComponent(id)}&limit=1`, H);
      if (r.ok) matchId = (((await r.json()).items || [])[0] || {}).match_id || null;
    }
    if (matchId) {
      const r = await fetch(`${API}/matches/${encodeURIComponent(matchId)}`, H);
      if (r.ok) {
        const m = await r.json();
        const home = m.home_team_id === id;
        const side = k => m[(home ? "home_" : "away_") + k], opp = k => m[(home ? "away_" : "home_") + k];
        const per = st => st ? Object.keys(st).sort().map(k => (st[k] || {}).latency_avg_ms ?? null) : null;
        out.match = { id: matchId, status: m.status, opp: home ? m.away_team_name : m.home_team_name,
                      oppId: home ? m.away_team_id : m.home_team_id, usId: id, home,
                      us: per(side("agent_stats")), them: per(opp("agent_stats")),
                      usAvg: side("avg_latency_ms") ?? null, themAvg: opp("avg_latency_ms") ?? null };
      }
    }
    return out;
  };
  // Our matches being played now (1.28, background recording): in_progress and started recently
  // (the portal leaves some old ones in_progress for hours).
  const liveNow = async () => {
    let token = null;
    try { token = localStorage.getItem("world_cup_team_token"); } catch (e) {}
    if (!token) return { ok: false, why: "signed out" };
    const H = { headers: { Authorization: "Bearer " + token } };
    if (!myTeam || Date.now() - myTeamAt > 10 * 60e3) {
      const r = await fetch(API + "/teams/mine", H);
      if (!r.ok) return { ok: false, why: "teams/mine " + r.status };
      myTeam = ((await r.json()).items || [])[0] || null; myTeamAt = Date.now();
    }
    if (!myTeam) return { ok: false, why: "no team" };
    const r = await fetch(`${API}/matches?team_id=${encodeURIComponent(myTeam.team_id)}&limit=5`, H);
    if (!r.ok) return { ok: false, why: "matches " + r.status };
    const items = ((await r.json()).items || []).filter(m => m.status === "in_progress"
      && Date.now() - Date.parse(m.created_at) < ((m.match_duration_seconds || 120) + (m.auto_start_delay_seconds || 0) + 240) * 1000)
      .map(m => ({ id: m.match_id, created: Date.parse(m.created_at) || 0, opp: m.home_team_id === myTeam.team_id ? m.away_team_name : m.home_team_name }));
    return { ok: true, items };
  };
  // An opponent's form (1.28): their own last matches on the portal (/matches?team_id=<them>).
  const oppFormNow = async oppId => {
    let token = null;
    try { token = localStorage.getItem("world_cup_team_token"); } catch (e) {}
    if (!token) return { ok: false, why: "signed out" };
    const r = await fetch(`${API}/matches?team_id=${encodeURIComponent(oppId)}&limit=100`, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return { ok: false, why: "matches " + r.status };
    let items = ((await r.json()).items || []).filter(m => m.status === "completed" && m.result);
    if (items.filter(m => !m.is_practice).length >= 5) items = items.filter(m => !m.is_practice);   // real teams, not the sample bots
    const ms = items
      .map(m => { const h = m.home_team_id === oppId, f = h ? m.result.home_score : m.result.away_score, a = h ? m.result.away_score : m.result.home_score;
        return { at: Date.parse(m.completed_at || m.created_at) || 0, f, a, r: f > a ? "W" : f < a ? "L" : "D",
                 t: `${f}:${a} vs ${h ? m.away_team_name : m.home_team_name}` }; })
      .sort((x, y) => y.at - x.at);
    const sum = list => ({ n: list.length, wr: list.length ? Math.round(100 * list.filter(x => x.r === "W").length / list.length) : 0,
      gf: list.length ? (list.reduce((s, x) => s + x.f, 0) / list.length).toFixed(1) : "0", ga: list.length ? (list.reduce((s, x) => s + x.a, 0) / list.length).toFixed(1) : "0" });
    return { ok: true, oppId, at: Date.now(), last: ms.slice(0, 5), day: sum(ms.filter(x => Date.now() - x.at < 864e5)), all: sum(ms) };
  };
  const acceptInvite = async (eventId, matchId) => {
    let token = null;
    try { token = localStorage.getItem("world_cup_team_token"); } catch (e) {}
    if (!token) return { ok: false, why: "signed out" };
    const r = await fetch(`${API}/events/${encodeURIComponent(eventId)}/match-invites/${encodeURIComponent(matchId)}/accept`,
      { method: "PUT", headers: { Authorization: "Bearer " + token } });
    if (!r.ok) {
      let why = "accept " + r.status;
      try { const j = await r.json(); why += ": " + (j.message || j.error || JSON.stringify(j)).slice(0, 120); } catch (e) {}
      return { ok: false, why };
    }
    let mid = matchId;
    try { mid = (await r.json()).match_id || matchId; } catch (e) {}
    return { ok: true, matchId: mid };
  };
  if (location.hostname === "agentic-football.aws.dev") {
    // (1.17: an invite lasts ~2 min and the background's own check runs only every 30 s);
    // tabs share one check via localStorage
    let aaOn = false;
    const loadAA = async () => {
      try { const { autoAccept: a } = await chrome.storage.local.get("autoAccept"); aaOn = !!(a && a.on && Date.now() < (a.until || 0)); } catch (e) {}
    };
    loadAA();
    try { chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.autoAccept) loadAA(); }); } catch (e) {}
    // 1.28: every portal tab, hidden too, so a challenge is seen within ~5 s (2.5 s with auto-accept);
    // while one waits, every portal tab that is not a match viewer flashes its title.
    let baseTitle = null, flash = 0;
    const flashTitle = () => {
      let w = null;
      try { w = JSON.parse(localStorage.getItem("__inv_wait") || "null"); } catch (e) {}
      const on = w && w.n > 0 && Date.now() - w.at < 20000 && !/\/viewer/.test(location.pathname);
      if (on) {
        if (baseTitle === null) baseTitle = document.title;
        document.title = ++flash % 2 ? `🔔 Challenge: ${w.from}` : `⚽ Accept? (${w.n})`;
      } else if (baseTitle !== null) { document.title = baseTitle; baseTitle = null; }
    };
    setInterval(flashTitle, 1000);
    // background recording (1.29): every ~10 s one portal tab (not a viewer) wakes the background check
    setInterval(() => {
      if (!alive() || /\/viewer|\/report/.test(location.pathname)) return;
      try { if (Date.now() - (+localStorage.getItem("__bg_at") || 0) < 9000) return; localStorage.setItem("__bg_at", String(Date.now())); } catch (e) {}
      try { chrome.runtime.sendMessage({ type: "bg-live" }); } catch (e) {}
    }, 3000);
    setInterval(async () => {
      if (!alive()) return;
      try { if (Date.now() - (+localStorage.getItem("__inv_at") || 0) < (aaOn ? 2500 : 4500)) return; localStorage.setItem("__inv_at", String(Date.now())); } catch (e) {}
      const res = await invitesNow().catch(e => ({ ok: false, why: String(e && e.message || e) }));
      try { if (res && res.ok) localStorage.setItem("__inv_wait", JSON.stringify({ n: res.items.length, from: (res.items[0] || {}).from || "", at: Date.now() })); } catch (e) {}
      try { chrome.runtime.sendMessage({ type: "invites", res }); } catch (e) {}
    }, 2500);
  }

  if (location.hostname === "agentic-football.aws.dev") {
    setTimeout(() => portalSync(false), 4000);
    setInterval(() => { if (document.visibilityState === "visible") portalSync(false); }, 5 * 60e3);
  }

  // ---- Match panel over the viewer's "Coach Live Feed" card (1.16): opponent's place, win rate
  // and our record against them, our place, both teams' ping per position, the recording and
  // the switches. "▾" folds it to its title so the coach feed shows again (remembered).
  // 1.19: the portal opens a match you start yourself without loading a new page (it only changes
  // the address), so the panel follows the address instead of checking it once at load.
  const viewerMid = () => {
    const p = location.pathname;
    return /\/report/.test(p) ? null : ((p.match(/match(?:es)?\/([0-9a-f-]{36})/) || [])[1] || null);
  };
  {
    let mid = viewerMid();
    const POSN = ["GK", "DEF", "MID", "FWD1", "FWD2"];
    const E = x => String(x ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const nn = n => String(n || "").replace(/\s*\((\u043b\u044e\u0434\u0438\u043d\u0430|human)\)/i, "").trim().toLowerCase();
    let H = null, PING = null, LIVE = null, FORM = null, folded = false, host = null, box = null;
    try { folded = localStorage.getItem("__drk_panel_folded") === "1"; } catch (e) {}
    // 1.34: own compact font (the page's pixel font made every label wrap), collapsible sections
    // (remembered), bars + a shot map next to the numbers, "waiting for kick-off" before the first frames.
    let closed = {};
    try { closed = JSON.parse(localStorage.getItem("__drk_sec") || "{}") || {}; } catch (e) {}
    const css = `
      .drk{box-sizing:border-box;padding:12px 14px;background:#11131c;border:1px solid #22d3ee55;border-radius:10px;
        color:#e5e7eb;font:12.5px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;letter-spacing:0;
        font-variant-numeric:tabular-nums;text-transform:none;text-align:left}
      .drk *{box-sizing:border-box;font-family:inherit;letter-spacing:inherit}
      .drk.folded{padding:8px 12px;margin-top:8px}
      .drk .hd{display:flex;align-items:center;gap:8px}
      .drk .hd .nm{font-size:15px;font-weight:700;color:#f8fafc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
      .drk .hd button{flex:none;background:none;border:1px solid #334155;color:#94a3b8;border-radius:6px;cursor:pointer;font-size:11px;padding:1px 7px}
      .drk .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
      .drk .chip{padding:1px 7px;border-radius:9px;background:#1e2433;font-size:11px;white-space:nowrap;color:#cbd5e1}
      .drk .chip b{font-weight:700}
      .drk.folded .bd,.drk.folded .chips{display:none}
      .drk .sec{margin-top:10px;border-top:1px solid #1f2937;padding-top:6px}
      .drk .sh{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;
        color:#64748b;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em}
      .drk .sh:hover{color:#94a3b8}
      .drk .sh .ar{font-size:10px}
      .drk .sb{margin-top:5px}
      .drk .sec.closed .sb{display:none}
      .drk .kv{display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:1px 0}
      .drk .kv>span:first-child{color:#94a3b8;white-space:nowrap}
      .drk .kv>span:last-child{text-align:right;white-space:nowrap;min-width:0}
      .drk .kv.w>span:last-child{white-space:normal}
      .drk .kv b{font-weight:700}
      .drk .g{color:#4ade80}.drk .o{color:#fbbf24}.drk .r{color:#f87171}.drk .m{color:#94a3b8}.drk .us{color:#22d3ee}.drk .th{color:#fb923c}
      .drk .note{color:#64748b;font-size:10.5px;margin-top:4px;line-height:1.35}
      .drk .wait{color:#94a3b8;font-size:12px;padding:4px 0}
      .drk .fr{display:inline-flex;gap:3px}
      .drk .fr i{display:inline-block;width:15px;height:15px;border-radius:3px;font:700 9.5px/15px inherit;font-style:normal;text-align:center;color:#0b0c10}
      .drk .fr .W{background:#f87171}.drk .fr .L{background:#4ade80}.drk .fr .D{background:#fbbf24}
      .drk .br{display:grid;grid-template-columns:38px 1fr 38px;align-items:center;gap:6px;margin:3px 0}
      .drk .br .lb{grid-column:1/4;color:#94a3b8;font-size:11px;margin-bottom:-2px}
      .drk .br .a{text-align:right;font-weight:700}.drk .br .z{text-align:left;font-weight:700}
      .drk .br .t{height:8px;border-radius:4px;background:#1f2937;display:flex;overflow:hidden}
      .drk .br .t i{display:block;height:100%}
      .drk .lg{display:flex;justify-content:space-between;font-size:11px;font-weight:600;margin-bottom:2px}
      .drk svg{display:block;width:100%;height:auto;margin-top:6px}
      .drk table{width:100%;border-collapse:collapse}
      .drk th{color:#64748b;font-weight:500;font-size:10.5px;text-align:right;padding:0 3px 2px;white-space:nowrap}
      .drk td{text-align:right;padding:2px 3px;border-top:1px solid #1f2937;white-space:nowrap}
      .drk th:first-child,.drk td:first-child{text-align:left}
      #drk-strip{position:absolute;z-index:5;padding:10px 16px 12px;background:#11131cee;border:1px solid #22d3ee44;border-radius:10px;overflow:hidden;flex-direction:column}
      #drk-strip .drk-cols{display:grid;grid-template-columns:minmax(220px,1.1fr) minmax(240px,1.3fr) minmax(250px,1fr);gap:22px;flex:1;min-height:0}
      #drk-strip .drk-cols>div{min-height:0;overflow:hidden}
      #drk-strip .drk-top{display:flex;align-items:center;gap:12px;margin-bottom:6px;color:#64748b;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em}
      #drk-strip .drk-top .sc{color:#f8fafc;font-size:18px;letter-spacing:0}
      #drk-strip .drk-top button{margin-left:auto;background:none;border:1px solid #334155;color:#94a3b8;border-radius:6px;cursor:pointer;font-size:10.5px;padding:1px 8px;text-transform:none;letter-spacing:0}
      #drk-strip .drk-mapc{display:flex;flex-direction:column;min-height:0}
      #drk-strip .drk-mapc svg{flex:1 1 0;min-height:0;width:100%;height:100%;margin:0}
      #drk-strip .br{margin:2px 0 4px}
      .drk .lnk{color:#22d3ee;cursor:pointer;font-size:11px}`;
    const lat = v => v == null ? `<span class="m">—</span>` : `<span class="${v < 300 ? "g" : v < 900 ? "o" : "r"}">${Math.round(v)}</span>`;
    const pct = (a, n) => n ? Math.round(100 * a / n) : 0;
    const teamRow = (name, id) => {
      const lb = H && H.lb; if (!lb) return null;
      return (lb.teams || []).find(t => (id && t.id === id) || nn(t.name) === nn(name)) || null;
    };
    const headerOpp = () => {   // "Sporting Lambda vs The Drunkards" at the top of the viewer page
      const m = ((document.body && document.body.innerText) || "").match(/([^\n]+?)\s*\n?\s*\bvs\b\s*\n?\s*([^\n]+?)\s*(?:\n|$)/i);
      if (!m) return null;
      const us = (H && H.lb && H.lb.us && H.lb.us.name) || "The Drunkards";
      return nn(m[1].replace(/^.*Back to matches\s*/i, "")) === nn(us) ? m[2].replace(/\s*LIVE$/, "").trim() : m[1].replace(/^.*Back to matches\s*/i, "").trim();
    };
    const sec = (key, title, body, right = "") => `<div class="sec${closed[key] ? " closed" : ""}" data-sec="${key}">
        <div class="sh"><span>${title}</span><span>${right} <span class="ar">${closed[key] ? "▸" : "▾"}</span></span></div>
        <div class="sb">${body}</div></div>`;
    const flowing = () => !!(lastStatus && lastStatus.lastWall && Date.now() - lastStatus.lastWall < 10000 && lastStatus.n > 40);
    // 1.38: frames flow from the "Who kicks off?" screen on; the match is on once the game clock runs
    const started = () => !!(lastStatus && lastStatus.t > 0.5);
    const sides = () => {
      const pmh = PING && PING.match && PING.match.id === mid ? PING.match : null;
      const named = !!(pmh && typeof pmh.home === "boolean");
      const us = named ? (pmh.home ? 0 : 1) : 0;
      return { us, them: 1 - us, named, A: named ? "us" : "home", B: named ? "them" : "away" };
    };
    // 1.27: agents live (game stream for both teams; calls / pause from TRACE through the native helper).
    const pctCell = v => v == null ? `<span class="m">—</span>` : `${v}%`;
    const agoCell = v => v == null ? `<span class="m">—</span>` : `<span class="${v > 20 ? "r" : v > 10 ? "o" : ""}">${v}s</span>`;
    const liveBody = () => {
      const ctl = lastStatus && lastStatus.ctl;
      if (!flowing() || !ctl || !started()) return `<div class="wait">Starts with the match.</div>`;
      const { us, them } = sides();
      const tr = LIVE && LIVE.ok && LIVE.pos ? LIVE.pos : null;
      const rows = POSN.map((p, i) => {
        const a = ctl[us + ":" + i] || [], b = ctl[them + ":" + i] || [], t = tr && tr[p];
        const calls = t ? `<span class="${t.calls < 5 ? "r" : t.calls < 15 ? "o" : ""}">${t.calls}</span>` : `<span class="m">—</span>`;
        const gap = t && t.maxgap != null ? `<span class="${t.maxgap > 10 ? "r" : t.maxgap > 5 ? "o" : ""}">${t.maxgap}s</span>` : `<span class="m">—</span>`;
        return `<tr><td>${p}</td><td>${pctCell(a[0])}</td><td>${i === 0 && a[1] != null ? `${a[1]}s` : agoCell(a[1])}</td><td>${pctCell(b[0])}</td>${tr ? `<td>${calls}</td><td>${gap}</td>` : ""}</tr>`;
      }).join("");
      const note = tr ? " · calls / pause: our agents in CloudWatch, last 60 s" : LIVE && LIVE.error && !LIVE.missing ? ` · TRACE: ${E(LIVE.error).slice(0, 60)}` : "";
      return `<table><tr><th></th><th title="share of the last 30 s our player spent on an agent command">ctl</th><th title="seconds our player has been without an agent command">off</th><th title="their player's share under an agent command">them</th>${tr ? `<th title="our agent's calls in the last 60 s">calls</th><th title="longest pause between calls, last 60 s">pause</th>` : ""}</tr>${rows}</table>
        <div class="note">ctl = time under an agent command (30 s) · off = seconds without one${note}</div>`;
    };
    // 1.28 numbers + 1.34 bars and a shot map. Bar = our share of the two sides' total.
    const bar = (label, a, b, f = v => v) => {
      const t = (a || 0) + (b || 0), w = t ? Math.round(100 * (a || 0) / t) : 50;
      return `<div class="br"><div class="lb">${label}</div><div class="a us">${f(a)}</div>
        <div class="t"><i style="width:${w}%;background:#22d3ee"></i><i style="width:${100 - w}%;background:#fb923c"></i></div><div class="z th">${f(b)}</div></div>`;
    };
    // pitch 13 x 7.3 (x ±6.5 goal lines); our shots drawn attacking right, theirs attacking left. 1.39: +z is the
    // top of the pitch (the game's own minimap), and the styles are inline so the page's CSS cannot recolour lines.
    const shotMap = (map, us) => {
      const W = 260, Hh = 146, sx = x => (x + 6.5) / 13 * W, sz = z => (3.65 - z) / 7.3 * Hh;
      const L = "fill:none;stroke:#1f5135;stroke-width:1";
      const dots = (map || []).map(m => {
        const mine = m[1] === us, x = mine ? m[3] : -m[3], z = mine ? m[4] : -m[4];
        const r = 3 + Math.round((m[5] || 0) * 10), c = mine ? "#22d3ee" : "#fb923c";
        return `<circle cx="${sx(Math.max(-6.5, Math.min(6.5, x))).toFixed(1)}" cy="${sz(Math.max(-3.65, Math.min(3.65, z))).toFixed(1)}" r="${r}"
          style="fill:${m[6] ? c : "none"};stroke:${c};stroke-width:1.5;opacity:${m[6] ? 1 : .8}"><title>${Math.round(m[0])}s ${POSN[m[2]] || ""} xG ${m[5]}${m[6] ? " · GOAL" : ""}</title></circle>`;
      }).join("");
      const gh = Math.abs(sz(0.9) - sz(-0.9));
      return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="shot map" style="border:0;outline:0;background:none;box-shadow:none;overflow:hidden">
        <rect x=".5" y=".5" width="${W - 1}" height="${Hh - 1}" rx="4" style="fill:#0f2a1c;stroke:#1f5135;stroke-width:1"/>
        <line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${Hh}" style="${L}"/><circle cx="${W / 2}" cy="${Hh / 2}" r="18" style="${L}"/>
        <rect x="0" y="${(Hh - 3 * gh) / 2}" width="26" height="${3 * gh}" style="${L}"/>
        <rect x="${W - 26}" y="${(Hh - 3 * gh) / 2}" width="26" height="${3 * gh}" style="${L}"/>
        <rect x="0" y="${(Hh - gh) / 2}" width="3" height="${gh}" style="fill:#fb923c88;stroke:none"/><rect x="${W - 3}" y="${(Hh - gh) / 2}" width="3" height="${gh}" style="fill:#22d3ee88;stroke:none"/>
        ${dots}</svg>`;
    };
    const statBody = () => {
      const s = lastStatus && lastStatus.st;
      if (!s || !s.sh || !started()) return `<div class="wait">Waiting for kick-off…</div>`;
      const { us, them, A, B } = sides();
      const last = (s.last || []).slice(-3).reverse().map(x => `${Math.round(x[0])}s ${x[1] === us ? A : B} ${POSN[x[2]] || x[2]} ${x[3]}m`).join(" · ");
      return `<div class="lg"><span class="us">● ${A}</span><span class="th">${B} ●</span></div>
        ${bar("Shots", s.sh[us], s.sh[them])}
        ${bar(`<span title="sum over shots of the share of shots from that distance that went in (280 recorded matches)">xG guide</span>`, s.xg[us], s.xg[them], v => (v || 0).toFixed(2))}
        ${s.pos ? bar("Possession", s.pos[us], s.pos[them], v => v + "%") : ""}
        ${s.third ? bar(`<span title="share of play time the ball is in this side's attacking third">Ball in attacking third</span>`, s.third[us], s.third[them], v => v + "%") : ""}
        ${shotMap(s.map, us)}
        <div class="note">● filled = goal · size = xG · ${A} attack →${last ? `<br>last: ${E(last)}` : ""}</div>`;
    };
    // 1.28: the opponent's form, from their own match list on the portal.
    const formRows = () => {
      if (!FORM || !FORM.ok || !FORM.last.length) return "";
      const seq = FORM.last.map(x => `<i class="${x.r}" title="${E(x.t)}">${x.r}</i>`).join("");
      const day = FORM.day.n ? `${FORM.day.wr}% <span class="m">· ${FORM.day.n} games</span>` : `<span class="m">no games</span>`;
      const arrow = FORM.day.n >= 3 && FORM.all.n ? (FORM.day.wr > FORM.all.wr + 10 ? ` <span class="r">▲</span>` : FORM.day.wr < FORM.all.wr - 10 ? ` <span class="g">▼</span>` : "") : "";
      return `<div class="kv"><span title="their last 5, newest first (red = they won)">Form</span><span class="fr">${seq}</span></div>
        <div class="kv"><span>Last 24 h</span><span>${day}${arrow}</span></div>
        <div class="kv"><span>Goals / game</span><span>${FORM.all.gf}:${FORM.all.ga} <span class="m">· last ${FORM.all.n}</span></span></div>`;
    };
    const loadForm = () => {
      const pm = PING && PING.match && PING.match.id === mid ? PING.match : null;
      if (!pm || !pm.oppId || (FORM && FORM.oppId === pm.oppId && Date.now() - FORM.at < 5 * 60e3)) return;
      oppFormNow(pm.oppId).then(r => { FORM = r; render(); }).catch(() => {});
    };
    // 1.38: "This match" and "Agents live" in a wide strip under the game picture, in the empty part of the
    // viewer's frame (only when there is room and not in full screen). "→ side panel" moves them back.
    let strip = null, stripOn = false, stripPref = true;
    try { stripPref = localStorage.getItem("__drk_strip") !== "0"; } catch (e) {}
    const gameCanvas = () => { let c = null, a = 0; for (const x of document.querySelectorAll("canvas")) { const r = x.getBoundingClientRect(), s2 = r.width * r.height; if (s2 > a) { a = s2; c = x; } } return a > 40000 ? c : null; };
    const placeStrip = () => {
      const off = () => { if (strip) strip.style.display = "none"; stripOn = false; };
      if (!mid || !stripPref || document.fullscreenElement) return off();
      const c = gameCanvas(); if (!c) return off();
      const cr = c.getBoundingClientRect();
      let fr = null, el = c.parentElement;
      while (el && el !== document.body) { const r = el.getBoundingClientRect(); if (r.height >= cr.height + 180 && r.width >= cr.width * 0.95) { fr = el; break; } el = el.parentElement; }
      if (!fr) return off();
      const frr = fr.getBoundingClientRect(), space = frr.bottom - cr.bottom - 20;
      if (space < 180) return off();
      if (!strip || !strip.isConnected) {
        for (const x of document.querySelectorAll("#drk-strip")) x.remove();   // left by a copy from before a reload
        strip = document.createElement("div"); strip.id = "drk-strip"; strip.className = "drk";
        strip.addEventListener("click", ev => { if (ev.target.closest("[data-side]")) { stripPref = false; try { localStorage.setItem("__drk_strip", "0"); } catch (e) {} placeStrip(); render(); } });
        fr.appendChild(strip);
      }
      if (getComputedStyle(fr).position === "static") fr.style.position = "relative";
      Object.assign(strip.style, { display: "flex", top: `${Math.round(cr.bottom - frr.top + 12)}px`, left: "24px", right: "24px",
        height: `${Math.round(Math.min(space - 8, 320))}px` });
      stripOn = true;
    };
    const stripHtml = () => {
      const s = lastStatus && lastStatus.st, st = lastStatus;
      const { us, them, A, B } = sides();
      const sc = st && st.score ? `${st.score[us]}:${st.score[them]}` : "";
      const clock = st && st.t ? `${Math.floor(st.t / 60)}:${String(Math.floor(st.t % 60)).padStart(2, "0")}` : "";
      if (!s || !s.sh || !started()) return `<div class="drk-top">This match <span class="sc">${sc}</span><button data-side title="Show this in the side panel instead">→ side panel</button></div><div class="wait">Waiting for kick-off… The match stats, the shot map and the agents show here once the clock runs.</div>`;
      const last = (s.last || []).slice(-3).reverse().map(x => `${Math.round(x[0])}s ${x[1] === us ? A : B} ${POSN[x[2]] || x[2]} ${x[3]}m`).join(" · ");
      return `<div class="drk-top">This match <span class="sc">${sc}</span><span>${clock}</span><span class="us">● ${A}</span><span class="th">● ${B}</span>
          <button data-side title="Show this in the side panel instead">→ side panel</button></div>
        <div class="drk-cols">
          <div>${bar("Shots", s.sh[us], s.sh[them])}
            ${bar(`<span title="sum over shots of the share of shots from that distance that went in (280 recorded matches)">xG guide</span>`, s.xg[us], s.xg[them], v => (v || 0).toFixed(2))}
            ${s.pos ? bar("Possession", s.pos[us], s.pos[them], v => v + "%") : ""}
            ${s.third ? bar(`<span title="share of play time the ball is in this side's attacking third">Ball in attacking third</span>`, s.third[us], s.third[them], v => v + "%") : ""}
            ${last ? `<div class="note">last: ${E(last)}</div>` : ""}</div>
          <div class="drk-mapc">${shotMap(s.map, us)}<div class="note">● filled = goal · size = xG · ${A} attack →</div></div>
          <div>${liveBody()}</div>
        </div>`;
    };
    const render = () => {
      if (!box || !alive()) return;
      placeStrip();
      if (stripOn) strip.innerHTML = stripHtml();
      layout();
      const pm = PING && PING.match && PING.match.id === mid ? PING.match : null;
      const oppName = (pm && pm.opp) || headerOpp() || "opponent";
      const ot = teamRow(oppName, pm && pm.oppId);
      const ms = H ? Object.values(H.matches || {}).filter(m => ((pm && pm.oppId) && m.oppId === pm.oppId) || nn(m.opp) === nn(oppName))
        .sort((a, b) => String(a.at).localeCompare(String(b.at))) : [];
      const w = ms.filter(m => m.us > m.them).length, l = ms.filter(m => m.us < m.them).length, d = ms.length - w - l;
      const gf = ms.reduce((a, m) => a + m.us, 0), ga = ms.reduce((a, m) => a + m.them, 0), last = ms[ms.length - 1];
      const wr = ot ? pct(ot.w, ot.p) : null, vs = ms.length ? pct(l, ms.length) : null;
      const grp = H && H.group && H.group.teams.includes(nn(oppName)) ? H.group.name : null;   // 1.36: own build only
      const chips = [grp ? `<span class="chip" style="background:#7c3aed;color:#fff" title="in our group: this match counts for the table">⚑ <b>Group ${E(grp)}</b></span>` : "",
        ot ? `<span class="chip">#<b>${ot.rank}</b> of ${H.lb.total || H.lb.teams.length}</span>` : "",
        wr != null ? `<span class="chip">WR <b class="${wr >= 60 ? "r" : wr >= 45 ? "o" : "g"}">${wr}%</b></span>` : "",
        vs != null ? `<span class="chip">vs us <b class="${vs >= 50 ? "r" : vs >= 25 ? "o" : "g"}">${vs}%</b></span>` : (H ? `<span class="chip">never played us</span>` : "")].join("");
      const oppBody = `<div class="kv"><span>Win rate</span><span>${ot ? `<b class="${wr >= 60 ? "r" : wr >= 45 ? "o" : "g"}">${wr}%</b> <span class="m">· ${ot.w}-${ot.d}-${ot.l}</span>` : `<span class="m">${H ? "not in the table" : "…"}</span>`}</span></div>
          <div class="kv"><span>Win rate vs us</span><span>${!H ? "…" : ms.length ? `<b class="${l > w ? "r" : l === w ? "o" : "g"}">${vs}%</b> <span class="m">· ${l} of ${ms.length}</span>` : `<span class="m">never played</span>`}</span></div>
          <div class="kv"><span>Our record</span><span>${ms.length ? `<b class="${w > l ? "g" : w < l ? "r" : "o"}">${w}-${d}-${l}</b> <span class="m">· ${gf}:${ga}</span>` : "—"}</span></div>
          ${formRows()}
          ${last ? `<div class="kv"><span>Last vs us</span><span>${last.us}:${last.them}${last.version ? ` <span class="m">· ${E(last.version)}</span>` : ""}</span></div>` : ""}`;
      const ag = (PING && PING.agents) || [];
      const hasMatch = !!(pm && ((pm.us || []).some(v => v != null) || (pm.them || []).some(v => v != null)));
      const rows = POSN.map((p, i) => { const a = ag.find(x => x.pos === i) || {};
        return `<tr><td>${p}</td>${hasMatch ? `<td>${lat(pm.us ? pm.us[i] : null)}</td><td>${lat(pm.them ? pm.them[i] : null)}</td>` : ""}<td>${lat(a.latency_ms)}</td><td>${lat(a.p99_latency_ms)}</td></tr>`; }).join("");
      const obsAt = PING && PING.fetched ? new Date(PING.fetched).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
      const pingBody = `<table><tr><th></th>${hasMatch ? "<th>match</th><th>them</th>" : ""}<th title="average latency of our agents, portal figures">avg</th><th title="1 call in 100 is slower than this">p99</th></tr>${rows}</table>
          <div class="note">avg / p99: portal, recent hours${obsAt ? ` (${obsAt})` : ""}${!hasMatch && pm && pm.status !== "completed" ? " · this match's figures after full time" : ""}</div>`;
      const st = lastStatus;
      const recLine = st && st.n ? `<span class="${st.lastWall && Date.now() - st.lastWall < 8000 ? "g" : "o"}">● recording</span> <span class="m">${Math.round(st.t || 0)} s · ${Number(st.n).toLocaleString("en-GB")} frames${st.t0 > 3 ? ` · from ${Math.round(st.t0)} s` : ""}</span>`
        : `<span class="m">waits for frames</span>`;
      const aa = H && H.autoAccept && H.autoAccept.on && Date.now() < (H.autoAccept.until || 0);
      const as = !autoOn ? `<span class="m">off</span>` : autoDone ? `<span class="g">${E(autoLast || "done")}</span>` : `<span class="o">${E(autoLast || "waiting")}</span>`;
      const plugBody = `<div class="kv w"><span>Recording</span><span>${recLine}</span></div>
          <div class="kv w"><span>Auto-START</span><span>${as}</span></div><div class="kv"><span>Auto-accept</span><span>${aa ? `<span class="g">on</span>` : `<span class="m">off</span>`}</span></div>`;
      const sc = st && st.score ? (() => { const { us } = sides(); return `${st.score[us]}:${st.score[1 - us]}`; })() : "";
      box.className = "drk" + (folded ? " folded" : "");
      box.innerHTML = `<div class="hd"><span class="nm" title="${E(oppName)}">${E(oppName)}</span>${folded && sc ? `<b>${sc}</b>` : ""}
          <button data-fold title="${folded ? "Show the panel" : "Fold, show the Coach Live Feed"}">${folded ? "▸" : "▾"}</button></div>
        <div class="chips">${chips}</div>
        <div class="bd">
          ${sec("opp", "Opponent", oppBody)}
          ${stripOn ? `<div class="sec"><div class="note">This match and the agents: <b>under the game</b> ↙</div></div>`
            : `${sec("live", "This match", statBody(), st && st.score ? `<b style="color:#e5e7eb;font-size:12px">${sc}</b>` : "")}
          ${sec("agents", "Agents live", liveBody())}
          ${!stripPref ? `<div class="note"><span class="lnk" data-under>↙ show under the game</span></div>` : ""}`}
          ${sec("ping", "Our agents' ping, ms", pingBody)}
          ${sec("plugin", "Plugin", plugBody)}
        </div>`;
    };
    // clicks: fold the panel, open / close a section (remembered)
    const onPanelClick = ev => {
      if (ev.target.closest("[data-under]")) { stripPref = true; try { localStorage.setItem("__drk_strip", "1"); } catch (e) {} render(); return; }
      if (ev.target.closest("[data-fold]")) {
        folded = !folded;
        try { localStorage.setItem("__drk_panel_folded", folded ? "1" : "0"); } catch (e) {}
        layout(); render(); return;
      }
      const h = ev.target.closest(".sh"), s = h && h.parentElement;
      if (!s || !s.dataset.sec) return;
      closed[s.dataset.sec] = !closed[s.dataset.sec];
      try { localStorage.setItem("__drk_sec", JSON.stringify(closed)); } catch (e) {}
      render();
    };
    // the card: the smallest box around the "Coach Live Feed" title that is at least 100 px tall
    const findCard = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (!/Coach Live Feed/i.test(n.nodeValue)) continue;
        let el = n.parentElement;
        while (el && el !== document.body) {
          const r = el.getBoundingClientRect();
          if (r.height >= 100 && r.width < innerWidth * 0.6) return el;
          el = el.parentElement;
        }
      }
      return null;
    };
    // open: the card's own content is hidden and the panel takes its place (the card grows with
    // it); folded: the coach feed shows and the panel is a strip under it
    const layout = () => {
      if (!host) return;
      for (const ch of host.children) {
        if (ch === box) continue;
        if (ch.dataset.drkDisplay === undefined) ch.dataset.drkDisplay = ch.style.display || "";   // new coach messages too
        ch.style.display = folded ? ch.dataset.drkDisplay : "none";
      }
    };
    const unmount = () => {
      if (host) for (const ch of host.children) if (ch !== box && ch.dataset.drkDisplay !== undefined) ch.style.display = ch.dataset.drkDisplay;
      if (box) box.remove();
      if (strip) strip.remove();
      box = null; host = null; strip = null; stripOn = false;
    };
    const mount = () => {
      if (!alive()) { unmount(); return; }
      const m = viewerMid();
      if (m !== mid) { unmount(); mid = m; PING = null; LIVE = null; FORM = null; if (m) { loadH(); loadPing(); } }
      if (!m) return;
      if (box && box.isConnected) return;
      const card = findCard();
      if (!card) return;
      if (!document.getElementById("drk-panel-css")) {
        const sEl = document.createElement("style"); sEl.id = "drk-panel-css"; sEl.textContent = css;
        (document.head || document.documentElement).appendChild(sEl);
      }
      // a panel left by a copy of this script from before an extension reload: take its place
      const stale = card.querySelector("#drk-panel");
      if (stale) stale.remove();
      host = card;
      for (const ch of host.children) if (ch.dataset.drkDisplay === undefined) ch.dataset.drkDisplay = ch.style.display || "";
      box = document.createElement("div");
      box.id = "drk-panel";
      box.addEventListener("click", onPanelClick);
      card.appendChild(box);
      layout(); render();
    };
    const loadH = () => { try { chrome.runtime.sendMessage({ type: "panel-h2h" }, r => { if (r && r.ok) { H = r; render(); } }); } catch (e) {} };
    const loadPing = () => { if (mid) pingNow(mid).then(r => { if (r && r.ok) { PING = r; render(); loadForm(); } }).catch(() => {}); };
    const loadLive = () => {
      if (!mid || !alive() || document.visibilityState !== "visible") return;
      if (lastStatus && lastStatus.lastWall && Date.now() - lastStatus.lastWall > 60000) return;   // match over
      try { chrome.runtime.sendMessage({ type: "live-trace", matchId: mid }, r => { if (!chrome.runtime.lastError && r) { LIVE = r; render(); } }); } catch (e) {}
    };
    {   // bridge.js runs only on the portal (manifest), on every page of it
      setInterval(mount, 1500);
      setInterval(() => { if (mid) render(); }, 2000);
      setTimeout(() => { if (mid) { loadH(); loadPing(); } }, 1500);
      setInterval(() => { if (mid) loadH(); }, 60000);
      setInterval(loadPing, 30000);
      setInterval(loadLive, 15000);
      setTimeout(loadLive, 3000);
    }
  }

  // ---- Find Match list (1.20): next to each team, its place, win rate and our record against it.
  // The list is React's and is redrawn on every search keystroke, so the badges are re-added
  // every 400 ms to rows that lost them (only inside the "Find match" dialog).
  {
    let HB = null, hbAt = 0;
    const nb = n => String(n || "").replace(/\s*\((\u043b\u044e\u0434\u0438\u043d\u0430|human)\)/i, "").trim().toLowerCase();
    const E2 = x => String(x ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const loadHB = () => { try { chrome.runtime.sendMessage({ type: "panel-h2h" }, r => { if (r && r.ok) { HB = r; hbAt = Date.now(); } }); } catch (e) {} };
    const css2 = `
      .drk-badge{margin-left:12px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:#94a3b8;white-space:nowrap}
      .drk-badge b{font-weight:700}.drk-badge .g{color:#4ade80}.drk-badge .o{color:#fbbf24}.drk-badge .r{color:#f87171}
      .drk-badge .rk{color:#22d3ee;font-weight:700}
      .drk-badge .grp{padding:1px 6px;border-radius:4px;background:#7c3aed;color:#fff;font-weight:700}`;
    // 1.25: overall win rate, their record against us and, in brackets, how often they beat us
    // ("#24 · 43% · vs us 3-0-3 (50%)"); goals and the last result go into the tooltip.
    const badge = name => {
      const key = nb(name);
      const t = HB.lb && (HB.lb.teams || []).find(x => nb(x.name) === key);
      const ms = Object.values(HB.matches || {}).filter(m => nb(m.opp) === key)
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const g = HB.group && HB.group.teams.includes(key) ? HB.group.name : null;   // 1.36: our group (own build only)
      if (!t && !ms.length && !g) return null;
      const parts = [], tip = [name];
      if (g) { parts.push(`<span class="grp">⚑ GROUP ${E2(g)}</span>`); tip.push(`in our group ${g}: this match counts for the table`); }
      if (t) {
        const wr = t.p ? Math.round(100 * t.w / t.p) : 0;
        parts.push(`<span class="rk">#${t.rank}</span>`, `<b class="${wr >= 60 ? "r" : wr >= 45 ? "o" : "g"}">${wr}%</b>`);
        tip.push(`#${t.rank} of ${HB.lb.total || HB.lb.teams.length}, win rate ${wr}% (${t.w}-${t.d}-${t.l} of ${t.p})`);
      }
      if (ms.length) {
        const w = ms.filter(m => m.us > m.them).length, l = ms.filter(m => m.us < m.them).length, d = ms.length - w - l;
        const gf = ms.reduce((a, m) => a + m.us, 0), ga = ms.reduce((a, m) => a + m.them, 0), last = ms[ms.length - 1];
        const vs = Math.round(100 * l / ms.length);
        const cls = vs >= 50 ? "r" : vs >= 25 ? "o" : "g";
        parts.push(`vs us <b class="${cls}">${l}-${d}-${w}</b> (<b class="${cls}">${vs}%</b>)`);
        tip.push(`vs us: they won ${l} of ${ms.length}; our record ${w}-${d}-${l}, goals ${gf}:${ga}, last ${last.us}:${last.them}`);
      } else { parts.push("vs us —"); tip.push("never played us"); }
      return { html: parts.join(" · "), title: tip.join("\n") };
    };
    const dialog = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        if (!/^\s*find match\s*$/i.test(n.nodeValue)) continue;
        let el = n.parentElement;
        while (el && el !== document.body) { if (el.getBoundingClientRect().height > 250) return el; el = el.parentElement; }
      }
      return null;
    };
    setInterval(() => {
      if (!alive()) return;
      const dlg = dialog();
      if (!dlg) return;
      if (!HB || Date.now() - hbAt > 60000) { loadHB(); if (!HB) return; }
      if (!document.getElementById("drk-badge-css")) {
        const sEl = document.createElement("style"); sEl.id = "drk-badge-css"; sEl.textContent = css2;
        (document.head || document.documentElement).appendChild(sEl);
      }
      const names = new Set(((HB.lb && HB.lb.teams) || []).map(t => nb(t.name)));
      for (const m of Object.values(HB.matches || {})) names.add(nb(m.opp));
      for (const g of (HB.group && HB.group.teams) || []) names.add(g);
      const w = document.createTreeWalker(dlg, NodeFilter.SHOW_TEXT);
      const hits = [];
      let n;
      while ((n = w.nextNode())) {
        const el = n.parentElement;
        if (!el || el.closest(".drk-badge") || !names.has(nb(n.nodeValue))) continue;
        hits.push([el, n.nodeValue]);
      }
      for (const [el, name] of hits) {
        const next = el.nextElementSibling;
        if (next && next.classList.contains("drk-badge") && next.dataset.team === nb(name)) continue;
        if (next && next.classList.contains("drk-badge")) next.remove();   // the row now shows another team
        const bd = badge(name);
        if (!bd) continue;
        const b = document.createElement("span");
        b.className = "drk-badge"; b.dataset.team = nb(name); b.innerHTML = bd.html; b.title = bd.title;
        el.insertAdjacentElement("afterend", b);
      }
    }, 400);
  }

  // Toolbar button: save whatever this tab has recorded so far.
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg && msg.type === "ping-now") {
      pingNow(msg.matchId).catch(e => ({ ok: false, why: String(e && e.message || e) })).then(reply);
      return true;
    }
    if (msg && msg.type === "live-now") {
      liveNow().catch(e => ({ ok: false, why: String(e && e.message || e) })).then(reply);
      return true;
    }
    if (msg && msg.type === "invites-now") {
      invitesNow().catch(e => ({ ok: false, why: String(e && e.message || e) })).then(reply);
      return true;
    }
    if (msg && msg.type === "invite-accept" && msg.eventId && msg.matchId) {
      acceptInvite(msg.eventId, msg.matchId).catch(e => ({ ok: false, why: String(e && e.message || e) })).then(reply);
      return true;
    }
    if (msg && msg.type === "coach-now") {
      coachNow().catch(e => ({ ok: false, why: String(e && e.message || e) })).then(reply);
      return true;
    }
    if (msg && msg.type === "portal-now") {
      portalSync(true).then(reply);
      return true;
    }
    if (msg && msg.type === "save-now") {
      // Stop the live recorder in this page (it saves everything it has); only if it
      // does not answer (e.g. already on the report page) fall back to the stored copy.
      const asked = Date.now();
      window.postMessage({ source: "drunkards-rec-bridge", type: "save-now" }, location.origin);
      setTimeout(() => {
        const live = lastLiveSave >= asked;
        reply({ ok: live || fromStorage("button") });
      }, 500);
      return true;
    }
  });
})();
