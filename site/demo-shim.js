/* Browser bridge: simulates WLED in demo mode and provides browser-local app state in either mode.
   Real-controller WLED requests pass through directly to the configured controller. */
(function () {
  'use strict';
  const D = window.DEMO_DATA, TL = window.TLFX, HOST = 'demo-roof', SERVER = window.TL_SERVER_STATE || null, PREFS = SERVER?.has_settings ? SERVER.settings : window.TLSettings.read(), REAL = PREFS.mode === 'wled', LAYOUT = window.TLSettings.layout(), N = LAYOUT.runs.reduce((a, r) => a + r.leds, 0);
  const KEY = 'tlstudio-demo-v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const store = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { } };
  const LEGACY = load(), APPSTATE = Object.assign({}, D.app, SERVER?.has_app ? (SERVER.app || {}) : (LEGACY || {}));
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------------- pretend controller ----------------
  const cfg = clone(D.cfg), presets = { 0: {} }, palettes = {};
  const st = { on: true, bri: 180, transition: 7, ps: 3, pl: -1, nl: { on: false, dur: 60, mode: 1, tbri: 0, rem: -1 }, mainseg: 0, seg: [] };
  const segDefaults = (k) => ({ id: k, start: 0, stop: N, grp: 1, spc: 0, of: 0, on: true, bri: 255, fx: 0, sx: 128, ix: 128, c1: 128, c2: 128, c3: 16, o1: false, o2: false, o3: false, pal: 0, col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]], rev: false, mi: false, slow: 1, n: '' });
  const inst = [];   // engine instance per segment
  const colHex = c => typeof c === 'string' ? [1, 3, 5].map(i => parseInt(c.substr(i - 1, 2), 16)) : c;
  function applySeg(s) {
    const k = s.id ?? st.seg.length; let g = st.seg[k];
    if (s.stop === 0) { if (g) st.seg[k] = null; return; }
    if (!g) g = st.seg[k] = segDefaults(k);
    for (const key in s) if (key !== 'id') g[key] = key === 'col' ? s.col.map(c => Array.isArray(c) ? c.slice(0, 3) : colHex(c)) : s[key];
  }
  let plTimer = null, plRun = null;
  function stopPlaylist() { clearTimeout(plTimer); plTimer = null; plRun = null; st.pl = -1; }
  function startPlaylist(pl, id) {
    stopPlaylist(); plRun = { pl, i: 0, id }; st.pl = id;
    const step = () => { if (!plRun) return; const p = plRun.pl, ps = p.ps[plRun.i % p.ps.length]; applyPreset(ps, true); st.pl = plRun.id;
      const d = (Array.isArray(p.dur) ? p.dur[plRun.i % p.dur.length] : p.dur) || 100; plRun.i = p.r ? Math.floor(Math.random() * p.ps.length) : plRun.i + 1;
      if (p.repeat === 1 && plRun.i >= p.ps.length) { plRun = null; return; } plTimer = setTimeout(step, d * 100); push(); };
    step();
  }
  function applyPreset(id, fromPl) { const p = presets[id]; if (!p || p.ifon && !st.on) return; if (!fromPl) stopPlaylist(); if (p.playlist) return startPlaylist(p.playlist, id); apply(clone(p), true); st.ps = id; }
  function apply(b, quiet) {
    if (b.psave != null) { const p = clone(b); ['psave', 'o', 'ib', 'sb', 'time'].forEach(k => delete p[k]); if (!b.seg && !b.playlist) Object.assign(p, { on: st.on, bri: st.bri, seg: clone(st.seg.filter(Boolean)) }); presets[b.psave] = p; }
    if (b.ps != null && b.psave == null) { applyPreset(b.ps); return push(); }
    if (b.playlist && b.playlist.ps) { startPlaylist(b.playlist, b.psave ?? 0); if (b.bri) st.bri = b.bri; return push(); }
    if (b.pl === -1 && !quiet) stopPlaylist();
    if (b.on !== undefined) st.on = b.on === 't' ? !st.on : !!b.on;
    if (b.bri !== undefined) st.bri = b.bri;
    if (b.nl) Object.assign(st.nl, b.nl);
    if (b.seg) { (Array.isArray(b.seg) ? b.seg : [b.seg]).forEach(applySeg); if (!quiet) { st.ps = -1; stopPlaylist(); } }
    if (b.psave != null) st.ps = b.psave;
    if (!quiet) push();
  }
  // the live view: render each segment with the same engine, post-gamma (what WLED 0.15 sends)
  const frame = new Uint8Array(2 + N * 3); frame[0] = 76; frame[1] = 1;
  // layered looks (Studio firmware extensions): rebuild the layers from the segments and blend them with the Look Builder engine
  const SHAPE_BY_NAME = { 'Studio Field': 'field', 'Studio Waves': 'waves', 'Studio Comets': 'comets', 'Studio Glints': 'glints', 'Studio Noise': 'noise', 'Studio Breathe': 'pulse' };
  const BM = [null, 'cover', 'add', 'screen', 'lighter', 'reveal', 'tint', 'dim'], MT = ['opacity', 'hue', 'pos', 'speed', 'size', 'sx', 'ix', 'c1', 'c2', 'c3'], MS = ['sine', 'tri', 'up', 'down', 'square', 'wander'];
  const GAM8 = new Uint8Array(256).map((_, v) => Math.round(255 * Math.pow(v / 255, 2.8)));
  let stk = null, stkKey = '', stkView = {};
  function layered(now, out) {
    const B = window.TLBuilder, names = D.effects || [], segs = st.seg.filter(Boolean);
    const key = JSON.stringify(segs.map(g => [g.start, g.stop, g.fx, g.bm, g.sx, g.ix, g.c1, g.c2, g.c3, g.o1, g.o2, g.pal, g.col, g.tlc, g.mod, g.bri, g.on, g.fe, g.grp, g.spc, g.rev, g.mi, g.slow]));
    if (key !== stkKey) { stkKey = key; stkView = {};
      stk = { stack: { knobs: [], layers: segs.map((g, k) => {
        const type = SHAPE_BY_NAME[names[g.fx]], L = { id: 'd' + k, name: g.n || 'Layer', on: g.on !== false, blend: BM[g.bm] || 'cover', opacity: Math.round((g.bri ?? 255) / 2.55),
          zone: { runs: [], custom: [{ start: g.start, len: g.stop - g.start }], feather: g.fe || 0, grp: g.grp || 1, spc: g.spc || 0 }, motion: { slow: g.slow || 1, rev: !!g.rev, mi: !!g.mi },
          mods: (g.mod || []).map(m => ({ target: MT[m[0]] || 'opacity', shape: MS[m[1]] || 'sine', depth: m[2], phase: m[3], per: m[4] / 1000 })),
          stops: (g.tlc && g.tlc.length ? g.tlc : [[255, 140, 30, 0]]).map(c => [c[3] / 255, [c[0], c[1], c[2]]]), cmode: 'gradient' };
        L.src = type ? { kind: 'shape', type, p: B.SHAPES[type].dec({ sx: g.sx, ix: g.ix, c1: g.c1, c2: g.c2, c3: g.c3, o1: !!g.o1, o2: !!g.o2 }) }
                     : { kind: 'fx', fx: TL.supported.includes(g.fx) ? g.fx : 0, sx: g.sx, ix: g.ix, c1: g.c1, c2: g.c2, c3: g.c3, o1: g.o1, o2: g.o2, o3: g.o3, pal: g.pal, col: g.col };
        return L; }) } };
    }
    const buf = B.render(stkView, stk, now);   // screen space → what WLED 0.15 sends (post-gamma)
    for (let i = 0; i < out.length; i++) out[i] = GAM8[buf[i]];
  }
  function render(now) {
    const out = frame.subarray(2); out.fill(0);
    if (!st.on) return frame;
    if (window.TLBuilder && st.seg.some(g => g && g.bm)) { layered(now, out); return frame; }
    st.seg.forEach((g, k) => {
      if (!g || !g.on) return; const len = Math.max(0, Math.min(N, g.stop) - g.start); if (!len) return;
      let it = inst[k]; if (!it || it.fx !== g.fx || it.len !== len) it = inst[k] = { fx: g.fx, len, e: TL.create(TL.supported.includes(g.fx) ? g.fx : 0, len) };
      const raw = it.e.render({ sx: g.sx, ix: g.ix, c1: g.c1, c2: g.c2, c3: g.c3, o1: g.o1, o2: g.o2, o3: g.o3, pal: g.pal, col: g.col, grp: g.grp, spc: g.spc, rev: g.rev, mi: g.mi, of: g.of, bri: g.bri, slow: g.slow || 1 }, now);
      for (let i = 0; i < len * 3; i++) if (raw[i]) out[g.start * 3 + i] = raw[i];
    });
    return frame;
  }
  function info() { return { ver: 'Demo WLED', name: 'Demo roof', leds: { count: N, fps: 0, pwr: 0, maxpwr: 0 }, wifi: { signal: 100, rssi: -40 }, uptime: Math.floor(performance.now() / 1000), time: new Date().toLocaleString(), u: { 'Audio Source': ['Demo mic', ' - peak ' + Math.round(30 + 25 * Math.sin(Date.now() / 400)) + '%'] }, live: false }; }
  const sockets = new Set();
  function push() { const msg = JSON.stringify({ state: stateJSON(), info: info() }); sockets.forEach(s => s._recv(msg)); }
  function stateJSON() { const s = clone(st); s.seg = st.seg.filter(Boolean).map(clone); return s; }

  class DemoSocket {
    constructor() { this.readyState = 0; this.binaryType = 'arraybuffer'; sockets.add(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 30); }
    _recv(data) { this.onmessage && this.onmessage({ data }); }
    send(txt) { let j; try { j = JSON.parse(txt); } catch { return; } if (j.lv) { this._live(); return; } if (!('time' in j && Object.keys(j).length === 1)) apply(j); }
    _live() { if (this._t) return; const t0 = performance.now(); this._t = setInterval(() => this.onmessage && this.onmessage({ data: render(performance.now() - t0).slice().buffer }), 47); }
    close() { clearInterval(this._t); this.readyState = 3; sockets.delete(this); this.onclose && this.onclose({}); }
  }
  const RealWS = window.WebSocket;
  window.WebSocket = function (url, p) { return !REAL && String(url).includes(HOST) ? new DemoSocket(url) : new RealWS(url, p); };

  // ---------------- fetch: the Studio server + the pretend controller ----------------
  const json = (o, code) => new Response(JSON.stringify(o), { status: code || 200, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (url, opt) {
    const u = String(url), m = (opt && opt.method || 'GET').toUpperCase(), body = opt && opt.body;
    const parsed = () => { try { return typeof body === 'string' ? JSON.parse(body) : {}; } catch { return {}; } };
    if (!REAL && u.includes(HOST)) {
      const path = u.split(HOST)[1].split('?')[0];
      if (path === '/json/state') { if (m === 'POST') { apply(parsed()); return json({ success: true }); } return json(stateJSON()); }
      if (path === '/json/info') return json(info());
      if (path === '/json/cfg') { if (m === 'POST') { const c = parsed(); Object.assign(cfg, c); return json({ success: true }); } return json(cfg); }
      if (path === '/json/effects') return json(D.effects);
      if (path === '/json/palettes') return json(D.palettes);
      if (path === '/json/fxdata') return json(D.fxdata);
      if (path === '/presets.json') return json(presets);
      if (path === '/upload') { try { const f = body.get('data'), name = f.name || '', txt = await f.text(), slot = +(name.match(/palette(\d+)/) || [])[1]; palettes[slot] = JSON.parse(txt); const st2 = palettes[slot].palette, stops = []; for (let i = 0; i < st2.length; i += 2) stops.push([st2[i], [0, 2, 4].map(k => parseInt(st2[i + 1].substr(k, 2), 16))]); TL.setCustomPalette(255 - slot, stops); } catch { } return json({ success: true }); }
      const pm = path.match(/^\/palette(\d+)\.json$/); if (pm) return palettes[+pm[1]] ? json(palettes[+pm[1]]) : json({}, 404);
      return json({});
    }
    if (u.startsWith('/api/')) {
      if (u === '/api/controller/push') {
        if (REAL) return realFetch(url, opt);
        const data = parsed(), ids = new Set(data.seg.map(seg => seg.id));
        data.seg.push(...st.seg.filter(seg => seg && !ids.has(seg.id)).map(seg => ({ id: seg.id, stop: 0 })));
        apply(data);
        return json({ ok: true, state: stateJSON() });
      }
      if (u === '/api/controller/presets' || u === '/api/schedule/save') {
        if (REAL) return realFetch(url, opt);
        const data = parsed(), entries = data.presets || [];
        if (u === '/api/schedule/save') {
          const response = await window.fetch('/api/app', { method: 'POST', body: JSON.stringify({ schedule: data.schedule, expectedSchedule: data.expectedSchedule }) });
          if (!response.ok) return response;
          cfg.timers = { ...cfg.timers, ins: data.timers };
        }
        for (const { slot, body, name } of entries) presets[slot] = { ...clone(body), n: name };
        return json({ ok: true, changed: entries.length, timers: data.timers?.filter(t => t.en && t.macro).length, tonight: 'saved (demo)' });
      }
      if (u === '/api/scheduler/status') return realFetch(url, opt);
      if (u === '/api/app') {
        if (SERVER) {
          const response = await realFetch(url, opt);
          if (m === 'POST' && response.ok) { const data = parsed(); delete data.expectedSchedule; Object.assign(APPSTATE, data); SERVER.app = Object.assign({}, APPSTATE); SERVER.has_app = true; }
          return response;
        }
        if (m === 'POST') { const data = parsed(); delete data.expectedSchedule; Object.assign(APPSTATE, data); store(APPSTATE); return json({ ok: true }); }
        return json(APPSTATE);
      }
      if (u === '/api/settings') return realFetch(url, opt);
      if (u === '/api/restore') {
        if (SERVER) {
          const response = await realFetch(url, opt);
          if (response.ok) { const backup = parsed(); SERVER.app = backup.application; SERVER.settings = backup.controller; SERVER.has_app = SERVER.has_settings = true; }
          return response;
        }
        if (m === 'POST') {
          const backup = parsed();
          if (backup.format !== 'trimlight-home-studio-wled-backup' || backup.version !== 1 || !backup.application || !backup.controller) return json({ ok: false, error: 'This is not a supported Trimlight Home Studio WLED backup.' }, 400);
          for (const key of Object.keys(APPSTATE)) delete APPSTATE[key]; Object.assign(APPSTATE, backup.application); store(APPSTATE);
          try { localStorage.setItem('trimlight-home-studio-wled-v1', JSON.stringify(backup.controller)); } catch { }
          return json({ ok: true });
        }
      }
      if (u === '/api/wled/status') return json({ host: REAL ? (PREFS.outputs?.length ? PREFS.host : null) : HOST, mode: REAL ? 'wled' : 'demo' });
      if (u === '/api/fxinfo') return json(D.fxinfo);
      if (u === '/api/layout') return json(LAYOUT);
      if (u.startsWith('/api/schedule/apply')) {
        if (!REAL) return json({ ok: true, changed: true, tonight: 'saved (demo)', via: 'demo' });
        if (SERVER) return realFetch(url, opt);
        try {
          const request = parsed(), host = PREFS.host, slot = Number.isInteger(request.slot) && request.slot >= 240 && request.slot <= 250 ? request.slot : 240;
          {
            const current = await realFetch('http://' + host + '/json/state', { cache: 'no-store' }).then(r => r.json());
            const savedLook = request.body || { on: current.on, bri: current.bri, seg: current.seg || [] };
            const preset = Object.assign({}, savedLook, { psave: slot, n: 'Studio · ' + String(request.name || 'Scheduled look').slice(0, 48), ib: true, sb: true, o: true });
            const saved = await realFetch('http://' + host + '/json/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preset) });
            if (!saved.ok) throw new Error('WLED could not save the scheduled look.');
            await realFetch('http://' + host + '/json/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: current.on, bri: current.bri, transition: 0, seg: current.seg || [] }) });
          }
          return json({ ok: true, changed: true, tonight: request.body ? 'preset ' + slot + ' updated' : 'current WLED look saved to preset ' + slot, via: 'wled' });
        } catch (e) { return json({ ok: false, error: e.message || 'Could not save the WLED schedule preset.' }, 502); }
      }
      if (u.startsWith('/api/ai/')) return json({ ok: false, error: 'AI looks are switched off in the demo.' });
      return json({ ok: false, error: 'Not available in the demo' });
    }
    return realFetch(url, opt);
  };
  window.__demoGet = url => url === '/api/layout' ? LAYOUT : url === '/api/app' ? APPSTATE : {};
  if (SERVER && !SERVER.has_app && LEGACY) realFetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(LEGACY) }).then(r => { if (r.ok) { SERVER.app = LEGACY; SERVER.has_app = true; try { localStorage.removeItem(KEY); } catch { } } }).catch(() => { });

  // start the pretend roof on the look the app last pushed
  if (!REAL) { const lp = APPSTATE.lastPush; presets[3] = { on: true, bri: 180, seg: [Object.assign(segDefaults(0), { fx: 80, sx: 55, ix: 150, pal: 5, col: [[190, 10, 0], [255, 85, 0], [255, 185, 0]] })] }; apply(clone(presets[3]), true); st.ps = 3; }
  window.__demoReset = () => { try { localStorage.removeItem(KEY); } catch { } location.reload(); };
  window.DEMO = !REAL; window.TL_REAL_WLED = REAL;
})();
