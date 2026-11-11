Warning: truncated output (original token count: 42022)
Total output lines: 1750

/* Trimlight Home Studio · WLED Edition — WLED look library and editor with demo and direct-controller modes. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = 2000;                                               // plate width; roof-map coordinates are normalized
  const CAT = window.TLCatalog, FXL = window.TLFX || null, TLB = window.TLBuilder;
  const isStack = P => !!(TLB && TLB.isStack(P));   // a Look Builder stack (builder.js)
  // Select the effect catalog according to the WLED compatibility version exposed by the engine.
  const V16 = !!(FXL && /^16/.test(String(FXL.version || '')));
  const CPAL = slot => (V16 ? 200 : 255) - slot;   // /paletteN.json → palette id (WLED 16: 200-N, 0.15: 255-N)
  if (V16 && FXL.config) { FXL.config.outputGamma = false; FXL.config.simFps = 250; }   // previews in display space (same as WLED 16's live view, which is pre-gamma)
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const clone = o => JSON.parse(JSON.stringify(o));
  const hex = c => '#' + c.slice(0, 3).map(x => ('0' + Math.round(clamp(x, 0, 255)).toString(16)).slice(-2)).join('');
  const unhex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const getSync = url => window.__demoGet(url);

  /* ---------------- house geometry: LEDs in WLED order (port 1 → 2 → 3, runs in data order) ---------------- */
  const layout = getSync('/api/layout');
  const photoSize = layout.photoSize || [2000, 1500], H = W * (Number(photoSize[1]) / Number(photoSize[0]) || .75);
  const LEDS = [];
  const physicalRuns = (layout.runs || []).slice().map((r, k) => ({ r, k })).sort((a, b) => (a.r.port - b.r.port) || (a.k - b.k));
  const geometryRuns = (layout.mappedPaths || layout.runs || []).slice().map((r, k) => ({ r, k })).sort((a, b) => ((a.r.port ?? a.k) - (b.r.port ?? b.k)) || (a.k - b.k));
  let physicalRun = 0, physicalRunStop = physicalRuns[0]?.r.leds || Infinity;
  geometryRuns.forEach(({ r }) => {
    const pts = r.points.map(p => [p[0] * W, p[1] * H]), seg = []; let tot = 0;
    for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(d); tot += d; }
    const arr = [];
    for (let k = 0; k < r.leds; k++) {
      let d = (k + 0.5) / r.leds * tot, s = 0;
      while (s < seg.length - 1 && d > seg[s]) { d -= seg[s]; s++; }
      const f = Math.min(1, d / seg[s]);
      arr.push([pts[s][0] + (pts[s + 1][0] - pts[s][0]) * f, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * f]);
    }
    if (r.reverse) arr.reverse();
    arr.forEach(p => {
      while (physicalRun < physicalRuns.length - 1 && LEDS.length >= physicalRunStop) { physicalRun++; physicalRunStop += physicalRuns[physicalRun].r.leds; }
      LEDS.push({ x: p[0], y: p[1], run: physicalRun });
    });
  });
  const N = LEDS.length;

  /* ---------------- persistent app state (server: data/app.json) ---------------- */
  const APP = Object.assign({ userLooks: [], edits: {}, cats: [], starred: {}, roofSections: [], master: { speed: 100, bright: 100, spacing: 0, theme: '' }, perRow: 3, lastPush: null, history: [] }, getSync('/api/app'));
  APP.roofSections = Array.isArray(APP.roofSections) ? APP.roofSections : [];
  let saveT = null; const pending = {};
  function save(keys) { keys.forEach(k => pending[k] = APP[k]); clearTimeout(saveT); saveT = setTimeout(() => { const b = Object.assign({}, pending); for (const k in pending) delete pending[k]; fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).catch(() => toast('Couldn’t save', 'var(--warn)')); }, 300); }

  /* ---------------- looks: catalog + yours, with renames/categories applied ---------------- */
  const CAT_LABEL = {}; CAT.CATS.forEach(c => CAT_LABEL[c[0]] = c[1]); APP.cats.forEach(c => CAT_LABEL[c[0]] = c[1]);
  const baseP = l => upgradeP({ fx: l.fx, sx: l.sx, ix: l.ix, c1: l.c1 ?? 128, c2: l.c2 ?? 128, c3: l.c3 ?? 16, o1: !!l.o1, o2: !!l.o2, o3: !!l.o3, pal: l.pal, col: clone(l.col), spc: l.spc || 0, rev: !!l.rev, mi: !!l.mi, slow: l.slow || 1, bri: l.bri ?? 180, pattern: l.pattern ? clone(l.pattern) : undefined });
  // colours model: swatches (P.mycol + P.colors 1–8, P.blend, P.rep) or per-bulb (P.cmode 'bulb' + P.seq [{c|null, n}])
  function upgradeP(P) {
    if (!P) return P;
    if (P.pattern) { P.cmode = 'bulb'; P.seq = P.pattern.map(c => ({ c: c.slice(0, 3), n: 1 })); delete P.pattern; }
    if (P.cmode !== 'bulb' && !P.mycol && [3, 4, 5].includes(P.pal)) {
      const c = (P.col || []).map(x => x.slice(0, 3));
      P.mycol = true; P.rep = 1; P.blend = P.pal === 4;
      P.colors = P.pal === 3 ? c.slice(0, 2) : P.pal === 4 ? [c[2], c[1], c[0]] : (c[2] && c[2].some(v => v) ? c.slice(0, 3) : c.slice(0, 2));
    }
    return P;
  }
  let LOOKS = [], BY_ID = {};
  function buildLooks() {
    LOOKS = APP.userLooks.map(u => Object.assign({}, CAT.LOOKS.find(c => c.id === u.base) || {}, u, { custom: true }))
      .concat(CAT.LOOKS.map(l => Object.assign({}, l)));
    LOOKS.forEach(l => { const e = APP.edits[l.id]; if (e) { if (e.name) l.name = e.name; if (e.cats) l.cats = e.cats; } l.P = l.custom && l.P ? upgradeP(l.P) : baseP(l); });
    BY_ID = {}; LOOKS.forEach(l => BY_ID[l.id] = l);
  }
  buildLooks();

  /* ---------------- WLED: metadata, live feed, push ---------------- */
  const WL = { host: null, ws: null, state: null, info: null, frame: null, fxdata: [], effects: [], palettes: [] };
  const hostReady = new Promise(r => WL._ready = r);   // pages opened straight from the URL wait for the controller's address
  const wget = p => fetch(`http://${WL.host}${p}`).then(r => r.json());
  async function wpost(body) {
    if (WL.ws && WL.ws.readyState === 1) { WL.ws.send(JSON.stringify(body)); return; }
    await fetch(`http://${WL.host}/json/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function connectWS() {
    try { WL.ws = new WebSocket(`ws://${WL.host}/ws`); } catch { return setTimeout(connectWS, 3000); }
    WL.ws.binaryType = 'arraybuffer';
    WL.ws.onopen = () => { WL.ws.send('{"lv":true}'); WL.ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000) })); syncController(); };  // keep the controller's clock right for the schedule
    WL.ws.onmessage = e => {
      if (typeof e.data !== 'string') { const u = new Uint8Array(e.data); if (u[0] === 76) { const t = performance.now(); if (WL.frame) { WL.prevFrame = WL.frame; WL.gap = Math.min(150, Math.max(16, t - WL.frameAt)); } const px = u.subarray(u[1] === 2 ? 4 : 2); WL.frame = V16 ? px : px.map(v => UNGAMMA[v]); WL.frameAt = t; /* 0.15 live view is post-gamma: convert to screen space like the previews */ } return; }
      try { const j = JSON.parse(e.data); if (j.info) WL.info = j.info; if (j.state) { WL.state = j.state; onHouseChanged(); } syncController(); } catch { }
    };
    WL.ws.onclose = () => { syncController(); setTimeout(connectWS, 2500); };
  }
  // slider/colour/palette names straight from WLED's own per-effect metadata
  function fxMeta(fx) {
    const raw = WL.fxdata[fx] ?? '', parts = raw === '' ? [] : raw.split(';');
    const sl = parts[0] ? parts[0].split(',') : (raw === '' && fx !== 0 ? ['!', '!'] : []);
    const colors = parts.length > 1 ? (parts[1] ? parts[1].split(',') : []) : (raw === '' ? ['!', '!', '!'] : []);
    const pal = parts.length > 2 ? parts[2] !== '' : raw === '' && fx !== 0;
    const flags = parts[3] || '';
    return { sl, colors, pal, flags, audio: /[vf]/.test(flags) };
  }
  const usesPal = fx => fxMeta(fx).pal;
  const BLACK = [0, 0, 0];
  function paletteStops(P) {
    const seq = []; for (let k = 0; k < (P.rep || 1); k++) seq.push(...P.colors);
    if (!P.blend) { const B = seq.length, st = []; seq.forEach((c, b) => st.push([Math.round(b * 256 / B), c], [Math.min(255, Math.round((b + 1) * 256 / B) - 1), c])); return st.slice(0, 18); }
    const all = seq.concat([seq[0]]); return all.map((c, k) => [Math.round(k * 255 / (all.length - 1)), c]).slice(0, 18);
  }
  // what the controller should actually get for these colours (3 normal slots when possible, else a custom palette)
  function effective(P) {
    const q = Object.assign({}, P);
    if (P.cmode === 'bulb' || !P.mycol || !P.colors?.length) return q;
    const cs = P.colors, n = cs.length, r = P.rep || 1;
    if (r === 1 && n === 1) { q.pal = 2; q.col = [cs[0], BLACK, BLACK]; }
    else if (r === 1 && !P.blend && n <= 3) { q.pal = 5; q.col = [cs[0], cs[1], cs[2] || BLACK]; }
    else if (r === 1 && P.blend && n === 3) { q.pal = 4; q.col = [cs[2], cs[1], cs[0]]; }
    else { q.cpal = paletteStops(P); q.col = [cs[0], cs[1] || cs[0], cs[2] || cs[0]]; }
    return q;
  }
  const stopsKey = st => JSON.stringify(st);
  // preview palettes live only in the engine (unlimited); push palettes use controller slots /paletteN.json → id 200-N on WLED 16 (was 255-N on 0.15)
  const prevPal = {}; let prevPalN = 1000;
  function previewPalId(st) { const k = stopsKey(st); if (!prevPal[k]) { prevPal[k] = prevPalN++; FXL && FXL.setCustomPalette(prevPal[k], st); } return prevPal[k]; }
  APP.palSlots = APP.palSlots || {};   // slot → {key, stops, up (uploaded key), at}
  function pinnedKeys() {   // palettes that must never be evicted: the schedule's looks, what's on the roof (boot preset), the bedtime look
    const b = [APP.schedule?.default?.body].concat((APP.schedule?.programs || []).map(p => p.body));
    const keys = new Set(b.filter(Boolean).map(x => x._palKey).filter(Boolean));
    const keyOf = P => { try { const q = P && effective(P); return q && q.cpal ? stopsKey(q.cpal) : null; } catch { return null; } };
    [APP.lastPush?.P, APP.schedule?.nightMode === 'look' && BY_ID[APP.schedule?.nightLook] ? applyMaster(BY_ID[APP.schedule.nightLook].P) : null].forEach(P => { const k = keyOf(P); if (k) keys.add(k); });
    return keys;
  }
  function slotFor(st) {
    const k = stopsKey(st), S = APP.palSlots;
    for (const s in S) if (S[s].key === k) { S[s].at = Date.now(); return +s; }
    const pin = pinnedKeys();
    let slot = [...Array(10).keys()].find(s => !S[s]);
    if (slot === undefined) slot = [...Array(10).keys()].filter(s => !pin.has(S[s].key)).sort((a, b) => S[a].at - S[b].at)[0] ?? 9;
    S[slot] = { key: k, stops: st, up: null, at: Date.now() }; save(['palSlots']); return slot;
  }
  async function flushPalettes() {   // upload any assigned-but-not-uploaded palettes to the controller
    for (const s in APP.palSlots) {
      const e = APP.palSlots[s]; if (e.up === e.key) continue;
      const json = JSON.stringify({ palette: e.stops.flatMap(([pos, c]) => [pos, c.map(v => ('0' + Math.round(v).toString(16)).slice(-2)).join('')]) });
      const fd = new FormData(); fd.append('data', new Blob([json], { type: 'application/json' }), 'palette' + s + '.json');
      await fetch(`http://${WL.host}/upload`, { method: 'POST', body: fd, mode: 'no-cors' });
      await new Promise(r => setTimeout(r, 400));
      e.up = (await paletteOnController(s, e)) === false ? null : e.key; save(['palSlots']);
      if (!e.up) toast('Couldn’t confirm the custom palette upload: colors may differ on the roof', 'var(--warn)');
    }
  }
  // read /paletteN.json back from the controller: true = matches, false = missing/different, null = couldn't check
  async function paletteOnController(slot, e) {
    try {
      const r = await fetch(`http://${WL.host}/palette${slot}.json`, { cache: 'no-store' }); if (!r.ok) return false;
      const got = (await r.json()).palette || [], want = e.stops.flatMap(([pos, c]) => [pos, c.map(v => ('0' + Math.round(v).toString(16)).slice(-2)).join('')]);
      return JSON.stringify(got).toLowerCase() === JSON.stringify(want).toLowerCase();
    } catch { return null; }
  }
  async function checkPaletteSlots() {   // after a reflash or wipe, re-upload on the next push instead of trusting app.json
    let dirty = false;
    for (const s in APP.palSlots) { const e = APP.palSlots[s]; if (e.up && (await paletteOnController(s, e)) === false) { e.up = null; dirty = true; } }
    if (dirty) save(['palSlots']);
  }
  function segFor(P, k, extra) {
    return Object.assign({ id: k, start: 0, stop: N, grp: 1, spc: P.spc || 0, of: 0, rev: !!P.rev, mi: !!P.mi, slow: P.slow || 1, on: true, bri: 255, fx: P.fx, sx: P.sx, ix: P.ix, c1: P.c1, c2: P.c2, c3: P.c3, o1: !!P.o1, o2: !!P.o2, o3: !!P.o3, pal: P.pal, col: P.col.map(c => c.slice(0, 3)), n: '' }, extra || {});
  }
  // ---- sections: one look per part of the roof (P.parts = [{start, stop, look, dir 'n'|'r'|'m', speed ×}]) ----
  const isSec = P => !!(P && P.parts && P.parts.length);
  function partP(pt) {   // the part's look as the roof runs it: its library look (gallery adjustments applied) + this part's direction/speed
    const base = (BY_ID[pt.look] && !isSec(BY_ID[pt.look].P)) ? BY_ID[pt.look].P : pt.P;
    const q = applyMaster(base || { fx: 0, sx: 128, ix: 128, pal: 0, col: [[255, 80, 0], BLACK, BLACK], bri: 180 });
    q.rev = pt.dir === 'r'; q.mi = pt.dir === 'm';
    if (pt.speed && pt.speed !== 1) q.sx = clamp(Math.round(q.sx * pt.speed), 0, 255);
    return q;
  }
  function secBody(P) {
    const segs = P.parts.map((pt, k) => {
      const q = effective(partP(pt)); if (q.cpal) q.pal = CPAL(slotFor(q.cpal));
      const top = Math.max(1, P.bri), sb = clamp(Math.round(255 * clamp(q.bri, 1, 255) / Math.max(top, ...P.parts.map(x => partP(x).bri))), 1, 255);
      return segFor(q, k, { start: pt.start, stop: pt.stop, bri: sb, n: (pt.name || '').slice(0, 30) });
    });
    return segs;
  }
  // per-bulb pattern → one segment per coloured entry: offset by its position, `n` bulbs lit, the rest of the repeat skipped
  function seqLayout(P) { const L = P.seq.reduce((a, e) => a + e.n, 0) || 1; let o = 0; const out = []; P.seq.forEach(e => { if (e.c) out.push({ start: o, n: e.n, c: e.c }); o += e.n; }); return { L, segs: out }; }
  function wledBody(P) {
    let segs, palKey;
    if (isStack(P)) segs = TLB.segments(P);
    else if (isSec(P)) segs = secBody(P);
    else if (P.cmode === 'bulb') {
      const { L, segs: ss } = seqLayout(P), pal = usesPal(P.fx) ? 2 : 0;
      segs = ss.map((e, k) => segFor(Object.assign({}, P, { pal, col: [e.c, BLACK, BLACK] }), k, { start: e.start, grp: e.n, spc: L - e.n }));
    } else {
      const q = effective(P);
      if (q.cpal) { palKey = stopsKey(q.cpal); q.pal = CPAL(slotFor(q.cpal)); }
      segs = [segFor(q, 0)];
    }
    for (let k = segs.length; k < Math.max(10, (WL.state?.seg || []).length); k++) segs.push({ id: k, stop: 0 });
    const body = { on: true, bri: clamp(Math.round(P.bri), 1, 255), transition: clamp(Math.round((isStack(P) && P.fade != null ? P.fade : (APP.fade?.push ?? 2)) * 10), 0, 6000), pl: -1, lor: 0, mainseg: 0, seg: segs };
    if (palKey) body._palKey = palKey;   // remembered so the schedule's palettes are never evicted (WLED ignores the field)
    return body;
  }
  const sameP = (a, b) => !!a && !!b && JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  const norm = P => ({ fx: P.fx, sx: P.sx, ix: P.ix, c1: P.c1, c2: P.c2, c3: P.c3, o1: !!P.o1, o2: !!P.o2, o3: !!P.o3, pal: P.pal, col: (P.col || []).map(c => c.slice(0, 3).map(Math.round)), spc: P.spc || 0, rev: !!P.rev, mi: !!P.mi, slow: P.slow || 1, bri: Math.round(P.bri), mycol: !!P.mycol, colors: P.colors || null, blend: !!P.blend, rep: P.rep || 1, cmode: P.cmode || null, seq: P.seq || null, parts: P.parts ? P.parts.map(pt => [pt.start, pt.stop, pt.look, pt.dir || 'n', pt.speed || 1]) : null });
  // does the roof still run what we last pushed? (someone may have changed it from the WLED app)
  // does the roof run these settings? (compares the controller's live state with a look's push settings)
  function stateMatches(P) {
    const s = WL.state; if (!P || !s || !s.on) return false;
    const segs = (s.seg || []).filter(x => x.stop > x.start), g = segs[0]; if (!g) return false;
    const same = (a, b) => JSON.stringify(a.slice(0, 3).map(Math.round)) === JSON.stringify(b.slice(0, 3).map(Math.round));
    if (isStack(P)) return TLB.matches(P, s.seg);
    if (isSec(P)) return segs.length === P.parts.length && P.parts.every((pt, k) => { const q = effective(partP(pt)), x = segs[k]; return x.start === pt.start && x.stop === pt.stop && x.fx === q.fx && x.sx === q.sx && x.ix === q.ix && !!x.rev === !!q.rev && !!x.mi === !!q.mi; });
    if (P.cmode === 'bulb') { const { L, segs: ss } = seqLayout(P); return segs.length === ss.length && segs.every((x, k) => x.fx === P.fx && x.sx === P.sx && x.ix === P.ix && x.start === ss[k].start && x.grp === ss[k].n && x.spc === L - ss[k].n && same(x.col[0], ss[k].c)); }
    const q = effective(P);
    if (q.cpal) { const slot = Object.keys(APP.palSlots).find(s => APP.palSlots[s].key === stopsKey(q.cpal)); if (slot === undefined || g.pal !== CPAL(+slot)) return false; }
    else if (g.pal !== q.pal) return false;
    const knobs = ['c1', 'c2'].every(k => g[k] === undefined || q[k] === undefined || g[k] === q[k]) && (g.c3 === undefined || q.c3 === undefined || g.c3 === Math.min(31, q.c3)) && ['o1', 'o2', 'o3'].every(k => g[k] === undefined || !!g[k] === !!q[k]);
    return segs.length === 1 && knobs && g.fx === q.fx && g.sx === q.sx && g.ix === q.ix && (g.spc || 0) === (q.spc || 0) && !!g.rev === !!q.rev && !!g.mi === !!q.mi && (g.slow || 1) === (q.slow || 1) && g.col.every((c, k) => same(c, q.col[k] || BLACK));
  }
  function houseMatchesLastPush() { return !!APP.lastPush && stateMatches(APP.lastPush.P); }
  // a look that's on the roof but wasn't pushed from here (e.g. a preset saved before the app existed)
  function recognizedLook() { if (!WL.state) return null; for (const l of LOOKS) if (stateMatches(applyMaster(l.P))) return l; return null; }
  function houseName() {
    const s = WL.state; if (!s) return '…'; if (!s.on) return 'Lights off';
    if (WL.info?.live) return 'Streaming from Studio';
    if (s.pl > 0 && s.pl >= PS_PL && s.pl < PS_PL + 10) return '▶ ' + (APP.playlists[s.pl - PS_PL]?.name || 'Playlist');
    if (houseMatchesLastPush()) return BY_ID[APP.lastPush.id]?.name || APP.lastPush.name || 'Your look';
    const rl = recognizedLook(); if (rl) return rl.name;
    const ps = s.ps > 0 ? s.ps : -1;
    return (WL.effects[s.seg?.[0]?.fx] || 'Custom') + (ps > 0 ? ' (preset)' : '') + ' · set outside the app';
  }
  function houseLookId() { if (houseMatchesLastPush()) return APP.lastPush.id; const rl = recognizedLook(); return rl ? rl.id : null; }
  // WLED 16 resets unrelated settings (target fps, gamma, …) when /json/cfg gets a PARTIAL document (wled/WLED#5883),
  // so always send the whole config with our change merged in, and re-assert the settings the looks depend on.
  const CFG_KEEP = { hw: { led: { fps: 250 } }, light: { gc: { bri: 1, col: 2.8 } } };
  function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
  async function cfgPatch(patch) {
    const cur = await (await fetch(`http://${WL.host}/json/cfg`, { cache: 'no-store' })).json();
    const doc = deepMerge(deepMerge(cur, patch), CFG_KEEP);
    return fetch(`http://${WL.host}/json/cfg`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
  }
  async function pushToHouse(P, id, base) {   // P = exactly what the roof gets (gallery adjustments applied); base = the look's own settings
    const look = BY_ID[id];
    const body = wledBody(P); await flushPalettes();
    await wpost(body);
    APP.lastPush = { id, name: look?.name, P: clone(P), base: clone(base || P), at: Date.now() };
    APP.history = [id].concat((APP.history || []).filter(x => x !== id)).slice(0, 8);
    save(['lastPush', 'history']);
    // keep it after a power blip: save as preset 3 and make that the boot look
    setTimeout(() => wpost({ psave: 3, n: 'Studio · ' + (look?.name || 'look'), ib: true, sb: true }), 2600);
    if (!pushToHouse.bootSet) { pushToHouse.bootSet = true; setTimeout(() => cfgPatch({ def: { ps: 3 } }).catch(() => { }), 3800); }
  }

  /* ---------------- preview engine ---------------- */
  const UNGAMMA = new Uint8Array(256).map((_, v) => Math.round(255 * Math.pow(v / 255, 1 / 2.8)));
  const DISP = V16 ? new Uint8Array(256).map((_, v) => v) : UNGAMMA;   // engine output → screen (WLED 16 engine already gives display space)
  function fakeAudio(t) { // a 120 bpm "song" for mic-reactive previews
    const beat = (t * 2) % 1, v = Math.round(60 + 170 * Math.pow(1 - beat, 3) + 25 * Math.sin(t * 7.3));
    const fft = new Uint8Array(16); for (let i = 0; i < 16; i++) fft[i] = clamp(Math.round(v * (1 - i / 22) * (0.6 + 0.4 * Math.sin(t * (1 + i * 0.37) + i))), 0, 255);
    return { volume: clamp(v, 0, 255), peak: beat < 0.06, fft };
  }
  function renderLook(v, P, nowMs) {
    // returns Uint8Array N*3 for this view
    if (isStack(P)) return TLB.render(v, P, nowMs);
    if (isSec(P)) {   // one engine instance per part, written into its bulb range (like the controller's segments)
      const d = v.sbuf || (v.sbuf = new Uint8Array(N * 3)); d.fill(0); v.parts = v.parts || [];
      const top = Math.max(...P.parts.map(pt => partP(pt).bri), 1);
      P.parts.forEach((pt, k) => {
        const q = partP(pt), len = clamp(pt.stop, 0, N) - clamp(pt.start, 0, N); if (len <= 0) return;
        const sv = v.parts[k] && v.parts[k].len === len ? v.parts[k] : (v.parts[k] = { len, n: len });
        const buf = renderPart(sv, q, nowMs, len), f = q.bri / top;
        for (let i = 0; i < len; i++) { const o = (pt.start + i) * 3; d[o] = buf[i * 3] * f; d[o + 1] = buf[i * 3 + 1] * f; d[o + 2] = buf[i * 3 + 2] * f; }
      });
      return d;
    }
    if (FXL && FXL.config) FXL.config.globalBri = clamp(Math.round(P.bri ?? 128), 1, 255);   // Colortwinkles reads the roof's overall brightness (changes its fade when dimmed ≤ 28)
    if (P.cmode === 'bulb' && FXL && FXL.supported.indexOf(P.fx) >= 0) {
      // compose one engine instance per coloured entry, exactly like the controller's overlapping segments
      const { L, segs } = seqLayout(P), pal = usesPal(P.fx) ? 2 : 0, d = v.dbuf || (v.dbuf = new Uint8Array(N * 3));
      d.fill(0); v.segInst = v.segInst || [];
      segs.forEach((e, k) => {
        let it = v.segInst[k]; const len = N - e.start;
        if (!it || it.fx !== P.fx || it.len !== len) it = v.segInst[k] = { fx: P.fx, len, inst: FXL.create(P.fx, len) };
        const raw = it.inst.render({ sx: P.sx, ix: P.ix, c1: P.c1, c2: P.c2, c3: P.c3, o1: P.o1, o2: P.o2, o3: P.o3, pal, col: [e.c, BLACK, BLACK], grp: e.n, spc: L - e.n, rev: !!P.rev, mi: !!P.mi, slow: P.slow || 1, bri: 255 }, nowMs);
        for (let i = 0; i < len; i++) if ((i % L) < e.n) { const o = (e.start + i) * 3; d[o] = DISP[raw[i * 3]]; d[o + 1] = DISP[raw[i * 3 + 1]]; d[o + 2] = DISP[raw[i * 3 + 2]]; }
      });
      return d;
    }
    if (FXL && FXL.supported.indexOf(P.fx) >= 0) {
      const q = effective(P); if (q.cpal) q.pal = previewPalId(q.cpal); P = q;
      if (!v.inst || v.instFx !== P.fx) { v.inst = FXL.create(P.fx, N); v.instFx = P.fx; }
      const meta = fxMeta(P.fx);
      // tlfx returns what the controller sends to the bulbs (gamma 2.8 applied); undo that so the screen shows
      // the colour your eye sees on the roof — same space as the controller's live view
      const raw = v.inst.render({ sx: P.sx, ix: P.ix, c1: P.c1, c2: P.c2, c3: P.c3, o1: P.o1, o2: P.o2, o3: P.o3, pal: P.pal, col: P.col, grp: 1, spc: P.spc || 0, rev: !!P.rev, mi: !!P.mi, slow: P.slow || 1, bri: 255, audio: meta.audio ? fakeAudio(nowMs / 1000) : undefined }, nowMs);
      const d = v.dbuf || (v.dbuf = new Uint8Array(N * 3));
      if (V16) d.set(raw); else for (let i = 0; i < N * 3; i++) d[i] = UNGAMMA[raw[i]];
      return d;
    }
    const b = v.pbuf || (v.pbuf = new Uint8Array(N * 3)), c = P.col[0];   // engine missing: show colour 1
    for (let i = 0; i < N; i++) { const on = (i % ((P.spc || 0) + 1)) === 0; b[i * 3] = on ? c[0] : 0; b[i * 3 + 1] = on ? c[1] : 0; b[i * 3 + 2] = on ? c[2] : 0; }
    return b;
  }
  function renderPart(v, P, nowMs, len) {
    if (P.cmode === 'bulb' || !FXL || FXL.supported.indexOf(P.fx) < 0) { const b = v.pb || (v.pb = new Uint8Array(len * 3)), c = P.cmode === 'bulb' ? (P.seq.find(e => e.c) || { c: [255, 80, 0] }).c : P.col[0]; for (let i = 0; i < len; i++) { const on = (i % ((P.spc || 0) + 1)) === 0; b[i * 3] = on ? c[0] : 0; b[i * 3 + 1] = on ? c[1] : 0; b[i * 3 + 2] = on ? c[2] : 0; } return b; }
    const q = effective(P); if (q.cpal) q.pal = previewPalId(q.cpal);
    if (!v.inst || v.instFx !== q.fx) { v.inst = FXL.create(q.fx, len); v.instFx = q.fx; }
    const meta = fxMeta(q.fx);
    const raw = v.inst.render({ sx: q.sx, ix: q.ix, c1: q.c1, c2: q.c2, c3: q.c3, o1: q.o1, o2: q.o2, o3: q.o3, pal: q.pal, col: q.col, grp: 1, spc: q.spc || 0, rev: !!q.rev, mi: !!q.mi, slow: q.slow || 1, bri: 255, audio: meta.audio ? fakeAudio(nowMs / 1000) : undefined }, nowMs);
    const d = v.db || (v.db = new Uint8Array(len * 3));
    if (V16) d.set(raw); else for (let i = 0; i < len * 3; i++) d[i] = UNGAMMA[raw[i]];
    return d;
  }
  function liveBuf() { // what the roof is showing right now (controller live view, in WLED order)
    let f = WL.frame; if (!f) return null;
    // the controller's live view arrives ~21×/s; blend from the previous frame to the newest over that gap so the mini house moves smoothly
    const pf = WL.prevFrame; if (pf && pf.length === f.length) {
      const a = Math.min(1, (performance.now() - WL.frameAt) / (WL.gap || 47)), m = liveBuf.m && liveBuf.m.length === f.length ? liveBuf.m : (liveBuf.m = new Uint8Array(f.length));
      for (let i = 0; i < f.length; i++) m[i] = pf[i] + (f[i] - pf[i]) * a; f = m;
    }
    const n = f.length / 3, total = WL.info?.leds?.count || n;
    if (n >= N && total === N) return f;
    const b = liveBuf.b || (liveBuf.b = new Uint8Array(N * 3));
    for (let i = 0; i < N; i++) { const j = Math.min(n - 1, Math.floor(i * n / total)); b[i * 3] = f[j * 3]; b[i * 3 + 1] = f[j * 3 + 1]; b[i * 3 + 2] = f[j * 3 + 2]; }
    return b;
  }

  /* ---------------- master controls (gallery-wide) ---------------- */
  const M = APP.master;
  function themeCols(name) { for (const g of CAT.THEMES) for (const t of g[1]) if (t[0] === name) return t[1]; return null; }
  // editor works in roof values: the library's master speed/brightness is the starting point, then the sliders own it
  function bakeMaster(P) {
    if (!P || isSec(P) || isStack(P)) return P;
    if (!P.sxFixed) { P.sx = clamp(Math.round(P.sx * M.speed / 100), 0, 255); P.sxFixed = true; }
    if (!P.briFixed) { P.bri = clamp(Math.round(P.bri * M.bright / 100), 1, 255); P.briFixed = true; }
    P.colFixed = true;   // the swatches you see in the editor are the colours that play (the Library's master colours don't repaint a tuned look)
    return P;
  }
  function applyMaster(P) {
    const q = clone(P);
    if (isSec(q) || isStack(q)) { if (!q.briFixed) q.bri = clamp(Math.round(q.bri * M.bright / 100), 1, 255); return q; }
    if (!q.sxFixed) q.sx = clamp(Math.round(q.sx * M.speed / 100), 0, 255);     // looks you tuned keep their own speed/brightness
    if (!q.briFixed) q.bri = clamp(Math.round(q.bri * M.bright / 100), 1, 255);
    if (M.spacing) q.spc = M.spacing - 1;
    const tc = !q.colFixed && M.theme && themeCols(M.theme);
    if (tc) {
      if (q.cmode === 'bulb') { let k = 0; q.seq = q.seq.map(e => e.c ? { c: tc[k++ % tc.length].slice(), n: e.n } : e); }
      else if (q.mycol) q.colors = q.colors.map((c, k) => tc[k % tc.length].slice());
      else if (usesPal(q.fx) && q.pal === 2) q.col = [tc[0], q.col[1], q.col[2]];               // one color over its own background
      else if (usesPal(q.fx) && q.pal === 3) q.col = [tc[0], tc[1] || tc[0], q.col[2]];
      else if (usesPal(q.fx)) { q.mycol = true; q.colors = clone(tc); q.rep = 1; q.blend = false; }
      else q.col = [tc[0], q.col[1], q.col[2]];
    }
    return q;
  }

  /* ---------------- canvas house renderer (approved mockup look) ---------------- */
  const plateImg = new Image(); let plateReady = false; const allViews = [], customPlate = !!layout.photo?.startsWith('data:image/');
  plateImg.onload = () => { plateReady = true; allViews.forEach(v => { v.plate = null; v.dirty = true; }); };
  plateImg.src = layout.photo?.startsWith('data:image/') ? layout.photo : 'demo-house.svg';
  const CROP_CARD = { x: 0.0, y: 0.11, w: 0.82, h: 0.80 }, CROP_STAGE = { x: 0.0, y: 0.12, w: 0.82, h: 0.76 }, CROP_FULL = { x: 0.0, y: 0.14, w: 1, h: 0.74 };
  const DPR = Math.min(2, devicePixelRatio || 1);
  function makeView(canvas, crop, size, dprCap) {
    const v = { canvas, ctx: canvas.getContext('2d'), crop, size: size || 1, plate: null, cw: 0, ch: 0, dirty: true, dpr: Math.min(DPR, dprCap || 2) };
    v.resize = () => {
      const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return false;
      const cw = Math.max(2, Math.round(r.width * v.dpr)), ch = Math.max(2, Math.round(r.height * v.dpr));
      if (cw === v.cw && ch === v.ch && v.plate) return true;
      v.cw = canvas.width = cw; v.ch = canvas.height = ch;
      const c = v.crop; v.k = Math.max(cw / (c.w * W), ch / (c.h * H));
      v.ox = cw / 2 - (c.x + c.w / 2) * W * v.k; v.oy = ch / 2 - (c.y + c.h / 2) * H * v.k;
      v.plate = null; v.dirty = true; return true;
    };
    allViews.push(v); return v;
  }
  function buildPlate(v) {
    const c = document.createElement('canvas'); c.width = v.cw; c.height = v.ch; const x = c.getContext('2d');
    x.fillStyle = '#05070d'; x.fillRect(0, 0, v.cw, v.ch);
    if (plateReady) { if (customPlate) x.filter = 'grayscale(1)'; x.drawImage(plateImg, v.ox, v.oy, W * v.k, H * v.k); x.filter = 'none'; }
    x.fillStyle = 'rgba(3,5,12,0.18)'; x.fillRect(0, 0, v.cw, v.ch);
    const g = x.createRadialGradient(v.cw / 2, v.ch * 0.5, v.ch * 0.3, v.cw / 2, v.ch * 0.5, Math.max(v.cw, v.ch) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)'); x.fillStyle = g; x.fillRect(0, 0, v.cw, v.ch);
    const r0 = Math.max(1.1, 3.8 * v.k * v.size); x.fillStyle = 'rgba(18,20,26,0.75)';
    for (const l of LEDS) { x.beginPath(); x.arc(l.x * v.k + v.ox, l.y * v.k + v.oy, r0 * 1.05, 0, 6.2832); x.fill(); }
    v.plate = c;
  }
  // the controller's output stage (Studio firmware): evening drift + breath, applied after the effects, so the live view
  // doesn't include it either: apply it to everything drawn on WLED
  const TN = { on: false, p: 0, kG: 1, kB: 1, dim: 1, br: null };
  function tlsTick() {
    const t = WL.state?.tls || APP.tlsFx; TN.on = false; if (!t || !FXL) return;
    let p = 0; const d = t.drift;
    if (d && d.on) {
      const now = new Date(), mins = now.getHours() * 60 + now.getMinutes(), ss = sunTimes(now).set, st = d.st >= 1440 ? (t.sunset ?? ss.getHours() * 60 + ss.getMinutes()) : d.st % 1440, en = d.en % 1440;
      let len = (en - st + 1440) % 1440 || 1440; const into = (mins - st + 1440) % 1440;
      if (into <= len) p = into / len; else { const since = (mins - en + 1440) % 1440, hold = (360 - en + 1440) % 1440; p = since <= hold ? 1 : 0; }
    }
    TN.p = p; TN.kG = 1 - (d?.warm || 0) / 100 * 0.35 * p; TN.kB = 1 - (d?.warm || 0) / 100 * 0.8 * p; TN.dim = 1 - (d?.dim || 0) / 100 * p;
    FXL.config.slowMul = p > 0 ? 1 + ((d.slow || 10) / 10 - 1) * p : 1;
    TN.br = t.breath && t.breath.on ? { depth: t.breath.depth / 100, per: t.breath.per * 1000, len: t.breath.len || 190 } : null;
    TN.on = p > 0 || !!TN.br;
  }
  function outStage(buf) {   // display space: linear factor f shows as f^(1/2.8)
    if (!TN.on || !buf) return buf;
    const o = outStage.o && outStage.o.length === buf.length ? outStage.o : (outStage.o = new Uint8Array(buf.length)), n = buf.length / 3, e = 1 / 2.8;
    const ph = TN.br ? (Date.now() % TN.br.per) / TN.br.per : 0;
    for (let i = 0; i < n; i++) {
      let f = TN.dim; if (TN.br) f *= 1 - TN.br.depth * (0.5 - 0.5 * Math.cos(6.2831853 * (ph - i / TN.br.len)));
      o[i * 3] = buf[i * 3] * Math.pow(f, e); o[i * 3 + 1] = buf[i * 3 + 1] * Math.pow(f * TN.kG, e); o[i * 3 + 2] = buf[i * 3 + 2] * Math.pow(f * TN.kB, e);
    }
    return o;
  }
  function drawHouse(v, buf, bri) {
    buf = outStage(buf);
    if (!v.cw || !v.plate) { if (!v.resize()) return; }
    if (!v.plate) buildPlate(v);
    const ctx = v.ctx, k = v.k, sz = v.size;
    ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(v.plate, 0, 0);
    if (!buf) { v.dirty = false; return; }
    const r0 = Math.max(1.1, 3.8 * k * sz), R = Math.max(5, 22 * k * sz), WR = Math.max(8, 46 * k * sz), gb = 0.35 + 0.65 * (bri ?? 255) / 255;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const r = buf[i * 3], gg = buf[i * 3 + 1], b = buf[i * 3 + 2], m = Math.max(r, gg, b);
      if (m < 4) continue;
      const a = (m / 255) * gb, s = 255 / m, cr = r * s | 0, cg = gg * s | 0, cb = b * s | 0, cs = cr + ',' + cg + ',' + cb;
      const x = LEDS[i].x * k + v.ox, y = LEDS[i].y * k + v.oy;
      const g1 = ctx.createRadialGradient(x, y, 0, x, y, R);
      g1.addColorStop(0, 'rgba(' + cs + ',' + (0.62 * a).toFixed(3) + ')'); g1.addColorStop(0.3, 'rgba(' + cs + ',' + (0.2 * a).toFixed(3) + ')'); g1.addColorStop(1, 'rgba(' + cs + ',0)');
      ctx.fillStyle = g1; ctx.fillRect(x - R, y - R, R * 2, R * 2);
      ctx.save(); ctx.translate(x, y + WR * 0.45); ctx.scale(0.75, 1.35);
      const g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, WR);
      g2.addColorStop(0, 'rgba(' + cs + ',' + Math.min(0.4, 0.10 * a).toFixed(3) + ')'); g2.addColorStop(1, 'rgba(' + cs + ',0)');
      ctx.fillStyle = g2; ctx.fillRect(-WR, -WR, WR * 2, WR * 2); ctx.restore();
      const hr = Math.min(255, cr * 1.05 + 35 * a), hg = Math.min(235, cg * 1.12 + 22 * a), hb = Math.min(235, cb * 1.1 + 8 * a);  // warm core, never white
      ctx.fillStyle = 'rgba(' + (hr | 0) + ',' + (hg | 0) + ',' + (hb | 0) + ',' + Math.min(1, 0.3 + 0.8 * a).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, r0, 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over'; v.dirty = false;
  }

  /* ---------------- UI state ---------------- */
  const state = { sec: 'all', q: '', route: 'gallery', edit: null, scrollMem: 0, full: false, pushing: false };
  const stackCols = P => P.stack.layers.slice().reverse().flatMap(l => (l.sw && l.cmode !== 'gradient' ? l.sw.cols : l.stops.map(s => s[1])).slice(0, 2));
  const swatchesOf = P => isStack(P) ? stackCols(P).slice(0, 5) : isSec(P) ? P.parts.flatMap(pt => swatchesOf(partP(pt)).slice(0, 2)).slice(0, 5) : (P.cmode === 'bulb' ? P.seq.filter(e => e.c).map(e => e.c) : P.mycol && P.colors ? P.colors : P.col).slice(0, 5);
  const allCats = () => CAT.CATS.filter(c => !['mine', 'house', 'all'].includes(c[0])).concat(APP.cats);
  const NAVF = () => [['mine', 'Saved looks', '★'], ['house', 'Current WLED output', '●']].concat(allCats(), [['all', 'All looks', '▦']]);
  const SEC_SUB = { all: 'Every look, on the roofline controller. Choose one to edit it.', mine: 'Looks you saved or starred.', house: 'What the roof is doing now, and what it did recently.', fall: 'Warm reds and ambers for the season.', ambient: 'Slow, quiet looks for every night.', events: 'Team colors and event-day looks.', holiday: 'For the big days.', party: 'Busier looks for guests.', mic: 'React to music through the controller’s mic.', wild: 'The weird and wonderful ones.', chase: 'Things that move along the roofline.', xmas: 'Old-fashioned holiday colors.', strobe: 'Fast flashing. Party only, not for every night.' };
  function inSec(l, sec) {
    if (sec === 'all') return true;
    if (sec === 'mine') return l.cats.includes('mine') || l.custom || !!APP.starred[l.id];
    if (sec === 'house') return l.id === houseLookId();
    return l.cats.includes(sec);
  }
  const count = sec => LOOKS.filter(l => inSec(l, sec)).length;
  const matchQ = l => { const q = state.q.trim().toLowerCase(); return !q || l.name.toLowerCase().includes(q) || (l.desc || '').toLowerCase().includes(q); };
  function renderNav() {
    $('nav').innerHTML = NAVF().map(n => '<button data-sec="' + n[0] + '" class="' + (state.sec === n[0] ? 'on' : '') + '"><span class="ic">' + n[2] + '</span>' + esc(n[1]) + (n[0] === 'house' ? '' : '<em>' + count(n[0]) + '</em>') + '</button>').join('') + '<button class="navadd" id="navAdd">＋ New category</button>';
  }
  function groupsFor() {
    if (state.q.trim()) return [{ title: 'Results for “' + state.q.trim() + '”', looks: LOOKS.filter(matchQ) }];
    if (state.sec === 'all') {
      const seen = {};
      return ['mine'].concat(allCats().map(c => c[0])).map(c => {
        const ls = LOOKS.filter(l => !seen[l.id] && (c === 'mine' ? inSec(l, 'mine') : l.cats.includes(c)));
        ls.forEach(l => seen[l.id] = 1); return { title: CAT_LABEL[c], looks: ls };
      });
    }
    if (state.sec === 'house') {
      const cur = houseLookId(), recent = (APP.history || []).filter(id => id !== cur && BY_ID[id]).map(id => BY_ID[id]);
      return [{ title: 'Current WLED output', looks: cur ? [BY_ID[cur]] : [] }, { title: 'Recent WLED output history', looks: recent }];
    }
    return [{ title: CAT_LABEL[state.sec] || state.sec, looks: LOOKS.filter(l => inSec(l, state.sec)) }];
  }
  function cardHTML(l) {
    const st = APP.starred[l.id] || l.cats.includes('mine') || l.custom;
    return '<article class="card" tabindex="0" data-id="' + l.id + '"><div class="th"><canvas></canvas>' +
      '<span class="badge"><span class="dot"></span>Active on WLED</span>' + (l.custom ? '<span class="badge mine">Your look</span>' : '') +
      '<button class="star' + (st ? ' on' : '') + '" title="Add to Saved looks" data-act="star">' + (st ? '★' : '☆') + '</button>' +
      '<button class="qpush" data-act="push">▶ Push</button></div>' +
      '<div class="meta"><div><div class="nm">' + esc(l.name) + '<button class="rnb" data-act="rename" title="Rename">✎</button>' + (l.cats.includes('mic') ? '<span class="mic">needs mic</span>' : '') + (l.flash ? '<span class="mic" title="Fast flashing">⚡ flashes</span>' : '') + '</div><div class="mood">' + esc(l.desc || '') + '</div></div>' +
      '<div class="sw">' + cardSwatches(applyMaster(l.P)) + '</div></div></article>';
  }
  function cardSwatches(P) {   // what the card's animation actually uses: its own colors, or the palette strip for palette looks
    if (isStack(P)) return swatchesOf(P).filter(c => Math.max(...c) > 12).map(c => '<i style="background:' + hex(c) + ';box-shadow:0 0 6px ' + hex(c) + '88"></i>').join('');
    if (isSec(P)) return P.parts.map(pt => '<i style="background:' + hex(swatchesOf(partP(pt))[0] || [90, 90, 90]) + '"></i>').join('');
    const palLook = P.cmode !== 'bulb' && !P.mycol && usesPal(P.fx) && (P.pal >= 6 || P.pal === 0);
    if (palLook && FXL) return '<i class="palsw" style="background:' + FXL.paletteCss(P.pal, P.col) + '"></i>';
    return swatchesOf(P).filter(c => Math.max(...c) > 12).map(c => '<i style="background:' + hex(c) + ';box-shadow:0 0 6px ' + hex(c) + '88"></i>').join('');
  }
  let cardViews = []; const visibleCards = new Set();
  const io = new IntersectionObserver(es => es.forEach(en => { const cv = cardViews[+en.target.dataset.vi]; if (!cv) return; if (en.isIntersecting) { visibleCards.add(cv); cv.v.dirty = true; } else visibleCards.delete(cv); }), { root: $('scroller'), rootMargin: '60px 0px' });
  function renderGallery(keepScroll) {
    io.disconnect(); visibleCards.clear();
    cardViews.forEach(c => { const i = allViews.indexOf(c.v); if (i >= 0) allViews.splice(i, 1); }); cardViews = [];
    $('groups').innerHTML = groupsFor().filter(g => g.looks.length).map(g => '<section class="group"><div class="gh"><h2>' + esc(g.title) + '</h2><span>' + g.looks.length + (g.looks.length === 1 ? ' look' : ' looks') + '</span></div><div class="grid">' + g.looks.map(cardHTML).join('') + '</div></section>').join('')
      || '<div class="empty">' + (state.q ? 'No looks match “' + esc(state.q) + '”.' : 'Nothing here yet.') + '</div>';
    $('groups').querySelectorAll('.card').forEach((el, i) => {
      const cv = el.querySelector('canvas'); cv.dataset.vi = i;
      cardViews.push({ v: makeView(cv, CROP_CARD, 1.7, 1.5), id: el.dataset.id, el, phase: i * 1371 });
      io.observe(cv);
    });
    $('secTitle').textContent = state.q.trim() ? 'Search' : (state.sec === 'all' ? 'All looks' : CAT_LABEL[state.sec] || state.sec);
    $('secSub').textContent = state.q.trim() ? 'Across every section.' : (SEC_SUB[state.sec] || 'Your category. Add looks from any look’s edit page.');
    if (!keepScroll) $('scroller').scrollTop = 0;
    markLive();
  }
  function markLive() { const id = houseLookId(); cardViews.forEach(c => c.el.classList.toggle('live', c.id === id)); }
  function onHouseChanged() { markLive(); $('pillName').textContent = houseName(); if (state.route === 'edit') syncEditState(); syncController(); }
  function syncController() {
    const ok = WL.ws && WL.ws.readyState === 1, i = WL.info;
    $('footDot').style.background = ok ? 'var(--live)' : 'var(--warn)';
    $('footName').innerHTML = ok ? esc(i?.name || 'WLED') + ' · <b>online</b>' : 'Controller offline';
    $('footSub').textContent = ok && i ? `${i.leds?.count} bulbs · WiFi ${i.wifi?.signal ?? '–'}% · ${i.leds?.fps ?? '–'} fps` : (WL.host ? 'Reconnecting to ' + WL.host + '…' : 'WLED isn’t set up');
    $('ctrlSub').textContent = ok ? 'online' : 'offline'; $('ctrlSub').className = 'sub ' + (ok ? 'ok' : '');
    if (WL.state) { $('powerTgl').checked = !!WL.state.on; const nl = WL.state.nl || {}; $('sleepSub').textContent = nl.on ? (nl.rem > 0 ? Math.ceil(nl.rem / 60) + ' min left' : 'fading') : 'off'; }
  }

  /* per-row */
  function setPerRow(n) {
    APP.perRow = clamp(n, 2, 6); save(['perRow']);
    document.documentElement.style.setProperty('--cols', APP.perRow); document.documentElement.style.setProperty('--gap', APP.perRow >= 5 ? '12px' : '18px');
    document.querySelectorAll('#perrow button').forEach(b => b.classList.toggle('on', +b.dataset.c === APP.perRow));
    if ($('groups').children.length) renderGallery(true);
  }
  document.querySelectorAll('#perrow button').forEach(b => b.onclick = () => setPerRow(+b.dataset.c));
  addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input,textarea,select') || state.route !== 'gallery') return;
    if (e.key === '-' || e.key === '_') setPerRow(APP.perRow + 1); else if (e.key === '=' || e.key === '+') setPerRow(APP.perRow - 1);
  });

  /* master */
  function renderMaster() {
    $('mSpeed').value = M.speed; $('mSpeedO').textContent = (M.speed / 100).toFixed(2).replace(/0$/, '') + '×';
    $('mBright').value = M.bright; $('mBrightO').textContent = M.bright + '%';
    document.querySelectorAll('#mSpacing button').forEach(b => b.classList.toggle('on', +b.dataset.s === M.spacing));
    $('mTheme').value = M.theme; $('master').classList.toggle('active', M.speed !== 100 || M.bright !== 100 || !!M.spacing || !!M.theme);
  }
  function setMaster(k, v) { M[k] = v; save(['master']); renderMaster(); cardViews.forEach(c => c.v.dirty = true); if (k === 'theme') renderGallery(true); }
  $('mTheme').innerHTML = '<option value="">Each look’s own</option>' + CAT.THEMES.map(g => '<optgroup label="' + esc(g[0]) + '">' + g[1].map(t => '<option>' + esc(t[0]) + '</option>').join('') + '</optgroup>').join('');
  $('mSpeed').oninput = e => setMaster('speed', +e.target.value); $('mBright').oninput = e => setMaster('bright', +e.target.value);
  $('mTheme').onchange = e => setMaster('theme', e.target.value);
  document.querySelectorAll('#mSpacing button').forEach(b => b.onclick = () => setMaster('spacing', +b.dataset.s));
  $('mReset').onclick = () => { Object.assign(M, { speed: 100, bright: 100, spacing: 0, theme: '' }); setMaster('speed', 100); };

  /* nav + search + cards */
  $('nav').addEventListener('click', e => { const b = e.target.closest('button[data-sec]'); if (!b) return; state.sec = b.dataset.sec; state.q = ''; $('q').value = ''; renderNav(); renderGallery(); });
  $('q').addEventListener('input', function () { state.q = this.value; renderGallery(); });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && state.route === 'gallery' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); }
    if (e.key === 'Escape') { if ($('themePop')?.classList.contains('on') || $('catPop')?.classList.contains('on')) return; if (state.full) setFull(false); else if (state.route === 'edit' && document.activeElement.tagName !== 'INPUT') goLibrary(); }
  });
  $('groups').addEventListener('click', e => {
    const card = e.target.closest('.card'); if (!card || e.target.closest('input.rn')) return;
    const id = card.dataset.id, look = BY_ID[id], act = e.target.closest('[data-act]');
    if (act?.dataset.act === 'rename') { e.stopPropagation(); startRename(card.querySelector('.nm'), id); return; }
    if (act?.dataset.act === 'star') {
      e.stopPropagation(); if (look.cats.includes('mine') || look.custom) return toast(look.name + ' is one of saved looks.', 'var(--accent)');
      APP.starred[id] = !APP.starred[id]; save(['starred']); act.classList.toggle('on', !!APP.starred[id]); act.textContent = APP.starred[id] ? '★' : '☆'; renderNav(); return;
    }
    if (act?.dataset.act === 'push') { e.stopPropagation(); pushToHouse(applyMaster(look.P), id, look.P).then(() => toast('Fading ' + look.name + ' onto the house…')); return; }
    openEdit(id, card.querySelector('canvas'));
  });
  $('groups').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('card')) openEdit(e.target.dataset.id, e.target.querySelector('canvas')); });
  $('onhouse').addEventListener('click', () => { const id = houseLookId(); if (id) openEdit(id, null); else { state.sec = 'house'; renderNav(); renderGallery(); } });

  /* house menu */
  $('nav2').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const s = b.dataset.sec;
    if (s === 'setup') { location.hash = 'wiring'; return; }
    if (s === 'ctrl') return openController();
    if (s === 'sections') return openSections();
    if (s === 'builder') return void (location.hash = 'builder');
    if (s === 'make') return void (location.hash = 'make');
    if (s === 'playlists') return openPlaylists();
    if (s === 'schedule') return openSchedule();
    if (s === 'dimnow') return dimNow();
    if (s === 'sleep') { const p = $('sleepPop'), r = b.getBoundingClientRect(); p.style.left = (r.right + 8) + 'px'; p.style.top = Math.min(innerHeight - 180, r.top) + 'px'; p.hidden = !p.hidden; }
  });
  $('sleepPop').addEventListener('click', e => {
    const b = e.target.closest('[data-nl]'); if (!b) return; const m = +b.dataset.nl;
    const sd = APP.sleepDefaults || {}; wpost(m ? { on: true, nl: { on: true, dur: m, mode: sd.mode ?? 1, tbri: sd.tbri ?? 0 } } : { nl: { on: false } }); $('sleepPop').hidden = true;
    toast(m ? 'Fading to off over ' + (m >= 60 ? m / 60 + ' hr' : m + ' min') + ' 🌙' : 'Fade cancelled', 'var(--accent)');
  });
  document.addEventListener('mousedown', e => { if (!$('sleepPop').hidden && e.target.closest && !e.target.closest('#sleepPop,[data-sec=sleep]')) $('sleepPop').hidden = true; });
  $('powerTgl').onchange = e => wpost({ on: e.target.checked });

  /* ======================= EDIT PAGE ======================= */
  const vStage = makeView($('stageCv'), CROP_STAGE, 1, 2), vMini = makeView($('miniCv'), CROP_CARD, 1.5, 2), vPill = makeView($('pillCv'), { x: 0.02, y: 0.25, w: 0.78, h: 0.45 }, 1.4, 2);
  const ro = new ResizeObserver(() => { [vStage, vMini, vPill].forEach(v => v.resize()); cardViews.forEach(c => c.v.resize()); });
  [$('stageCv'), $('miniCv'), $('pillCv')].forEach(c => ro.observe(c));
  let pendingGhost = null;
  function openEdit(id, fromCanvas) { pendingGhost = fromCanvas || null; location.hash = 'edit=' + id; }
  function goLibrary() { location.hash = 'library'; }
  function enterEdit(id, instant) {
    const look = BY_ID[id]; if (!look) return goLibrary();
    if (isSec(look.P)) return openSections(id);
    if (isStack(look.P)) { location.replace(location.href.split('#')[0] + (window.TLSimple && TLSimple.canOpen(look) && !look.P.edited ? '#make=' : '#builder=') + id); return; }
    if (state.route === 'gallery') state.scrollMem = $('scroller').scrollTop;
    state.edit = { id, P: bakeMaster(clone(look.P)), locks: [] };   // always the library's version; the pill says whether the roof matches
    resetStage(); hov.hi = -1; hov.k = -1;
    $('eName').textContent = look.name; $('fsName').textContent = look.name; renderCrumbCats();
    $('pTitle').textContent = 'Tune ' + look.name;
    $('pMade').textContent = look.labels ? 'Made for this look' : 'WLED controls'; $('pMade').className = 'made' + (look.labels ? '' : ' gen');
    $('pDesc').textContent = (look.desc || '') + '.';
    renderControls(); syncEditState(); vStage.dirty = true;
    const g = pendingGhost; pendingGhost = null; showRoute('edit', instant); if (g && !instant && !REDUCED) flyGhost(g);
  }
  function showRoute(r, instant) {
    state.route = r; if (instant) document.body.classList.add('noanim');
    ['gallery', 'edit', 'schedule', 'sections', 'playlists', 'controller', 'builder', 'simple'].forEach(x => $(x).classList.toggle('hidden', r !== x));
    if (r !== 'builder' && TLB) TLB.close();
    if (r !== 'simple' && window.TLSimple) TLSimple.close();
    if (instant) { void document.body.offsetWidth; document.body.classLi…17022 tokens truncated… = ((h * 60 + bm) - 720 + 1440) % 1440; if (t > bed && t < end) reapply.push({ en: 1, hour: h, min: bm, macro: PS_NIGHT, dow: 127 }); }
      }
      reapply.sort((a, b) => ((a.hour + 12) % 24) - ((b.hour + 12) % 24)); ins.push(...reapply);   // after the must-have timers (game day etc.), earliest first
      if (!V16 && ins.length > 8) ins.splice(8);   // WLED 0.15 has 8 regular timer slots (the last hourly bedtime re-applies are dropped)
      ins.push({ en: SC.offMode === 'sunrise' ? 1 : 0, hour: 255, min: 0, macro: SC.offMode === 'sunrise' ? PS_OFF : 0, dow: 127 });
      ins.push({ en: SC.onMode === 'sunset' ? 1 : 0, hour: V16 ? 254 : 255, min: SC.onOffset, macro: SC.onMode === 'sunset' ? PS_TONIGHT : 0, dow: 127 });   // sunset: hour 254 on WLED 16, second hour-255 entry on 0.15
      await cfgPatch({ timers: { ins } });
      await pause(800);
      const seg = (before.seg || []).map(s => ({ id: s.id, start: s.start, stop: s.stop, fx: s.fx, sx: s.sx, ix: s.ix, c1: s.c1, c2: s.c2, c3: s.c3, o1: s.o1, o2: s.o2, o3: s.o3, pal: s.pal, col: s.col, grp: s.grp, spc: s.spc, of: s.of, on: s.on, bri: s.bri }));
      await wpost({ on: before.on, bri: before.bri, transition: 0, seg });
      // tonight's look → preset 240 (the server does this every day; force it now)
      const ap = await fetch('/api/schedule/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: bodyOf(SC.eveLook) }) }).then(r => r.json());
      const c = await wget('/json/cfg'), n = (c.timers?.ins || []).filter(t => t.en && t.macro).length;
      $('schStat').innerHTML = '✓ Saved · ' + n + ' timers' + (ap.ok ? ' · tonight: ' + esc(ap.tonight || '') : ' · ⚠️ ' + esc(ap.error || ''));
      toast('Schedule saved to the controller 🌙'); openSchedule();
    } catch (err) { $('schStat').textContent = '⚠️ ' + err.message; }
    btn.disabled = false;
  };
  $('schPreview').onclick = async () => { readSchedule(); await wpost(Object.assign({}, bedtimeBody(), { transition: 20 })); toast('This is bedtime. Push a look or use “Bedtime dim now” to undo.', 'var(--accent)'); };
  // one-tap: dim the roof to the bedtime brightness now / back to normal
  async function dimNow() {
    const s = WL.state; if (!s) return;
    if (APP.dimmedFrom) { await wpost({ on: true, bri: APP.dimmedFrom, transition: 30 }); APP.dimmedFrom = null; save(['dimmedFrom']); toast('Back to normal brightness'); }
    else { APP.dimmedFrom = s.bri; save(['dimmedFrom']); await wpost({ on: true, bri: pct2bri(SC.nightBri), transition: 30 }); toast('Dimmed to ' + SC.nightBri + '% · tap again to go back', 'var(--accent)'); }
    syncDim();
  }
  function syncDim() { const on = !!APP.dimmedFrom; $('dimNowBtn').classList.toggle('on', on); $('dimNowBtn').firstChild.nextSibling.textContent = on ? 'Back to normal' : 'Bedtime dim now'; $('dimSub').textContent = on ? 'dimmed' : SC.nightBri + '%'; }
  syncDim();
  // keep the schedule's stored copies of each look in sync with the looks themselves (e.g. after a look is redesigned)
  function refreshScheduleBodies() {
    if (!WL.host) return;
    const before = JSON.stringify([SC.default?.body, SC.programs.map(p => p.body)]);
    if (SC.eveLook !== 'current' && (BY_ID[SC.eveLook] || plName(SC.eveLook))) SC.default = { look: SC.eveLook, name: nameOf(SC.eveLook), body: bodyOf(SC.eveLook) };
    SC.programs.forEach(p => { if (BY_ID[p.look]) { p.lookName = BY_ID[p.look].name; p.body = bodyOf(p.look); } });
    if (JSON.stringify([SC.default?.body, SC.programs.map(p => p.body)]) !== before) fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: SC }) });
  }


  /* ======================= ▤ sections page ======================= */
  const RUNS = (() => { let o = 0; return (layout.runs || []).slice().map((r, k) => ({ r, k })).sort((a, b) => (a.r.port - b.r.port) || (a.k - b.k)).map(({ r }) => { const x = { start: o, stop: o + r.leds, name: r.name, port: r.port }; o += r.leds; return x; }); })();
  const SEC_COL = ['#62d682', '#4dc3ff', '#b98cff', '#4dffa6', '#ff6b9a', '#ffd36b', '#7a8cff', '#ff8a4d'];
  const SEC_SPEEDS = [[0.25, '¼×'], [0.5, '½×'], [0.75, '¾×'], [1, '1×'], [1.5, '1½×'], [2, '2×']];
  const secLooks = () => LOOKS.filter(l => !isSec(l.P) && !isStack(l.P) && l.P.cmode !== 'bulb');
  let SD = null, vSec = null;   // the split look being edited
  const PORT_NAME = Object.fromEntries([...new Set(RUNS.map(r => r.port))].map(port => [port, 'Output ' + port]));
  const portRange = pt => { const rs = RUNS.filter(r => r.port === pt); return rs.length ? [rs[0].start, rs[rs.length - 1].stop] : null; };
  function nameFor(start, stop) {   // name a bulb range after the roof runs it covers
    const saved = APP.roofSections.find(s => s.start === start && s.stop === stop);
    if (saved) return saved.name;
    for (const pt in PORT_NAME) { const r = portRange(+pt); if (r && r[0] === start && r[1] === stop) return PORT_NAME[pt]; }
    const rs = RUNS.filter(r => r.start < stop && r.stop > start);
    if (rs.length > 2 && rs[0].start >= start && rs[rs.length - 1].stop <= stop) { const ports = [...new Set(rs.map(r => r.port))]; return ports.map(x => PORT_NAME[x] || 'Output ' + x).join(' + '); }
    if (rs.length && rs[0].start >= start && rs[rs.length - 1].stop <= stop) return rs.map(r => r.name.replace(/ · .*/, '')).join(' + ');
    return 'Bulbs ' + (start + 1) + '–' + stop;
  }
  function splitRanges(kind) {
    if (kind === 'outputs') return RUNS.map(r => [r.start, r.stop, r.name]);
    const raw = (APP.roofSections || []).filter(s => Number.isInteger(s.start) && Number.isInteger(s.stop) && s.start >= 0 && s.stop <= N && s.stop > s.start).slice().sort((a, b) => a.start - b.start);
    const parts = []; let cursor = 0;
    raw.forEach(s => { const start = Math.max(cursor, s.start); if (start > cursor) parts.push([cursor, start, 'Bulbs ' + (cursor + 1) + '–' + start]); if (s.stop > start) parts.push([start, s.stop, s.name]); cursor = Math.max(cursor, s.stop); });
    if (cursor < N) parts.push([cursor, N, 'Bulbs ' + (cursor + 1) + '–' + N]);
    return parts;
  }
  function resplit(kind) {
    const old = SD.P.parts, ranges = splitRanges(kind), fallback = old[0]?.look || secLooks()[0]?.id || LOOKS[0]?.id;
    if (!ranges.length) return toast('Add output channels or named roof sections first.', 'var(--warn)');
    SD.P.parts = ranges.map(([a, b, label]) => {
      const prior = old.filter(p => p.start < b && p.stop > a).sort((x, y) => (Math.min(b, y.stop) - Math.max(a, y.start)) - (Math.min(b, x.stop) - Math.max(a, x.start)))[0];
      return { start: a, stop: b, name: label || nameFor(a, b), look: prior?.look || fallback, dir: prior?.dir || 'n', speed: prior?.speed || 1 };
    });
    resetSecView(); renderSections();
  }
  function resetSecView() { if (vSec) vSec.parts = []; }
  function openSections(id) {
    showRoute('sections'); history.replaceState(null, '', location.href.split('#')[0] + '#sections' + (id ? '=' + id : ''));
    if (!vSec) vSec = makeView($('secCv'), CROP_CARD, 1.4, 2);
    const l = id && BY_ID[id] && isSec(BY_ID[id].P) ? BY_ID[id] : null;
    if (l) SD = { id: l.id, name: l.name, P: clone(l.P) };
    else if (!SD || SD.id) { SD = { id: null, name: 'My split look', P: { parts: [], bri: 180 } }; resplit('outputs'); }
    resetSecView(); renderSections();
  }
  function renderSections() {
    $('secName').value = SD.name; $('secTitle').textContent = SD.name;
    $('secStrip').innerHTML = SD.P.parts.map((pt, k) => '<i title="' + esc(pt.name) + '" style="flex:' + (pt.stop - pt.start) + ';background:' + SEC_COL[k % SEC_COL.length] + '"></i>').join('');
    const opts = secLooks().map(l => '<option value="' + l.id + '">' + esc(l.name) + '</option>').join('');
    $('secParts').innerHTML = SD.P.parts.map((pt, k) => '<div class="part" data-k="' + k + '"><div class="bar" style="background:' + SEC_COL[k % SEC_COL.length] + '"></div><div>' +
      '<div class="ph"><b>' + esc(pt.name) + '</b>' + (SD.P.parts.length > 1 ? '<button class="x" data-del="' + k + '" title="Merge into the neighbour">×</button>' : '') + '</div>' +
      '<div class="rg">Bulbs <input type="number" data-a="' + k + '" min="1" max="' + N + '" value="' + (pt.start + 1) + '"' + (k === 0 ? ' disabled' : '') + '> to <input type="number" data-b="' + k + '" min="1" max="' + N + '" value="' + pt.stop + '"' + (k === SD.P.parts.length - 1 ? ' disabled' : '') + '> <span>(' + (pt.stop - pt.start) + ' bulbs)</span></div>' +
      '<select data-look="' + k + '">' + opts + '</select>' +
      '<div class="opts">' + DIRS.map(o => '<button class="chipb' + ((pt.dir || 'n') === o[0] ? ' on' : '') + '" data-pdir="' + k + ':' + o[0] + '">' + o[1] + '</button>').join('') + '<span style="width:8px"></span>' +
      SEC_SPEEDS.map(([v, t]) => '<button class="chipb' + ((pt.speed || 1) === v ? ' on' : '') + '" data-psp="' + k + ':' + v + '">' + t + '</button>').join('') + '</div></div></div>').join('') +
      '<div class="sl"><span>Brightness</span><input type="range" id="secBri" min="5" max="255" value="' + SD.P.bri + '"><output>' + pct(SD.P.bri) + '</output></div>';
    $('secParts').querySelectorAll('select[data-look]').forEach(sel => sel.value = SD.P.parts[+sel.dataset.look].look);
  }
  function setBoundary(k, at) {   // move the divider between part k-1 and part k
    const P = SD.P.parts; at = clamp(Math.round(at), P[k - 1].start + 1, P[k].stop - 1);
    P[k - 1].stop = at; P[k].start = at; P[k - 1].name = nameFor(P[k - 1].start, at); P[k].name = nameFor(at, P[k].stop);
  }
  $('secParts').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.look != null) { SD.P.parts[+t.dataset.look].look = t.value; resetSecView(); return; }
    if (t.dataset.a != null) setBoundary(+t.dataset.a, +t.value - 1);
    if (t.dataset.b != null) setBoundary(+t.dataset.b + 1, +t.value);
    resetSecView(); renderSections();
  });
  $('secParts').addEventListener('input', e => { if (e.target.id === 'secBri') { SD.P.bri = +e.target.value; e.target.nextSibling.textContent = pct(SD.P.bri); } });
  $('secParts').addEventListener('click', e => {
    const d = e.target.closest('[data-del]'), pd = e.target.closest('[data-pdir]'), ps = e.target.closest('[data-psp]');
    if (d) { const k = +d.dataset.del, P = SD.P.parts, nb = k > 0 ? k - 1 : k + 1; P[nb].start = Math.min(P[nb].start, P[k].start); P[nb].stop = Math.max(P[nb].stop, P[k].stop); P[nb].name = nameFor(P[nb].start, P[nb].stop); P.splice(k, 1); }
    else if (pd) { const [k, v] = pd.dataset.pdir.split(':'); SD.P.parts[+k].dir = v; }
    else if (ps) { const [k, v] = ps.dataset.psp.split(':'); SD.P.parts[+k].speed = +v; }
    else return;
    resetSecView(); renderSections();
  });
  document.querySelector('.secsplits').addEventListener('click', e => {
    const b = e.target.closest('[data-split]'); if (!b) return;
    if (b.dataset.split !== 'add') return resplit(b.dataset.split);
    const P = SD.P.parts; if (P.length >= 32) return toast('The controller allows 32 sections', 'var(--warn)');
    let k = 0; P.forEach((x, i) => { if (x.stop - x.start > P[k].stop - P[k].start) k = i; });
    const x = P[k], mid = Math.round((x.start + x.stop) / 2); P.splice(k + 1, 0, { start: mid, stop: x.stop, look: x.look, dir: x.dir, speed: x.speed, name: nameFor(mid, x.stop) }); x.stop = mid; x.name = nameFor(x.start, mid);
    resetSecView(); renderSections();
  });
  $('secName').addEventListener('input', e => { SD.name = e.target.value; $('secTitle').textContent = SD.name; });
  function saveSection() {
    const desc = SD.P.parts.map(pt => (BY_ID[pt.look]?.name || '?')).join(' · ');
    SD.P.parts.forEach(pt => { if (BY_ID[pt.look]) pt.P = clone(BY_ID[pt.look].P); });   // snapshot, used if the library look is ever deleted
    if (SD.id && APP.userLooks.find(u => u.id === SD.id)) { const u = APP.userLooks.find(u => u.id === SD.id); Object.assign(u, { name: SD.name, desc, P: clone(SD.P) }); }
    else { SD.id = 'split-' + Date.now().toString(36); APP.userLooks.unshift({ id: SD.id, name: SD.name, cats: ['mine'], desc, P: clone(SD.P) }); }
    save(['userLooks']); buildLooks(); renderNav(); renderGallery(true);
    history.replaceState(null, '', location.href.split('#')[0] + '#sections=' + SD.id);
    return SD.id;
  }
  $('secSave').onclick = () => { saveSection(); toast('Saved “' + SD.name + '” to Saved looks', 'var(--accent)'); };
  $('secPush').onclick = async () => { const id = saveSection(); try { await pushToHouse(applyMaster(BY_ID[id].P), id, BY_ID[id].P); toast(SD.name + ' is fading onto the house'); } catch (err) { toast('Push failed: ' + err.message, 'var(--warn)'); } };

  /* ======================= ▶ playlists (stored + played by the controller) ======================= */
  const PS_PL = 230, PS_ITEMS = 200;   // playlist presets 230-239; the looks they play 200-229
  APP.playlists = APP.playlists || []; APP.plSlots = APP.plSlots || {};
  let PLsel = null;
  const plById = id => APP.playlists.find(p => p.id === id);
  const plName = v => typeof v === 'string' && v.startsWith('pl:') ? (plById(v.slice(3))?.name || 'Playlist') : null;
  function openPlaylists() {
    showRoute('playlists'); history.replaceState(null, '', location.href.split('#')[0] + '#playlists');
    if (!PLsel && APP.playlists[0]) PLsel = APP.playlists[0].id; renderPlaylists();
  }
  function plLoop(pl) { return pl.items.reduce((a, it) => a + (+it.min || 0), 0); }
  function renderPlaylists() {
    const live = WL.state?.pl > 0 ? WL.state.pl : -1;
    $('plList').innerHTML = APP.playlists.map((pl, i) => '<div class="plitem' + (pl.id === PLsel ? ' on' : '') + '" data-pl="' + pl.id + '"><b>' + esc(pl.name) + '</b><small>' + pl.items.length + ' looks · ' + plLoop(pl) + ' min loop · ' + pl.mode + '</small>' + (live === PS_PL + i ? '<div class="live">● playing on WLED</div>' : '') + '</div>').join('') || '<p class="sh">No playlists yet.</p>';
    const pl = plById(PLsel); $('plStart').disabled = !pl || !pl.items.length; $('plSub').textContent = APP.playlists.length ? APP.playlists.length + '' : '';
    if (!pl) { $('plEdit').innerHTML = '<p class="sh">Make a playlist: a few looks, how long each plays, and how long they crossfade. The controller runs it on its own.</p>'; return; }
    const tot = plLoop(pl) || 1, cols = pl.items.map(it => { const l = BY_ID[it.look]; return l ? hex(swatchesOf(applyMaster(l.P))[0] || [90, 90, 90]) : '#333'; });
    $('plEdit').innerHTML = '<div class="sl"><span>Name</span><input type="text" id="plName" value="' + esc(pl.name) + '"><button class="chipb" id="plDel" title="Delete playlist">Delete</button></div>' +
      '<div class="tg"><span>When it reaches the end</span><span>' + [['repeat', 'Repeat'], ['shuffle', 'Shuffle'], ['once', 'Play once']].map(([v, t]) => '<button class="chipb' + (pl.mode === v ? ' on' : '') + '" data-mode="' + v + '">' + t + '</button>').join(' ') + '</span></div>' +
      '<div class="pltl">' + pl.items.map((it, k) => '<i style="flex:' + (it.min || 1) + ';background:' + cols[k] + '"></i>').join('') + '</div><p class="sh">' + tot + ' min per loop</p>' +
      '<div id="plSteps">' + pl.items.map((it, k) => '<div class="plstep" draggable="true" data-st="' + k + '"><span class="g">⋮⋮</span><select data-sl="' + k + '">' + LOOKS.map(l => '<option value="' + l.id + '"' + (l.id === it.look ? ' selected' : '') + '>' + esc(l.name) + '</option>').join('') + '</select><label>Play<input type="number" min="1" max="600" data-min="' + k + '" value="' + it.min + '">min</label><label>Fade<input type="number" min="0" max="300" data-fade="' + k + '" value="' + it.fade + '">s</label><button class="x" data-rmst="' + k + '">×</button></div>').join('') + '</div>' +
      '<button class="btn" id="plAdd" style="align-self:flex-start">＋ Add look</button>' +
      '<p class="sh">Use it from the Schedule too: pick it as the usual look or for a calendar program. Bedtime still dims at its usual time.</p>';
  }
  $('plList').addEventListener('click', e => { const it = e.target.closest('[data-pl]'); if (it) { PLsel = it.dataset.pl; renderPlaylists(); } });
  $('plNew').onclick = () => { const id = 'p' + Date.now().toString(36); APP.playlists.push({ id, name: 'New playlist', mode: 'repeat', items: [{ look: houseLookId() || 'autumn-twinkle', min: 10, fade: 3 }] }); PLsel = id; save(['playlists']); renderPlaylists(); };
  $('plEdit').addEventListener('change', e => {
    const pl = plById(PLsel), t = e.target; if (!pl) return;
    if (t.id === 'plName') pl.name = t.value.trim() || 'Playlist';
    if (t.dataset.sl != null) pl.items[+t.dataset.sl].look = t.value;
    if (t.dataset.min != null) pl.items[+t.dataset.min].min = clamp(Math.round(+t.value) || 1, 1, 600);
    if (t.dataset.fade != null) pl.items[+t.dataset.fade].fade = clamp(Math.round(+t.value) || 0, 0, 300);
    save(['playlists']); renderPlaylists();
  });
  $('plEdit').addEventListener('click', e => {
    const pl = plById(PLsel); if (!pl) return; const t = e.target;
    if (t.closest('[data-mode]')) pl.mode = t.closest('[data-mode]').dataset.mode;
    else if (t.id === 'plAdd') pl.items.push({ look: pl.items[pl.items.length - 1]?.look || 'autumn-twinkle', min: 10, fade: 3 });
    else if (t.dataset.rmst != null) pl.items.splice(+t.dataset.rmst, 1);
    else if (t.id === 'plDel') { if (!confirmDel.armed) { confirmDel.armed = true; t.textContent = 'Click again to delete'; setTimeout(() => confirmDel.armed = false, 3000); return; } APP.playlists = APP.playlists.filter(p => p !== pl); PLsel = APP.playlists[0]?.id || null; }
    else return;
    save(['playlists']); renderPlaylists();
  });
  function confirmDel() { }
  let plDrag = null;
  $('plEdit').addEventListener('dragstart', e => { const s = e.target.closest('[data-st]'); if (s) plDrag = +s.dataset.st; });
  $('plEdit').addEventListener('dragover', e => { if (plDrag != null && e.target.closest('[data-st]')) e.preventDefault(); });
  $('plEdit').addEventListener('drop', e => { const t = e.target.closest('[data-st]'), pl = plById(PLsel); if (plDrag == null || !t || !pl) return; e.preventDefault(); moveItem(pl.items, plDrag, +t.dataset.st); plDrag = null; save(['playlists']); renderPlaylists(); });
  // write the looks a playlist plays into presets 200-229 (no brightness, so bedtime dimming sticks), then the playlist itself
  function plItemSlot(look) {
    const used = new Set(APP.playlists.flatMap(p => p.items.map(i => i.look)));
    if (APP.plSlots[look] != null) return APP.plSlots[look];
    const taken = new Set(Object.values(APP.plSlots));
    for (let s = PS_ITEMS; s < PS_PL; s++) if (!taken.has(s)) return APP.plSlots[look] = s;
    for (const k in APP.plSlots) if (!used.has(k)) { const s = APP.plSlots[k]; delete APP.plSlots[k]; return APP.plSlots[look] = s; }
    throw new Error('Too many different looks across playlists (30 max)');
  }
  function plBody(pl) {
    const ps = pl.items.map(it => plItemSlot(it.look));
    return { on: true, bri: clamp(Math.max(...pl.items.map(it => applyMaster(BY_ID[it.look]?.P || { bri: 180 }).bri)), 1, 255), playlist: { ps, dur: pl.items.map(it => clamp(it.min * 600, 10, 65000)), transition: pl.items.map(it => it.fade * 10), repeat: pl.mode === 'once' ? 1 : 0, end: 0, r: pl.mode === 'shuffle' } };
  }
  async function writePlaylist(pl) {   // every write makes WLED run that preset, so the caller decides what plays afterwards
    const pause = ms => new Promise(r => setTimeout(r, ms)), i = APP.playlists.indexOf(pl);
    if (i < 0 || i > 9) throw new Error('10 playlists max on the controller');
    const body = plBody(pl); save(['plSlots']);
    for (const [k, it] of pl.items.entries()) {
      const l = BY_ID[it.look]; if (!l) continue;
      const b = wledBody(applyMaster(l.P)); delete b.bri; delete b._palKey; delete b.pl;
      await flushPalettes(); await wpost(Object.assign(b, { psave: body.playlist.ps[k], n: 'Playlist look · ' + l.name, o: true })); await pause(450);
    }
    await wpost(Object.assign({}, body, { psave: PS_PL + i, n: 'Playlist · ' + pl.name, o: true })); await pause(450);
    return PS_PL + i;
  }
  $('plStart').onclick = async () => {
    const pl = plById(PLsel); if (!pl || !pl.items.length) return;
    $('plStart').disabled = true; $('plStat').innerHTML = '<span class="aispin"></span>Loading ' + pl.items.length + ' looks into the controller…';
    try {
      const ps = await writePlaylist(pl);
      await wpost(Object.assign(plBody(pl), { psave: 3, n: 'Studio · ' + pl.name, o: true }));   // boot look = the playlist, so a restart resumes it
      await new Promise(r => setTimeout(r, 500)); await wpost({ ps });
      APP.lastPush = { id: 'pl:' + pl.id, name: pl.name, P: null, at: Date.now() }; save(['lastPush']);
      $('plStat').textContent = '✓ Playing on WLED'; toast(pl.name + ' is playing on WLED');
    } catch (err) { $('plStat').textContent = '⚠️ ' + err.message; }
    $('plStart').disabled = false; setTimeout(renderPlaylists, 800);
  };
  $('plStop').onclick = async () => { await wpost({ pl: -1 }); toast('Playlist stopped: the current look stays on'); setTimeout(renderPlaylists, 600); };

  /* ======================= ◉ controller settings (written to the controller's own config) ======================= */
  let CT = null, ctPoll = null;
  const BTN_ACTS = () => [[0, 'WLED default (on / off)'], [PS_TONIGHT, 'Tonight’s scheduled look'], [3, 'Last look I pushed'], [PS_NIGHT, 'Bedtime dim'], [PS_OFF, 'Lights off']].concat(APP.playlists.slice(0, 10).map((p, i) => [PS_PL + i, 'Playlist: ' + p.name]));
  async function openController() {
    showRoute('controller'); history.replaceState(null, '', location.href.split('#')[0] + '#controller');
    $('ctGrid').innerHTML = '<p class="sh">Reading the controller…</p>';
    await hostReady;
    try { CT = { cfg: await wget('/json/cfg'), info: await wget('/json/info'), st: await wget('/json/state') }; } catch { $('ctGrid').innerHTML = '<p class="sh">Can’t reach the controller right now.</p>'; return; }
    renderController(); clearInterval(ctPoll); ctPoll = setInterval(pollMic, 700);
  }
  function renderRoofSectionManager() {
    const sections = APP.roofSections || [];
    return '<section class="schcard roof-manager"><h3>🏠 Named roof sections</h3><p class="sh">Define reusable bulb ranges on your mapped layout. These names appear as quick-pick zones in the Look Builder.</p>' +
      (sections.length ? sections.map((s, i) => '<div class="roof-section-row" data-roof-row="' + i + '"><input type="text" data-roof-name value="' + esc(s.name) + '" maxlength="32" aria-label="Section name"><label>Bulbs <input type="number" data-roof-start min="1" max="' + N + '" value="' + (s.start + 1) + '"></label><span>to</span><label><input type="number" data-roof-stop min="1" max="' + N + '" value="' + s.stop + '" aria-label="Last bulb"></label><button type="button" class="x" data-roof-delete title="Delete section">×</button></div>').join('') : '<p class="sh">No named roof sections yet. Add ranges such as “Front gable” or “Garage eave.”</p>') +
      '<button type="button" class="btn" id="roofSectionAdd">＋ Add bulb range</button></section>';
  }
  function renderController() {
    const c = CT.cfg, ins = c.hw.led.ins || [], btn = (c.hw.btn?.ins || [])[0] || { macros: [0, 0, 0] }, ar = c.um?.AudioReactive || {}, nl = c.light?.nl || {};
    const sel = (id, v, opts) => '<select id="' + id + '">' + opts.map(([k, t]) => '<option value="' + k + '"' + (+k === +v ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
    const ablOn = ins.some(b => b.maxpwr > 0 && b.ledma > 0);
    $('ctGrid').innerHTML =
      '<section class="schcard"><h3>💡 WLED output channels</h3><p class="sh">LED counts, color order, home photo, and traced channel paths are configured together.</p>' +
      ins.map((b, k) => '<div class="sl wide"><span>' + esc(PORT_NAME[k + 1] || 'Output ' + (k + 1)) + '</span><b>' + b.len + ' bulbs</b><span></span></div>').join('') +
      '<button type="button" class="btn" id="ctOpenWledSetup">Configure output counts &amp; roof layout</button></section>' +
      renderRoofSectionManager() +
      '<section class="schcard"><h3>⚡ Power limit</h3><p class="sh">Each output caps its current by dimming bright looks. The controller estimates <b>' + (CT.info.leds?.pwr ?? '?') + ' mA</b> right now.</p>' +
      '<label class="sw2"><input type="checkbox" id="ctAbl"' + (ablOn ? ' checked' : '') + '> Limit current per output</label>' +
      ins.map((b, k) => '<div class="sl wide"><span>' + esc(PORT_NAME[k + 1] || 'Output ' + (k + 1)) + ' <small>(' + b.len + ' bulbs)</small></span><input type="number" min="200" max="10000" step="50" data-abl="' + k + '" value="' + (b.maxpwr || 850) + '"><span>mA</span></div>').join('') +
      '<div class="sl wide"><span>Per bulb</span><input type="number" id="ctLedma" min="1" max="250" value="' + (ins[0]?.ledma || 55) + '"><span>mA at full white</span></div>' +
      '<p class="sh">Set each output to what its power supply line can carry, and “per bulb” to your bulbs’ real full-white draw. With 55 mA per bulb (the default for 5 V strips) the roofline output dims bright looks a lot.</p></section>' +
      '<section class="schcard"><h3>🔘 Button on the controller</h3><p class="sh">The physical controller button, if your controller provides one.</p>' +
      '<div class="sl"><span>Press</span>' + sel('ctB0', btn.macros[0], BTN_ACTS()) + '<span></span></div>' +
      '<div class="sl"><span>Double</span>' + sel('ctB2', btn.macros[2], BTN_ACTS()) + '<span></span></div>' +
      '<div class="sl"><span>Hold</span>' + sel('ctB1', btn.macros[1], BTN_ACTS()) + '<span></span></div></section>' +
      '<section class="schcard"><h3>🏠 Smart home &amp; voice</h3>' +
      '<label class="sw2"><input type="checkbox" id="ctAlexa"' + (c.if?.va?.alexa ? ' checked' : '') + '> Alexa can control it</label>' +
      '<div class="sl"><span>Alexa name</span><input type="text" id="ctInv" value="' + esc(!c.id?.inv || c.id.inv === 'Light' ? 'Roof lights' : c.id.inv) + '"><span></span></div>' +
      '<p class="sh">Then say “Alexa, discover devices”, and “Alexa, turn on ' + esc(!c.id?.inv || c.id.inv === 'Light' ? 'Roof lights' : c.id.inv) + '”.</p>' +
      '<p class="sh">Optional smart-home integrations can use the controller interface supported by your platform. Configure the integration and network details for your own environment.</p></section>' +
      '<section class="schcard"><h3>🎤 Microphone</h3><p class="sh">For the Mic-reactive looks. Live level from the controller:</p><div class="meter" id="ctMeter">' + '<i></i>'.repeat(16) + '</div>' +
      '<label class="sw2"><input type="checkbox" id="ctMic"' + (ar.enabled ? ' checked' : '') + '> Mic on</label>' +
      '<div class="sl"><span>Gain</span><input type="range" id="ctGain" min="1" max="255" value="' + (ar.config?.gain ?? 60) + '"><output>' + (ar.config?.gain ?? 60) + '</output></div>' +
      '<div class="sl"><span>Ignore quiet</span><input type="range" id="ctSq" min="0" max="80" value="' + (ar.config?.squelch ?? 10) + '"><output>' + (ar.config?.squelch ?? 10) + '</output></div></section>' +
      '<section class="schcard"><h3>🌙 Fade to sleep</h3><p class="sh">What the sidebar’s “Fade to sleep” and the controller’s own nightlight do.</p>' +
      '<div class="sl"><span>Fade over</span>' + sel('ctNlDur', nl.dur ?? 60, [[15, '15 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours']]) + '<span></span></div>' +
      '<div class="sl"><span>End at</span>' + sel('ctNlEnd', (nl.tbri || 0) > 0 ? 1 : 0, [[0, 'Off'], [1, 'Bedtime brightness (' + SC.nightBri + '%)']]) + '<span></span></div>' +
      '<div class="sl"><span>Style</span>' + sel('ctNlMode', nl.mode ?? 1, [[1, 'Smooth fade'], [0, 'Wait, then switch'], [3, 'Sunrise (reverse)']]) + '<span></span></div></section>' + tlsCards();
    $('ctOpenWledSetup').onclick = () => { location.hash = 'wiring'; };
    $('roofSectionAdd').onclick = () => {
      const occupied = new Set(APP.roofSections.flatMap(s => Array.from({ length: Math.min(N, s.stop) - Math.max(0, s.start) }, (_, i) => i + Math.max(0, s.start))));
      let start = 0; while (start < N && occupied.has(start)) start++;
      if (start >= N) start = 0;
      APP.roofSections.push({ id: 'roof-' + Date.now().toString(36), name: 'New section', start, stop: Math.min(N, start + Math.max(1, Math.ceil(N / 4))) });
      save(['roofSections']); window.TLBuilder?.refreshZones(); renderController();
    };
    $('ctGrid').querySelectorAll('[data-roof-delete]').forEach(b => b.onclick = () => {
      APP.roofSections.splice(+b.closest('[data-roof-row]').dataset.roofRow, 1); save(['roofSections']); window.TLBuilder?.refreshZones(); renderController();
    });
    $('ctGrid').querySelectorAll('[data-roof-name],[data-roof-start],[data-roof-stop]').forEach(input => input.onchange = () => {
      const row = input.closest('[data-roof-row]'), section = APP.roofSections[+row.dataset.roofRow], name = row.querySelector('[data-roof-name]').value.trim(), start = +row.querySelector('[data-roof-start]').value - 1, stop = +row.querySelector('[data-roof-stop]').value;
      if (!name || !Number.isInteger(start) || !Number.isInteger(stop) || start < 0 || stop > N || stop <= start) { toast('Enter a section name and a valid inclusive bulb range between 1 and ' + N, 'var(--warn)'); renderController(); return; }
      Object.assign(section, { name, start, stop }); APP.roofSections.sort((a, b) => a.start - b.start || a.stop - b.stop); save(['roofSections']); window.TLBuilder?.refreshZones(); renderController();
    });
    renderMoments();
  }
  /* ---- optional Studio firmware extension cards ---- */
  const hasTls = () => !!(CT && CT.st && CT.st.tls);
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const rng = (id, min, max, v, word) => '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" value="' + v + '"><output data-w="' + (word || '') + '">' + fmtW(word, v) + '</output>';
  function fmtW(w, v) { v = +v; return w === '%' ? v + '%' : w === 's' ? (v >= 60 ? (v / 60).toFixed(v % 60 ? 1 : 0) + ' min' : v + ' s') : w === 'x' ? (v / 10).toFixed(1).replace(/\.0$/, '') + '×' : String(v); }
  function tlsCards() {
    if (!hasTls()) return '<section class="schcard"><h3>✨ More controls</h3><p class="sh">Smooth fades, evening drift, breath, moments and the restart log need the Studio firmware on the controller (optional extensions enabled). This controller runs ' + esc(CT.info.ver || '?') + '.</p></section>';
    const t = CT.st.tls, d = t.drift, b = t.breath, F = APP.fade || { push: 2, sched: 2 }, sunset = t.sunset;
    const atSunset = d.st >= 1440;
    return '<section class="schcard"><h3>〰 Smooth fades &amp; transitions</h3><p class="sh">For subtle looks: no stair-stepping at low brightness, and looks melt into each other instead of switching.</p>' +
      '<label class="sw2"><input type="checkbox" id="tlsDith"' + (t.dith ? ' checked' : '') + '> Smooth low-brightness fades (dithering)</label>' +
      '<label class="sw2"><input type="checkbox" id="tlsXf"' + (t.xfade ? ' checked' : '') + '> True crossfade between looks</label>' +
      '<div class="sl"><span>Push fades over</span>' + rng('tlsFadeP', 0, 120, F.push, 's') + '</div>' +
      '<div class="sl"><span>Schedule fades</span>' + rng('tlsFadeS', 0, 300, F.sched, 's') + '</div>' +
      '<p class="sh">Playlists keep their own fade per look (up to 5 min).</p></section>' +
      '<section class="schcard"><h3>🌒 Evening drift</h3><p class="sh">As the night goes on, whatever is playing gets slowly warmer, dimmer and slower. No timers, no jumps.</p>' +
      '<label class="sw2"><input type="checkbox" id="tlsDrift"' + (d.on ? ' checked' : '') + '> Drift every night</label>' +
      '<div class="drifttl"><span>' + (atSunset ? 'Sunset' + (sunset ? ' ' + fmt12(hhmm(sunset)) : '') : fmt12(hhmm(d.st))) + ' · as designed</span><span>' + fmt12(hhmm(d.en % 1440)) + ' · embers</span></div>' +
      '<div class="sl"><span>From</span><select id="tlsDSt"><option value="sunset"' + (atSunset ? ' selected' : '') + '>Sunset</option><option value="time"' + (atSunset ? '' : ' selected') + '>A set time</option></select><input type="time" id="tlsDStT" value="' + hhmm(atSunset ? 1080 : d.st) + '"' + (atSunset ? ' hidden' : '') + '></div>' +
      '<div class="sl"><span>To</span><input type="time" id="tlsDEn" value="' + hhmm(d.en % 1440) + '"><span></span></div>' +
      '<div class="sl"><span>Warmer by</span>' + rng('tlsDWarm', 0, 100, d.warm, '%') + '</div>' +
      '<div class="sl"><span>Dimmer by</span>' + rng('tlsDDim', 0, 90, d.dim, '%') + '</div>' +
      '<div class="sl"><span>Slower by</span>' + rng('tlsDSlow', 10, 80, d.slow, 'x') + '</div>' +
      '<p class="sh">Holds at full until 6 AM. Bedtime dim still happens on top.' + (d.on ? ' Right now: ' + t.driftP + '% drifted.' : '') + '</p></section>' +
      '<section class="schcard"><h3>🫁 Breath</h3><p class="sh">A very slow brightness wave on top of any look, so even a still glow feels alive.</p>' +
      '<label class="sw2"><input type="checkbox" id="tlsBr"' + (b.on ? ' checked' : '') + '> Breathe</label>' +
      '<div class="sl"><span>Depth</span>' + rng('tlsBDepth', 5, 80, b.depth, '%') + '</div>' +
      '<div class="sl"><span>One breath every</span>' + rng('tlsBPer', 4, 300, b.per, 's') + '</div>' +
      '<div class="sl"><span>Shape</span><select id="tlsBLen"><option value="2000"' + (b.len >= 1000 ? ' selected' : '') + '>Whole roof together</option><option value="190"' + (b.len < 1000 ? ' selected' : '') + '>Rolls along the roof</option></select><span></span></div></section>' +
      '<section class="schcard"><h3>🧾 Restart log</h3><p class="sh">Why the controller restarted, how long it had been running, and what it was doing.</p>' + restartTable() + '</section>' +
      '<section class="schcard momcard"><h3>✦ Moments</h3><p class="sh">A look that plays for a little while, then fades back to whatever was on. An external automation can trigger it through the generated link.</p><div id="momList"></div>' +
      '<button class="btn" id="momAdd" style="align-self:flex-start">＋ New moment</button>' +
      '<div class="trig"><div><b>External automation</b>Use the generated link as an HTTP request in an automation platform you configure.</div>' +
      '<div><b>Only after dark</b>Links can be set to run only while the lights are on.</div></div></section>';
  }
  function restartTable() {
    const boots = CT.info.tls?.boots || [], up = CT.info.uptime || 0; if (!boots.length) return '<p class="sh">No restarts recorded yet since the firmware was installed.</p>';
    let end = Date.now() - up * 1000; const fmtUp = s => s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.floor(s % 3600 / 60) + ' min' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
    const cls = r => /watchdog|crash|brownout/.test(r) ? 'r' : r === 'software restart' ? 'g' : 'w';
    const rows = boots.map(b => { const when = new Date(end); end -= b.up * 1000 + 3000; return '<tr><td>' + when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '</td><td><span class="rpill ' + cls(b.reason) + '">' + esc(b.reason === 'software restart' ? 'restart or update' : b.reason) + '</span></td><td>' + fmtUp(b.up) + '</td><td>' + esc(b.stage) + '</td></tr>'; }).join('');
    return '<div class="rtab"><table><thead><tr><th>When</th><th>Why</th><th>Ran for</th><th>Doing</th></tr></thead><tbody>' + rows + '</tbody></table></div><p class="sh">This run: ' + fmtUp(up) + ' · started by ' + esc(CT.info.tls.reason) + ' · lowest free memory ' + Math.round((CT.info.tls.minHeap || 0) / 1024) + ' KB · longest stall ' + ((CT.info.tls.maxLoop || 0) / 1000).toFixed(1) + ' s</p>';
  }
  // ---- moments: looks saved in presets 210-219, played by /moment?ps=… on the controller
  const PS_MOM = 210; APP.moments = APP.moments || [];
  const momLink = (m, test) => 'http://' + WL.host + '/moment?ps=' + m.ps + '&dur=' + m.dur + '&tt=' + (m.tt * 10) + (test ? '' : '&if=on');
  function renderMoments() {
    const box = $('momList'); if (!box) return;
    const looks = LOOKS.map(l => '<option value="' + l.id + '">' + esc(l.name) + '</option>').join('');
    const durs = [[10, '10 s'], [20, '20 s'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']], tts = [[1, 'fade back 1 s'], [3, 'fade back 3 s'], [5, 'fade back 5 s'], [10, 'fade back 10 s']];
    const opt = (arr, v) => arr.map(([k, t]) => '<option value="' + k + '"' + (k === v ? ' selected' : '') + '>' + t + '</option>').join('');
    box.innerHTML = APP.moments.map((m, i) => '<div class="momrow" data-m="' + i + '"><input type="text" data-mk="name" value="' + esc(m.name) + '"><select data-mk="look">' + looks + '</select><select data-mk="dur">' + opt(durs, m.dur) + '</select><select data-mk="tt">' + opt(tts, m.tt) + '</select>' +
      '<span class="momact"><button class="btn" data-ma="test">Test</button><button class="btn" data-ma="copy">Copy link</button><button class="x" data-ma="del" title="Delete">×</button></span>' +
      '<div class="momlink mono">' + esc(momLink(m)) + '</div></div>').join('') || '<p class="sh">No moments yet. Add one, pick a look, then copy its link into an automation platform.</p>';
    box.querySelectorAll('.momrow').forEach(r => r.querySelector('[data-mk=look]').value = APP.moments[+r.dataset.m].look);
  }
  async function writeMoment(m) {   // store the look in its preset; saving runs it, so put back what was showing
    const before = await wget('/json/state'), l = BY_ID[m.look]; if (!l) throw new Error('That look no longer exists');
    const b = wledBody(applyMaster(l.P)); delete b._palKey; delete b.pl; b.transition = 10;
    await flushPalettes(); await wpost(Object.assign(b, { psave: m.ps, n: 'Moment · ' + m.name, o: true })); await new Promise(r => setTimeout(r, 700));
    if (before.ps > 0) await wpost({ ps: before.ps }); else await wpost({ on: before.on, bri: before.bri, transition: 0, seg: (before.seg || []).map(s => ({ id: s.id, start: s.start, stop: s.stop, fx: s.fx, sx: s.sx, ix: s.ix, c1: s.c1, c2: s.c2, c3: s.c3, o1: s.o1, o2: s.o2, o3: s.o3, pal: s.pal, col: s.col, grp: s.grp, spc: s.spc, rev: s.rev, mi: s.mi, slow: s.slow, on: s.on, bri: s.bri })) });
    // wait until the roof really shows the previous look again, so a test right after snapshots the right thing
    for (let k = 0; k < 20; k++) { await new Promise(r => setTimeout(r, 150)); const st = await wget('/json/state').catch(() => null); if (st && (before.ps > 0 ? st.ps === before.ps : st.seg?.[0]?.fx === before.seg?.[0]?.fx)) break; }
    await new Promise(r => setTimeout(r, 400));
    m.saved = JSON.stringify([m.look, m.ps, b.seg && b.seg[0]]); save(['moments']);
  }
  const momDirty = m => m.saved !== JSON.stringify([m.look, m.ps, (() => { const l = BY_ID[m.look]; if (!l) return null; const b = wledBody(applyMaster(l.P)); return b.seg && b.seg[0]; })()]);
  $('ctGrid').addEventListener('change', e => {
    const r = e.target.closest('.momrow'); if (r) { const m = APP.moments[+r.dataset.m], k = e.target.dataset.mk; if (k) { m[k] = k === 'dur' || k === 'tt' ? +e.target.value : e.target.value; save(['moments']); renderMoments(); } return; }
    if (e.target.id === 'tlsDSt') { $('tlsDStT').hidden = e.target.value === 'sunset'; }
  });
  $('ctGrid').addEventListener('click', async e => {
    if (e.target.id === 'momAdd') { const used = new Set(APP.moments.map(m => m.ps)); let ps = PS_MOM; while (used.has(ps) && ps < PS_MOM + 10) ps++; if (ps >= PS_MOM + 10) return toast('10 moments max', 'var(--warn)');
      APP.moments.push({ name: APP.moments.length ? 'New moment' : 'Welcome home', look: 'porch-glow', dur: 20, tt: 3, ps }); save(['moments']); renderMoments(); return; }
    const a = e.target.closest('[data-ma]'); if (!a) return; const i = +a.closest('.momrow').dataset.m, m = APP.moments[i];
    if (a.dataset.ma === 'del') { APP.moments.splice(i, 1); save(['moments']); wpost({ pdel: m.ps }); renderMoments(); return; }
    if (a.dataset.ma === 'copy') { try { await navigator.clipboard.writeText(momLink(m)); toast('Link copied: paste it into your automation platform'); } catch { toast(momLink(m)); } return; }
    if (a.dataset.ma === 'test') { a.disabled = true; try { if (momDirty(m)) { toast('Saving “' + m.name + '” on the controller…', 'var(--accent)'); await writeMoment(m); }
        const r = await fetch(momLink(m, true)).then(r => r.json()); toast(r.played ? m.name + ' is playing for ' + m.dur + ' s' : 'Didn’t play: ' + (r.why || r.error || '?'), r.played ? undefined : 'var(--warn)'); }
      catch (err) { toast('Test failed: ' + err.message, 'var(--warn)'); } a.disabled = false; }
  });
  $('ctGrid').addEventListener('input', e => { const o = e.target.nextElementSibling; if (e.target.type === 'range' && o && o.dataset.w !== undefined) o.textContent = fmtW(o.dataset.w, e.target.value); });
  function tlsSettingsFromForm() {
    if (!hasTls() || !$('tlsDith')) return null;
    const tm = id => { const [h, m] = ($(id).value || '00:00').split(':').map(Number); return h * 60 + m; };
    return { dith: $('tlsDith').checked, xfade: $('tlsXf').checked,
      drift: { on: $('tlsDrift').checked, st: $('tlsDSt').value === 'sunset' ? 1440 : tm('tlsDStT'), en: tm('tlsDEn') || 1440, warm: +$('tlsDWarm').value, dim: +$('tlsDDim').value, slow: +$('tlsDSlow').value },
      breath: { on: $('tlsBr').checked, depth: +$('tlsBDepth').value, per: +$('tlsBPer').value, len: +$('tlsBLen').value } };
  }
  $('ctGrid').addEventListener('input', e => { if (e.target.type === 'range' && e.target.nextSibling) e.target.nextSibling.textContent = e.target.value; });
  async function pollMic() {
    if (state.route !== 'controller') { clearInterval(ctPoll); return; }
    try { const i = await wget('/json/info'), src = (i.u?.['Audio Source'] || []).join(''), m = src.match(/peak\s+(\d+)%/), pk = m ? +m[1] : 0, bars = $('ctMeter')?.children; if (!bars) return;
      for (let k = 0; k < bars.length; k++) bars[k].style.height = clamp(pk * (0.55 + 0.45 * Math.sin(k * 1.7 + Date.now() / 300)), 2, 100) + '%'; } catch { }
  }
  $('ctSave').onclick = async () => {
    if (!CT) return; const c = CT.cfg, btn = $('ctSave'); btn.disabled = true; $('ctStat').innerHTML = '<span class="aispin"></span>Saving…';
    try {
      const on = $('ctAbl').checked, ledma = clamp(+$('ctLedma').value || 55, 1, 250);
      const ins = c.hw.led.ins.map((b, k) => Object.assign({}, b, { maxpwr: on ? clamp(+document.querySelector('[data-abl="' + k + '"]').value || 850, 200, 10000) : 0, ledma: on ? ledma : 0 }));
      const btns = clone(c.hw.btn); if (btns.ins?.[0]) btns.ins[0].macros = [+$('ctB0').value, +$('ctB1').value, +$('ctB2').value];
      const nlTbri = +$('ctNlEnd').value ? pct2bri(SC.nightBri) : 0;
      await cfgPatch({ hw: { led: { ins }, btn: btns }, if: { va: { alexa: $('ctAlexa').checked } }, id: { inv: $('ctInv').value.trim() || 'Roof lights' },
        light: { nl: { dur: +$('ctNlDur').value, tbri: nlTbri, mode: +$('ctNlMode').value } },
        um: { AudioReactive: { enabled: $('ctMic').checked, config: { gain: +$('ctGain').value, squelch: +$('ctSq').value } } } });
      APP.sleepDefaults = { dur: +$('ctNlDur').value, tbri: nlTbri, mode: +$('ctNlMode').value }; save(['sleepDefaults']);
      const tls = tlsSettingsFromForm();
      if (tls) {
        await fetch(`http://${WL.host}/json/cfg`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ um: { TrimlightStudio: tls } }) });
        APP.fade = { push: +$('tlsFadeP').value, sched: +$('tlsFadeS').value }; APP.tlsFx = tls; save(['fade', 'tlsFx']);
        for (const m of APP.moments) if (momDirty(m)) await writeMoment(m);
      }
      $('ctStat').textContent = '✓ Saved on the controller (it restarts to apply output changes)'; toast('Controller settings saved');
      CT.cfg = await wget('/json/cfg').catch(() => CT.cfg);
    } catch (err) { $('ctStat').textContent = '⚠️ ' + err.message; }
    btn.disabled = false;
  };
  $('ctWled').onclick = () => toast('In the real app this opens the controller’s own settings', 'var(--accent)');
  $('ctWledSetup').onclick = () => { location.hash = 'wiring'; };
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => goLibrary());

  /* ======================= one shared animation loop ======================= */
  let frameN = 0;
  function frame(now) {
    frameN++; if (frameN % 30 === 1) tlsTick();
    const live = liveBuf(), lbri = WL.state ? (WL.state.on ? WL.state.bri : 0) : 255;
    if (state.route === 'gallery') {
      visibleCards.forEach(c => {
        if (REDUCED ? c.v.dirty : ((frameN + c.phase) % 2 === 0 || c.v.dirty)) {
          const P = applyMaster(BY_ID[c.id].P); drawHouse(c.v, renderLook(c.v, P, now + c.phase), P.bri);
        }
      });
      if (!REDUCED || vPill.dirty) drawHouse(vPill, live, lbri);
    } else if (state.edit) {
      const P = editR(), buf = renderLook(vStage, P, now);
      drawHouse(vStage, highlight(P, buf), P.bri); drawOverlay(vStage, P); drawStrip(P, buf);
      if (!$('mini').classList.contains('gone')) drawHouse(vMini, live, lbri);
    }
    if (state.route === 'sections' && vSec && SD) { const P = applyMaster(SD.P); drawHouse(vSec, renderLook(vSec, P, now), P.bri); }
    if (state.route === 'schedule' && vTonight && vTonight.P) drawHouse(vTonight, renderLook(vTonight, vTonight.P, now), vTonight.P.bri);
    if (!$('aiModal').hidden) aiViews.forEach((v, k) => drawHouse(v, renderLook(v, v.P, now + k * 997), v.P.bri));
    requestAnimationFrame(frame);
  }

  /* ---------------- ✦ Look Builder (builder.js) ---------------- */
  function openBuilder(id) { if (!TLB) return toast('Builder didn’t load', 'var(--warn)'); showRoute('builder'); TLB.open(id); }
  const TLS = window.TLSimple;
  function openSimple(id) { if (!TLS) return toast('Builder didn’t load', 'var(--warn)'); showRoute('simple'); TLS.open(id); }
  const BHOST = {
    FXL, N, runs: () => RUNS, leds: () => LEDS, sections: () => APP.roofSections,
    loadDraft: () => APP.builderDraft, saveDraft: draft => { APP.builderDraft = draft; save(['builderDraft']); },
    fxdata: fx => WL.fxdata[fx], fxName: fx => WL.effects[fx], isAudio: fx => fxMeta(fx).audio,
    palettes: () => (WL.palettes.length ? WL.palettes : (FXL ? FXL.palNames : [])).map((name, id) => ({ id, name })),
    themes: () => CAT.THEMES.flatMap(g => g[1]), cats: () => CAT.CATS.filter(c => !['house', 'all', 'mine'].includes(c[0])),
    looks: () => LOOKS, lookById: id => state.edit && state.edit.id === id && BY_ID[id] ? Object.assign({}, BY_ID[id], { P: state.edit.P }) : BY_ID[id],
    lookSrc: l => effective(l.P),
    shapeFx: name => { const i = (WL.effects || []).indexOf(name); return i > 0 ? i : null; },
    customPalId: st => CPAL(slotFor(st)),
    fwLayers: () => !!(WL.info && !!WL.info.tls) && (WL.effects || []).includes('Studio Field'), fwVer: () => WL.info?.ver || '', fps: () => WL.info?.leds?.fps,
    toast, goLibrary, makeView: cv => makeView(cv, CROP_STAGE, 1, 2), drawHouse,
    saveLook({ id, name, desc, P, cats }) {
      const u = id && APP.userLooks.find(x => x.id === id);
      if (u) { Object.assign(u, { name, desc, P: clone(P) }, cats ? { cats: cats.slice() } : {}); delete u.fromSimple; }
      else { id = 'stack-' + Date.now().toString(36); APP.userLooks.unshift({ id, name, cats: cats ? cats.slice() : ['mine'], desc, P: clone(P) }); }
      save(['userLooks']); buildLooks(); renderNav(); renderGallery(true); return id;
    },
    push: id => pushToHouse(applyMaster(BY_ID[id].P), id, BY_ID[id].P),
    openBuilderDraft: d => { TLB.openDraft(d); location.hash = 'builder'; },
  };
  if (TLB) TLB.init(BHOST);
  if (TLS && window.TLMotions) TLS.init(BHOST);

  /* ---------------- boot ---------------- */
  renderNav(); setPerRow(APP.perRow || 3); renderMaster(); renderGallery(); route(true); requestAnimationFrame(frame);
  (async () => {
    const st = await fetch('/api/wled/status').then(r => r.json()).catch(() => ({}));
    WL.host = st.host || null; WL._ready(); if (!WL.host) { syncController(); return toast('WLED isn’t set up yet: open Setup', 'var(--warn)'); }
    try {
      for (const [k, p] of [['fxdata', '/json/fxdata'], ['effects', '/json/effects'], ['palettes', '/json/palettes'], ['info', '/json/info']]) WL[k] = await wget(p);
      WL.state = await wget('/json/state');
      if (HOME.lat == null || HOME.lon == null) {
        const cfg = await wget('/json/cfg').catch(() => null), ntp = cfg?.if?.ntp;
        const lat = ntp?.lt == null ? NaN : Number(ntp.lt), lon = ntp?.ln == null ? NaN : Number(ntp.ln);
        if (Number.isFinite(lat) && Number.isFinite(lon)) { HOME.lat = lat; HOME.lon = lon; }
      }
    } catch { toast('Can’t reach the controller right now', 'var(--warn)'); }
    if (!WL.fxdata.length) try { const fi = await fetch('/api/fxinfo').then(r => r.json()); WL.fxdata = []; (fi.effects || []).forEach(e => WL.fxdata[e.id] = e.meta); WL.effects = []; (fi.effects || []).forEach(e => WL.effects[e.id] = e.name); if (!WL.palettes.length) { WL.palettes = []; (fi.palettes || []).forEach(p => WL.palettes[p.id] = p.name); } renderGallery(true); if (state.edit) renderControls(); } catch { }
    connectWS(); onHouseChanged(); refreshScheduleBodies();
    if (state.edit) syncEditState();
    checkPaletteSlots();
    if (!FXL) toast('Preview engine not loaded yet: showing simple previews', 'var(--warn)');
  })();
  // test hook for the screen-vs-roof audit (scratchpad audit.cjs); only with ?audit in the URL
  if (/[?&]audit\b/.test(location.search)) window.__audit = { looks: () => LOOKS, applyMaster, wledBody, renderLook, N, V16, palSlots: () => APP.palSlots, schedule: () => APP.schedule };
})();
