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
    if (d.type === "live") { lastLive = d; if (onLive) try { onLive(); } catch (e) {} return; }
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
  let lastLive = null, onLive = null;   // 1.44: live positions from recorder.js (~10 a second)
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
  // 1.49: who beat whom across the whole tournament, for the emulator's /bracket: every team's last 100
  // matches (the portal gives no more), at most every 20 minutes, kept in this tab between reads.
  // {at, v: 2, names: [team names], cmds: [command names],
  //  rows: [[minute (epoch / 60 s), home index, away index, home goals, away goals, practice 0/1, match id (8),
  //          home commands by type, away commands by type, home ping ms, away ping ms]],
  //  stats: {match id (8): [home shots, home on target, away shots, away on target, home possession %]}}
  // 1.50: match id, both teams' commands by type and ping (their style: a new deploy shows as a change) and,
  // from each match's own page (/matches/<id>), shots and possession — at most 300 new matches per read,
  // newest first, kept in this tab so each match is asked once.
  const LEAGUE_CMDS = ["MOVE_TO", "PRESS_BALL", "PASS", "SHOOT", "CLEAR_OVERRIDE", "INTERCEPT", "MARK", "FOLLOW_PLAYER",
                       "GK_DISTRIBUTE", "SET_STANCE", "RESET"];
  const leagueRead = async (get, table, force) => {
    try { if (!(await chrome.storage.local.get("leagueRead")).leagueRead) return null; } catch (e) { return null; }   // own build only
    try { const c = JSON.parse(localStorage.getItem("__league") || "null");
      if (c && c.v === 2 && c.rows && !force && Date.now() - c.at < 20 * 60e3) return c; } catch (e) {}
    const idx = {}, names = [];
    for (const t of table) if (t.team_id && !(t.team_id in idx)) { idx[t.team_id] = names.length; names.push(t.team_name); }
    const seen = new Map();
    const one = async id => { const j = await get(`/matches?team_id=${encodeURIComponent(id)}&limit=100`);
      for (const m of j.items || []) if (m.status === "completed" && m.result && m.result.home_score != null) seen.set(m.match_id, m); };
    const ids = Object.keys(idx);
    for (let i = 0; i < ids.length; i += 6) await Promise.all(ids.slice(i, i + 6).map(id => one(id).catch(() => {})));
    if (!seen.size) return null;
    const at = id => { if (!(id in idx)) { idx[id] = names.length; names.push(null); } return idx[id]; };
    const cmds = b => b && typeof b === "object" ? LEAGUE_CMDS.map(k => +b[k] || 0) : null;
    const ms = [...seen.values()].sort((x, y) => Date.parse(x.completed_at || x.created_at) - Date.parse(y.completed_at || y.created_at));
    const rows = ms.map(m => { const h = at(m.home_team_id), a = at(m.away_team_id);
      names[h] = names[h] || m.home_team_name; names[a] = names[a] || m.away_team_name;
      return [Math.round(Date.parse(m.completed_at || m.created_at) / 60e3), h, a, m.result.home_score, m.result.away_score, m.is_practice ? 1 : 0,
              String(m.match_id).slice(0, 8), cmds(m.home_command_breakdown), cmds(m.away_command_breakdown),
              m.home_avg_latency_ms != null ? Math.round(m.home_avg_latency_ms) : null, m.away_avg_latency_ms != null ? Math.round(m.away_avg_latency_ms) : null]; });
    let stats = {};
    try { stats = JSON.parse(localStorage.getItem("__leagueStats") || "{}") || {}; } catch (e) {}
    const keep = new Set(rows.map(r => r[6]));
    for (const k of Object.keys(stats)) if (!keep.has(k)) delete stats[k];
    const todo = ms.filter(m => !m.is_practice && !(String(m.match_id).slice(0, 8) in stats)).reverse().slice(0, 300);
    const detail = async m => { const j = await get(`/matches/${encodeURIComponent(m.match_id)}`), g = (j.item || j).game_stats;
      if (g && g.home && g.away) stats[String(m.match_id).slice(0, 8)] = [g.home.shots, g.home.shots_on_target, g.away.shots, g.away.shots_on_target,
                                                                         Math.round(g.home.possession_pct)]; };
    for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(m => detail(m).catch(() => {})));
    try { localStorage.setItem("__leagueStats", JSON.stringify(stats)); } catch (e) {}
    const out = { at: Date.now(), v: 2, names, cmds: LEAGUE_CMDS, rows, stats };
    try { localStorage.setItem("__league", JSON.stringify(out)); } catch (e) {}
    return out;
  };
  // 1.52: every tournament team's roster status (/tournaments/<T>/teams, paginated) — agent status
  // (configured / not), whether it is one of the game's sample AI teams, and the AWS account id when the
  // portal returns one (admin only, else null). For the emulator site's roster. Own build only, kept 20 min.
  const rosterRead = async (get, T, force) => {
    try { if (!(await chrome.storage.local.get("leagueRead")).leagueRead) return null; } catch (e) { return null; }
    try { const c = JSON.parse(localStorage.getItem("__roster") || "null");
      if (c && c.items && !force && Date.now() - c.at < 20 * 60e3) return c; } catch (e) {}
    const items = []; let next = null;
    for (let i = 0; i < 60; i++) {
      const q = new URLSearchParams({ limit: "200" }); if (next) q.set("next_token", next);
      const j = await get(`/tournaments/${encodeURIComponent(T)}/teams?${q.toString()}`).catch(() => null);
      if (!j) break;
      for (const t of j.items || []) items.push({ id: t.team_id, name: t.team_name || t.name || "",
        status: t.agent_status || null, ai: t.is_ai_team === true, aws: t.aws_account_id || null });
      next = j.next_token; if (!next) break;
    }
    if (!items.length) return null;
    const out = { at: Date.now(), items };
    try { localStorage.setItem("__roster", JSON.stringify(out)); } catch (e) {}
    return out;
  };
  // 1.53: our team's agent observability (/teams/<us>/observability) — each position's recent average and
  // p99 latency, invocations, errors and throttles, as the portal reports them. Saved with the portal data
  // for the emulator site's profile page (the match panel reads it live too, via pingNow).
  const obsRead = async (get, id) => {
    const j = await get(`/teams/${encodeURIComponent(id)}/observability`).catch(() => null);
    if (!j || !Array.isArray(j.agents)) return null;
    return { at: j.fetched_at || null, agents: j.agents.map(a => { const m = a.metrics || {};
      return { pos: a.position, name: a.agent_name || null, avg: m.latency_ms ?? null, p99: m.p99_latency_ms ?? null,
               inv: m.invocations ?? null, err: m.errors ?? 0, thr: m.throttles ?? 0 }; }).sort((x, y) => x.pos - y.pos) };
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
                     table: table.items || [], matches: matches.items || [], counts: matches.counts || null,
                     league: await leagueRead(get, table.items || [], force).catch(() => null),
                     roster: await rosterRead(get, T, force).catch(() => null),
                     obs: await obsRead(get, id).catch(() => null) };
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
    // 1.45: their play style — the portal counts every team's agent commands by type in each match
    // (home_ / away_command_breakdown); summed over their last 20 matches, with commands per match and ping.
    const recent = items.slice().sort((x, y) => Date.parse(y.completed_at || y.created_at) - Date.parse(x.completed_at || x.created_at)).slice(0, 20);
    const cmd = {}; let total = 0, nm = 0, lat = 0, nl = 0;
    for (const m of recent) {
      const side = m.home_team_id === oppId ? "home_" : "away_", b = m[side + "command_breakdown"];
      if (b && typeof b === "object") { nm++; for (const [k, v] of Object.entries(b)) { cmd[k] = (cmd[k] || 0) + (+v || 0); total += +v || 0; } }
      if (m[side + "avg_latency_ms"] != null) { lat += m[side + "avg_latency_ms"]; nl++; }
    }
    const style = nm && total ? { n: nm, perMatch: Math.round(total / nm), ping: nl ? Math.round(lat / nl) : null,
      share: Object.entries(cmd).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(100 * v / total)]) } : null;
    return { ok: true, oppId, at: Date.now(), last: ms.slice(0, 5), day: sum(ms.filter(x => Date.now() - x.at < 864e5)), all: sum(ms), style };
  };
  // Their tactics (1.51): /matches/<id>/coach-chat holds BOTH teams' coach instructions, each tagged
  // home / away. They are preset buttons only, so instruction_key maps to a short label. We surface
  // the opponent's — what tactic they switched to and at what match time.
  const INSTR = { go_all_out_attack: "all-out attack", play_possession: "possession",
    press_high: "high press", shoot_on_sight: "shoot on sight", slow_the_tempo: "sit back" };
  const coachFeed = async matchId => {
    let token = null;
    try { token = localStorage.getItem("world_cup_team_token"); } catch (e) {}
    if (!token) return { ok: false, why: "signed out" };
    const r = await fetch(`${API}/matches/${encodeURIComponent(matchId)}/coach-chat`, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return { ok: false, why: "coach-chat " + r.status };
    const chat = ((await r.json()).chat || []).map(c => ({
      team: (c.senderTeamCode || c.SenderTeamCode) === "home" ? "home" : "away",
      key: c.instruction_key || "", ts: +(c.timestamp || c.Timestamp || 0) }))
      .filter(c => c.key).sort((a, b) => a.ts - b.ts);
    return { ok: true, id: matchId, at: Date.now(), chat };
  };
  // Agents' health in this match (1.51): /matches/<id>/agent-health — one row per team: status
  // (healthy / degraded / unhealthy / no_data), success rate, avg / p99 latency, commands,
  // invocations and errors. Available to any viewer, so it covers the opponent too.
  const matchHealth = async matchId => {
    let token = null;
    try { token = localStorage.getItem("world_cup_team_token"); } catch (e) {}
    if (!token) return { ok: false, why: "signed out" };
    const r = await fetch(`${API}/matches/${encodeURIComponent(matchId)}/agent-health`, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return { ok: false, why: "agent-health " + r.status };
    const rows = ((await r.json()).health || []).map(h => ({ teamId: h.team_id, name: h.team_name,
      status: h.status || "no_data", sr: h.success_rate != null ? Math.round(h.success_rate * 100) : null,
      lat: h.latency_avg_ms ?? null, p99: h.latency_p99_ms ?? null,
      cmds: h.total_commands ?? null, calls: h.total_invocations ?? null, err: h.total_errors ?? 0 }));
    return { ok: true, id: matchId, at: Date.now(), rows };
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

// 1.43: our chances against a team — log5 on the two overall win rates (draws: the two teams' average draw
  // share), nudged by our head-to-head record with weight 8 (on our 69 real matches h2h added nothing beyond
  // that: Brier 0.43, the likeliest outcome right 64%). Returns {w, d, l} (0..1) and decimal odds, or null.
  const winChance = (lb, opp, ms, oppWr) => {
    if (!lb || !lb.teams) return null;
    const meRow = lb.teams.find(t => lb.us && ((lb.us.id && t.id === lb.us.id) || String(t.name).trim().toLowerCase() === String(lb.us.name || "").trim().toLowerCase()));
    if (!meRow || !meRow.p) return null;
    const A = meRow.w / meRow.p, B = opp && opp.p ? opp.w / opp.p : (oppWr != null ? oppWr / 100 : 0.5);
    const dr = Math.min(0.3, ((meRow.d / meRow.p) + (opp && opp.p ? opp.d / opp.p : meRow.d / meRow.p)) / 2);
    const P = A * (1 - B) + B * (1 - A) > 0 ? A * (1 - B) / (A * (1 - B) + B * (1 - A)) : 0.5;
    const k = 8, list = ms || [], w = list.filter(m => m.us > m.them).length, l = list.filter(m => m.us < m.them).length, n = list.length;
    const W = (w + k * P * (1 - dr)) / (n + k), L = (l + k * (1 - P) * (1 - dr)) / (n + k), D = Math.max(0, 1 - W - L);
    const odds = p => p > 0.02 ? (1 / p).toFixed(p > 0.5 ? 2 : 1) : "50+";
    return { w: W, d: D, l: L, odds: [odds(W), odds(D), odds(L)] };
  };

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
    let H = null, PING = null, LIVE = null, FORM = null, COACH = null, HEALTH = null, folded = false, host = null, box = null;
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
      .drk .kv{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:0 10px;padding:1px 0}
      .drk .kv>span:first-child{color:#94a3b8;white-space:nowrap}
      .drk .kv>span:last-child{text-align:right;white-space:nowrap;min-width:0;margin-left:auto}
      .drk .kv.w>span:last-child{white-space:normal}
      .drk .kv b{font-weight:700}
      .drk .seq{line-height:1.5}.drk .seq .hl{color:#e5e7eb;font-weight:700}
      .drk .seq.m .hl{color:#cbd5e1}
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
      .drk table{width:100%;border-collapse:collapse;font-size:12px}
      .drk th{color:#64748b;font-weight:500;font-size:10.5px;text-align:right;padding:0 3px 2px;white-space:nowrap}
      .drk td{text-align:right;padding:2px 2px;border-top:1px solid #1f2937;white-space:nowrap}
      .drk th:first-child,.drk td:first-child{text-align:left}
      .drk table.pt td,.drk table.pt th{padding:2px 1px;font-size:11px}
      #drk-strip{position:relative;z-index:5;padding:10px 16px 12px;background:#11131cee;border:1px solid #22d3ee44;border-radius:10px;overflow:hidden auto;flex-direction:column}
      #drk-strip .drk-cols{display:grid;grid-template-columns:minmax(200px,1fr) minmax(230px,1.1fr) minmax(330px,1.45fr);gap:20px;align-items:start}
      #drk-strip .drk-cols>div{min-width:0}
      #drk-strip .drk-top{display:flex;align-items:center;gap:12px;margin-bottom:6px;color:#64748b;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.07em}
      #drk-strip .drk-top .sc{color:#f8fafc;font-size:18px;letter-spacing:0}
      #drk-strip .drk-top button{margin-left:auto;background:none;border:1px solid #334155;color:#94a3b8;border-radius:6px;cursor:pointer;font-size:10.5px;padding:1px 8px;text-transform:none;letter-spacing:0}
      #drk-strip .drk-mapc{display:flex;flex-direction:column;min-height:0}
      #drk-strip .drk-mapc svg{width:100%;height:190px;margin:0}
      #drk-strip .drk-tog{display:flex;gap:4px;margin:0 0 4px;font-size:10.5px}
      .drk .drk-warn{margin:0 0 6px;padding:4px 10px;border-radius:6px;background:#7f1d1d55;border:1px solid #f8717166;color:#fecaca;font-size:11.5px}
      #drk-strip .drk-logh{margin:8px 0 2px;color:#94a3b8;font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
      #drk-strip .drk-logh span{text-transform:none;letter-spacing:0;font-weight:400}
      #drk-strip .drk-le{font-size:11.5px;line-height:1.5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #drk-strip .drk-tog span{padding:1px 8px;border-radius:9px;border:1px solid #334155;color:#94a3b8;cursor:pointer}
      #drk-strip .drk-tog span.on{background:#22d3ee22;border-color:#22d3ee;color:#22d3ee}
      #drk-strip .br{margin:2px 0 4px}
      #drk-strip .drk-cols2 .br{grid-template-columns:minmax(120px,1.1fr) 42px 2fr 42px;margin:0;padding:3px 0;border-top:1px solid #1f293766}
      #drk-strip .drk-cols2 .br .lb{grid-column:auto;margin:0;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #drk-strip .drk-cols2 .br .z{text-align:right}
      .drk .lnk{color:#22d3ee;cursor:pointer;font-size:11px}
      .drk .ac-mv{color:#cbd5e1}.drk .ac-sh{color:#f472b6;font-weight:600}.drk .ac-pa{color:#4ade80}.drk .ac-df{color:#fbbf24}.drk .ac-dr{color:#a78bfa}.drk .ac-gk{color:#fde047}
      .drk .tg{display:inline-block;padding:0 5px;border-radius:4px;font-size:10px;font-weight:700;line-height:15px;letter-spacing:.03em;vertical-align:1px}
      .drk .tg.ag{background:#22d3ee26;color:#22d3ee}.drk .tg.ai{background:#47556999;color:#e2e8f0}
      .drk .hd .rec{flex:none;font-size:11px;cursor:default}
      .drk .foot{margin-top:10px;border-top:1px solid #1f2937;padding-top:6px;color:#64748b;font-size:11px;line-height:1.5}
      #drk-strip .drk-top .clk{color:#94a3b8;font-size:12px;letter-spacing:0;font-weight:500}
      #drk-strip .drk-top .tm{font-size:11px}
      #drk-strip .drk-ball{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:12px;text-transform:none;letter-spacing:0;font-weight:500;color:#e5e7eb;white-space:nowrap}
      #drk-strip .drk-top .sc{min-width:2.6em;text-align:center}#drk-strip .drk-top .clk{min-width:2.6em}
      #drk-strip .drk-tabs{flex:none}#drk-strip #drk-tired{flex:none}
      #drk-strip .drk-tabs{display:flex;gap:2px;background:#0b0d14;border:1px solid #1f2937;border-radius:8px;padding:2px;text-transform:none;letter-spacing:0}
      #drk-strip .drk-tabs span{padding:2px 12px;border-radius:6px;cursor:pointer;color:#94a3b8;font-size:12px;font-weight:600}
      #drk-strip .drk-tabs span:hover{color:#e5e7eb}
      #drk-strip .drk-tabs span.on{background:#22d3ee22;color:#22d3ee}
      #drk-strip .drk-goals{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 8px;align-items:center}
      #drk-strip .gl{padding:0 6px;border-radius:5px;font-size:11px;line-height:18px;border:1px solid;white-space:nowrap;cursor:default}
      #drk-strip .gl b{font-weight:600}
      #drk-strip .gl i{display:inline-block;width:7px;height:7px;margin-left:5px;vertical-align:0}
      #drk-strip .gl i.ag{background:#22d3ee;border-radius:50%}#drk-strip .gl i.ai{background:#cbd5e1;border-radius:1px}#drk-strip .gl i.un{border:1px solid #64748b;border-radius:50%}
      #drk-strip .gl:hover{filter:brightness(1.5)}
      #drk-tip{position:fixed;z-index:2147483000;pointer-events:none;max-width:300px;padding:7px 10px;border-radius:8px;background:#0b0d14f2;border:1px solid #334155;
        box-shadow:0 6px 20px #0008;color:#e5e7eb;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;text-align:left;display:none}
      #drk-tip .m{color:#94a3b8}#drk-tip .us{color:#22d3ee}#drk-tip .th{color:#fb923c}#drk-tip .g{color:#4ade80}
      #drk-tip .tg{display:inline-block;padding:0 5px;border-radius:4px;font-size:10px;font-weight:700;line-height:15px}
      #drk-tip .tg.ag{background:#22d3ee26;color:#22d3ee}#drk-tip .tg.ai{background:#47556999;color:#e2e8f0}
      #drk-strip [data-tip]{cursor:default}
      #drk-strip .gl.us{border-color:#22d3ee55;background:#22d3ee0f}
      #drk-strip .gl.th{border-color:#fb923c55;background:#fb923c0f}
      #drk-strip .gsum{margin-left:auto;font-size:11px;color:#94a3b8;white-space:nowrap}
      #drk-strip .drk-cols2{display:grid;grid-template-columns:minmax(240px,1fr) minmax(300px,1.25fr);gap:24px;align-items:start}
      #drk-strip .drk-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:8px}
      #drk-strip .drk-card{background:#0b0d14;border:1px solid #1f2937;border-radius:8px;padding:7px 9px;min-width:0}
      #drk-strip .drk-card.hasball{border-color:#f8fafcaa}
      #drk-strip .drk-card.them .ch b{color:#fb923c}
      #drk-strip .drk-tog span.on.th{background:#fb923c22;border-color:#fb923c;color:#fb923c}
      #drk-strip .drk-card .ch{display:flex;align-items:center;gap:6px;font-size:13px}
      #drk-strip .drk-card.hasball .bl::after{content:"⚽ on the ball";font-size:11px;color:#f8fafc}
      #drk-strip .drk-card .nw{margin:3px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}
      #drk-strip .drk-card .kv{font-size:11.5px}
      #drk-strip .drk-card .ch .stm{margin-left:auto;font-size:11px;color:#64748b}
      #drk-strip .drk-card .dl{margin-top:5px;border-top:1px solid #1f2937;padding-top:4px;min-height:60px}
      #drk-strip .drk-card .dle{font-size:11px;line-height:1.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      #drk-strip .drk-team{margin-top:8px;font-size:11.5px;color:#cbd5e1}
      #drk-strip .drk-time svg{margin:0}
      #drk-strip .drk-tired{font-size:12px;font-weight:600;color:#fecaca;background:#7f1d1d88;border:1px solid #f8717166;border-radius:6px;padding:0 7px;text-transform:none;letter-spacing:0;white-space:nowrap}
      #drk-strip .drk-tired b{color:#f87171}
      #drk-tip .r{color:#f87171}#drk-tip .o{color:#fbbf24}`;
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
    const isClosed = k => k in closed ? !!closed[k] : ["more", "form", "style", "agx"].includes(k);   // 1.56 / 1.57: folded until opened
    // 1.57: our players by their role, not by their agent's slot — the 1-2-1 runs MID2 on the FWD1 agent. The
    // role is the agent's own TRACE "pos" (live_trace.py "roles", helper only), remembered for the next match.
    let ROLES = {};
    try { ROLES = JSON.parse(localStorage.getItem("__drk_roles") || "{}") || {}; } catch (e) {}
    const roleOf = i => (ROLES && ROLES[POSN[i]]) || POSN[i] || String(i);
    const nameOf = (tm, i, us) => tm === us ? roleOf(i) : (POSN[i] || String(i));
    const sec = (key, title, body, right = "") => `<div class="sec${isClosed(key) ? " closed" : ""}" data-sec="${key}">
        <div class="sh"><span>${title}</span><span>${right} <span class="ar">${isClosed(key) ? "▸" : "▾"}</span></span></div>
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
    // 1.56: shared bits — action names without "Coach", mm:ss, and the AGENT / AI tag
    const actName = a => String(a || "").replace(/^Coach/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    // 1.59: a colour per kind of action (the AGENT / AI tag still says who gave it): shoot, pass, win the ball back,
    // dribble, keeper's dive; plain moves stay light grey
    const ACAT = a => { const x = String(a || "").replace(/^Coach/, "");
      return /Shoot/.test(x) ? "sh" : /Pass|Distribute/.test(x) ? "pa" : /Press|Pressure|Intercept|Tackle|Mark|Chase/.test(x) ? "df"
        : /Advance|Dribble/.test(x) ? "dr" : /Jump/.test(x) ? "gk" : "mv"; };
    const ACOL = { m: "#64748b", s: "#f472b6", p: "#4ade80", d: "#fbbf24", r: "#a78bfa", k: "#fde047" };   // 1.60: strip colours
    // 1.60: the last 40 s as the kind of action each second (recorder.js ctlA): grey = move, pink shoot, green pass…
    const tlineA = str => !str ? "" : `<svg viewBox="0 0 120 5" preserveAspectRatio="none" style="width:100%;height:5px;display:block;margin:2px 0 0;border:0">${[...str].map((c, i) => c === "-" ? "" : `<rect x="${i * 3}" y="0" width="2.4" height="5" style="fill:${ACOL[c] || ACOL.m}"/>`).join("")}</svg>`;
    // 1.60: our players under 20 stamina now — a red chip in the top line
    const tiredNow = () => {
      const L2 = lastLive; if (!L2 || !L2.p || !started()) return "";
      const { us } = sides(), t = L2.p.filter(x => x[0] === us && x[6] != null && x[6] < 20).sort((a, b) => a[6] - b[6]);
      return t.length ? `<span class="drk-tired" title="stamina under 20: the player slows down; 0 = empty">⚡ tired: ${t.map(x => `${E(roleOf(x[1]))} <b>${x[6]}</b>`).join(" · ")}</span>` : "";
    };
    const actSpan = a => `<span class="ac-${ACAT(a)}">${E(actName(a))}</span>`;
    const ACLEG = `<span class="ac-mv">move</span> · <span class="ac-sh">shoot</span> · <span class="ac-pa">pass</span> · <span class="ac-df">press / intercept / mark / chase</span> · <span class="ac-dr">dribble</span>`;
    const mmss = t => `${Math.floor((t || 0) / 60)}:${String(Math.floor((t || 0) % 60)).padStart(2, "0")}`;
    const tag = ag => ag === 1 ? `<span class="tg ag" title="our agent's command (Coach*)">AGENT</span>` : ag === 0 ? `<span class="tg ai" title="the game's own built-in AI">AI</span>` : `<span class="tg">?</span>`;
    // 1.44: who decides — "agent" when the player's action is an agent command (Coach*), "AI" when the game's
    // own AI moves him; per player now, and (wide) a 40 s timeline, cyan = agent share of each second.
    const tline = (str, full = false) => {
      if (!str) return "";
      if (full) return `<svg viewBox="0 0 120 12" preserveAspectRatio="none" style="width:100%;height:10px;display:block;margin:0;border:0">${[...str].map((c, i) => c === "-" ? "" : `<rect x="${i * 3}" y="0" width="2.4" height="12" style="fill:${c === "0" ? "#334155" : "#22d3ee"};opacity:${c === "0" ? 1 : (0.35 + 0.65 * (+c) / 9).toFixed(2)}"/>`).join("")}</svg>`;
      const cells = [...str].map((c, i) => c === "-" ? "" : `<rect x="${i * 3}" y="0" width="2.4" height="12" rx="0.6" style="fill:${c === "0" ? "#334155" : "#22d3ee"};opacity:${c === "0" ? 1 : (0.35 + 0.65 * (+c) / 9).toFixed(2)}"/>`).join("");
      return `<svg viewBox="0 0 120 12" style="width:120px;height:12px;display:inline-block;vertical-align:middle;margin:0;border:0">${cells}</svg>`;
    };
    const nowCell = (team, i, short = false) => {
      const pl = lastLive && lastLive.p ? lastLive.p.find(x => x[0] === team && x[1] === i) : null;
      if (!pl) return `<span class="m">—</span>`;
      if (short) return pl[4] ? `<b class="us" title="${E(pl[5])}">AGENT</b>` : `<span class="m" title="${E(pl[5])}">AI</span>`;
      return `<span title="${E(pl[5])}">${tag(pl[4])} ${actSpan(pl[5])}</span>`;
    };
    // 1.46: stamina now, per player (live positions carry it)
    const stamCell = (team, i) => {
      const pl = lastLive && lastLive.p ? lastLive.p.find(x => x[0] === team && x[1] === i) : null;
      if (!pl || pl[6] == null) return `<span class="m">—</span>`;
      return `<span class="${pl[6] < 30 ? "r" : pl[6] < 50 ? "o" : ""}">${pl[6]}</span>`;
    };
    // 1.46: our agents' health now — errors / timeouts in CloudWatch, "fallback" decisions (TRACE), and the
    // portal's errors + throttles; one warning line, empty when all is well
    const healthLine = () => {
      const bad = [];
      const tr = LIVE && LIVE.ok && LIVE.pos ? LIVE.pos : null;
      if (tr) for (const [i, slot] of POSN.entries()) { const t = tr[slot], p = roleOf(i); if (!t) continue;
        if (t.err) bad.push(`${p}: ${t.err} error${t.err > 1 ? "s" : ""}`);
        if (t.fb > 2) bad.push(`${p}: ${t.fb} fallbacks`);
        if (t.ago != null && t.ago > 25 && started()) bad.push(`${p}: no call for ${t.ago} s`); }
      for (const a of (PING && PING.agents) || []) { const e = (a.errors || 0) + (a.throttles || 0); if (e) bad.push(`${roleOf(a.pos)}: ${e} errors / throttles (portal)`); }
      return bad.length ? `<div class="drk-warn">⚠ ${E(bad.slice(0, 4).join(" · "))}</div>` : "";
    };
    const liveBody = (wide = false) => {
      const ctl = lastStatus && lastStatus.ctl;
      if (!flowing() || !ctl || !started()) return `<div class="wait">Starts with the match.</div>`;
      const { us, them } = sides();
      const tl = (lastStatus && lastStatus.ctlT) || {};
      const tr = LIVE && LIVE.ok && LIVE.pos ? LIVE.pos : null;
      const rows = POSN.map((p, i) => {
        const a = ctl[us + ":" + i] || [], b = ctl[them + ":" + i] || [], t = tr && tr[p];
        const calls = t ? `<span class="${t.calls < 5 ? "r" : t.calls < 15 ? "o" : ""}">${t.calls}</span>` : `<span class="m">—</span>`;
        const gap = t && t.maxgap != null ? `<span class="${t.maxgap > 10 ? "r" : t.maxgap > 5 ? "o" : ""}">${t.maxgap}s</span>` : `<span class="m">—</span>`;
        return `<tr><td>${roleOf(i)}</td><td style="text-align:left" data-now="${us}:${i}" data-short="${wide ? "" : "1"}">${nowCell(us, i, !wide)}</td>${wide ? `<td>${tline(tl[us + ":" + i])}</td>` : ""}<td data-stam="${us}:${i}">${stamCell(us, i)}</td><td>${pctCell(a[0])}</td><td>${i === 0 && a[1] != null ? `${a[1]}s` : agoCell(a[1])}</td><td>${pctCell(b[0])}</td>${tr ? `<td>${calls}</td><td>${gap}</td>` : ""}</tr>`;
      }).join("");
      const note = tr ? " · calls / pause: our agents in CloudWatch, last 60 s" : LIVE && LIVE.error && !LIVE.missing ? ` · TRACE: ${E(LIVE.error).slice(0, 60)}` : "";
      return `<table><tr><th></th><th style="text-align:left" title="who moves our player right now: an agent command (Coach*) or the game's own AI">now</th>${wide ? `<th title="last 40 s, oldest left: cyan = under an agent command, grey = the game's AI">last 40 s</th>` : ""}<th title="stamina now (100 = fresh); red under 30">stam</th><th title="share of the last 30 s our player spent on an agent command">ctl</th><th title="seconds our player has been without an agent command">off</th><th title="their player's share under an agent command">them</th>${tr ? `<th title="our agent's calls in the last 60 s">calls</th><th title="longest pause between calls, last 60 s">pause</th>` : ""}</tr>${rows}</table>
        <div class="note">AGENT = following an agent command · AI = the game's own AI · ctl = agent share, 30 s · off = seconds without a command${note}</div>`;
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
        const cx = sx(Math.max(-6.5, Math.min(6.5, x))), cy = sz(Math.max(-3.65, Math.min(3.65, z)));
        const sty = `fill:${m[6] ? c : "none"};stroke:${c};stroke-width:1.5;opacity:${m[6] ? 1 : .8}`;
        const tip = `data-tip="${E(shotTip(m, lastStatus && lastStatus.st, us))}"`;   // 1.57: hover box
        return m[7] === 0 ? `<rect ${tip} x="${(cx - r).toFixed(1)}" y="${(cy - r).toFixed(1)}" width="${2 * r}" height="${2 * r}" style="${sty}"/>`   // 1.56: built-in AI shot = square
          : `<circle ${tip} cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" style="${sty}"/>`;
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
      const last = (s.last || []).slice(-3).reverse().map(x => `${Math.round(x[0])}s ${x[1] === us ? A : B} ${nameOf(x[1], x[2], us)} ${x[3]}m`).join(" · ");
      return `<div class="lg"><span class="us">● ${A}</span><span class="th">${B} ●</span></div>
        ${bar("Shots", s.sh[us], s.sh[them])}
        ${bar(`<span title="sum over shots of the share of shots from that distance that went in (280 recorded matches)">xG guide</span>`, s.xg[us], s.xg[them], v => (v || 0).toFixed(2))}
        ${s.pos ? bar("Possession", s.pos[us], s.pos[them], v => v + "%") : ""}
        ${s.third ? bar(`<span title="share of play time the ball is in this side's attacking third">Ball in attacking third</span>`, s.third[us], s.third[them], v => v + "%") : ""}
        ${s.pass ? bar("Passes completed", s.pass[us], s.pass[them], v => v == null ? "—" : v + "%") : ""}
        ${s.won ? bar("Ball won", s.won[us], s.won[them]) : ""}
        ${s.rate ? bar("Agent commands / min", s.rate[us], s.rate[them]) : ""}
        ${s.pause ? bar("Longest silence, s", s.pause[us], s.pause[them], v => v == null ? "—" : v) : ""}
        ${s.stam ? bar("Stamina", s.stam[us], s.stam[them]) : ""}
        ${oldRecorder()}
        ${shotMap(s.map, us)}
        <div class="note">○ agent shot · □ built-in AI shot · filled = goal · size = xG · ${A} attack →${last ? `<br>last: ${E(last)}` : ""}</div>`;
    };
    // 1.28: the opponent's form, from their own match list on the portal.
    const formRows = (part = "all") => {
      if (!FORM || !FORM.ok || !FORM.last.length) return "";
      const seq = FORM.last.map(x => `<i class="${x.r}" title="${E(x.t)}">${x.r}</i>`).join("");
      const day = FORM.day.n ? `${FORM.day.wr}% <span class="m">· ${FORM.day.n} games</span>` : `<span class="m">no games</span>`;
      const arrow = FORM.day.n >= 3 && FORM.all.n ? (FORM.day.wr > FORM.all.wr + 10 ? ` <span class="r">▲</span>` : FORM.day.wr < FORM.all.wr - 10 ? ` <span class="g">▼</span>` : "") : "";
      const l5 = `<div class="kv"><span title="the opponent's last 5 matches, newest first: W = they won (red), L = they lost (green), D = draw">Their last 5</span><span class="fr">${seq}</span></div>`;
      if (part === "last5") return l5;
      return `${part === "rest" ? "" : l5}
        <div class="kv"><span title="their win rate over the last 24 h (▲ / ▼: more than 10 points above / below their overall)">Their last 24 h</span><span>${day}${arrow}</span></div>
        <div class="kv"><span>Goals / game</span><span>${FORM.all.gf}:${FORM.all.ga} <span class="m">· last ${FORM.all.n}</span></span></div>`;
    };
    let OURS = null;
    const loadForm = () => {
      const pm = PING && PING.match && PING.match.id === mid ? PING.match : null;
      if (pm && pm.usId && (!OURS || Date.now() - OURS.at > 10 * 60e3)) oppFormNow(pm.usId).then(r => { OURS = r; render(); }).catch(() => {});
      if (!pm || !pm.oppId || (FORM && FORM.oppId === pm.oppId && Date.now() - FORM.at < 5 * 60e3)) return;
      oppFormNow(pm.oppId).then(r => { FORM = r; render(); }).catch(() => {});
    };
    // 1.45: play style from the portal's command counts. CLEAR_OVERRIDE hands the player back to the game's AI.
    const CMDN = { MOVE_TO: "move", PRESS_BALL: "press", MARK: "mark", PASS: "pass", INTERCEPT: "intercept", SHOOT: "shoot",
      CLEAR_OVERRIDE: "back to AI", GK_DISTRIBUTE: "GK kick", SET_STANCE: "stance", FOLLOW_PLAYER: "follow", RESET: "reset" };
    const styleLine = st => st ? st.share.slice(0, 4).map(([k, v]) => `${CMDN[k] || k.toLowerCase()} <b>${v}%</b>`).join(" · ") : "";
    // 1.57: both styles side by side — one row per command type (their top 5 and ours), then commands a match and ping
    const styleTable = () => {
      const t = FORM && FORM.ok && FORM.style, o = OURS && OURS.ok && OURS.style;
      if (!t && !o) return "";
      const keys = [];
      for (const st of [t, o]) if (st) for (const [k] of st.share.slice(0, 5)) if (!keys.includes(k)) keys.push(k);
      const v = (st, k) => { if (!st) return `<span class="m">—</span>`; const x = st.share.find(e => e[0] === k); return x ? `${x[1]}%` : `<span class="m">—</span>`; };
      const rows = keys.slice(0, 7).map(k => `<tr><td>${E(CMDN[k] || k.toLowerCase())}</td><td>${v(t, k)}</td><td>${v(o, k)}</td></tr>`).join("");
      return `<table><tr><th></th><th class="th" style="color:#fb923c">them</th><th style="color:#22d3ee">us</th></tr>${rows}
          <tr><td title="agent commands a match">commands</td><td>${t ? "~" + t.perMatch : "—"}</td><td>${o ? "~" + o.perMatch : "—"}</td></tr>
          <tr><td title="average agent ping, ms">ping, ms</td><td>${t && t.ping != null ? t.ping : "—"}</td><td>${o && o.ping != null ? o.ping : "—"}</td></tr></table>
        <div class="note">share of each agent command type, last ${(t || o).n} matches · "back to AI" hands the player to the game's built-in AI</div>`;
    };
    const styleRows = () => {
      const t = FORM && FORM.ok && FORM.style, o = OURS && OURS.ok && OURS.style;
      if (!t && !o) return "";
      const tip = st => st ? st.share.map(([k, v]) => `${CMDN[k] || k}: ${v}%`).join(", ") + ` — ${st.perMatch} commands a match, ping ${st.ping ?? "?"} ms, last ${st.n} matches` : "";
      return `${t ? `<div class="kv w"><span title="${E(tip(t))}">Their style</span><span>${styleLine(t)}</span></div>
          <div class="kv"><span>Their agents</span><span>~${t.perMatch} cmds / match${t.ping != null ? ` · ${t.ping} ms` : ""}</span></div>` : ""}
        ${o ? `<div class="kv w"><span title="${E(tip(o))}">Our style</span><span class="m">${styleLine(o)}</span></div>` : ""}`;
    };
    // 1.38: "This match" and "Agents live" in a wide strip under the game picture, in the empty part of the
    // viewer's frame (only when there is room and not in full screen). "→ side panel" moves them back.
    let strip = null, stripOn = false, stripPref = true;
    try { stripPref = localStorage.getItem("__drk_strip") !== "0"; } catch (e) {}
    const gameCanvas = () => { let c = null, a = 0; for (const x of document.querySelectorAll("canvas")) { const r = x.getBoundingClientRect(), s2 = r.width * r.height; if (s2 > a) { a = s2; c = x; } } return a > 40000 ? c : null; };
    // 1.40: the strip lives only inside the game's own frame (the bordered box around the picture, MuiBox
    // css-1aisiqn on 27.10) — never above the side panel. Free space under the picture: it fills it (overlay);
    // no space: it becomes the frame's last block and the frame grows by its height.
    const gameFrame = c => {
      let el = c.parentElement;
      for (let i = 0; el && el !== document.body && i < 10; i++, el = el.parentElement) {
        if (el.classList.contains("css-1aisiqn")) return el;
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        if (parseFloat(cs.borderTopWidth) >= 2 && cs.borderTopStyle !== "none" && r.width < innerWidth * 0.85) return el;
      }
      return null;
    };
    const placeStrip = () => {
      const off = () => { if (strip) strip.style.display = "none"; stripOn = false; };
      if (!mid || !stripPref || document.fullscreenElement) return off();
      const c = gameCanvas(); if (!c) return off();
      const fr = gameFrame(c);
      if (!fr) return off();
      if (!strip || !strip.isConnected || strip.parentElement !== fr) {
        for (const x of document.querySelectorAll("#drk-strip")) x.remove();   // left by a copy from before a reload
        strip = document.createElement("div"); strip.id = "drk-strip"; strip.className = "drk";
        strip.addEventListener("click", ev => { const ts = ev.target.closest("[data-tl]"); if (ts) { tlSide = ts.dataset.tl; try { localStorage.setItem("__drk_tlside", tlSide); } catch (e) {} render(); return; } const as = ev.target.closest("[data-ag]"); if (as) { agSide = as.dataset.ag; try { localStorage.setItem("__drk_agside", agSide); } catch (e) {} render(); return; } const tb = ev.target.closest("[data-tab]"); if (tb) { tab = tb.dataset.tab; try { localStorage.setItem("__drk_tab", tab); } catch (e) {} render(); return; } const mt = ev.target.closest("[data-map]"); if (mt) { mapMode = mt.dataset.map; try { localStorage.setItem("__drk_map", mapMode); } catch (e) {} render(); return; } if (ev.target.closest("[data-side]")) { stripPref = false; try { localStorage.setItem("__drk_strip", "0"); } catch (e) {} placeStrip(); render(); } });
        fr.appendChild(strip);
        strip.addEventListener("mousemove", onTipMove); strip.addEventListener("mouseleave", () => tipShow("", null)); strip.addEventListener("mousedown", () => tipShow("", null));
        // free space under the picture, measured once without the strip
        const cr = c.getBoundingClientRect(), frr = fr.getBoundingClientRect();
        strip.dataset.mode = frr.bottom - cr.bottom - 20 >= 180 ? "overlay" : "block";
      }
      if (strip.dataset.mode === "overlay") {
        const cr = c.getBoundingClientRect(), frr = fr.getBoundingClientRect(), space = frr.bottom - cr.bottom - 20;
        if (space < 140) { strip.dataset.mode = "block"; return placeStrip(); }
        if (getComputedStyle(fr).position === "static") fr.style.position = "relative";
        Object.assign(strip.style, { display: "flex", position: "absolute", top: `${Math.round(cr.bottom - frr.top + 12)}px`, left: "24px", right: "24px",
          height: "auto", maxHeight: `${Math.round(space - 8)}px`, margin: "0", flex: "" });
      } else {
        const cs = getComputedStyle(fr), row = cs.display.includes("flex") && !cs.flexDirection.startsWith("column");
        if (row) fr.style.flexWrap = "wrap";
        Object.assign(strip.style, { display: "flex", position: "relative", top: "", left: "", right: "", height: "auto", maxHeight: "",
          margin: "12px 20px 16px", flex: row ? "0 0 calc(100% - 40px)" : "" });
      }
      stripOn = true;
    };
    // 1.44: the "Control now" pitch — every player where he is, filled = under an agent command, hollow = the
    // game's AI; redrawn from recorder.js's live positions ~6 times a second without rebuilding the strip.
    let mapMode = "shots";
    try { mapMode = localStorage.getItem("__drk_map") === "ctl" ? "ctl" : "shots"; } catch (e) {}
    const ctlPitch = () => {
      const W = 260, Hh = 146, gh = Math.abs((0.9 - -0.9) / 7.3 * Hh), L = "fill:none;stroke:#1f5135;stroke-width:1";
      return `<svg viewBox="0 0 ${W} ${Hh}" style="border:0;outline:0;background:none;overflow:hidden">
        <rect x=".5" y=".5" width="${W - 1}" height="${Hh - 1}" rx="4" style="fill:#0f2a1c;stroke:#1f5135;stroke-width:1"/>
        <line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${Hh}" style="${L}"/><circle cx="${W / 2}" cy="${Hh / 2}" r="18" style="${L}"/>
        <rect x="0" y="${(Hh - 3 * gh) / 2}" width="26" height="${3 * gh}" style="${L}"/><rect x="${W - 26}" y="${(Hh - 3 * gh) / 2}" width="26" height="${3 * gh}" style="${L}"/>
        <rect x="0" y="${(Hh - gh) / 2}" width="3" height="${gh}" style="fill:#fb923c88;stroke:none"/><rect x="${W - 3}" y="${(Hh - gh) / 2}" width="3" height="${gh}" style="fill:#22d3ee88;stroke:none"/>
        <g id="drk-lp">${livePlayers()}</g></svg>`;
    };
    const livePlayers = () => {
      const L2 = lastLive; if (!L2 || !L2.p) return "";
      const { us } = sides(), W = 260, Hh = 146;
      const dir = L2.dir || 1, f = us === 0 ? dir : -dir;   // our frame: we attack +x (right)
      const X = x => ((Math.max(-6.5, Math.min(6.5, x * f)) + 6.5) / 13 * W).toFixed(1), Z = z => ((3.65 - Math.max(-3.65, Math.min(3.65, z * f))) / 7.3 * Hh).toFixed(1);
      const dots = L2.p.map(([tm, i, x, z, ag, a]) => { const c = tm === us ? "#22d3ee" : "#fb923c";
        return `<circle cx="${X(x)}" cy="${Z(z)}" r="5" style="fill:${ag ? c : "#0f2a1c"};stroke:${c};stroke-width:1.6"><title>${tm === us ? "us" : "them"} ${nameOf(tm, i, us)} || i}: ${ag ? "agent" : "game AI"} · ${E(a)}</title></circle>`
          + (tm === us ? `<text x="${X(x)}" y="${(+Z(z) - 7).toFixed(1)}" style="fill:#94a3b8;font:7px sans-serif;text-anchor:middle">${roleOf(i)}</text>` : ""); }).join("");
      const hp = L2.h ? L2.p.find(x => x[0] === L2.h[0] && x[1] === L2.h[1]) : null;   // 1.56: ring on the ball holder
      return dots + (hp ? `<circle cx="${X(hp[2])}" cy="${Z(hp[3])}" r="8.5" style="fill:none;stroke:#f8fafc;stroke-width:1.2;opacity:.9"/>` : "")
        + `<circle cx="${X(L2.b[0])}" cy="${Z(L2.b[1])}" r="2.6" style="fill:#fff;stroke:#000;stroke-width:.5"/>`;
    };
    // 1.56: the strip has tabs — Match (stats + pitch), Agents (a card per player with his own decisions),
    // Timeline (the whole match per second) — and, above them, who has the ball now and every goal with its
    // scorer, assist and whether our agent's command or the game's built-in AI moved them.
    let tab = "match";
    try { const t = localStorage.getItem("__drk_tab"); if (["match", "agents", "time"].includes(t)) tab = t; } catch (e) {}
    const ballNow = () => {
      const L2 = lastLive; if (!L2 || !L2.p || !started()) return "";
      const { us } = sides();
      if (!L2.h) return `<span class="m">⚽ loose ball</span>`;
      const [tm, i] = L2.h, pl = L2.p.find(x => x[0] === tm && x[1] === i);
      const who = tm === us ? `<b class="us">${roleOf(i)}</b>` : `<b class="th">their ${POSN[i] || i}</b>`;
      return `<span title="who has the ball now, and who moves him: our agent's command or the game's built-in AI">⚽ ${who} ${pl ? `${tag(pl[4])} ${actSpan(pl[5])}` : ""}</span>`;
    };
    // 1.57: what a hover shows — a shot (and the goal it made), a goal chip. HTML for the #drk-tip box.
    const byWho = (ag, mine) => ag === 1 ? `${tag(1)} ${mine ? "our" : "their"} agent's command` : ag === 0 ? `${tag(0)} the game's built-in AI` : `<span class="m">not seen</span>`;
    const goalTip = (g, us) => {
      const mine = g[1] === us;
      return `<b>${mmss(g[0])}</b> · ⚽ <b class="g">GOAL</b> · ${mine ? "our" : "their"} <b class="${mine ? "us" : "th"}">${E(g[2] >= 0 ? nameOf(g[1], g[2], us) : "?")}</b>
        <br>shot: ${byWho(g[3], mine)}${g[4] != null ? ` <span class="m">· ${g[4]} m</span>` : ""}
        <br>${g[5] >= 0 ? `pass from <b>${E(nameOf(g[1], g[5], us))}</b>: ${byWho(g[6], mine)}` : `<span class="m">no pass before it (own run, rebound or loose ball)</span>`}`;
    };
    const shotTip = (m, s, us) => {
      const mine = m[1] === us, d = Math.hypot(6.5 - m[3], m[4]).toFixed(1);
      const g = m[6] ? ((s && s.goals) || []).find(x => x[1] === m[1] && x[2] === m[2] && x[0] - m[0] >= -0.5 && x[0] - m[0] <= 4) : null;
      if (g) return goalTip(g, us) + `<br><span class="m">xG ${m[5]}</span>`;
      return `<b>${mmss(m[0])}</b> · shot · ${mine ? "our" : "their"} <b class="${mine ? "us" : "th"}">${E(nameOf(m[1], m[2], us))}</b><br>by: ${byWho(m[7], mine)}<br><span class="m">${d} m · xG ${m[5]} · no goal</span>`;
    };
    // goals as small chips (time, scorer, dot: cyan = agent's shot, grey square = built-in AI); the rest on hover
    const goalRibbon = s => {
      const gl = (s && s.goals) || []; if (!gl.length) return "";
      const { us } = sides();
      const mine = gl.filter(g => g[1] === us), ag = mine.filter(g => g[3] === 1).length, ai = mine.filter(g => g[3] === 0).length;
      const items = gl.map(g => { const ours = g[1] === us;
        return `<span class="gl ${ours ? "us" : "th"}" data-tip="${E(goalTip(g, us))}"><span class="m">${mmss(g[0])}</span> <b class="${ours ? "us" : "th"}">${E(g[2] >= 0 ? nameOf(g[1], g[2], us) : "?")}</b><i class="${g[3] === 1 ? "ag" : g[3] === 0 ? "ai" : "un"}"></i></span>`; }).join("");
      const sum = mine.length ? `<span class="gsum" data-tip="${E(`our goals: <b>${mine.length}</b><br>${tag(1)} by our agent's shot: <b>${ag}</b><br>${tag(0)} by the game's built-in AI: <b>${ai}</b>`)}">our goals <b class="us">${ag}</b> agent · <b>${ai}</b> AI</span>` : "";
      return `<div class="drk-goals">${items}${sum}</div>`;
    };
    // one player's own switches between the game's AI and agent commands, newest first; an agent command gets
    // our rule's reason from TRACE when the helper has it (±3 s, same position)
    // 1.62: `team` — their players too (no TRACE reason for them)
    const agentDecisions = (i, n = 4, team = null) => {
      const ev = (lastLive && lastLive.ev) || [], { us } = sides(), tm = team == null ? us : team;
      const tr = tm === us && LIVE && LIVE.recent ? LIVE.recent : [], pos = POSN[i];
      const list = ev.filter(e => e[1] === tm && e[2] === i).slice(-n).reverse();
      if (!list.length) return `<div class="dle m">no switches yet</div>`;
      return list.map(([t, , , a, ag]) => {
        const why = ag ? tr.filter(x => x[0] === pos && x[1] != null && Math.abs(x[1] - t) <= 3).pop() : null;
        const tip = `${t.toFixed(1)} s: ${ag ? "agent command" : "built-in AI"} ${actName(a)}${why ? ` — ${why[2]}: ${why[3]}` : ""}`;
        return `<div class="dle" title="${E(tip)}"><span class="m">${mmss(t)}</span> ${tag(ag)} ${actSpan(a)}${why ? ` <span class="m">· ${E(why[3] || why[2])}</span>` : ""}</div>`;
      }).join("");
    };
    // 1.58: back to the 1.56 card (user: it was better) — everything visible, decisions included; named by role
    // 1.62: `tm` = whose player — ours (default) or theirs, the same card from the game stream; their names are
    // the slot (POSN), and instead of our TRACE calls · pause: new commands seen in the stream, last 60 s
    const agentCard = (i, s, tm = null) => {
      const { us } = sides(), mine = tm == null || tm === us, team = mine ? us : tm, k = team + ":" + i;
      const ctl = (lastStatus && lastStatus.ctl) || {}, c = ctl[k] || [], tl = (lastStatus && lastStatus.ctlT) || {};
      const fps = (s && s.fps) || 40, h = s && s.hag && s.hag[k], ps = s && s.psh && s.psh[k], goals = (s && s.goals) || [];
      const gl = goals.filter(g => g[1] === team && g[2] === i), asn = goals.filter(g => g[1] === team && g[5] === i).length;
      const glAI = gl.filter(g => g[3] === 0).length;
      const ball = h && h[1] ? `${(h[1] / fps).toFixed(0)} s <span class="m">· agent ${pct(h[0], h[1])}%</span>` : `<span class="m">—</span>`;
      const shots = ps ? `${ps[0] + ps[1]}${ps[1] ? ` <span class="m">(AI ${ps[1]})</span>` : ""}` : "0";
      const t = mine && LIVE && LIVE.ok && LIVE.pos ? LIVE.pos[POSN[i]] : null;
      const pc = !mine && s && s.pcmd ? s.pcmd[k] || [0, null] : null;
      const hb = lastLive && lastLive.h && lastLive.h[0] === team && lastLive.h[1] === i;
      return `<div class="drk-card${hb ? " hasball" : ""}${mine ? "" : " them"}" data-card="${k}">
        <div class="ch"><b>${E(nameOf(team, i, us))}</b><span class="bl"></span><span class="stm" title="stamina now (100 = fresh)">stamina <span data-stam="${k}">${stamCell(team, i)}</span></span></div>
        <div class="nw" data-now="${k}">${nowCell(team, i)}</div>
        <div title="last 40 s, oldest left — top: cyan = agent command, grey = built-in AI; bottom: the kind of action (grey move, pink shoot, green pass, yellow press / intercept / mark, violet dribble)">${tline(tl[k], true)}${tlineA(((lastStatus && lastStatus.ctlA) || {})[k])}</div>
        <div class="kv" style="margin-top:3px"><span title="share of the last 30 s on an agent command; idle = seconds without one">agent control</span><span>${pctCell(c[0])}${c[1] && i ? ` <span class="m">· idle</span> ${agoCell(c[1])}` : ""}</span></div>
        <div class="kv"><span title="time on the ball this match, and how much of it under an agent command (the rest: the built-in AI dribbles / passes)">on the ball</span><span>${ball}</span></div>
        <div class="kv"><span title="shots (built-in AI ones in brackets) · goals${asn ? " · assists" : ""}">shots · goals${asn ? " · ast" : ""}</span><span>${shots} · ${gl.length ? `<b class="g">${gl.length}</b>${glAI ? ` <span class="m">(AI ${glAI})</span>` : ""}` : "0"}${asn ? ` · ${asn}` : ""}</span></div>
        ${t ? `<div class="kv"><span title="our agent's calls / longest pause, last 60 s (TRACE)">calls · pause</span><span>${t.calls} · ${t.maxgap != null ? t.maxgap + " s" : "—"}</span></div>` : ""}
        ${mine ? "" : `<div class="kv"><span title="estimated from the game stream, last 60 s: new agent commands seen (a switch from the built-in AI or to another command) · the longest gap between them. A repeated same command is invisible in the stream, so the real count can be higher.">commands (stream)</span><span>${pc ? `${pc[0]} · ${pc[1] != null ? pc[1] + " s" : "—"}` : `<span class="m" title="reload this tab (⌘R): the recorder in the page is older">—</span>`}</span></div>`}
        <div class="dl" data-dl="${k}">${agentDecisions(i, 4, team)}</div></div>`;
    };
    const teamLine = s => {
      const { us, them } = sides(), ctl = (lastStatus && lastStatus.ctl) || {};
      const th = POSN.map((p, i) => (ctl[them + ":" + i] || [])[0]).filter(v => v != null);
      const tAvg = th.length ? Math.round(th.reduce((a, b) => a + b, 0) / th.length) : null;
      const bits = [];
      if (s.rate) bits.push(`<span title="new agent commands in the last 60 s of play">commands / min <b class="us">${s.rate[us]}</b> vs <b class="th">${s.rate[them]}</b></span>`);
      if (s.pause) bits.push(`<span title="the longest stretch with no new agent command for the whole team, last 60 s — lower is better">longest silence <b class="us">${s.pause[us] ?? "—"} s</b> vs <b class="th">${s.pause[them] ?? "—"} s</b></span>`);
      if (s.stam) bits.push(`<span title="average stamina of the five players now">stamina <b class="us">${s.stam[us]}</b> vs <b class="th">${s.stam[them]}</b></span>`);
      if (tAvg != null) bits.push(`<span title="their players' average share of the last 30 s on an agent command">their agent control <b class="th">${tAvg}%</b></span>`);
      return bits.length ? `<div class="drk-team">${bits.join(`<span class="m"> · </span>`)}</div>` : "";
    };
    // the whole match, one column per game second: who holds the ball, every shot / goal, and per player the
    // agent share (cyan) vs the built-in AI (grey) with a white mark where he had the ball
    let agSide = "us";   // 1.62: whose players the Agents tab's cards show
    try { if (localStorage.getItem("__drk_agside") === "them") agSide = "them"; } catch (e) {}
    let tlSide = "us";   // 1.60: whose players the timeline's lanes show
    try { if (localStorage.getItem("__drk_tlside") === "them") tlSide = "them"; } catch (e) {}
    const timeline = s => {
      const tl = s && s.tl;
      if (!tl || !tl.pos) return `<div class="wait">Reload this tab (⌘R) for the timeline — the plugin was updated; the recording carries on.</div>`;
      const { us, them } = sides(), now = (lastStatus && lastStatus.t) || tl.pos.length;
      const dur = Math.max(tl.pos.length, (lastStatus && lastStatus.dur) || 120), LW = 46, W = 1000, cw = (W - LW) / dur, X = t => (LW + t * cw).toFixed(1);
      const runs = (str, f) => { const out = []; let i = 0; while (i < str.length) { let j = i; while (j < str.length && str[j] === str[i]) j++; const v = f(str[i]); if (v) out.push(`<rect x="${X(i)}" width="${((j - i) * cw).toFixed(1)}" ${v}/>`); i = j; } return out.join(""); };
      const lab = (y, t, c = "#94a3b8") => `<text x="0" y="${y}" style="fill:${c};font:600 9px sans-serif">${t}</text>`;
      let y = 2, out = [];
      out.push(lab(y + 8, "Ball"), runs(tl.pos, c => c === "." ? "" : `y="${y}" height="9" style="fill:${c === "-" ? "#1f2937" : +c === us ? "#22d3ee" : "#fb923c"};opacity:${c === "-" ? 1 : .75}"`));
      y += 13;
      const sy = y + 9;
      out.push(lab(y + 12, "Shots"), `<line x1="${LW}" x2="${W}" y1="${sy}" y2="${sy}" style="stroke:#1f2937;stroke-width:1"/>`);
      for (const m of s.map || []) {
        const mine = m[1] === us, c = mine ? "#22d3ee" : "#fb923c", cx = +X(m[0]), cy = mine ? sy - 4.5 : sy + 4.5, r = m[6] ? 4 : 3;
        const sty = `fill:${m[6] ? c : "#0b0d14"};stroke:${c};stroke-width:1.2`, tip = `data-tip="${E(shotTip(m, s, us))}"`;
        out.push(`<g ${tip}><circle cx="${cx}" cy="${cy}" r="7" style="fill:transparent"/>${m[7] === 0 ? `<rect x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" style="${sty}"/>` : `<circle cx="${cx}" cy="${cy}" r="${r}" style="${sty}"/>`}</g>`);
      }
      y += 22;
      const top = y, lt = tlSide === "them" ? them : us, lc = lt === us ? "#22d3ee" : "#fb923c";
      POSN.forEach((p, i) => {
        const k = lt + ":" + i, ag = tl.ag[k] || "", hd = tl.hd[k] || "", sm = (tl.sm && tl.sm[k]) || "";
        out.push(lab(y + 9, E(nameOf(lt, i, us)), lt === us ? "#cbd5e1" : "#fdba74"), `<rect x="${LW}" y="${y}" width="${(Math.min(now, dur) * cw).toFixed(1)}" height="11" style="fill:#334155"/>`,
          runs(ag, c => c === "." || c === "0" ? "" : `y="${y}" height="11" style="fill:${lc};opacity:${(0.3 + 0.7 * (+c) / 9).toFixed(2)}"`),
          runs(hd, c => c === "1" ? `y="${y + 8}" height="3" style="fill:#f8fafc"` : ""),
          runs(sm, c => c === "." || +c >= 5 ? "" : `y="${y + 12}" height="2.5" style="fill:${+c < 2 ? "#f87171" : "#fbbf24"}"`));   // 1.60: tired (under 50 / under 20)
        y += TL_STEP;
      });
      for (const g of s.goals || []) {
        const c = g[1] === us ? "#22d3ee" : "#fb923c", x = X(g[0]);
        out.push(`<line x1="${x}" x2="${x}" y1="${top - 22}" y2="${y - 4}" style="stroke:${c};stroke-width:1.2;stroke-dasharray:2 2;pointer-events:none"/>`);
        if (g[1] === lt && g[2] >= 0) out.push(`<circle data-tip="${E(goalTip(g, us))}" cx="${x}" cy="${top + g[2] * TL_STEP + 5.5}" r="4" style="fill:#f8fafc;stroke:${c};stroke-width:1.5"/>`);
      }
      out.push(`<line x1="${X(Math.min(now, dur))}" x2="${X(Math.min(now, dur))}" y1="0" y2="${y - 4}" style="stroke:#f8fafc;stroke-width:1;opacity:.5"/>`);
      TLM = { LW, cw, dur, top, H: y + 10, W, s, us, lt };   // 1.57: for the per-second hover
      for (let t = 0; t <= dur; t += 15) out.push(`<text x="${X(t)}" y="${y + 7}" style="fill:#64748b;font:9px sans-serif;text-anchor:${!t ? "start" : t + 15 > dur ? "end" : "middle"}">${mmss(t)}</text>`);
      return `<div class="drk-time"><div class="drk-tog" style="margin-bottom:4px"><span data-tl="us" class="${tlSide === "us" ? "on" : ""}">Our players</span><span data-tl="them" class="${tlSide === "them" ? "on" : ""}">Their players</span></div><svg class="drk-tlsvg" viewBox="0 0 ${W} ${y + 10}" style="width:100%;height:auto;border:0;outline:0;background:none">${out.join("")}</svg>
        <div class="note">Ball: <span class="us">us</span> / <span class="th">them</span> / grey = loose · Shots: ○ agent, □ built-in AI, filled = goal (ours above the line) · players: <span class="us">cyan</span> / <span class="th">orange</span> = agent command, grey = built-in AI, white mark = on the ball, ● = his goal, underline = tired (<span style="color:#fbbf24">under 50</span>, <span class="r">under 20</span>) · hover for details</div></div>`;
    };
    // 1.57: hover on the timeline's lanes — that second: who had the ball, or this player's agent / AI share
    let TLM = null;
    const TL_STEP = 17;   // 1.60: lane + stamina underline
    const tlHover = (svg, ev) => {
      const M = TLM; if (!M || !M.s || !M.s.tl) return "";
      const r = svg.getBoundingClientRect(), vx = (ev.clientX - r.left) / r.width * M.W, vy = (ev.clientY - r.top) / r.height * M.H;
      const t = Math.floor((vx - M.LW) / M.cw); if (t < 0 || t >= M.dur) return "";
      const tl = M.s.tl, us = M.us, holder = tm => { for (let i = 0; i < 5; i++) if ((tl.hd[tm + ":" + i] || "")[t] === "1") return i; return -1; };
      if (t >= tl.pos.length || tl.pos[t] === ".") return `<b>${mmss(t)}</b> <span class="m">· not played yet</span>`;
      if (vy < 15) {
        const c = tl.pos[t], tm = c === "-" ? -1 : +c, hi = tm >= 0 ? holder(tm) : -1;
        return `<b>${mmss(t)}</b> · ball: ${tm < 0 ? `<span class="m">loose</span>` : `<b class="${tm === us ? "us" : "th"}">${tm === us ? "us" : "them"}</b>${hi >= 0 ? ` · ${E(nameOf(tm, hi, us))}` : ""}`}`;
      }
      const i = Math.floor((vy - M.top) / TL_STEP); if (vy < M.top || i < 0 || i > 4) return "";
      const lt = M.lt, k = lt + ":" + i, mine = lt === us;
      const d = (tl.ag[k] || "")[t], on = (tl.hd[k] || "")[t] === "1", sm = ((tl.sm && tl.sm[k]) || "")[t];
      const share = d === undefined || d === "." ? `<span class="m">no data</span>` : +d === 9 ? `${tag(1)} ${mine ? "our" : "their"} agent's command` : +d === 0 ? `${tag(0)} the game's built-in AI` : `${tag(1)} ${Math.round(100 * d / 9)}% · ${tag(0)} the rest`;
      const stam = sm && sm !== "." ? `<br>stamina <b class="${+sm < 2 ? "r" : +sm < 5 ? "o" : ""}">${+sm * 10}–${+sm * 10 + 9}</b>` : "";
      return `<b>${mmss(t)}</b> · <b class="${mine ? "us" : "th"}">${E(nameOf(lt, i, us))}</b><br>${share}${on ? `<br>⚽ on the ball` : ""}${stam}`;
    };
    // one floating box for every hover tip in the strip (data-tip = HTML built here from the match data)
    let tipEl = null;
    const tipShow = (html, ev) => {
      if (!tipEl || !tipEl.isConnected) { tipEl = document.getElementById("drk-tip") || document.createElement("div"); tipEl.id = "drk-tip"; document.body.appendChild(tipEl); }
      if (!html) { tipEl.style.display = "none"; return; }
      if (tipEl.innerHTML !== html) tipEl.innerHTML = html;
      tipEl.style.display = "block";
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      tipEl.style.left = `${Math.max(4, ev.clientX + 14 + w > innerWidth ? ev.clientX - w - 14 : ev.clientX + 14)}px`;
      tipEl.style.top = `${Math.max(4, ev.clientY + 16 + h > innerHeight ? ev.clientY - h - 12 : ev.clientY + 16)}px`;
    };
    const onTipMove = ev => {
      const el = ev.target && ev.target.closest ? ev.target.closest("[data-tip]") : null;
      if (el) return tipShow(el.getAttribute("data-tip"), ev);
      const svg = ev.target && ev.target.closest ? ev.target.closest("svg.drk-tlsvg") : null;
      tipShow(svg ? tlHover(svg, ev) : "", ev);
    };
    let liveDrawAt = 0;
    onLive = () => {
      if (Date.now() - liveDrawAt < 150) return;
      liveDrawAt = Date.now();
      const g = strip && stripOn ? strip.querySelector("#drk-lp") : null; if (g) g.innerHTML = livePlayers();
      if (strip && stripOn) {   // 1.56: who has the ball, and each card's own decisions
        const bb = strip.querySelector("#drk-ball"); if (bb) bb.innerHTML = ballNow();
        const tc = strip.querySelector("#drk-tired"); if (tc) { const h2 = tiredNow(); if (tc.innerHTML !== h2) tc.innerHTML = h2; }
        const { us } = sides(), h = lastLive && lastLive.h;
        for (const c of strip.querySelectorAll("[data-card]")) { const [tm, i] = c.dataset.card.split(":").map(Number); c.classList.toggle("hasball", !!(h && h[0] === tm && h[1] === i));
          const dl = c.querySelector("[data-dl]"); if (dl) dl.innerHTML = agentDecisions(i, 4, tm); }
      }
      for (const td of document.querySelectorAll(".drk [data-stam]")) { const [tm, i] = td.dataset.stam.split(":").map(Number); td.innerHTML = stamCell(tm, i); }
      for (const td of document.querySelectorAll(".drk [data-now]")) { const [tm, i] = td.dataset.now.split(":").map(Number); td.innerHTML = nowCell(tm, i, !!td.dataset.short); }
    };
    // 1.47: the recorder runs inside the page and is only replaced when the tab reloads; an older one has no
    // passes / tempo / stamina — say so instead of leaving them out silently
    const oldRecorder = () => {
      const s = lastStatus && lastStatus.st;
      return s && s.sh && !("rate" in s) ? `<div class="drk-warn" style="background:#78350f55;border-color:#fbbf2466;color:#fde68a">Reload this tab (⌘R) for passes, tempo and stamina — the plugin was updated; the recording carries on.</div>` : "";
    };
    const stripHtml = () => {
      const s = lastStatus && lastStatus.st, st = lastStatus;
      const { us, them, A, B } = sides();
      const sc = st && st.score ? `${st.score[us]}:${st.score[them]}` : "";
      const clock = st && st.t ? mmss(st.t) : "";
      const side = `<button data-side title="Show this in the side panel instead">→ side panel</button>`;
      const head = `<span class="us tm">${A}</span><span class="sc">${sc}</span><span class="th tm">${B}</span><span class="clk">${clock}</span>`;
      if (!s || !s.sh || !started()) return `<div class="drk-top">${head}${side}</div><div class="wait">Waiting for kick-off… The match stats, the agents and the timeline show here once the clock runs.</div>`;
      const plan = LIVE && LIVE.ok && LIVE.plan ? `<span title="our agents' plan and the match phase in their newest call (TRACE)" style="text-transform:none;letter-spacing:0;font-weight:500">plan <b class="us">${E(String(LIVE.plan).toUpperCase())}</b>${LIVE.pm ? ` · ${E(String(LIVE.pm).replace(/_/g, " ").toLowerCase())}` : ""}</span>` : "";
      const tabs = [["match", "Match"], ["agents", "Agents"], ["time", "Timeline"]].map(([k, l]) => `<span data-tab="${k}" class="${tab === k ? "on" : ""}">${l}</span>`).join("");
      let body;
      if (tab === "agents") { const th = agSide === "them";
        body = `<div class="drk-tog"><span data-ag="us" class="${th ? "" : "on"}">Our players</span><span data-ag="them" class="${th ? "on th" : ""}">Their players</span></div>
          <div class="drk-cards">${POSN.map((p, i) => agentCard(i, s, th ? them : us)).join("")}</div>${teamLine(s)}
          <div class="note"><span class="tg ag">AGENT</span> the player follows ${th ? "their" : "our"} agent's command · <span class="tg ai">AI</span> the game's built-in AI moves him · decisions per player, newest first${!th && LIVE && LIVE.recent ? ", with our rule's reason (TRACE)" : ""}${th ? " · their side is all from the game stream (no TRACE for them)" : ""}<br>actions: ${ACLEG}</div>`; }
      else if (tab === "time") body = timeline(s);
      else {
        const hg = tm => { let a = 0, n = 0; for (const k in s.hag || {}) if (+k.split(":")[0] === tm) { a += s.hag[k][0]; n += s.hag[k][1]; } return n ? Math.round(100 * a / n) : null; };
        const ha = [hg(us), hg(them)];
        body = `<div class="drk-cols2">
          <div>${bar("Shots", s.sh[us], s.sh[them])}
            ${bar(`<span title="sum over shots of the share of shots from that distance that went in (280 recorded matches)">xG guide</span>`, s.xg[us], s.xg[them], v => (v || 0).toFixed(2))}
            ${s.pos ? bar("Possession", s.pos[us], s.pos[them], v => v + "%") : ""}
            ${ha[0] != null && ha[1] != null ? bar(`<span title="of the time a team has the ball, the share its carrier follows an agent command (the rest: the built-in AI dribbles or passes)">Agent on the ball</span>`, ha[0], ha[1], v => v + "%") : ""}
            ${s.third ? bar(`<span title="share of play time the ball is in this side's attacking third">Ball in attacking third</span>`, s.third[us], s.third[them], v => v + "%") : ""}
            ${s.pass ? bar(`<span title="the ball's next holder is a teammate (shots left out)">Passes completed</span>`, s.pass[us], s.pass[them], v => v == null ? "—" : v + "%") : ""}
            ${s.won ? bar(`<span title="the ball taken from the other team: interceptions and tackles">Ball won</span>`, s.won[us], s.won[them]) : ""}
            ${oldRecorder()}</div>
          <div class="drk-mapc"><div class="drk-tog"><span data-map="shots" class="${mapMode === "shots" ? "on" : ""}">Shots</span><span data-map="ctl" class="${mapMode === "ctl" ? "on" : ""}">Live</span></div>
            ${mapMode === "ctl" ? `${ctlPitch()}<div class="note">● filled = agent command · ○ hollow = built-in AI · white ring = on the ball · ${A} attack →</div>`
              : `${shotMap(s.map, us)}<div class="note">○ agent shot · □ built-in AI shot · filled = goal · size = xG · ${A} attack →</div>`}</div>
        </div>`;
      }
      return `${healthLine()}<div class="drk-top">${head}<div class="drk-tabs">${tabs}</div><span class="drk-ball" id="drk-ball">${ballNow()}</span><span id="drk-tired">${tiredNow()}</span>${plan}${side}</div>
        ${goalRibbon(s)}${body}`;
    };
    // 1.51: the opponent's coach instructions this match, as a sequence (latest in bold). If the match
    // clock can be worked out from the live frames, each switch gets a minute mark.
    const coachRows = pm => {
      if (!COACH || !COACH.ok || !pm) return "";
      const oppSide = pm.home ? "away" : "home";
      const theirs = COACH.chat.filter(c => c.team === oppSide);
      const ours = COACH.chat.filter(c => c.team !== oppSide);
      if (!theirs.length && !ours.length) return "";
      // match-start epoch from the live reading (lastStatus.t seconds elapsed at lastStatus.lastWall)
      const start = lastStatus && lastStatus.lastWall && lastStatus.t > 0 ? lastStatus.lastWall - lastStatus.t * 1000 : null;
      const dur = (lastStatus && lastStatus.dur) || 120;
      const clock = ts => { if (start && ts > 1e12) { const s = Math.round((ts - start) / 1000); if (s >= -5 && s <= dur + 40) return `${Math.max(0, s)}s`; } return null; };
      const seq = list => list.map((c, i) => { const t = clock(c.ts), lab = INSTR[c.key] || c.key.replace(/_/g, " "),
        last = i === list.length - 1; return `<span${last ? ` class="hl"` : ""} title="${t ? E(t + " · ") : ""}${E(lab)}">${t ? `<span class="m">${t}</span> ` : ""}${E(lab)}</span>`; }).join(`<span class="m"> → </span>`);
      const their = theirs.length ? `<div class="kv w"><span title="every tactic the opponent's coach switched to this match, in order; the last is live now">Their tactics</span><span class="seq">${seq(theirs)}</span></div>` : "";
      const my = ours.length ? `<div class="kv w"><span>Our tactics</span><span class="seq m">${seq(ours)}</span></div>` : "";
      return their + my;
    };
    // 1.51: both agents' health in this match (/matches/<id>/agent-health) — the opponent's first.
    const SCLS = { healthy: "g", degraded: "o", unhealthy: "r", no_data: "m" };
    const healthRow = (r, label, muted) => {
      if (!r || r.status === "no_data") return "";   // 1.57: nothing to say
      const cls = SCLS[r.status] || "m", bits = [];
      if (r.sr != null) bits.push(`${r.sr}%`);
      if (r.lat != null) bits.push(`${r.lat} ms`);
      if (r.err) bits.push(`<span class="r">${r.err} err</span>`);
      const tip = `${r.name || label}: ${r.status}${r.sr != null ? `, success ${r.sr}%` : ""}${r.lat != null ? `, avg ${r.lat} ms${r.p99 != null ? ` / p99 ${r.p99} ms` : ""}` : ""}${r.cmds != null ? `, ${r.cmds} commands` : ""}${r.calls != null ? `, ${r.calls} calls` : ""}${r.err ? `, ${r.err} errors` : ""}`;
      return `<div class="kv"><span title="${E(tip)}">${label}</span><span${muted ? ` class="m"` : ""}><b class="${cls}">${r.status}</b>${bits.length ? ` <span class="m">· ${bits.join(" · ")}</span>` : ""}</span></div>`;
    };
    const healthRows = pm => {
      if (!HEALTH || !HEALTH.ok || !HEALTH.rows.length || !pm) return "";
      let their = HEALTH.rows.find(r => r.teamId === pm.oppId);
      let our = HEALTH.rows.find(r => r.teamId === pm.usId);
      if (!their && !our && HEALTH.rows.length === 2) {   // team ids did not match: fall back to home / away order
        const h = HEALTH.rows[0], a = HEALTH.rows[1];
        their = pm.home ? a : h; our = pm.home ? h : a;
      }
      return healthRow(their, "Their agent", false) + healthRow(our, "Our agent", true);
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
      const wr = ot ? pct(ot.w, ot.p) : null;
      const grp = H && H.group && H.group.teams.includes(nn(oppName)) ? H.group.name : null;   // 1.36: our group
      const ogrp = !grp && H && H.group && H.group.groups ? (Object.entries(H.group.groups).find(([, v]) => v.includes(nn(oppName))) || [])[0] : null;
      const chips = [grp ? `<span class="chip" style="background:#7c3aed;color:#fff" title="in our group: this match counts for the table">⚑ <b>Group ${E(grp)}</b></span>`
          : ogrp ? `<span class="chip" title="another group">Group ${E(ogrp)}</span>` : "",
        ot ? `<span class="chip">#<b>${ot.rank}</b> of ${H.lb.total || H.lb.teams.length}</span>` : "",
        wr != null ? `<span class="chip" title="their win rate in the tournament">WR <b class="${wr >= 60 ? "r" : wr >= 45 ? "o" : "g"}">${wr}%</b></span>` : ""].join("");
      const wc = H ? winChance(H.lb, ot, ms, FORM && FORM.ok ? FORM.all.wr : null) : null;
      const wcp = wc ? Math.round(100 * wc.w) : null;
      const wcChip = wc ? `<span class="chip" title="our win chance: estimate from both win rates and our record against them">win chance <b class="${wcp >= 60 ? "g" : wcp >= 40 ? "o" : "r"}">${wcp}%</b></span>` : "";
      const wcRow = wc ? `<div class="kv"><span title="estimate: both teams' win rates (log5) and our record against them">Our win chance</span><span><b class="${wcp >= 60 ? "g" : wcp >= 40 ? "o" : "r"}">${wcp}%</b></span></div>
          <div class="br" style="grid-template-columns:1fr;margin:3px 0 1px"><div class="t"><i style="width:${100 * wc.w}%;background:#4ade80"></i><i style="width:${100 * wc.d}%;background:#fbbf24"></i><i style="width:${100 * wc.l}%;background:#f87171"></i></div></div>
          <div class="note" style="margin:0 0 4px" title="decimal odds = 1 / chance: what a fair bet would pay">win ${wcp}% · draw ${Math.round(100 * wc.d)}% · lose ${Math.round(100 * wc.l)}% · odds ${wc.odds.join(" / ")}</div>` : "";
      // 1.56: the panel keeps what matters before and during the match — win chance, their place and win rate (chips),
      // our record against them, their form and tactics; the rest (odds, styles, agent health, ping) sits under
      // "More" (closed by default), the recording is a dot by the name, Auto-START shows only before kick-off.
      const recOn = st => st && st.lastWall && Date.now() - st.lastWall < 8000;
      const h2h = `<div class="kv"><span title="our wins-draws-losses against them, goals for:against">Our record vs them</span><span>${ms.length ? `<b class="${w > l ? "g" : w < l ? "r" : "o"}">${w}-${d}-${l}</b> <span class="m">· ${gf}:${ga}</span>` : `<span class="m">${H ? "never played" : "…"}</span>`}</span></div>
          ${formRows("last5")}
          ${last ? `<div class="kv"><span>Last vs us</span><span>${last.us}:${last.them}${last.version ? ` <span class="m">· ${E(last.version)}</span>` : ""}</span></div>` : ""}
          ${coachRows(pm)}`;
      const formBody = `${wcRow}
          ${ot ? `<div class="kv"><span>Their record</span><span><b class="${wr >= 60 ? "r" : wr >= 45 ? "o" : "g"}">${wr}%</b> <span class="m">· ${ot.w}-${ot.d}-${ot.l}</span></span></div>` : ""}
          ${formRows("rest")}`;
      const styleBody = styleTable();
      const hlth = healthRows(pm);
      const ag = (PING && PING.agents) || [];
      const hasMatch = !!(pm && ((pm.us || []).some(v => v != null) || (pm.them || []).some(v => v != null)));
      const rows = POSN.map((p, i) => { const a = ag.find(x => x.pos === i) || {};
        return `<tr><td>${roleOf(i)}</td>${hasMatch ? `<td>${lat(pm.us ? pm.us[i] : null)}</td><td>${lat(pm.them ? pm.them[i] : null)}</td>` : ""}<td>${lat(a.latency_ms)}</td><td>${lat(a.p99_latency_ms)}</td></tr>`; }).join("");
      const obsAt = PING && PING.fetched ? new Date(PING.fetched).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "";
      const pingBody = `${hlth}<table class="pt"><tr><th></th>${hasMatch ? "<th>match</th><th>them</th>" : ""}<th title="average latency of our agents, portal figures">avg</th><th title="1 call in 100 is slower than this">p99</th></tr>${rows}</table>
          <div class="note">our agents' ping, ms · avg / p99: portal, recent hours${obsAt ? ` (${obsAt})` : ""}${!hasMatch && pm && pm.status !== "completed" ? " · this match's figures after full time" : ""}</div>`;
      const st = lastStatus;
      const rec = st && st.n ? `<span class="rec ${recOn(st) ? "g" : "o"}" title="recording: ${Math.round(st.t || 0)} s · ${Number(st.n).toLocaleString("en-GB")} frames${st.t0 > 3 ? ` · from ${Math.round(st.t0)} s` : ""}">● REC</span>`
        : `<span class="rec m" title="the recording starts with the game's frames">○ REC</span>`;
      const aa = H && H.autoAccept && H.autoAccept.on && Date.now() < (H.autoAccept.until || 0);
      const foot = [st && st.n ? `<span class="${recOn(st) ? "g" : "o"}">●</span> recording ${Math.round(st.t || 0)} s${st.t0 > 3 ? ` <span class="o">· from ${Math.round(st.t0)} s</span>` : ""}` : "",
        autoOn && !started() ? `Auto-START: <span class="${autoDone ? "g" : "o"}">${E(autoLast || (autoDone ? "done" : "waiting"))}</span>` : "",
        aa ? `auto-accept <span class="g">on</span>` : ""].filter(Boolean).join(" · ");
      const sc = st && st.score ? (() => { const { us } = sides(); return `${st.score[us]}:${st.score[1 - us]}`; })() : "";
      box.className = "drk" + (folded ? " folded" : "");
      box.innerHTML = `<div class="hd"><span class="nm" title="${E(oppName)}">${E(oppName)}</span>${folded && sc ? `<b>${sc}</b>` : ""}${rec}
          <button data-fold title="${folded ? "Show the panel" : "Fold, show the Coach Live Feed"}">${folded ? "▸" : "▾"}</button></div>
        <div class="chips">${wcChip}${chips}</div>
        <div class="bd">
          ${sec("opp", "Head to head", h2h)}
          ${stripOn ? "" : `${sec("live", "This match", statBody(), st && st.score ? `<b style="color:#e5e7eb;font-size:12px">${sc}</b>` : "")}
          ${sec("agents", "Agents live", healthLine() + liveBody())}
          ${!stripPref ? `<div class="note"><span class="lnk" data-under>↙ show under the game</span></div>` : ""}`}
          ${formBody.trim() ? sec("form", "Their form", formBody) : ""}
          ${styleBody ? sec("style", "Play style", styleBody) : ""}
          ${sec("agx", "Agents &amp; ping", pingBody)}
          ${foot ? `<div class="foot">${foot}</div>` : ""}
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
      closed[s.dataset.sec] = !isClosed(s.dataset.sec);
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
      if (m !== mid) { unmount(); mid = m; PING = null; LIVE = null; FORM = null; COACH = null; HEALTH = null; if (m) { loadH(); loadPing(); loadCoach(); } }
      if (!m) return;
      if (box && box.isConnected) return;
      const card = findCard();
      if (!card) return;
      {   // 1.58: a plugin update re-injects this script into open tabs — refresh the old copy's styles too
        const sEl = document.getElementById("drk-panel-css") || document.createElement("style"); sEl.id = "drk-panel-css";
        if (sEl.textContent !== css) sEl.textContent = css;
        if (!sEl.isConnected) (document.head || document.documentElement).appendChild(sEl);
      }
      // a panel left by a copy of this script from before an extension reload: take its place
      const stale = card.querySelector("#drk-panel");
      if (stale) stale.remove();
      host = card;
      for (const ch of host.children) if (ch.dataset.drkDisplay === undefined) ch.dataset.drkDisplay = ch.style.display || "";
      box = document.createElement("div");
      box.id = "drk-panel";
      box.addEventListener("click", onPanelClick); box.addEventListener("mousemove", onTipMove); box.addEventListener("mouseleave", () => tipShow("", null));
      card.appendChild(box);
      layout(); render();
    };
    const loadH = () => { try { chrome.runtime.sendMessage({ type: "panel-h2h" }, r => { if (r && r.ok) { H = r; render(); } }); } catch (e) {} };
    const loadPing = () => { if (mid) pingNow(mid).then(r => { if (r && r.ok) { PING = r; render(); loadForm(); } }).catch(() => {}); };
    const loadLive = () => {
      if (!mid || !alive() || document.visibilityState !== "visible") return;
      if (lastStatus && lastStatus.lastWall && Date.now() - lastStatus.lastWall > 60000) return;   // match over
      try { chrome.runtime.sendMessage({ type: "live-trace", matchId: mid }, r => { if (!chrome.runtime.lastError && r) { LIVE = r;
        if (r.roles && Object.keys(r.roles).length) { ROLES = { ...ROLES, ...r.roles }; try { localStorage.setItem("__drk_roles", JSON.stringify(ROLES)); } catch (e) {} }
        render(); } }); } catch (e) {}
    };
    // 1.51: the opponent's coach instructions and both agents' health, re-read every ~8 s during the
    // match (not gated on tab focus, unlike the TRACE read — these are two cheap portal GETs, so the
    // health row stays current even when the viewer is in a background tab), once more after the whistle.
    const loadCoach = () => {
      if (!mid || !alive()) return;
      const over = !!(lastStatus && lastStatus.lastWall && Date.now() - lastStatus.lastWall > 60000);
      if (over && COACH && COACH.id === mid && Date.now() - COACH.at < 30000) return;   // settled: one last read is enough
      coachFeed(mid).then(r => { if (r && r.ok) { COACH = r; render(); } }).catch(() => {});
      matchHealth(mid).then(r => { if (r && r.ok) { HEALTH = r; render(); } }).catch(() => {});
    };
    {   // bridge.js runs only on the portal (manifest), on every page of it
      setInterval(mount, 1500);
      setInterval(() => { if (mid) render(); }, 2000);
      setTimeout(() => { if (mid) { loadH(); loadPing(); } }, 1500);
      setInterval(() => { if (mid) loadH(); }, 60000);
      setInterval(loadPing, 30000);
      setInterval(loadLive, 15000);
      setTimeout(loadLive, 3000);
      setInterval(loadCoach, 8000);
      setTimeout(loadCoach, 2500);
    }
  }

  // ---- Find Match list (1.20): next to each team, its place, win rate and our record against it.
  // The list is React's and is redrawn on every search keystroke, so the badges are re-added
  // every 400 ms to rows that lost them (only inside the "Find match" dialog).
  {
    let HB = null, hbAt = 0, AV = null, avAt = 0;
    const nb = n => String(n || "").replace(/\s*\((\u043b\u044e\u0434\u0438\u043d\u0430|human)\)/i, "").trim().toLowerCase();
    const groupOf = (G, key) => { if (!G || !G.groups) return null; for (const [k, v] of Object.entries(G.groups)) if (v.includes(key)) return k; return null; };
    const E2 = x => String(x ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const loadHB = () => { try { chrome.runtime.sendMessage({ type: "panel-h2h" }, r => { if (r && r.ok) { HB = r; hbAt = Date.now(); } }); } catch (e) {} };
    // 1.51: who can be challenged right now (/events/<tournament>/available-teams): each team's
    // online / busy / ready flags, keyed by name, refreshed every ~15 s while the dialog is open.
    // The tournament id comes from the panel data when it is fresh, else from /teams/mine (the panel
    // data is only rewritten on a portal sync, which is throttled to once every 3 min).
    let avTourn = null;
    const loadAV = async () => {
      let token = null;
      try { token = localStorage.getItem("world_cup_team_token"); } catch (e) {}
      if (!token) return;
      try {
        let T = (HB && HB.lb && HB.lb.tournament) || avTourn;
        if (!T) {
          const m = await fetch(API + "/teams/mine", { headers: { Authorization: "Bearer " + token } });
          if (m.ok) { const t = ((await m.json()).items || [])[0]; T = t && t.tournament_id; avTourn = T || null; }
        }
        if (!T) return;
        const r = await fetch(`${API}/events/${encodeURIComponent(T)}/available-teams`, { headers: { Authorization: "Bearer " + token } });
        if (!r.ok) return;
        const map = {};
        for (const x of (await r.json()).items || [])
          map[nb(x.team_name)] = { busy: !!x.busy, ready: x.ready !== false };
        AV = map; avAt = Date.now();
      } catch (e) {}
    };
    // available-teams is the portal's own "who can I challenge now" list, so a team in it is playable
    // right now (the agents are always-on; the `online` field tracks the human owner, not the agent, so
    // it is ignored). In the list and free → green "● free"; busy → amber "● in match"; no agent yet →
    // muted "○ no agent"; not in the list at all → muted "○ offline". null until the list has loaded.
    const avMark = name => {
      if (!AV) return null;
      const a = AV[nb(name)];
      // a team shown in the list is already free to challenge (the dialog greys out the rest), so a "free"
      // mark would only repeat what the row already says. The one worth flagging is a listed team that is
      // busy in a match right now — challenge it and you wait. Everything else gets no mark.
      if (a && a.busy) return { html: `<span class="o">● in match</span>`, tip: "in a match now" };
      return null;
    };
    const css2 = `
      .drk-badge{margin-left:10px;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#94a3b8;white-space:nowrap;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;letter-spacing:0}
      .drk-badge b{font-weight:700}.drk-badge .g{color:#4ade80}.drk-badge .o{color:#fbbf24}.drk-badge .r{color:#f87171}
      .drk-badge .rk{color:#22d3ee;font-weight:700}
      .drk-badge .grp{padding:1px 6px;border-radius:4px;background:#7c3aed;color:#fff;font-weight:700}
      .drk-badge .ogrp{padding:0 5px;border-radius:4px;border:1px solid #475569;color:#94a3b8;font-weight:700}`;
    // 1.25: overall win rate, their record against us and, in brackets, how often they beat us
    // ("#24 · 43% · vs us 3-0-3 (50%)"); goals and the last result go into the tooltip.
    const badge = name => {
      const key = nb(name);
      const t = HB.lb && (HB.lb.teams || []).find(x => nb(x.name) === key);
      const ms = Object.values(HB.matches || {}).filter(m => nb(m.opp) === key)
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const g = HB.group && HB.group.teams.includes(key) ? HB.group.name : null;   // 1.36: our group
      const og = !g ? groupOf(HB.group, key) : null;                                    // 1.42: another group
      const av = avMark(name);                                                          // 1.51: online / busy / free
      if (!t && !ms.length && !g && !og && !av) return null;
      const parts = [], tip = [name];
      if (av) { parts.push(av.html); tip.push(av.tip); }
      // 1.47: shorter (a long name + group + win ran past the row): "⚑ D", no "(vs %)" — it is in the tooltip
      if (g) { parts.push(`<span class="grp">⚑ ${E2(g)}</span>`); tip.push(`in our group ${g}: this match counts for the table`); }
      else if (og) { parts.push(`<span class="ogrp">${E2(og)}</span>`); tip.push(`group ${og} (not ours)`); }
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
        parts.push(`vs us <b class="${cls}">${l}-${d}-${w}</b>`);
        tip.push(`vs us: they won ${l} of ${ms.length} (${vs}%); our record ${w}-${d}-${l}, goals ${gf}:${ga}, last ${last.us}:${last.them}`);
      } else { parts.push("vs us —"); tip.push("never played us"); }
      const wc = winChance(HB.lb, t, ms, null);   // 1.43
      if (wc && t) { const p = Math.round(100 * wc.w);
        parts.push(`win <b class="${p >= 60 ? "g" : p >= 40 ? "o" : "r"}">${p}%</b>`);
        tip.push(`our win chance ${p}% · draw ${Math.round(100 * wc.d)}% · lose ${Math.round(100 * wc.l)}% (odds ${wc.odds.join(" / ")})`); }
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
      if (Date.now() - avAt > 15000) { avAt = Date.now(); loadAV(); }
      {   // 1.58: a plugin update re-injects this script into open tabs — refresh the old copy's styles too
        const sEl = document.getElementById("drk-badge-css") || document.createElement("style"); sEl.id = "drk-badge-css";
        if (sEl.textContent !== css2) sEl.textContent = css2;
        if (!sEl.isConnected) (document.head || document.documentElement).appendChild(sEl);
      }
      const names = new Set(((HB.lb && HB.lb.teams) || []).map(t => nb(t.name)));
      for (const m of Object.values(HB.matches || {})) names.add(nb(m.opp));
      for (const g of (HB.group && HB.group.teams) || []) names.add(g);
      for (const v of Object.values((HB.group && HB.group.groups) || {})) for (const g of v) names.add(g);
      const w = document.createTreeWalker(dlg, NodeFilter.SHOW_TEXT);
      const hits = [];
      let n;
      while ((n = w.nextNode())) {
        const el = n.parentElement;
        if (!el || el.closest(".drk-badge") || !names.has(nb(n.nodeValue))) continue;
        hits.push([el, n.nodeValue]);
      }
      const avStamp = String(avAt);   // 1.51: re-badge a row when its availability was refreshed (free ↔ in match)
      for (const [el, name] of hits) {
        const next = el.nextElementSibling;
        if (next && next.classList.contains("drk-badge") && next.dataset.team === nb(name) && next.dataset.av === avStamp) continue;
        if (next && next.classList.contains("drk-badge")) next.remove();   // the row now shows another team, or availability changed
        const bd = badge(name);
        if (!bd) continue;
        const b = document.createElement("span");
        b.className = "drk-badge"; b.dataset.team = nb(name); b.dataset.av = avStamp; b.innerHTML = bd.html; b.title = bd.title;
        el.insertAdjacentElement("afterend", b);
      }
    }, 400);
  }

  // ---- Group chips on every portal page (1.42): next to a team's name on the leaderboard, in match lists, in the
  // challenge banner — purple "⚑ D" for our group, grey "B" for another group (when every group is loaded).
  // Not on the match viewer (it has the panel) and not in Find match (its badge already says it).
  {
    let HG = null, hgAt = 0;
    const nb = n => String(n || "").replace(/\s*\((\u043b\u044e\u0434\u0438\u043d\u0430|human)\)/i, "").trim().toLowerCase();
    const loadHG = () => { try { chrome.runtime.sendMessage({ type: "panel-h2h" }, r => { if (r && r.ok) { HG = r.group || null; hgAt = Date.now(); } }); } catch (e) {} };
    const css3 = `.drk-gchip{display:inline-block;margin-left:8px;padding:0 6px;border-radius:4px;font:700 11px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0;vertical-align:middle;white-space:nowrap;text-transform:none}
      .drk-gchip.mine{background:#7c3aed;color:#fff}.drk-gchip.other{border:1px solid #475569;color:#94a3b8}`;
    setInterval(() => {
      if (!alive() || /\/viewer|\/report/.test(location.pathname) || document.visibilityState !== "visible") return;
      if (!HG || Date.now() - hgAt > 60000) { loadHG(); if (!HG) return; }
      const map = new Map();
      for (const [k, v] of Object.entries(HG.groups || {})) for (const t of v) map.set(t, k);
      for (const t of HG.teams || []) map.set(t, HG.name);
      if (!map.size) return;
      {   // 1.58: a plugin update re-injects this script into open tabs — refresh the old copy's styles too
        const sEl = document.getElementById("drk-gchip-css") || document.createElement("style"); sEl.id = "drk-gchip-css";
        if (sEl.textContent !== css3) sEl.textContent = css3;
        if (!sEl.isConnected) (document.head || document.documentElement).appendChild(sEl);
      }
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      let n;
      while ((n = w.nextNode())) {
        const v = n.nodeValue; if (!v || v.length > 60) continue;
        const k = nb(v); if (!map.has(k)) continue;
        const el = n.parentElement;
        if (!el || el.closest(".drk,.drk-badge,.drk-gchip,input,textarea,[contenteditable],title,script,style")) continue;
        if (el.nextElementSibling && el.nextElementSibling.classList.contains("drk-badge")) continue;   // Find match row
        hits.push([el, k]);
      }
      for (const [el, k] of hits) {
        const g = map.get(k), mine = g === HG.name;
        // inline name: the chip goes right after it; a cell / block that holds only the name: inside, at its end
        const inside = !/^inline/.test(getComputedStyle(el).display);
        const cur = inside ? el.querySelector(":scope > .drk-gchip") : (el.nextElementSibling && el.nextElementSibling.classList.contains("drk-gchip") ? el.nextElementSibling : null);
        if (cur && cur.dataset.team === k) continue;
        if (cur) cur.remove();
        const c = document.createElement("span");
        c.className = "drk-gchip " + (mine ? "mine" : "other"); c.dataset.team = k;
        c.textContent = mine ? `⚑ ${g}` : g; c.title = mine ? `our group ${g}` : `group ${g}`;
        if (inside) el.appendChild(c); else el.insertAdjacentElement("afterend", c);
      }
    }, 1500);
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
