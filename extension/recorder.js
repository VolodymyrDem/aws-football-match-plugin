// Runs in the page itself (MAIN world) before any portal code, on every
// agentic-football.aws.dev page, so the game socket is always hooked in time.
// Each game-state frame (MessagePack after a 5-byte header, ~40/s) becomes one row:
// [wall_ms, tick, gameTime, f2, scoreHome, scoreAway,
//  ballX, ballH, ballZ, velX, velH, velZ, ballFree, holderIdx, holderTeam,
//  then per player: idx, team, x, z, actionCode]   (server frame, goal lines at ±6.5)
// actionCode indexes `acts` (the players' lastAction names). Commentary lines from the
// viewer go to `comm` as [gameTime, text]. Saved as
// {"v": 4, "id": <match id>, "acts": [...], "rows": [...], "comm": [...],
//  "full": [[wall_ms, window, frame], ...], "other": {kind: {n, first: [...]}},
//  "sent": {kind: {n, first: [...]}}, "meta": {...}}.
// v3 (1.1): a reload or a dropped socket mid-match no longer starts from zero — the
// recording so far is kept gzipped in sessionStorage and picked up again.
// v4 (1.2): `rows` keep only a few fields of each frame, so the whole decoded frame is
// kept too: every 10th frame (window = 0), plus the 40 frames before and after every
// score change (window = 1) and every shot or keeper jump (window = 2: a player's action
// turns ShootAtGoal / CoachShoot / GoalkeeperJump). Messages that are not game state and what the viewer sends are kept
// (first 30 of each kind, and a count). `meta`: socket opens/closes, page header text.
// 1.4: `events` = the viewer's own game events ("unity-event": goals, match end...) as
// [wall_ms, gameTime, detail]; the stored copy and the popup status follow the frame count
// (timers of a hidden tab can be slowed to once a minute); optional `xrows` (see XP).
// Auto-START (1.10+) lives in bridge.js since 1.12.
// Nothing leaves the browser except through the extension's own download.
(() => {
  if (window.__drunkardsRec) return;
  window.__drunkardsRec = true;
  const GAME_HOST = "game.agentic-football.aws.dev";
  const STORE = "__rec_v3";
  const FULL_EVERY = 10, RING = 40, FIRST_PER_KIND = 30;
  const FULL_BUDGET = 5e6, FULL_HARD = 9e6;   // raw JSON chars kept in `full`
  const SHOT_ACTS = new Set(["ShootAtGoal", "CoachShoot", "GoalkeeperJump"]);
  // Extra fields copied from every frame into `xrows` = [tick, ...XG values, then XP values
  // per player in frame order]. Empty until map_fields.py tells which raw paths hold
  // stamina / sprint / velocity / server time (e.g. XP = ["3.0", "4"], XG = ["7"]).
  // 1.28: mapped with map_fields.py on two matches (|r| ≥ 0.97 against TRACE): 5 = stamina,
  // 13 = isSprinting, 3.0 / 3.1 = velocity x / y (≈ 8.5 × raw = TRACE vx / vy).
  const XP = ["5", "13", "3.0", "3.1"], XG = [];
  let rows = [];
  let comm = [];
  let matchId = null;
  let stopped = false;    // set by the toolbar button: stop recording this match
  let restoring = false;  // reading the stored copy back after a reload
  let acts = [], actIdx = {};
  // v4 extras: whole frames, other socket messages, what the viewer sends, page info.
  let full = [], fullChars = 0, ring = [], after = 0, afterFlag = 1, nFrames = 0, prevScore = null, prevAct = {};
  let other = {}, sent = {}, meta = {}, events = [], xrows = [];

  const fresh = () => {
    full = []; fullChars = 0; ring = []; after = 0; afterFlag = 1; nFrames = 0; prevScore = null; prevAct = {};
    other = {}; sent = {}; events = []; xrows = [];
    meta = { ext: "1.28", page: location.pathname, opened: [], closed: [], header: "" };

  };
  fresh();
  const code = s => (s in actIdx ? actIdx[s] : (actIdx[s] = acts.push(s) - 1));
  const lastTime = () => (rows.length ? rows[rows.length - 1][2] : 0);

  const mp = (u, pos) => {
    const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    let p = pos;
    const td = new TextDecoder();
    const str = n => { const s = td.decode(u.subarray(p, p + n)); p += n; return s; };
    const arr = n => { const a = []; for (let i = 0; i < n; i++) a.push(r()); return a; };
    const map = n => { const o = {}; for (let i = 0; i < n; i++) { const k = r(); o[k] = r(); } return o; };
    function r() {
      const b = u[p++];
      if (b <= 0x7f) return b;
      if (b >= 0xe0) return b - 256;
      if ((b & 0xf0) === 0x90) return arr(b & 15);
      if ((b & 0xf0) === 0x80) return map(b & 15);
      if ((b & 0xe0) === 0xa0) return str(b & 31);
      let v;
      switch (b) {
        case 0xc0: return null;
        case 0xc2: return false;
        case 0xc3: return true;
        case 0xca: v = dv.getFloat32(p); p += 4; return v;
        case 0xcb: v = dv.getFloat64(p); p += 8; return v;
        case 0xcc: return u[p++];
        case 0xcd: v = dv.getUint16(p); p += 2; return v;
        case 0xce: v = dv.getUint32(p); p += 4; return v;
        case 0xcf: v = Number(dv.getBigUint64(p)); p += 8; return v;
        case 0xd0: return dv.getInt8(p++);
        case 0xd1: v = dv.getInt16(p); p += 2; return v;
        case 0xd2: v = dv.getInt32(p); p += 4; return v;
        case 0xd9: return str(u[p++]);
        case 0xda: v = dv.getUint16(p); p += 2; return str(v);
        case 0xdc: v = dv.getUint16(p); p += 2; return arr(v);
        case 0xdd: v = dv.getUint32(p); p += 4; return arr(v);
        case 0xde: v = dv.getUint16(p); p += 2; return map(v);
        case 0xc4: v = u[p++]; p += v; return null;
        case 0xc5: v = dv.getUint16(p); p += 2 + v; return null;
        case 0xc6: v = dv.getUint32(p); p += 4 + v; return null;
        case 0xd3: v = Number(dv.getBigInt64(p)); p += 8; return v;
        case 0xdb: v = dv.getUint32(p); p += 4; return str(v);
        case 0xdf: v = dv.getUint32(p); p += 4; return map(v);
        case 0xd4: p += 2; return null;
        case 0xd5: p += 3; return null;
        case 0xd6: p += 5; return null;
        case 0xd7: p += 9; return null;
        case 0xd8: p += 17; return null;
        case 0xc7: v = u[p++]; p += 1 + v; return null;
        default: throw new Error("msgpack tag " + b);
      }
    }
    return r();
  };
  // 3 decimals (1.2+; was 2): 0.01 server units is 0.085 on the ±55 pitch, which made speeds
  // taken over a few frames wrong by up to ~3 units/s (a run is 8.5).
  const R = x => (typeof x === "number" ? Math.round(x * 1000) / 1000 : x);
  // Whole decoded value with numbers rounded to 3 places (keeps file size sane).
  const deep = x => {
    if (typeof x === "number") return Number.isInteger(x) ? x : Math.round(x * 1000) / 1000;
    if (Array.isArray(x)) return x.map(deep);
    if (x && typeof x === "object") { const o = {}; for (const k in x) o[k] = deep(x[k]); return o; }
    return x;
  };
  const hex = (u, n) => Array.from(u.subarray(0, n), b => b.toString(16).padStart(2, "0")).join("");
  // First FIRST_PER_KIND messages of each kind, each cut to 4000 chars of JSON, and a count.
  const keepKind = (store, kind, value) => {
    if (!store[kind] && Object.keys(store).length >= 40) kind = "more-kinds";
    const k = store[kind] || (store[kind] = { n: 0, first: [] });
    k.n++;
    if (k.first.length >= FIRST_PER_KIND) return;
    let s;
    try { s = JSON.stringify(deep(value)); } catch (e) { s = String(value); }
    k.first.push([Date.now(), lastTime(), s.length > 4000 ? s.slice(0, 4000) + "…" : s]);
  };
  const describe = data => {
    if (typeof data === "string") {
      let v = data;
      try { v = JSON.parse(data); } catch (e) {}
      const t = v && typeof v === "object" && (v.type || v.event || v.action);
      return ["text" + (t ? ":" + String(t).slice(0, 40) : ""), v];
    }
    const u = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
    if (!u) return ["unknown", String(data)];
    let v;
    for (const off of [5, 0]) {
      try { v = mp(u, off); return ["bin" + off + ":" + hex(u, 1) + (Array.isArray(v) && (typeof v[0] === "string" || (Number.isInteger(v[0]) && v[0] >= 0 && v[0] < 64)) ? ":" + String(v[0]).slice(0, 20) : ""), v]; }
      catch (e) {}
    }
    return ["raw:" + hex(u, 1), { len: u.length, head: hex(u, 64) }];
  };
  const pick = (v, path) => {
    for (const k of String(path).split(".")) v = v == null ? null : v[k];
    return typeof v === "boolean" ? (v ? 1 : 0) : v;
  };
  const keepFull = (entry, len) => { full.push(entry); fullChars += len; return entry; };

  const onFrame = async data => {
    if (stopped) return;
    const buf = data instanceof Blob ? await data.arrayBuffer() : data;
    if (!(buf instanceof ArrayBuffer)) {
      try { const [k, v] = describe(data); keepKind(other, k, v); } catch (e) {}
      return;
    }
    const u = new Uint8Array(buf);
    let g = null;
    if (u.length >= 200) {
      try {
        g = mp(u, 5)[1];
        const b = g[5];
        const row = [Date.now(), g[0], R(g[1]), R(g[2]), g[4][0], g[4][1],
          R(b[0][0]), R(b[0][1]), R(b[0][2]), R(b[1][0]), R(b[1][1]), R(b[1][2]),
          b[2] ? 1 : 0, b[3] == null ? -1 : R(b[3]), R(b[6])];
        for (const pl of g[6] || []) row.push(pl[0], pl[1], R(pl[2][0]), R(pl[2][1]), code(String(pl[8])));
        rows.push(row);
        ctlAdd(g);
        statAdd(row);
        if (rows.length % 200 === 0) persist();        // ~5 s of play, even in a throttled tab
        if (rows.length % 80 === 0) postStatus();
      } catch (e) { g = null; /* not a game-state frame */ }
    }
    if (!g) {
      try { const [k, v] = describe(buf); keepKind(other, k, v); } catch (e) {}
      return;
    }
    if (XP.length || XG.length) {
      try {
        const xr = [g[0], ...XG.map(p => R(pick(g, p)))];
        for (const pl of g[6] || []) for (const p of XP) xr.push(R(pick(pl, p)));
        xrows.push(xr);
      } catch (e) {}
    }
    // v4: the whole frame, sampled, and all of it around every score change and shot.
    try {
      nFrames++;
      const d = deep(g);
      const len = JSON.stringify(d).length;
      const score = String(g[4]);
      const goal = prevScore !== null && score !== prevScore;
      prevScore = score;
      let shot = false;
      for (const pl of g[6] || []) {
        const k = pl[1] + ":" + pl[0], a = String(pl[8]);
        if (SHOT_ACTS.has(a) && prevAct[k] !== undefined && prevAct[k] !== a) shot = true;
        prevAct[k] = a;
      }
      const flag = goal ? 1 : shot ? 2 : 0;
      if (flag && fullChars < FULL_HARD) {
        for (const e of ring) {
          if (!e.kept) { e.kept = true; e.arr = keepFull([e.w, flag, e.d], e.len); }
          else if (goal && e.arr) e.arr[1] = 1;   // the shot before a goal counts as the goal's
        }
        if (goal || after <= 0 || afterFlag !== 1) afterFlag = flag;   // a goal window stays a goal window
        after = RING;
      }
      const entry = { w: Date.now(), d, len, kept: false };
      if (after > 0 && fullChars < FULL_HARD) { after--; entry.kept = true; entry.arr = keepFull([entry.w, afterFlag, d], len); }
      else if (nFrames % FULL_EVERY === 1 && fullChars < FULL_BUDGET) { entry.kept = true; entry.arr = keepFull([entry.w, 0, d], len); }
      ring.push(entry);
      if (ring.length > RING) ring.shift();
      if (!meta.header || nFrames % 1200 === 0) grabHeader();
    } catch (e) { /* extras must never break the main recording */ }
  };

  // Text at the top of the viewer (team names, score, clock), for knowing who played.
  const grabHeader = () => {
    try {
      const t = ((document.body && document.body.innerText) || "").replace(/\s+\n/g, "\n").trim();
      const i = t.indexOf("COMMENTARY");
      meta.header = (i > 0 ? t.slice(0, i) : t).slice(0, 600);
      meta.title = document.title;
    } catch (e) {}
  };

  // Commentary panel of the viewer: new complete lines, tagged with the game time.
  const seen = new Set();
  const skip = /^(Live|Stop Claude|Mute audio|Unmute audio|Claude is active in this tab group|Open chat|Dismiss)$/;
  setInterval(() => {
    if (!matchId || stopped) return;
    const txt = (document.body && document.body.innerText) || "";
    const i = txt.indexOf("COMMENTARY");
    if (i < 0) return;
    for (const raw of txt.slice(i + 10).split("\n")) {
      const s = raw.trim();
      if (!s || skip.test(s) || /[▋▌█|_]$/.test(s) || seen.has(s)) continue;
      seen.add(s);
      comm.push([lastTime(), s]);
    }
  }, 700);

  const dump = () => JSON.stringify({ v: 4, id: matchId, acts, rows, comm, full, other, sent, meta, events,
    ...(XP.length || XG.length ? { xcols: { XG, XP }, xrows } : {}) });

  // The viewer's own game events (the portal listens to the same "unity-event").
  window.addEventListener("unity-event", ev => {
    try {
      if (!matchId || stopped || events.length >= 3000) return;
      events.push([Date.now(), lastTime(), deep(JSON.parse(JSON.stringify(ev.detail ?? null)))]);
    } catch (e) {}
  });

  async function gzipB64(text) {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
    const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  async function gunzipB64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }

  // Gzipped copy in sessionStorage (a full match is ~3 MB raw, ~0.3 MB gzipped): survives a
  // reload of the viewer and is what the report page saves if the viewer never could.
  let persisting = false;
  const persist = async () => {
    if (!matchId || rows.length < 100 || restoring || persisting) return;
    persisting = true;
    try {
      const b64 = await gzipB64(dump());
      sessionStorage.setItem(STORE, JSON.stringify({ id: matchId, n: rows.length, b64 }));
    } catch (e) { /* quota or no storage: the live save still carries everything */ }
    persisting = false;
  };
  setInterval(persist, 5000);

  // ---- Agent control (1.27): a player whose action is Coach* (CoachMoveTo, CoachShoot...) is
  // carrying out an agent's command; anything else (CoverZone, ChaseBall...) is the game's own AI
  // filling in. Per player of both teams: the share of the last 30 s under an agent command, and
  // for how long the player has been without one (0 while a command runs; an agent repeating the
  // same command shows as one long Coach* action, so "new command" times are not visible).
  const CTL_WIN = 30;
  let ctl = {};
  const ctlAdd = g => {
    const sec = Math.floor(Date.now() / 1000);
    for (const pl of g[6] || []) {
      const k = pl[1] + ":" + pl[0], a = String(pl[8]), on = a.startsWith("Coach");
      const c = ctl[k] || (ctl[k] = { b: [], last: null });
      let b = c.b[c.b.length - 1];
      if (!b || b[0] !== sec) { b = [sec, 0, 0]; c.b.push(b); if (c.b.length > CTL_WIN + 1) c.b.shift(); }
      b[2]++; if (on) b[1]++;
      if (on) c.last = Date.now();
    }
  };
  const ctlNow = () => {
    const out = {}, now = Math.floor(Date.now() / 1000);
    for (const k in ctl) {
      let on = 0, all = 0;
      for (const [sec, n, t] of ctl[k].b) if (now - sec < CTL_WIN) { on += n; all += t; }
      out[k] = [all ? Math.round(100 * on / all) : null, ctl[k].last ? Math.round((Date.now() - ctl[k].last) / 1000) : null];
    }
    return out;
  };

  // ---- Live match stats (1.28) from the rows: shots (an agent or the game turning a player to
  // ShootAtGoal / CoachShoot), possession (frames each team holds the ball), the share of play
  // the ball spends in each team's attacking third, and an xG guide from shot distance (table
  // fitted on 280 recorded matches, 27.10: share of shots followed by a goal within 4 s).
  const XG_BY_M = [0.58, 0.28, 0.28, 0.22, 0.2, 0.2, 0.13, 0.05, 0.05, 0.05];
  const SHOOT = new Set(["ShootAtGoal", "CoachShoot"]);
  let st = null;
  // 1.34: every shot for the panel's shot map — [gameTime, team, playerIdx, x, z, xg, goal], x / z in the
  // shooter's frame (attacking +x towards the goal at x = 6.5); goal = 1 when that team scored within 4 s.
  const statReset = () => { st = { dir: 0, sh: [0, 0], xg: [0, 0], hold: [0, 0], third: [0, 0], all: 0, prev: {}, at: {}, last: [], map: [], score: null }; };
  statReset();
  const statAdd = r => {
    if (!st.dir) {   // home attacks +x when it kicks off on the -x half
      let s = 0, n = 0;
      for (let i = 15; i < r.length; i += 5) if (r[i + 1] === 0) { s += r[i + 2]; n++; }
      if (!n) return;
      st.dir = s / n < 0 ? 1 : -1;
    }
    st.all++;
    if (st.score) for (const tm of [0, 1]) if (r[4 + tm] > st.score[tm]) {   // a goal: its team's last shot within 4 s
      for (let j = st.map.length - 1; j >= 0; j--) { const m = st.map[j]; if (r[2] - m[0] > 4) break; if (m[1] === tm && !m[6]) { m[6] = 1; break; } }
    }
    st.score = [r[4], r[5]];
    if (r[14] === 0 || r[14] === 1) st.hold[r[14]]++;
    const bx = r[6] * st.dir;   // + = towards the away goal
    if (bx > 6.5 / 3) st.third[0]++; else if (bx < -6.5 / 3) st.third[1]++;
    for (let i = 15; i < r.length; i += 5) {
      const tm = r[i + 1], k = tm + ":" + r[i], a = acts[r[i + 4]];
      const was = st.prev[k];
      st.prev[k] = a;
      if (!SHOOT.has(a) || was === undefined || SHOOT.has(was)) continue;
      if (st.at[k] !== undefined && r[2] - st.at[k] < 1.5) continue;   // flicker of one shot
      st.at[k] = r[2];
      const gx = 6.5 * (tm === 0 ? st.dir : -st.dir), d = Math.hypot(gx - r[i + 2], r[i + 3]);
      const xg = XG_BY_M[Math.min(9, Math.floor(d))];
      st.sh[tm]++; st.xg[tm] += xg;
      st.last.push([r[2], tm, r[i], Math.round(d * 10) / 10, xg]);
      const sx = tm === 0 ? st.dir : -st.dir;   // the shooter's frame: attacking +x
      if (st.map.length < 80) st.map.push([Math.round(r[2] * 10) / 10, tm, r[i], Math.round(r[i + 2] * sx * 100) / 100, Math.round(r[i + 3] * sx * 100) / 100, xg, 0]);
      if (st.last.length > 5) st.last.shift();
    }
  };
  const statNow = () => {
    const h = st.hold[0] + st.hold[1];
    return { sh: st.sh, xg: st.xg.map(x => Math.round(x * 100) / 100),
      pos: h ? [Math.round(100 * st.hold[0] / h), 100 - Math.round(100 * st.hold[0] / h)] : null,
      third: st.all ? st.third.map(x => Math.round(100 * x / st.all)) : null, last: st.last, map: st.map, frames: st.all };
  };

  // Live status for the extension's popup (bridge.js passes it on): what is recorded so far.
  function postStatus() {
    if (!matchId) return;
    const first = rows[0], last = rows[rows.length - 1];
    window.postMessage({
      source: "drunkards-rec", type: "status", id: matchId, n: rows.length, t: lastTime(),
      t0: first ? first[2] : null, score: last ? [last[4], last[5]] : null, lastWall: last ? last[0] : null,
      header: (meta.header || "").slice(0, 300), reloads: meta.reloads || 0, stopped, ctl: ctlNow(), st: statNow()
    }, location.origin);
  }
  setInterval(postStatus, 2000);

  // A reload mid-match: take the stored rows back and keep recording after them.
  const restore = async id => {
    let st = null;
    try { st = JSON.parse(sessionStorage.getItem(STORE) || "null"); } catch (e) {}
    if (!st || st.id !== id || !st.b64) return;
    restoring = true;
    try {
      const old = JSON.parse(await gunzipB64(st.b64));
      // Re-code the old action indexes into this page's table, then put the old rows first.
      const remap = (old.acts || []).map(a => code(a));
      for (const r of old.rows || []) for (let k = 19; k < r.length; k += 5) r[k] = remap[r[k]];
      const firstNew = rows.length ? rows[0][1] : Infinity;
      rows = (old.rows || []).filter(r => r[1] < firstNew).concat(rows);
      for (const c of old.comm || []) if (!seen.has(c[1])) { seen.add(c[1]); comm.push(c); }
      try {
        const firstW = full.length ? full[0][0] : Infinity;
        const oldFull = (old.full || []).filter(f => f[0] < firstW);
        full = oldFull.concat(full);
        fullChars += oldFull.reduce((a, f) => a + JSON.stringify(f[2]).length, 0);
        for (const [store, src] of [[other, old.other], [sent, old.sent]])
          for (const k in src || {}) {
            const cur = store[k] || (store[k] = { n: 0, first: [] });
            cur.n += src[k].n;
            cur.first = src[k].first.concat(cur.first).slice(0, FIRST_PER_KIND);
          }
        const firstEv = events.length ? events[0][0] : Infinity;
        events = (old.events || []).filter(e => e[0] < firstEv).concat(events);
        const firstX = xrows.length ? xrows[0][0] : Infinity;
        xrows = (old.xrows || []).filter(r => r[0] < firstX).concat(xrows);
        if (old.meta) {
          meta.opened = (old.meta.opened || []).concat(meta.opened);
          meta.closed = (old.meta.closed || []).concat(meta.closed);
          meta.header = meta.header || old.meta.header || "";
          meta.reloads = (old.meta.reloads || 0) + 1;
        }
      } catch (e) {}
      comm.sort((a, b) => a[0] - b[0]);
      statReset(); for (const r of rows) statAdd(r);   // stats over the whole match again
    } catch (e) { /* unreadable copy: carry on with what this page records */ }
    restoring = false;
  };

  // Ask the extension (bridge.js) to save the file.
  const flush = why => {
    if (!matchId || rows.length < 100 || stopped || restoring) return;
    window.postMessage({ source: "drunkards-rec", type: "save", id: matchId, why, n: rows.length, data: dump() },
      location.origin);
  };
  window.addEventListener("pagehide", () => flush("pagehide"));
  window.addEventListener("message", ev => {
    if (ev.source === window && ev.data && ev.data.source === "drunkards-rec-bridge" && ev.data.type === "save-now") {
      flush("button");
      stopped = true;   // manual stop: nothing more is recorded until the next match
    }
  });

  // ---- START button check from the page itself (1.18). A capture of the tab works only for the
  // window's active tab; reading Unity's WebGL canvas works for any visible tab, but only right
  // after Unity drew the frame (preserveDrawingBuffer is false), so requestAnimationFrame is
  // wrapped and, when bridge.js asks, the next drawn frame is sampled (checked live 27.10).
  let wantStart = 0;
  const isO = (r, g, b) => r > 200 && g > 90 && g < 215 && b < 110 && r - b > 120;
  const SW = 192, SH = 108;
  let off = null, octx = null;
  const sampleStart = () => {
    let gl = null, area = 0;
    for (const c of document.querySelectorAll("canvas")) { const a = c.width * c.height; if (a > area) { area = a; gl = c; } }
    if (!gl || area < 40000) return false;
    if (!off) { off = document.createElement("canvas"); off.width = SW; off.height = SH; octx = off.getContext("2d", { willReadFrequently: true }); }
    let w = gl.width, h = gl.height;   // the 16:9 picture inside the canvas buffer
    if (w / h > 16 / 9) w = h * 16 / 9; else h = w * 9 / 16;
    octx.clearRect(0, 0, SW, SH);
    octx.drawImage(gl, (gl.width - w) / 2, (gl.height - h) / 2, w, h, 0, 0, SW, SH);
    const d = octx.getImageData(0, 0, SW, SH).data;
    const at = (fx, fy) => { const i = (Math.round(fy * (SH - 1)) * SW + Math.round(fx * (SW - 1))) * 4; return d[i + 3] ? isO(d[i], d[i + 1], d[i + 2]) : null; };
    if (!d[(Math.round(SH / 2) * SW + SW / 2) * 4 + 3]) return false;   // blank: not a frame Unity just drew
    const pts = [];
    for (const dx of [-0.09, -0.06, -0.03, 0.03, 0.06, 0.09]) for (const dy of [-0.025, 0, 0.025]) pts.push([0.5 + dx, 0.85 + dy]);
    const share = pts.filter(([x, y]) => at(x, y)).length / pts.length;
    let res = { found: share >= 0.5, fx: 0.5, fy: 0.85, share };
    if (!res.found) {   // moved a little: centre of the orange in the lower middle
      let n = 0, sx = 0, sy = 0;
      for (let fy = 0.6; fy <= 0.97; fy += 0.01) for (let fx = 0.25; fx <= 0.75; fx += 0.01) if (at(fx, fy)) { n++; sx += fx; sy += fy; }
      if (n >= 60) res = { found: true, fx: sx / n, fy: sy / n, share, n };
    }
    window.postMessage({ source: "drunkards-rec", type: "start-seen", ...res }, location.origin);
    return true;
  };
  const origRAF = window.requestAnimationFrame;
  window.requestAnimationFrame = function (cb) {
    return origRAF.call(window, t => {
      try { cb(t); } finally {
        if (wantStart) { try { if (sampleStart()) wantStart = 0; } catch (e) { wantStart = 0; } }
      }
    });
  };
  window.addEventListener("message", ev => {
    if (ev.source === window && ev.data && ev.data.source === "drunkards-rec-bridge" && ev.data.type === "start-sample") wantStart = Date.now();
  });

  const Orig = window.WebSocket;
  function Hooked(url, protocols) {
    const ws = protocols === undefined ? new Orig(url) : new Orig(url, protocols);
    let host = "";
    try { host = new URL(url).host; } catch (e) {}
    if (host === GAME_HOST) {
      // /v2/player/matches/<id>/viewer, and the public /viewer/<code>/match/<id>, /viewer/match/<id>
      const m = location.pathname.match(/match(?:es)?\/([0-9a-f-]{36})/);
      const id = m ? m[1] : "unknown-" + Date.now();
      if (id !== matchId) {
        matchId = id; rows = []; comm = []; seen.clear(); acts = []; actIdx = {}; stopped = false;
        fresh(); ctl = {}; statReset();
        restore(id);
      }
      ws.addEventListener("open", () => {
        meta.opened.push([Date.now(), lastTime()]);
        window.postMessage({ source: "drunkards-rec", type: "recording", id }, location.origin);
      });
      // What the viewer sends to the game server.
      const origSend = ws.send;
      ws.send = function (d) {
        try { if (!stopped) { const [k, v] = describe(d); keepKind(sent, k, v); } } catch (e) {}
        return origSend.call(this, d);
      };
      ws.addEventListener("message", ev => onFrame(ev.data));
      // A dropped socket mid-match is not the end: keep a stored copy, save only at the end.
      ws.addEventListener("close", ev => {
        try { meta.closed.push([Date.now(), lastTime(), ev.code, ev.reason || ""]); } catch (e) {}
        persist(); if (lastTime() >= 118) flush("socket closed");
      });
    }
    return ws;
  }
  Hooked.prototype = Orig.prototype;
  Object.assign(Hooked, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Hooked;
})();
