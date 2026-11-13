/* Trimlight Home Studio · WLED Edition — WLED look library and editor with demo and direct-controller modes. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = 2000;                                               // plate width; roof-map coordinates are normalized
  const CAT = window.TLCatalog, FXL = window.TLFX || null, TLB = window.TLBuilder;
  const isStack = P => !!(TLB && TLB.isStack(P));   // a Look Builder stack (builder.js)
  // Select the effect catalog according to the WLED compatibility version exposed by the engine.
  const previewPreGamma = !!(FXL && /^16/.test(String(FXL.version || '')));
  const controllerV16 = () => /^(?:0\.)?16(?:\.|$)/.test(String(WL.info?.ver || ''));
  const CPAL = slot => (controllerV16() ? 200 : 255) - slot;
  if (previewPreGamma && FXL.config) { FXL.config.outputGamma = false; FXL.config.simFps = 250; }   // previews in display space (same as WLED 16's live view, which is pre-gamma)
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
      const f = seg[s] > 0 ? Math.min(1, d / seg[s]) : 0;
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
  const APP = Object.assign({ userLooks: [], edits: {}, cats: [], starred: {}, deletedLooks: [], roofSections: [], master: { speed: 100, bright: 100, spacing: 0, theme: '' }, perRow: 3, previewAnimations: true, lastPush: null, history: [] }, getSync('/api/app'));
  APP.roofSections = Array.isArray(APP.roofSections) ? APP.roofSections : [];
  let saveT = null; const pending = {};
  function save(keys) { keys.forEach(k => pending[k] = APP[k]); clearTimeout(saveT); saveT = setTimeout(() => { const b = Object.assign({}, pending); for (const k in pending) delete pending[k]; fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); }).catch(() => toast('Couldn’t save', 'var(--warn)')); }, 300); }

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
    const removed = new Set(APP.deletedLooks || []);
    LOOKS = APP.userLooks.map(u => Object.assign({}, CAT.LOOKS.find(c => c.id === u.base) || {}, u, { custom: true }))
      .concat(CAT.LOOKS.filter(l => !removed.has(l.id)).map(l => Object.assign({}, l)));
    LOOKS.forEach(l => { const e = APP.edits[l.id]; if (e) { if (e.name) l.name = e.name; if (e.cats) l.cats = e.cats; } l.P = l.custom && l.P ? upgradeP(l.P) : baseP(l); });
    BY_ID = {}; LOOKS.forEach(l => BY_ID[l.id] = l);
  }
  buildLooks();

  /* ---------------- WLED: metadata, live feed, push ---------------- */
  const WL = { host: null, ws: null, state: null, info: null, ledConfig: null, brightnessGamma: null, frame: null, fxdata: [], effects: [], palettes: [] };
  const STUDIO_EFFECTS = ['Studio Field', 'Studio Waves', 'Studio Comets', 'Studio Glints', 'Studio Noise', 'Studio Breathe'];
  const hasStudioEffects = () => !!WL.info && STUDIO_EFFECTS.every(name => (WL.effects || []).includes(name));
  const hostReady = new Promise(r => WL._ready = r);   // pages opened straight from the URL wait for the controller's address
  async function wget(p) {
    const r = await fetch(`http://${WL.host}${p}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('WLED returned HTTP ' + r.status + ' for ' + p + '.');
    return r.json();
  }
  async function wpost(body, direct) {
    if (!direct && WL.ws && WL.ws.readyState === 1) { WL.ws.send(JSON.stringify(body)); return; }
    const r = await fetch(`http://${WL.host}/json/state`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const ack = await r.json().catch(() => null);
    if (!r.ok || ack?.error || ack?.success !== true) throw new Error('WLED rejected the state update (HTTP ' + r.status + (ack?.error ? ', WLED error ' + ack.error : '') + ').');
    return ack;
  }
  function connectWS() {
    try { WL.ws = new WebSocket(`ws://${WL.host}/ws`); } catch { return setTimeout(connectWS, 3000); }
    WL.ws.binaryType = 'arraybuffer';
    WL.ws.onopen = () => { WL.ws.send('{"lv":true}'); WL.ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000) })); syncController(); };  // keep the controller's clock right for the schedule
    WL.ws.onmessage = e => {
      if (typeof e.data !== 'string') { const u = new Uint8Array(e.data); if (u[0] === 76) { const t = performance.now(); if (WL.frame) { WL.prevFrame = WL.frame; WL.gap = Math.min(150, Math.max(16, t - WL.frameAt)); } const px = u.subarray(u[1] === 2 ? 4 : 2); WL.frame = controllerV16() ? px : px.map(v => UNGAMMA[v]); WL.frameAt = t; /* 0.15 live view is post-gamma: convert to screen space like the previews */ } return; }
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
  function slotFor(st) {
    const k = stopsKey(st), S = APP.palSlots;
    for (const s in S) if (S[s].key === k) { S[s].at = Date.now(); return +s; }
    const count = controllerV16() ? Math.min(129, WL.info?.cpalmax || 10) : 10;
    const reserved = Math.max(0, Number(WL.info?.cpalcount) || 0);
    const slots = Array.from({ length: count }, (_, i) => i);
    const slot = slots.find(s => s >= reserved && !S[s]);
    if (slot === undefined) throw new Error('No free WLED custom palette slot. Remove an unused palette or simplify the look.');
    S[slot] = { key: k, stops: st, up: null, at: Date.now() }; save(['palSlots']); return slot;
  }
  async function flushPalettes() {   // upload any assigned-but-not-uploaded palettes to the controller
    for (const s in APP.palSlots) {
      const e = APP.palSlots[s]; if (e.up === e.key) continue;
      const json = JSON.stringify({ palette: e.stops.flatMap(([pos, c]) => [pos, c.map(v => ('0' + Math.round(v).toString(16)).slice(-2)).join('')]) });
      const fd = new FormData(); fd.append('data', new Blob([json], { type: 'application/json' }), 'palette' + s + '.json');
      await fetch(`http://${WL.host}/upload`, { method: 'POST', body: fd, mode: 'no-cors' });
      await new Promise(r => setTimeout(r, 400));
      e.up = (await paletteOnController(s, e)) === true ? e.key : null; save(['palSlots']);
      if (!e.up) throw new Error('Could not verify WLED custom palette ' + s + '.');
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
    return Object.assign({ id: k, start: 0, stop: N, grp: 1, spc: P.spc || 0, of: 0, rev: !!P.rev, mi: !!P.mi, slow: P.slow || 1, on: true, bri: 255, fx: P.fx, sx: P.sx, ix: P.ix, c1: P.c1, c2: P.c2, c3: P.c3, o1: !!P.o1, o2: !!P.o2, o3: !!P.o3, pal: P.pal, col: P.col.map(c => c.slice(0, 3)), frz: false, n: '' }, extra || {});
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
    const top = Math.max(1, P.bri, ...P.parts.map(x => partP(x).bri || 1)), segs = [];
    P.parts.forEach(pt => {
      const q = partP(pt), sb = clamp(Math.round(255 * clamp(q.bri, 1, 255) / top), 1, 255);
      if (isStack(q)) {
        TLB.segments(q).forEach(layer => {
          const start = Math.max(pt.start, layer.start), stop = Math.min(pt.stop, layer.stop);
          if (stop <= start) return;
          segs.push(Object.assign({}, layer, { id: segs.length, start, stop, bri: clamp(Math.round((layer.bri ?? 255) * sb / 255), 0, 255), n: ((pt.name || 'Section') + ' · ' + (layer.n || 'Layer')).slice(0, 30) }));
        });
      } else {
        const e = effective(q); if (e.cpal) e.pal = CPAL(slotFor(e.cpal));
        segs.push(segFor(e, segs.length, { start: pt.start, stop: pt.stop, bri: sb, n: (pt.name || '').slice(0, 30) }));
      }
    });
    if (segs.length > 32) throw new Error('This section look uses ' + segs.length + ' WLED segments; the controller limit is 32. Remove a layer or simplify the selected looks.');
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
    // Presets may run after a different look, so clear unused slots up to the controller's limit.
    const maxSegments = WL.info?.leds?.maxseg || 32;
    if (segs.length > maxSegments) throw new Error('This look needs ' + segs.length + ' segments. WLED supports ' + maxSegments + '.');
    if (controllerV16() || !hasStudioEffects()) segs = segs.map(s => {
      if (s.bm == null) return s;
      const { bm, fe, tlc, mod, ...segment } = s;
      if (!hasStudioEffects()) return controllerV16() ? { ...segment, bm: 0 } : segment;
      return { ...segment, bm: 0, tlsbm: bm, fe, tlc, mod };
    });
    for (let k = segs.length; k < maxSegments; k++) segs.push({ id: k, stop: 0 });
    const body = { on: true, bri: clamp(Math.round(P.bri), 1, 255), transition: clamp(Math.round((isStack(P) && P.fade != null ? P.fade : (APP.fade?.push ?? 2)) * 10), 0, 6000), pl: -1, lor: 0, mainseg: 0, seg: segs };
    if (palKey) body._palKey = palKey;   // remembered so the schedule's palettes are never evicted (WLED ignores the field)
    return body;
  }
  function canPush(P) {
    if (!WL.info) return false;
    if (isSec(P)) return P.parts.every(pt => { const q = partP(pt); return !isStack(q) || canPush(q); });
    if (!isStack(P)) return true;
    const layers = P.stack.layers || [];
    const needsStudio = layers.length > 1 || layers.some(L => L.src?.kind === 'shape' || L.blend !== 'cover' || (L.mods || []).length > 0 || (L.zone?.feather || 0) > 0 || (L.motion?.slow || 1) !== 1);
    return !needsStudio || hasStudioEffects();
  }
  const sameP = (a, b) => !!a && !!b && JSON.stringify(norm(a)) === JSON.stringify(norm(b));
  const norm = P => ({ fx: P.fx, sx: P.sx, ix: P.ix, c1: P.c1, c2: P.c2, c3: P.c3, o1: !!P.o1, o2: !!P.o2, o3: !!P.o3, pal: P.pal, col: (P.col || []).map(c => c.slice(0, 3).map(Math.round)), spc: P.spc || 0, rev: !!P.rev, mi: !!P.mi, slow: P.slow || 1, bri: Math.round(P.bri), mycol: !!P.mycol, colors: P.colors || null, blend: !!P.blend, rep: P.rep || 1, cmode: P.cmode || null, seq: P.seq || null, parts: P.parts ? P.parts.map(pt => [pt.start, pt.stop, pt.look, pt.dir || 'n', pt.speed || 1]) : null });
  // does the roof still run what we last pushed? (someone may have changed it from the WLED app)
  // does the roof run these settings? (compares the controller's live state with a look's push settings)
  function stateMatches(P, { matchBrightness = true } = {}) {
    const s = WL.state; if (!P || !s || !s.on) return false;
    const segs = (s.seg || []).filter(x => x.stop > x.start), g = segs[0]; if (!g) return false;
    const same = (a, b) => JSON.stringify(a.slice(0, 3).map(Math.round)) === JSON.stringify(b.slice(0, 3).map(Math.round));
    if (isStack(P)) return (!matchBrightness || Math.round(P.bri) === s.bri) && TLB.matches(P, s.seg, segmentMatches);
    if (isSec(P) && P.parts.some(pt => isStack(partP(pt)))) {
      const known = APP.lastPush?.state;
      return !!known && sameP(P, APP.lastPush.P) && (!matchBrightness || s.bri === known.bri) && segs.length === known.seg.length &&
        known.seg.every((seg, i) => segmentMatches(seg, segs[i]));
    }
    if (isSec(P)) return segs.length === P.parts.length && P.parts.every((pt, k) => { const q = effective(partP(pt)), x = segs[k]; return x.start === pt.start && x.stop === pt.stop && x.fx === q.fx && x.sx === q.sx && x.ix === q.ix && !!x.rev === !!q.rev && !!x.mi === !!q.mi; });
    if (P.cmode === 'bulb') { const { L, segs: ss } = seqLayout(P); return segs.length === ss.length && segs.every((x, k) => x.fx === P.fx && x.sx === P.sx && x.ix === P.ix && x.start === ss[k].start && x.grp === ss[k].n && x.spc === L - ss[k].n && same(x.col[0], ss[k].c)); }
    const q = effective(P);
    if (q.cpal) { const slot = Object.keys(APP.palSlots).find(s => APP.palSlots[s].key === stopsKey(q.cpal)); if (slot === undefined || g.pal !== CPAL(+slot)) return false; }
    else if (g.pal !== q.pal) return false;
    const knobs = ['c1', 'c2'].every(k => g[k] === undefined || q[k] === undefined || g[k] === q[k]) && (g.c3 === undefined || q.c3 === undefined || g.c3 === Math.min(31, q.c3)) && ['o1', 'o2', 'o3'].every(k => g[k] === undefined || !!g[k] === !!q[k]);
    return segs.length === 1 && knobs && g.fx === q.fx && g.sx === q.sx && g.ix === q.ix && (g.spc || 0) === (q.spc || 0) && !!g.rev === !!q.rev && !!g.mi === !!q.mi && (g.slow || 1) === (q.slow || 1) && g.col.every((c, k) => same(c, q.col[k] || BLACK));
  }
  function houseMatchesLastPush() {
    if (!APP.lastPush || !WL.state?.on) return false;
    const expected = APP.lastPush.state?.seg;
    if (!expected) return stateMatches(APP.lastPush.P, { matchBrightness: false });
    const live = (WL.state.seg || []).filter(s => s.stop > s.start);
    return live.length === expected.length && expected.every(s => live.some(a => segmentMatches(s, a)));
  }
  // a look that's on the roof but wasn't pushed from here (e.g. a preset saved before the app existed)
  function recognizedLook() {
    if (!WL.state?.on) return null;
    return LOOKS.find(l => stateMatches(applyMaster(l.P))) || LOOKS.find(l => isStack(l.P) && stateMatches(applyMaster(l.P), { matchBrightness: false })) || null;
  }
  function houseName() {
    const s = WL.state; if (!s) return '…'; if (!s.on) return 'Lights off';
    if (WL.info?.live) return 'Streaming from Studio';
    if (s.pl > 0 && s.pl >= PS_PL && s.pl < PS_PL + 10) return '▶ ' + (APP.playlists[s.pl - PS_PL]?.name || 'Playlist');
    if (houseMatchesLastPush()) return BY_ID[APP.lastPush.id]?.name || APP.lastPush.name || 'Your look';
    const rl = recognizedLook(); if (rl) return rl.name;
    const ps = s.ps > 0 ? s.ps : -1;
    return (WL.effects[s.seg?.[0]?.fx] || 'Custom look') + (ps > 0 ? ' · WLED preset ' + ps : ' · active WLED effect');
  }
  function houseLookId() { if (houseMatchesLastPush()) return APP.lastPush.id; const rl = recognizedLook(); return rl ? rl.id : null; }
  function deepMerge(a, b) { for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]); else a[k] = b[k]; } return a; }
  async function cfgPatch(patch, { preserveBuses = false, current } = {}) {
    const cur = current || await wget('/json/cfg'), doc = deepMerge(clone(cur), patch);
    if (JSON.stringify(cur) === JSON.stringify(doc)) return;
    if (preserveBuses && doc.hw?.led) delete doc.hw.led.ins;
    const r = await fetch(`http://${WL.host}/json/cfg`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
    const result = await r.json().catch(() => null);
    if (!r.ok || result?.success !== true) throw new Error('WLED rejected the settings update (HTTP ' + r.status + ').');
  }
  async function storePresets(presets) {
    if (!presets.length) return;
    const response = await fetch('/api/controller/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presets }) });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.ok !== true) throw new Error(result?.error || 'Could not store WLED presets (HTTP ' + response.status + ').');
  }
  function segmentMatches(expected, actual) {
    return Object.entries(expected).every(([key, value]) => {
      if (value === undefined || key === 'n' || key === 'slow' && value === 1 && actual.slow == null) return true;
      if (key === 'col') return value.every((c, i) => c.every((v, channel) => v === (actual.col?.[i]?.[channel] ?? 0)));
      if (['bm', 'fe', 'tlc', 'mod'].includes(key) && actual[key] == null) return key === 'bm' && value === 0 || Array.isArray(value) && !value.length || value === 0;
      if (key === 'c3') return Math.min(value, 31) === actual[key];
      return JSON.stringify(value) === JSON.stringify(actual[key]);
    });
  }
  async function pushToHouse(P, id, base) {   // P = exactly what the roof gets (gallery adjustments applied); base = the look's own settings
    if (!canPush(P)) throw new Error(WL.info ? 'This look uses layers or effects the controller does not advertise. Use one standard WLED effect layer, or add controller support for those features.' : 'The controller is offline.');
    const look = BY_ID[id];
    const body = wledBody(P); await flushPalettes();
    const expected = body.seg.filter(s => s.stop > s.start);
    const response = await fetch('/api/controller/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, seg: expected, name: 'Studio · ' + (look?.name || 'look') }) });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.state) throw new Error(result?.error || 'Could not apply the look (HTTP ' + response.status + ').');
    const applied = result.state, actual = (applied.seg || []).filter(s => s.stop > s.start);
    const segmentsMatch = expected.length === actual.length && expected.every(s => actual.some(a => segmentMatches(s, a)));
    if (!applied.on || applied.bri !== body.bri || !segmentsMatch) throw new Error('WLED did not apply the requested segments (sent ' + expected.length + ', controller reports ' + actual.length + '). Check the controller response and LED output settings.');
    WL.state = applied;
    APP.lastPush = { id, name: look?.name, P: clone(P), base: clone(base || P), state: { bri: applied.bri, seg: expected }, at: Date.now() };
    if (APP.dimmedFrom != null) { APP.dimmedFrom = null; save(['dimmedFrom']); }
    APP.history = [id].concat((APP.history || []).filter(x => x !== id)).slice(0, 8);
    save(['lastPush', 'history']);
    onHouseChanged();
    refreshScheduleBodies();
    if (result.bootWarning) toast('Look applied. Could not save the WLED boot preset: ' + result.bootWarning, 'var(--warn)');
  }

  /* ---------------- preview engine ---------------- */
  const UNGAMMA = new Uint8Array(256).map((_, v) => Math.round(255 * Math.pow(v / 255, 1 / 2.8)));
  const DISP = previewPreGamma ? new Uint8Array(256).map((_, v) => v) : UNGAMMA;   // engine output → screen (WLED 16 engine already gives display space)
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
        const f = q.bri / top;
        if (isStack(q)) {
          const sv = v.parts[k] && v.parts[k].stack ? v.parts[k] : (v.parts[k] = { stack: true });
          const buf = TLB.render(sv, q, nowMs);
          for (let i = 0; i < len; i++) { const o = (pt.start + i) * 3; d[o] = buf[o] * f; d[o + 1] = buf[o + 1] * f; d[o + 2] = buf[o + 2] * f; }
        } else {
          const sv = v.parts[k] && v.parts[k].len === len ? v.parts[k] : (v.parts[k] = { len, n: len });
          const buf = renderPart(sv, q, nowMs, len);
          for (let i = 0; i < len; i++) { const o = (pt.start + i) * 3; d[o] = buf[i * 3] * f; d[o + 1] = buf[i * 3 + 1] * f; d[o + 2] = buf[i * 3 + 2] * f; }
        }
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
      if (previewPreGamma) d.set(raw); else for (let i = 0; i < N * 3; i++) d[i] = UNGAMMA[raw[i]];
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
    if (previewPreGamma) d.set(raw); else for (let i = 0; i < len * 3; i++) d[i] = UNGAMMA[raw[i]];
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
  // optional controller output stage: evening drift + breath, applied after the effects, so the live view
  // doesn't include it either: apply it to everything drawn on WLED
  const TN = { on: false, p: 0, kG: 1, kB: 1, dim: 1, br: null };
  function tlsTick() {
    const t = WL.state?.tls || APP.tlsFx; TN.on = false; if (!t || !FXL) return;
    let p = 0; const d = t.drift;
    if (d && d.on) {
      const now = new Date(), mins = now.getHours() * 60 + now.getMinutes(), ss = sunTimes(now).set, st = d.st >= 1440 ? (t.sunset ?? (ss ? ss.getHours() * 60 + ss.getMinutes() : 1080)) : d.st % 1440, en = d.en % 1440;
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
      '<button class="del-look" data-act="delete" title="Remove this look from the library" aria-label="Remove ' + esc(l.name) + '">Delete</button>' +
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
    syncDim();
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
    if (act?.dataset.act === 'delete') { e.stopPropagation(); deleteLook(id); return; }
    if (act?.dataset.act === 'star') {
      e.stopPropagation(); if (look.cats.includes('mine') || look.custom) return toast(look.name + ' is one of saved looks.', 'var(--accent)');
      APP.starred[id] = !APP.starred[id]; save(['starred']); act.classList.toggle('on', !!APP.starred[id]); act.textContent = APP.starred[id] ? '★' : '☆'; renderNav(); return;
    }
    if (act?.dataset.act === 'push') { e.stopPropagation(); pushToHouse(applyMaster(look.P), id, look.P).then(() => toast('Fading ' + look.name + ' onto the house…')).catch(err => toast('Push failed: ' + err.message, 'var(--warn)')); return; }
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
  function syncPreviewToggle() {
    const button = $('previewToggle'), enabled = APP.previewAnimations !== false;
    button.textContent = enabled ? '⏸ Pause previews' : '▶ Resume previews';
    button.setAttribute('aria-pressed', String(enabled));
    button.title = enabled ? 'Pause animated look thumbnails and freeze the live preview' : 'Resume animated look thumbnails and the live preview';
  }
  $('previewToggle').addEventListener('click', () => {
    APP.previewAnimations = APP.previewAnimations === false;
    save(['previewAnimations']); syncPreviewToggle();
    cardViews.forEach(card => { card.v.dirty = true; }); vPill.dirty = true;
  });
  syncPreviewToggle();
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
    if (instant) { void document.body.offsetWidth; document.body.classList.remove('noanim'); }
    requestAnimationFrame(() => { vStage.resize(); vMini.resize(); });
  }
  function flyGhost(src) {
    const a = src.getBoundingClientRect(), b = $('stage').getBoundingClientRect(), g = document.createElement('canvas'); g.className = 'ghost';
    g.width = src.width; g.height = src.height; try { g.getContext('2d').drawImage(src, 0, 0); } catch { return; }
    Object.assign(g.style, { left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' }); document.body.appendChild(g);
    g.animate([{ transform: `translate(${a.left - b.left}px,${a.top - b.top}px) scale(${a.width / b.width},${a.height / b.height})`, opacity: 1, borderRadius: '16px' }, { transform: 'none', opacity: 1, offset: 0.8, borderRadius: '18px' }, { transform: 'none', opacity: 0, borderRadius: '18px' }], { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => g.remove();
  }
  function leaveEdit(instant) {
    if (state.full) setFull(false); showRoute('gallery', instant); $('scroller').scrollTop = state.scrollMem;
    if (state.edit) { const c = $('groups').querySelector('.card[data-id="' + state.edit.id + '"]'); if (c) { c.classList.add('flash'); setTimeout(() => c.classList.remove('flash'), 1200); } }
    cardViews.forEach(c => c.v.dirty = true);
  }
  function route(instant) { const h = location.hash.replace(/^#/, ''); if (h === 'schedule') { if (state.route !== 'schedule') openSchedule(); return; } const sm = h.match(/^sections(?:=([\w-]+))?$/); if (sm) { openSections(sm[1]); return; } const bm = h.match(/^builder(?:=([\w-]+))?$/); if (bm) { openBuilder(bm[1]); return; } const mk = h.match(/^make(?:=([\w-]+))?$/); if (mk) { openSimple(mk[1]); return; } if (h === 'playlists') { if (state.route !== 'playlists') openPlaylists(); return; } if (h === 'controller') { if (state.route !== 'controller') openController(); return; } const m = h.match(/^edit=([\w-]+)/); if (m && BY_ID[m[1]]) return enterEdit(m[1], instant); if (state.route !== 'gallery') leaveEdit(instant); }
  addEventListener('hashchange', () => route(false)); $('backBtn').addEventListener('click', goLibrary);
  $('toBuilderBtn').addEventListener('click', () => { if (state.edit) location.hash = 'builder=' + state.edit.id; });

  /* ---------- controls: per-look names, WLED's own sliders, colours, palette, spacing, brightness ---------- */
  const SL = ['sx', 'ix', 'c1', 'c2', 'c3'], SLD = ['Speed', 'Intensity', 'Custom 1', 'Custom 2', 'Custom 3'], COLD = ['Main', 'Background', 'Accent'];
  // speed slider: a curve that gives the slow end most of the travel (half way = speed 48 of 255, not 128)
  const SPEED_EXP = 2.4, spToPos = v => Math.round(1000 * Math.pow(clamp(v, 0, 255) / 255, 1 / SPEED_EXP)), posToSp = p => clamp(Math.round(255 * Math.pow(clamp(p, 0, 1000) / 1000, SPEED_EXP)), 0, 255);
  const speedWord = v => v === 0 ? 'slowest (0)' : v + ' / 255';
  const rangeFill = el => el.style.setProperty('--v', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
  const pct = v => Math.round(v / 2.55) + '%';
  function controlDefs(look) {
    const P = state.edit.P, m = fxMeta(P.fx), lab = look.labels || {}, defs = [];
    if (!P.pattern) {
      SL.forEach((k, i) => { const name = k in lab ? lab[k] : (m.sl[i] ? (m.sl[i] === '!' ? SLD[i] : m.sl[i]) : ''); if (name) defs.push({ k, type: 'range', label: name, min: 0, max: 255, word: pct }); });
      ['o1', 'o2', 'o3'].forEach((k, i) => { const name = k in lab ? lab[k] : (m.sl[5 + i] || ''); if (name) defs.push({ k, type: 'check', label: name }); });
    }
    if (P.cmode === 'bulb') defs.push({ k: 'seq', type: 'bulbs', label: 'Colors' });
    else if (P.mycol) defs.push({ k: 'colors', type: 'swatches', label: 'Colors' });
    else if (m.colors.some(Boolean) || m.pal) defs.push({ k: 'col', type: 'colors', label: 'Colors', n: Math.min(3, m.colors.filter(Boolean).length || 3), names: m.colors });
    if (m.pal && !P.mycol && P.cmode !== 'bulb') defs.push({ k: 'pal', type: 'palette', label: 'Palette' });
    if (!STILL_FX.has(P.fx)) defs.push({ k: 'slow', type: 'slow', label: 'Slow motion' }, { k: 'dir', type: 'dir', label: 'Direction' });
    defs.push({ k: 'spc', type: 'seg', label: 'Bulbs', opts: [[0, 'Every bulb'], [1, 'Every 2nd'], [2, 'Every 3rd']] });
    defs.push({ k: 'bri', type: 'range', label: 'Brightness', min: 5, max: 255, word: pct });
    return defs;
  }
  const STILL_FX = new Set([0, 2, 12, 83, 84, 98]);   // effects with no along-the-roof motion: no Direction control
  const DIRS = [['n', 'Normal', 'forward', 'M4 9h80m-8-6 8 6-8 6'], ['r', 'Reverse', 'backward', 'M92 9H12m8-6-8 6 8 6'], ['m', 'Mirror', 'out from the middle', 'M48 9H8m8-6-8 6 8 6M48 9h40m-8-6 8 6-8 6']];
  const SLOWS = [[1, 'Normal'], [2, '½×'], [4, '¼×'], [8, '⅛×'], [16, '1/16×']];
  const dirOf = P => P.mi ? 'm' : P.rev ? 'r' : 'n';
  const PAL_USE = [0, 2, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14, 20, 21, 26, 27, 35, 36, 39, 40, 46, 49, 50, 51, 55, 56, 57];
  function renderControls() {
    const look = BY_ID[state.edit.id], P = state.edit.P, defs = controlDefs(look);
    state.edit.defs = defs;
    let html = defs.map((c, i) => {
      let body = '', word = '';
      if (c.type === 'range' && c.k === 'sx') { body = '<div class="spdrow"><button class="nudge" data-nudge="-1" data-i="' + i + '" title="A touch slower" aria-label="Slower">−</button><input type="range" data-i="' + i + '" data-curve="1" min="0" max="1000" value="' + spToPos(P.sx) + '"><button class="nudge" data-nudge="1" data-i="' + i + '" title="A touch faster" aria-label="Faster">+</button></div>'; word = speedWord(P.sx); }
      else if (c.type === 'range') { body = '<input type="range" data-i="' + i + '" min="' + c.min + '" max="' + c.max + '" value="' + P[c.k] + '">'; word = rangeWord(c, P[c.k]); }
      else if (c.type === 'check') body = '<label class="chk"><input type="checkbox" data-i="' + i + '"' + (P[c.k] ? ' checked' : '') + '> ' + esc(c.label) + '</label>';
      else if (c.type === 'seg') { const g = gapOf(P); body = '<div class="segrow"><div class="seg">' + c.opts.map(o => { let d = ''; for (let j = 0; j < 6; j++) d += '<i class="' + (j % (o[0] + 1) ? 'off' : '') + '"></i>'; return '<button data-i="' + i + '" data-v="' + o[0] + '" class="' + (g === o[0] ? 'on' : '') + '"><span class="dots">' + d + '</span>' + o[1] + '</button>'; }).join('') + '</div><label class="gapbox" title="Dark bulbs between lit ones' + (P.cmode === 'bulb' ? ' (added after each color in your pattern)' : '') + '">Gap<input type="number" min="0" max="9" step="1" data-gap value="' + (g < 0 ? '' : g) + '" placeholder="mix"></label></div>'; word = g < 0 ? 'custom gaps' : g === 0 ? 'every bulb' : g + ' dark between'; }
      else if (c.type === 'palette') { body = '<div class="palsel">' + PAL_USE.map(id => '<button data-i="' + i + '" data-v="' + id + '" class="' + (P.pal === id ? 'on' : '') + '"><i style="background:' + (FXL ? FXL.paletteCss(id, P.col) : '#333') + '"></i><span>' + esc(WL.palettes[id] || 'Palette ' + id) + '</span></button>').join('') + '</div>'; word = WL.palettes[P.pal] || ''; }
      else if (c.type === 'colors') {   // fixed colour roles (e.g. candle flame + background)
        const COLN = ['Main', 'Background', 'Accent'];
        body = '<div class="colors">' + P.col.slice(0, c.n).map((col, j) => { const lk = state.edit.locks[j], nm = c.names && c.names[j] && c.names[j] !== '!' ? c.names[j] : COLN[j]; return '<label title="' + esc(nm) + '"><span style="background:' + hex(col) + ';box-shadow:inset 0 0 18px rgba(0,0,0,.35)"></span><em>' + esc(nm) + '</em><input type="color" data-i="' + i + '" data-j="' + j + '" value="' + hex(col) + '"><button class="lk' + (lk ? ' on' : '') + '" data-lock="' + j + '">' + (lk ? '🔒' : '🔓') + '</button></label>'; }).join('') + '</div>' + CTOOLS +
          (usesPal(P.fx) ? '<button class="linkbtn" data-act="mycol">Use my own colors (reorder, add more, per bulb) →</button>' : '');
        if (P.pal >= 6) word = 'palette in use';
      }
      else if (c.type === 'slow') { const v = P.slow || 1; body = '<div class="seg slowsel">' + SLOWS.map(([f, t]) => '<button data-slow="' + f + '" class="' + (v === f ? 'on' : '') + '">' + t + '</button>').join('') + '</div><p class="cnote">Slows the whole animation, fades included, below what the speed slider can reach. Stays smooth.</p>'; word = v === 1 ? 'off' : SLOWS.find(o => o[0] === v)[1] + ' speed'; }
      else if (c.type === 'dir') { const d = dirOf(P); body = '<div class="dirsel">' + DIRS.map(o => '<button data-dir="' + o[0] + '" class="' + (d === o[0] ? 'on' : '') + '"><svg width="96" height="18" viewBox="0 0 96 18"><path d="' + o[3] + '" stroke="currentColor" stroke-width="2" fill="none"/></svg><b>' + o[1] + '</b><small>' + o[2] + '</small></button>').join('') + '</div>'; word = DIRS.find(o => o[0] === d)[1]; }
      else if (c.type === 'swatches') { body = swatchesHTML(P); word = P.colors.length + ' color' + (P.colors.length === 1 ? '' : 's'); }
      else if (c.type === 'bulbs') { body = bulbsHTML(P); const L = P.seq.reduce((a, e) => a + e.n, 0) || 1; word = L + '-bulb pattern · repeats ~' + Math.round(N / L) + '×'; }
      return '<div class="ctl"><div class="cl"><label>' + (c.type === 'check' ? '' : esc(c.label)) + '</label><span class="val" id="val' + i + '">' + esc(word) + '</span></div>' + body + '</div>';
    }).join('');
    html += '<button class="reset" id="resetBtn">Reset to the original ' + esc(look.name) + '</button>';
    const adj = [M.spacing && 'every ' + (M.spacing === 1 ? 'bulb' : M.spacing === 2 ? '2nd bulb' : M.spacing + 'th bulb')].filter(Boolean);
    if (M.theme && themeCols(M.theme)) html = '<p class="adjnote">Master colors “' + esc(M.theme) + '” recolor looks in the Library, but not here: this look plays the colors below.</p>' + html;
    if (adj.length) html = '<p class="adjnote">Gallery setting on: ' + esc(adj.join(', ')) + ' — the preview and roof use it for every look.</p>' + html;
    $('ctrls').innerHTML = html; $('ctrls').querySelectorAll('input[type=range]').forEach(rangeFill);
    renderAITweak();
  }
  function rangeWord(c, v) { return c.word(v); }
  function changed() { if (state.edit) { state.edit.touched = true; state.edit.R = null; } vStage.dirty = true; syncEditState(); }
  // the edited look with the gallery-wide adjustments (speed/brightness/spacing/theme) applied = what the stage shows and the roof gets
  function editR() { const e = state.edit; if (!e) return null; const k = JSON.stringify(M); if (!e.R || e.Rk !== k || e.Rsrc !== e.P) { e.R = applyMaster(e.P); e.Rk = k; e.Rsrc = e.P; } return e.R; }
  function resetStage() { vStage.inst = null; vStage.instFx = null; vStage.segInst = []; vStage.dbuf = null; }
  // ---- colours: swatch row (A) + per-bulb sequence (C) ----
  const CTOOLS = '<div class="ctools"><button id="rollBtn" title="Random colors that go together (never white)">🎲 Random</button><button id="themeBtn">🎨 Themes ▾</button></div>';
  const MODE = P => '<div class="cmodebar"><div class="cmode"><button data-cm="swatch" class="' + (P.cmode !== 'bulb' ? 'on' : '') + '">Swatches</button><button data-cm="bulb" class="' + (P.cmode === 'bulb' ? 'on' : '') + '">Per bulb</button></div><button class="lbltog' + (APP.colorLabels ? ' on' : '') + '" data-act="labels" title="Show where the pattern starts and which color is where, on WLED">#  Labels</button></div>';
  function stripColors(P) {   // static view of where each colour lands along this layout's pixels
    const out = [];
    if (P.cmode === 'bulb') { const L = P.seq.reduce((a, e) => a + e.n, 0) || 1, flat = []; P.seq.forEach(e => { for (let k = 0; k < e.n; k++) flat.push(e.c); }); for (let i = 0; i < N; i++) out.push(flat[i % L]); return out; }
    const sm = swatchMap(P); if (sm) return sm.cols;
    const st = paletteStops(Object.assign({}, P, { colors: P.colors.length ? P.colors : [BLACK] }));
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1) * 255; let k = 0; while (k < st.length - 2 && st[k + 1][0] < x) k++;
      const [a, ca] = st[k], [b, cb] = st[k + 1] || st[k], f = b > a ? clamp((x - a) / (b - a), 0, 1) : 0;
      out.push(P.blend ? ca.map((v, j) => v + (cb[j] - v) * f) : (x >= b ? cb : ca));
    }
    return out;
  }
  // where each swatch lands when the controller uses its built-in palettes (3 slots): pal 5 = 16 blocks (2 colors 8/8, 3 colors 5/5/5/1), pal 4 = gradient, no wrap
  function swatchMap(P) {
    if (P.cmode === 'bulb' || !P.mycol || !P.colors?.length) return null;
    const q = effective(P), cs = P.colors, n = cs.length; if (q.cpal) return null;
    const cols = [], own = [];
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      if (q.pal === 2) { cols.push(cs[0]); own.push(0); continue; }
      if (q.pal === 5) { const b = Math.min(15, Math.floor(x * 16)), j = n === 2 ? (b < 8 ? 0 : 1) : (b < 5 ? 0 : b < 10 ? 1 : b < 15 ? 2 : 0); cols.push(cs[j]); own.push(j); continue; }
      if (q.pal === 4) { const f = x * (n - 1), a = Math.min(n - 2, Math.floor(f)), t = f - a; cols.push(cs[a].map((v, k) => v + (cs[a + 1][k] - v) * t)); own.push(Math.round(f)); continue; }
      return null;
    }
    return { cols, own };
  }
  const stripHTML = P => '<div class="cstripw"><canvas class="cstrip" id="cstrip"></canvas><div class="ctip" id="ctip"></div></div><div class="cstrip-l"><span>Bulb 1 · ' + esc(RUNS[0]?.name || 'first run') + '</span><span>' + esc(RUNS[1]?.name || 'next run') + '</span><span>' + esc(RUNS.at(-1)?.name || 'last run') + '</span><span>' + N + ' pixels</span></div>';
  function swatchesHTML(P) {
    const n = P.colors.length, maxRep = Math.max(1, Math.floor((P.blend ? 17 : 9) / n)), cust = !!effective(P).cpal;
    return MODE(P) + stripHTML(P) + '<div class="swrow">' + P.colors.map((c, j) => { const lk = state.edit.locks[j]; return '<div class="sw2t" draggable="true" data-sw="' + j + '" style="--c:' + hex(c) + '"><input type="color" data-swc="' + j + '" value="' + hex(c) + '"><em>' + (j + 1) + '</em><button class="lk' + (lk ? ' on' : '') + '" data-lock="' + j + '" title="Lock">' + (lk ? '🔒' : '🔓') + '</button>' + (n > 1 ? '<button class="rm" data-rm="' + j + '" title="Remove">×</button>' : '') + '</div>'; }).join('') +
      (n < 8 ? '<button class="sw2add" data-act="add" title="Add a color">＋</button>' : '') + '</div>' +
      '<div class="crow"><div class="seg2"><button data-bl="0" class="' + (!P.blend ? 'on' : '') + '">Blocks</button><button data-bl="1" class="' + (P.blend ? 'on' : '') + '">Blend</button></div>' +
      '<div class="seg2"><span>Repeat</span>' + [1, 2, 4].map(r => '<button data-rp="' + r + '" class="' + ((P.rep || 1) === r ? 'on' : '') + '"' + (r > maxRep ? ' disabled title="Too many color changes for one palette"' : '') + '>' + r + '×</button>').join('') + '</div></div>' +
      '<p class="cnote">Drag to reorder the colors along the pixel layout. ' + (cust ? '<b>Custom palette</b> on the controller (' + Math.min(18, paletteStops(P).length) + '/18 stops).' : 'Fits the controller’s 3 color slots.') + '</p>' + CTOOLS +
      '<button class="linkbtn" data-act="builtin">Use a built-in palette instead</button>';
  }
  const BULB_PRESETS = [['Classic C9', [[[255, 0, 0], 1], [[0, 255, 0], 1], [[0, 0, 255], 1], [[220, 100, 20], 1]]], ['Candy Cane', [[[220, 0, 20], 2], [[255, 90, 120], 1]]], ['Evergreen & sky', [[[0, 50, 200], 2], [[100, 255, 0], 1]]], ['Harvest', [[[255, 80, 0], 2], [[170, 25, 0], 1], [[255, 140, 0], 1]]], ['Hanukkah', [[[0, 60, 255], 2], [[255, 190, 40], 1]]]];
  function bulbsHTML(P) {
    const L = P.seq.reduce((a, e) => a + e.n, 0) || 1;
    return MODE(P) + stripHTML(P) +
      '<div class="strand">' + P.seq.map(e => Array.from({ length: e.n }, () => '<i class="' + (e.c ? '' : 'gap') + '" style="' + (e.c ? 'background:' + hex(e.c) + ';box-shadow:0 0 8px ' + hex(e.c) : '') + '"></i>').join('')).join('') + '<span>× ' + Math.round(N / L) + ' around the house</span></div>' +
      '<div class="seqlist">' + P.seq.map((e, j) => '<div class="seqrow" draggable="true" data-sq="' + j + '"><span class="grip">⋮⋮</span>' +
        (e.c ? '<label class="sqc" style="background:' + hex(e.c) + '"><input type="color" data-sqc="' + j + '" value="' + hex(e.c) + '"></label>' : '<span class="sqgap">gap</span>') +
        '<span class="dots">' + Array.from({ length: e.n }, () => '<i class="' + (e.c ? '' : 'gap') + '" style="' + (e.c ? 'background:' + hex(e.c) : '') + '"></i>').join('') + '</span>' +
        '<span class="step"><button data-dn="' + j + '">−</button><b>' + e.n + '</b><button data-up="' + j + '">+</button></span>' +
        (e.c ? '<button class="lk' + (state.edit.locks[j] ? ' on' : '') + '" data-lock="' + j + '">' + (state.edit.locks[j] ? '🔒' : '🔓') + '</button>' : '<span></span>') +
        '<button class="rm" data-rmq="' + j + '" title="Remove">×</button></div>').join('') + '</div>' +
      '<div class="crow"><button class="btn sm" data-act="addc">＋ Add color</button><button class="btn sm" data-act="addg">＋ Add gap</button></div>' +
      '<div class="bpre">' + BULB_PRESETS.map((b, k) => '<button data-bp="' + k + '"><i>' + b[1].map(([c, n]) => Array.from({ length: n }, () => '<u style="background:' + hex(c) + '"></u>').join('')).join('') + '</i>' + esc(b[0]) + '</button>').join('') + '</div>' +
      '<p class="cnote">Each color is its own segment on the controller, so the look’s effect still runs inside your pattern.</p>' + CTOOLS;
  }
  const near = (a, b) => a.map((v, j) => Math.round((v + b[j]) / 2));
  function visibleColors(P) {   // the colors a look actually shows: its swatches, its own colors (no black background), or samples of its palette
    if (P.cmode === 'bulb') return P.seq.filter(e => e.c).map(e => e.c.slice());
    if (P.mycol && P.colors?.length) return P.colors.map(c => c.slice());
    if (usesPal(P.fx) && (P.pal >= 6 || P.pal === 0) && FXL) { const pr = FXL.paletteRGB(P.pal, P.col, P.fx); return [0, 5, 10].map(k => [pr[k * 3], pr[k * 3 + 1], pr[k * 3 + 2]].map(v => previewPreGamma ? v : UNGAMMA[v])); }
    const cs = P.col.slice(0, usesPal(P.fx) && P.pal === 2 ? 1 : 3).filter(c => Math.max(...c) > 20).map(c => c.slice());
    return cs.length ? cs : [[255, 80, 0]];
  }
  let warmToast = 0;
  function warm(c) { const hi = Math.max(...c), lo = Math.min(...c); if (hi > 0 && lo > 0.6 * hi) { if (Date.now() - warmToast > 4000) { warmToast = Date.now(); toast('Kept it warm: no white bulbs', 'var(--accent)'); } return [255, Math.round(140 * hi / 255), Math.round(40 * hi / 255)]; } return c; }
  function moveItem(arr, from, to) { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); }
  function colorClick(e) {
    const P = state.edit.P, t = e.target;
    const cm = t.closest('[data-cm]');
    if (cm) {
      if (cm.dataset.cm === 'bulb' && P.cmode !== 'bulb') {
        const cs = visibleColors(P); P.seq = cs.map(c => ({ c: c.slice(), n: 1 })); P.cmode = 'bulb';
        if (P._fxBulb != null) { P.fx = P._fxBulb; P.c1 = P._c1Bulb; delete P._fxBulb; delete P._c1Bulb; }   // undo the swatch-mode effect swap
      }
      else if (cm.dataset.cm === 'swatch' && P.cmode === 'bulb') {
        P.colors = P.seq.filter(e => e.c).map(e => e.c.slice()); if (!P.colors.length) P.colors = [[255, 80, 0]]; delete P.cmode; P.mycol = true; P.rep = P.rep || 1;
        if (!usesPal(P.fx)) { P._fxBulb = P.fx; P._c1Bulb = P.c1; P.fx = 65; P.c1 = 0; }   // swatches need a palette effect; remembered so Per bulb gets it back
      }
      state.edit.locks = []; resetStage(); renderControls(); return changed(), true;
    }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'mycol') { P.mycol = true; P.colors = visibleColors(P); P.rep = 1; P.blend = false; state.edit.locks = []; renderControls(); return changed(), true; }
    if (act === 'builtin') { const cs = P.colors || []; P.mycol = false; P.col = [cs[0] || [255, 80, 0], cs[1] || cs[0] || BLACK, cs[2] || cs[0] || BLACK]; P.pal = 4; state.edit.locks = []; renderControls(); return changed(), true; }
    if (act === 'add') { const k = P.colors.length; P.colors.push(k ? near(P.colors[k - 1], P.colors[0]).map((v, j, a) => j === a.indexOf(Math.max(...a)) ? 255 : v) : [255, 80, 0]); renderControls(); return changed(), true; }
    if (act === 'addc') { const last = P.seq.filter(e => e.c).pop(); P.seq.push({ c: last ? last.c.slice() : [255, 80, 0], n: 1 }); renderControls(); return changed(), true; }
    if (act === 'labels') { APP.colorLabels = !APP.colorLabels; save(['colorLabels']); renderControls(); return true; }
    if (act === 'addg') { P.seq.push({ c: null, n: 1 }); renderControls(); return changed(), true; }
    const rm = t.closest('[data-rm]'); if (rm) { P.colors.splice(+rm.dataset.rm, 1); state.edit.locks.splice(+rm.dataset.rm, 1); renderControls(); return changed(), true; }
    const rq = t.closest('[data-rmq]'); if (rq) { if (P.seq.length > 1) { P.seq.splice(+rq.dataset.rmq, 1); state.edit.locks.splice(+rq.dataset.rmq, 1); } renderControls(); return changed(), true; }
    const up = t.closest('[data-up]'), dn = t.closest('[data-dn]');
    if (up || dn) { const e2 = P.seq[+(up || dn).dataset[up ? 'up' : 'dn']]; e2.n = clamp(e2.n + (up ? 1 : -1), 1, 6); renderControls(); return changed(), true; }
    const bl = t.closest('[data-bl]'); if (bl) { P.blend = bl.dataset.bl === '1'; const max = Math.max(1, Math.floor((P.blend ? 17 : 9) / P.colors.length)); if ((P.rep || 1) > max) P.rep = 1; renderControls(); return changed(), true; }
    const rp = t.closest('[data-rp]'); if (rp && !rp.disabled) { P.rep = +rp.dataset.rp; renderControls(); return changed(), true; }
    const bp = t.closest('[data-bp]'); if (bp) { P.seq = BULB_PRESETS[+bp.dataset.bp][1].map(([c, n]) => ({ c: c.slice(), n })); state.edit.locks = []; renderControls(); return changed(), true; }
    return false;
  }
  function colorInput(e) {
    const P = state.edit.P, t = e.target;
    if (t.dataset.swc != null) { const c = P.colors[+t.dataset.swc] = warm(unhex(t.value)); t.parentNode.style.setProperty('--c', hex(c)); if (hex(c) !== t.value) t.value = hex(c); refreshStrip(); changed(); return true; }
    if (t.dataset.sqc != null) { const c = P.seq[+t.dataset.sqc].c = warm(unhex(t.value)); t.parentNode.style.background = hex(c); if (hex(c) !== t.value) t.value = hex(c); const row = t.closest('.seqrow'); row && row.querySelectorAll('.dots i').forEach(d => d.style.background = hex(c)); refreshStrip(); changed(); return true; }
    return false;
  }
  function gapOf(P) {   // dark bulbs between lit ones: spc in swatch mode; a uniform gap after every color in per-bulb mode (-1 = mixed)
    if (P.cmode !== 'bulb') return P.spc || 0;
    const sq = P.seq; if (!sq.some(e => !e.c)) return 0;
    let g = null;
    for (let j = 0; j < sq.length; j++) { if (!sq[j].c) continue; const nx = sq[j + 1]; if (!nx || nx.c) return -1; if (g == null) g = nx.n; else if (g !== nx.n) return -1; }
    return sq.filter(e => !e.c).length === sq.filter(e => e.c).length ? g : -1;
  }
  function setGap(P, g) {
    if (P.cmode !== 'bulb') { P.spc = g; return; }
    const cols = P.seq.filter(e => e.c), locks = state.edit.locks.filter((_, j) => P.seq[j] && P.seq[j].c), out = [], nl = [];
    cols.forEach((e, k) => { out.push(e); nl.push(locks[k]); if (g > 0) { out.push({ c: null, n: g }); nl.push(false); } });
    P.seq = out.length ? out : [{ c: [255, 80, 0], n: 1 }]; state.edit.locks = nl; P.spc = 0;
  }
  function refreshStrip() { /* the strip is a live canvas now: redrawn every frame */ }
  // ---- hover: highlight one color on WLED + strip; hover the strip for bulb info ----
  const hov = { hi: -1, k: -1 };
  const RUN_NAMES = (layout.runs || []).slice().map((r, k) => ({ r, k })).sort((a, b) => (a.r.port - b.r.port) || (a.k - b.k)).map(o => o.r.name);
  const RUN_START = LEDS.reduce((a, l, i) => { if (!i || LEDS[i - 1].run !== l.run) a.push(i); return a; }, []);
  function colorList(P) { return P.cmode === 'bulb' ? null : (P.mycol && P.colors ? P.colors : P.col); }
  function ownerAt(P, k) {   // which color (swatch index / per-bulb row index) bulb k is assigned to
    if (P.cmode === 'bulb') { const L = P.seq.reduce((a, e) => a + e.n, 0) || 1; let r = k % L; for (let j = 0; j < P.seq.length; j++) { if (r < P.seq[j].n) return j; r -= P.seq[j].n; } return -1; }
    if (!(P.mycol && P.colors)) return -1;
    const sm = swatchMap(P); if (sm) return sm.own[k];
    const n = P.colors.length, B = n * (P.rep || 1);
    return (P.blend ? Math.round(k / (N - 1) * B) : Math.min(B - 1, Math.floor(k / N * B))) % n;
  }
  function keepFor(P, buf) {   // per bulb: true when it belongs to the hovered color
    const out = keepFor.o || (keepFor.o = new Uint8Array(N)), hi = hov.hi;
    if (P.cmode === 'bulb') { for (let i = 0; i < N; i++) out[i] = ownerAt(P, i) === hi ? 1 : 0; return out; }
    const cl = colorList(P); if (!cl || !cl[hi]) { out.fill(1); return out; }
    const nc = cl.map(c => { const m = Math.max(...c) || 1; return [c[0] / m, c[1] / m, c[2] / m]; });
    for (let i = 0; i < N; i++) {   // effects place palette colors anywhere, so match each bulb to its nearest swatch color
      const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2], m = Math.max(r, g, b);
      if (m < 6) { out[i] = 0; continue; }
      let best = -1, bd = 9; nc.forEach((t, j) => { const d = Math.abs(r / m - t[0]) + Math.abs(g / m - t[1]) + Math.abs(b / m - t[2]); if (d < bd) { bd = d; best = j; } });
      out[i] = best === hi ? 1 : 0;
    }
    return out;
  }
  function highlight(P, buf) {
    if (hov.hi < 0 || !buf) return buf;
    const keep = keepFor(P, buf), o = highlight.o || (highlight.o = new Uint8Array(N * 3));
    for (let i = 0; i < N; i++) { const f = keep[i] ? 1 : 0; o[i * 3] = buf[i * 3] * f; o[i * 3 + 1] = buf[i * 3 + 1] * f; o[i * 3 + 2] = buf[i * 3 + 2] * f; }
    return o;
  }
  function drawStrip(P, buf) {
    const cv = document.getElementById('cstrip'); if (!cv) return;
    const r = cv.getBoundingClientRect(); if (!r.width) return;
    const w = Math.round(r.width * DPR), h = Math.round(r.height * DPR);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const x = cv.getContext('2d'), sw = w / N, base = stripColors(P), keep = hov.hi >= 0 ? keepFor(P, buf) : null;
    x.globalCompositeOperation = 'source-over'; x.fillStyle = '#05070d'; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter';
    for (let k = 0; k < N; k++) {
      const own = keep ? (P.cmode === 'bulb' ? keep[k] : ownerAt(P, k) === hov.hi || keep[k]) : 1, x0 = Math.floor(k * sw), x1 = Math.floor((k + 1) * sw);
      const c = base[k];   // faint: where the color is assigned
      if (c) { const a = own ? 0.28 : 0.05; x.fillStyle = 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')'; x.fillRect(x0, 0, x1 - x0, h); }
      if (buf) { const f = own ? 1 : 0.1; x.fillStyle = 'rgb(' + (buf[k * 3] * f | 0) + ',' + (buf[k * 3 + 1] * f | 0) + ',' + (buf[k * 3 + 2] * f | 0) + ')'; x.fillRect(x0, 0, x1 - x0, h); }   // live: what the bulb is doing now
    }
    x.globalCompositeOperation = 'source-over'; x.fillStyle = '#0b0e0d';
    RUN_START.forEach(i => { if (i) x.fillRect(Math.round(i * sw) - DPR / 2, 0, DPR, h); });
    if (hov.k >= 0) { x.strokeStyle = '#ffe2bd'; x.lineWidth = 1.5 * DPR; x.strokeRect(hov.k * sw - DPR, DPR * 0.75, sw + 2 * DPR, h - 1.5 * DPR); }
  }
  function pill(ctx, x, y, text, fill, ink) {
    ctx.font = '600 ' + (11 * DPR) + 'px Inter, sans-serif';
    const w = Math.max(18 * DPR, ctx.measureText(text).width + 10 * DPR), h = 18 * DPR;
    ctx.fillStyle = fill; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, 6 * DPR); else ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill();
    ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5 * DPR);
  }
  function drawOverlay(v, P) {   // on the stage house: hovered bulb ring + optional labels
    const ctx = v.ctx, k = v.k, px = l => [l.x * k + v.ox, l.y * k + v.oy];
    if (APP.colorLabels) {
      const lift = 17 * DPR, [sx, sy] = px(LEDS[0]); pill(ctx, sx - 4 * DPR, sy + lift + 4 * DPR, 'start →', 'rgba(255,179,71,.92)', '#200c00');
      const runs = [];   // label each stretch of one color: blocks in swatch mode, pattern entries for short per-bulb runs
      let a = 0; for (let i = 1; i <= N; i++) if (i === N || ownerAt(P, i) !== ownerAt(P, a)) { runs.push([a, i - 1, ownerAt(P, a)]); a = i; }
      if (runs.length <= 16) runs.forEach(([s0, s1, j]) => {
        if (j < 0 || (hov.hi >= 0 && j !== hov.hi)) return;
        const c = P.cmode === 'bulb' ? P.seq[j].c : colorList(P)[j]; if (!c) return;
        const [x, y] = px(LEDS[(s0 + s1) >> 1]), num = P.cmode === 'bulb' ? P.seq.slice(0, j + 1).filter(e => e.c).length : j + 1;
        pill(ctx, x, y - lift, String(num), 'rgba(3,5,10,.78)', '#eef2ff'); ctx.fillStyle = hex(c); ctx.beginPath(); ctx.arc(x, y - lift + 11 * DPR, 2.4 * DPR, 0, 6.2832); ctx.fill();
      });
    }
    if (hov.k >= 0) { const [x, y] = px(LEDS[hov.k]); ctx.strokeStyle = 'rgba(255,215,160,.95)'; ctx.lineWidth = 1.5 * DPR; ctx.beginPath(); ctx.arc(x, y, 9 * DPR, 0, 6.2832); ctx.stroke(); }
  }
  function setHi(i) { if (hov.hi === i) return; hov.hi = i; $('ctrls').querySelectorAll('[data-sw],[data-sq]').forEach(el => el.classList.toggle('hl', +(el.dataset.sw ?? el.dataset.sq) === i)); }
  $('ctrls').addEventListener('pointerover', e => {
    if (dragFrom) return;
    const el = e.target.closest('[data-sw],[data-sq]'); if (!el) { setHi(-1); return; }
    const i = +(el.dataset.sw ?? el.dataset.sq); setHi(el.dataset.sq != null && !state.edit.P.seq[i]?.c ? -1 : i);
  });
  $('ctrls').addEventListener('pointerleave', () => setHi(-1));
  $('ctrls').addEventListener('pointermove', e => {
    const cv = e.target.closest('#cstrip'), tip = $('ctip');
    if (!cv) { if (hov.k >= 0) { hov.k = -1; tip && tip.classList.remove('on'); } return; }
    const r = cv.getBoundingClientRect(), k = clamp(Math.floor((e.clientX - r.left) / r.width * N), 0, N - 1), P = editR();
    hov.k = k; const j = ownerAt(P, k);
    const cn = j < 0 ? '' : P.cmode === 'bulb' ? (P.seq[j].c ? ' · color ' + P.seq.slice(0, j + 1).filter(e2 => e2.c).length : ' · gap') : ' · color ' + (j + 1);
    tip.textContent = 'Bulb ' + (k + 1) + ' · ' + (RUN_NAMES[LEDS[k].run] || '') + cn;
    tip.style.left = clamp(e.clientX - r.left, 80, r.width - 80) + 'px'; tip.classList.add('on');
  });
  // drag to reorder (swatches and per-bulb rows)
  let dragFrom = null;
  $('ctrls').addEventListener('dragstart', e => { const s = e.target.closest('[data-sw],[data-sq]'); if (!s) return; dragFrom = { kind: s.dataset.sw != null ? 'sw' : 'sq', i: +(s.dataset.sw ?? s.dataset.sq) }; e.dataTransfer.effectAllowed = 'move'; s.classList.add('dragging'); });
  $('ctrls').addEventListener('dragover', e => { if (dragFrom && e.target.closest(dragFrom.kind === 'sw' ? '[data-sw]' : '[data-sq]')) e.preventDefault(); });
  $('ctrls').addEventListener('drop', e => {
    const tgt = e.target.closest(dragFrom?.kind === 'sw' ? '[data-sw]' : '[data-sq]'); if (!dragFrom || !tgt) return; e.preventDefault();
    const P = state.edit.P, to = +(tgt.dataset.sw ?? tgt.dataset.sq), arr = dragFrom.kind === 'sw' ? P.colors : P.seq;
    if (to !== dragFrom.i) { moveItem(arr, dragFrom.i, to); moveItem(state.edit.locks, dragFrom.i, to); }
    dragFrom = null; renderControls(); changed();
  });
  $('ctrls').addEventListener('dragend', () => { dragFrom = null; });
  $('ctrls').addEventListener('input', e => {
    if (colorInput(e)) return;
    if (e.target.dataset.gap != null) { if (e.target.value === '') return; setGap(state.edit.P, clamp(Math.round(+e.target.value) || 0, 0, 9)); renderControls(); changed(); const g = $('ctrls').querySelector('[data-gap]'); if (g) g.focus(); return; }
    const el = e.target, i = el.dataset.i; if (i == null) return;
    const c = state.edit.defs[+i], P = state.edit.P;
    if (c.type === 'range' && el.dataset.curve) { P.sx = posToSp(+el.value); rangeFill(el); $('val' + i).textContent = speedWord(P.sx); }
    else if (c.type === 'range') { P[c.k] = +el.value; rangeFill(el); $('val' + i).textContent = rangeWord(c, P[c.k]); }
    else if (c.type === 'check') P[c.k] = el.checked;
    else if (c.type === 'colors') { const j = +el.dataset.j, v = unhex(el.value), cc = P.col[j] = j === 0 ? warm(v) : v; el.parentNode.querySelector('span').style.background = hex(cc); if (hex(cc) !== el.value) el.value = hex(cc); }   // backgrounds may be dim/neutral
    changed();
  });
  $('ctrls').addEventListener('click', e => {
    const P = state.edit.P;
    const lk = e.target.closest('[data-lock]');
    if (lk) { e.preventDefault(); e.stopPropagation(); const j = +lk.dataset.lock; state.edit.locks[j] = !state.edit.locks[j]; renderControls(); return; }
    if (colorClick(e)) return;
    const ng = e.target.closest('[data-nudge]');
    if (ng) { P.sx = clamp(P.sx + +ng.dataset.nudge, 0, 255); const sl = ng.parentNode.querySelector('input[type=range]'); sl.value = spToPos(P.sx); rangeFill(sl); $('val' + ng.dataset.i).textContent = speedWord(P.sx); return changed(); }
    const sw = e.target.closest('[data-slow]'); if (sw) { P.slow = +sw.dataset.slow; resetStage(); renderControls(); return changed(); }
    const dr = e.target.closest('[data-dir]'); if (dr) { P.rev = dr.dataset.dir === 'r'; P.mi = dr.dataset.dir === 'm'; resetStage(); renderControls(); return changed(); }
    if (e.target.closest('#rollBtn')) { const cur = P.cmode === 'bulb' ? P.seq.map(x => x.c || BLACK) : P.mycol ? P.colors : P.col.slice(0, 3); return applyColors(randomColors(cur, state.edit.locks), true); }
    if (e.target.closest('#themeBtn')) { if ($('themePop').classList.contains('on')) closeThemes(); else openThemes(e.target.closest('#themeBtn')); return; }
    if (e.target.id === 'resetBtn') { state.edit.P = bakeMaster(clone(BY_ID[state.edit.id].P)); state.edit.locks = []; resetStage(); renderControls(); return changed(); }
    const b = e.target.closest('button[data-i][data-v]'); if (!b) return;
    const c = state.edit.defs[+b.dataset.i];
    if (c.type === 'seg') setGap(P, +b.dataset.v); else if (c.type === 'palette') P.pal = +b.dataset.v;
    renderControls(); changed();
  });

  /* colours: themes + random (saturation ≥ .75, so never white) */
  const hsv2rgb = (h, s, v) => { const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6].map(x => Math.round(x * 255)); };
  function randomColors(cur, locks) {
    const base = Math.random(), sch = [[0, .07, -.07], [0, .5, .08], [0, .33, .66], [0, .12, .5]][Math.floor(Math.random() * 4)];
    return cur.map((c, j) => locks && locks[j] ? c : hsv2rgb((base + sch[j % 3] + 1) % 1, .75 + Math.random() * .25, .85 + Math.random() * .15));
  }
  function applyColors(cols, sameCount) {
    const P = state.edit.P, L = state.edit.locks;
    if (P.cmode === 'bulb') { let k = 0; P.seq = P.seq.map((e, j) => !e.c || L[j] ? e : { c: cols[sameCount ? j : k++ % cols.length].slice(), n: e.n }); }
    else if (P.mycol) P.colors = P.colors.map((c, j) => L[j] ? c : cols[sameCount ? j : j % cols.length].slice());
    else if (usesPal(P.fx) && P.pal === 2) { if (!L[0]) P.col[0] = cols[0].slice(); }       // keep the look's own background
    else if (usesPal(P.fx) && P.pal === 3) { [0, 1].forEach(j => { if (!L[j] && cols[j]) P.col[j] = cols[j].slice(); }); }
    else if (usesPal(P.fx)) { P.mycol = true; P.colors = cols.map((c, j) => (L[j] && P.col[j] ? P.col[j] : c).slice()); P.rep = 1; P.blend = false; state.edit.locks = []; }
    else P.col = P.col.map((c, j) => L[j] ? c : (cols[j] || c).slice());
    renderControls(); changed();
  }
  const themePop = document.createElement('div'); themePop.id = 'themePop'; document.body.appendChild(themePop);
  function openThemes(btn) {
    const cur = JSON.stringify(state.edit.P.mycol ? state.edit.P.colors : state.edit.P.col);
    themePop.innerHTML = '<div class="thm-h"><b>Color themes</b><span>click to try · Esc to close</span></div>' + CAT.THEMES.map(g => '<h4>' + esc(g[0]) + '</h4>' + g[1].map(t => '<button class="thm' + (JSON.stringify(t[1]) === cur ? ' on' : '') + '" data-th=\'' + JSON.stringify(t[1]) + '\'><i>' + t[1].map(c => '<u style="background:' + hex(c) + '"></u>').join('') + '</i>' + esc(t[0]) + '</button>').join('')).join('');
    const r = btn.getBoundingClientRect();
    themePop.style.left = Math.max(12, Math.min(innerWidth - 392, r.right - 380)) + 'px'; themePop.style.top = Math.max(12, Math.min(innerHeight - 482, r.bottom + 8)) + 'px';
    themePop.classList.add('on'); btn.classList.add('open');
  }
  function closeThemes() { themePop.classList.remove('on'); $('themeBtn')?.classList.remove('open'); }
  themePop.addEventListener('click', e => { const b = e.target.closest('[data-th]'); if (!b) return; applyColors(JSON.parse(b.dataset.th)); themePop.querySelectorAll('.thm').forEach(x => x.classList.toggle('on', x === b)); $('themeBtn')?.classList.add('open'); });
  document.addEventListener('mousedown', e => { if (themePop.classList.contains('on') && e.target.closest && !themePop.contains(e.target) && !e.target.closest('#themeBtn')) closeThemes(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && themePop.classList.contains('on')) { e.stopPropagation(); closeThemes(); } }, true);

  /* ---------- names + categories ---------- */
  function editOf(id) { return APP.edits[id] || (APP.edits[id] = {}); }
  function renameLook(id, name) {
    name = String(name || '').trim(); const l = BY_ID[id]; if (!l || !name || name === l.name) return;
    l.name = name; const u = APP.userLooks.find(x => x.id === id); if (u) { u.name = name; save(['userLooks']); } else { editOf(id).name = name; save(['edits']); }
    refreshScheduleBodies();
    if (state.edit?.id === id) { $('eName').textContent = name; $('fsName').textContent = name; $('pTitle').textContent = 'Tune ' + name; }
    renderGallery(true); onHouseChanged();
  }
  function setLookCats(id, cats) {
    const l = BY_ID[id]; l.cats = cats; const u = APP.userLooks.find(x => x.id === id);
    if (u) { u.cats = cats; save(['userLooks']); } else { editOf(id).cats = cats; save(['edits']); }
    renderNav(); renderGallery(true); renderCrumbCats();
  }
  function addCategory(label) {
    label = String(label || '').trim(); if (!label) return null;
    const id = 'c-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!CAT_LABEL[id]) { APP.cats.push([id, label, '◆']); CAT_LABEL[id] = label; save(['cats']); renderNav(); }
    return id;
  }
  function startRename(el, id) {
    const inp = document.createElement('input'); inp.className = 'rn'; inp.value = BY_ID[id].name; el.replaceWith(inp); inp.focus(); inp.select();
    let done = false; const finish = ok => { if (done) return; done = true; inp.replaceWith(el); if (ok) renameLook(id, inp.value); };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
  }
  function renderCrumbCats() {
    if (!state.edit) return; const l = BY_ID[state.edit.id];
    $('eCat').innerHTML = l.cats.filter(c => c !== 'mine').map(c => '<span class="cc">' + esc(CAT_LABEL[c] || c) + '</span>').join('') + '<button id="catBtn">＋ Categories</button>';
  }
  const catPop = document.createElement('div'); catPop.id = 'catPop'; document.body.appendChild(catPop);
  function openCatPop(anchor, id) {
    const l = BY_ID[id]; catPop.dataset.id = id;
    catPop.innerHTML = '<b>' + esc(l.name) + ' is in…</b>' + allCats().concat([['mine', 'Saved looks', '★']]).map(c => '<label><input type="checkbox" data-cat="' + c[0] + '"' + (l.cats.includes(c[0]) ? ' checked' : '') + '> ' + esc(c[1]) + '</label>').join('') + '<div class="newc"><input id="newCat" placeholder="New category, e.g. Thanksgiving"><button id="newCatBtn">Add</button></div>';
    const r = anchor.getBoundingClientRect(); catPop.style.left = Math.min(innerWidth - 272, r.left) + 'px'; catPop.style.top = (r.bottom + 8) + 'px'; catPop.classList.add('on');
  }
  catPop.addEventListener('change', e => { const cb = e.target.closest('[data-cat]'); if (!cb) return; const id = catPop.dataset.id; let cats = BY_ID[id].cats.slice(); const c = cb.dataset.cat; cats = cb.checked ? (cats.includes(c) ? cats : cats.concat([c])) : cats.filter(x => x !== c); setLookCats(id, cats); });
  catPop.addEventListener('click', e => { if (e.target.id !== 'newCatBtn') return; const cid = addCategory($('newCat').value); if (!cid) return; const id = catPop.dataset.id; if (!BY_ID[id].cats.includes(cid)) setLookCats(id, BY_ID[id].cats.concat([cid])); openCatPop($('catBtn') || document.body, id); });
  catPop.addEventListener('keydown', e => { if (e.target.id === 'newCat' && e.key === 'Enter') $('newCatBtn').click(); e.stopPropagation(); });
  document.addEventListener('mousedown', e => { if (catPop.classList.contains('on') && e.target.closest && !catPop.contains(e.target) && !e.target.closest('#catBtn')) catPop.classList.remove('on'); });
  document.addEventListener('click', e => {
    if (e.target.id === 'catBtn') { if (catPop.classList.contains('on')) catPop.classList.remove('on'); else openCatPop(e.target, state.edit.id); return; }
    if (e.target.id === 'eName' && state.edit) return startRename(e.target, state.edit.id);
    if (e.target.id === 'navAdd') {
      const inp = document.createElement('input'); inp.className = 'rn'; inp.style.cssText = 'width:100%;font-size:13px;margin-top:2px'; inp.placeholder = 'Category name, then Enter';
      e.target.replaceWith(inp); inp.focus();
      inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { const cid = addCategory(inp.value); if (cid) { state.sec = cid; renderNav(); renderGallery(); } else renderNav(); } else if (ev.key === 'Escape') renderNav(); };
      inp.onblur = () => renderNav();
    }
  });

  /* ---------- preview vs on WLED ---------- */
  function syncEditState() {
    if (!state.edit) return;
    const e = state.edit, look = BY_ID[e.id], hid = houseLookId(), hname = houseName();
    const R = editR(), sync = hid === e.id && stateMatches(R) && Math.round(R.bri) === (WL.state?.bri ?? -1);
    const edited = !sameP(R, applyMaster(Object.assign({}, look.P, { colFixed: true })));
    $('eState').innerHTML = sync
      ? '<span class="pill sync"><span class="dot"></span>This is current WLED output · <b>' + esc(look.name) + '</b></span>'
      : '<span class="pill pv"><span class="k">Preview</span><b>' + esc(look.name) + '</b>' + (edited ? '<span style="color:var(--dim)">edited</span>' : '') + '</span><span class="arrow">vs</span><span class="pill hs"><span class="dot"></span><span class="k">Active on WLED</span><b>' + esc(hname) + '</b></span>';
    const tag = $('stageTag'); tag.classList.toggle('sync', sync); tag.lastChild.textContent = sync ? 'Active on WLED' : 'Preview';
    $('mini').classList.toggle('gone', sync && !state.pushing); $('miniName').textContent = hname;
    $('revertBtn').disabled = sync || !hid;
    if (!state.pushing) {
      [$('pushBtn'), $('fsPush')].forEach(b => { b.classList.toggle('synced', sync); b.disabled = sync || !WL.host; });
      $('pushTxt').textContent = sync ? '✓ Active on WLED' : 'Push to house'; $('fsPush').querySelector('span').textContent = sync ? '✓ Active on WLED' : 'Push to house';
    }
    $('fmsg').innerHTML = sync ? 'The roof is showing exactly this. Tweak anything to preview a change; the house won’t change until you push.'
      : 'Only the preview changes. The roof keeps showing <b>' + esc(hname) + '</b> until you push.';
  }
  $('revertBtn').addEventListener('click', () => {
    const hid = houseLookId(); if (!hid) return;
    if (hid !== state.edit.id) { location.hash = 'edit=' + hid; return; }
    const lp = APP.lastPush; state.edit.P = bakeMaster(clone(houseMatchesLastPush() && lp.id === hid ? (lp.base || lp.P) : BY_ID[hid].P)); state.edit.locks = []; resetStage(); renderControls(); changed(); toast('Back to what’s on WLED');
  });
  async function doPush() {
    if (state.pushing) return;
    const e = state.edit, name = BY_ID[e.id].name; state.pushing = true;
    const fill = $('pushFill'); $('pushTxt').textContent = 'Fading in on the roof…';
    fill.style.transition = 'none'; fill.style.width = '0'; void fill.offsetWidth; fill.style.transition = 'width ' + (REDUCED ? 0.01 : 2) + 's linear'; fill.style.width = '100%';
    try { await pushToHouse(editR(), e.id, e.P); toast(name + ' is on WLED'); }
    catch (err) { toast('Push failed: ' + err.message, 'var(--warn)'); }
    finally { state.pushing = false; fill.style.transition = 'none'; fill.style.width = '0'; syncEditState(); markLive(); }
  }
  $('pushBtn').addEventListener('click', doPush); $('fsPush').addEventListener('click', doPush);
  $('saveBtn').addEventListener('click', () => {
    const e = state.edit, look = BY_ID[e.id];
    if (look.custom) { const u = APP.userLooks.find(x => x.id === look.id); u.P = clone(e.P); look.P = clone(e.P); save(['userLooks']); refreshScheduleBodies(); renderGallery(true); return toast('Saved changes to ' + look.name, 'var(--accent)'); }
    const id = 'mine-' + Date.now().toString(36), nm = look.name + ' · mine';
    APP.userLooks.unshift({ id, base: look.id, name: nm, cats: ['mine'].concat(look.cats.filter(c => c !== 'mine')), desc: 'Your take on ' + look.name, P: clone(e.P) });
    save(['userLooks']); buildLooks();
    const wasLive = houseLookId() === look.id && stateMatches(editR());
    if (wasLive) { APP.lastPush.id = id; save(['lastPush']); }
    history.replaceState(null, '', location.href.split('#')[0] + '#edit=' + id); enterEdit(id, true);
    renderNav(); renderGallery(true); toast('Saved “' + nm + '” to Saved looks', 'var(--accent)');
  });

  /* ---------- full screen ---------- */
  function setFull(on) { state.full = on; $('stage').classList.toggle('full', on); $('fsTxt').textContent = on ? 'Exit full screen' : 'Full screen'; vStage.crop = on ? CROP_FULL : CROP_STAGE; vStage.cw = 0; vStage.plate = null; requestAnimationFrame(() => { vStage.resize(); vMini.resize(); }); }
  $('fsBtn').addEventListener('click', () => setFull(!state.full)); $('fsExit').addEventListener('click', () => setFull(false));

  /* ---------- toast ---------- */
  let toastT; function toast(msg, color) { $('toastText').textContent = msg; const d = $('toastDot'); d.style.background = color || 'var(--live)'; d.style.boxShadow = '0 0 8px ' + (color || 'var(--live)'); $('toast').classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => $('toast').classList.remove('on'), 2600); }

  /* ======================= ✨ AI (AI features, through the configured service endpoint) ======================= */
  const AI_EXAMPLES = ['Thanksgiving dinner: slow cranberry & amber candlelight', 'Team colors for the big game, bright green & navy energy', 'Snowy blue evening, very calm', 'Haunted house flicker for Halloween', 'Christmas Eve warm twinkle, no white', 'Calm ocean night', 'Something wild I’ve never seen'];
  let aiViews = [], aiLooks = [];
  $('aiChips').innerHTML = AI_EXAMPLES.map(t => '<button>' + esc(t) + '</button>').join('');
  $('aiChips').onclick = e => { const b = e.target.closest('button'); if (b) { $('aiPrompt').value = b.textContent; $('aiPrompt').focus(); } };
  function openAI() { $('aiModal').hidden = false; setTimeout(() => $('aiPrompt').focus(), 30); }
  function closeAI() { $('aiModal').hidden = true; aiViews.forEach(v => { const i = allViews.indexOf(v); if (i >= 0) allViews.splice(i, 1); }); aiViews = []; }
  $('aiBtn').onclick = openAI; $('aiClose').onclick = closeAI;
  $('aiModal').addEventListener('mousedown', e => { if (e.target === $('aiModal')) closeAI(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('aiModal').hidden) { e.stopPropagation(); closeAI(); } }, true);
  $('aiPrompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('aiGo').click(); });
  const aiP = lk => ({ fx: lk.fx, sx: lk.sx, ix: lk.ix, c1: lk.c1, c2: lk.c2, c3: lk.c3, o1: lk.o1, o2: false, o3: false, pal: lk.pal, col: lk.col, spc: lk.spc, bri: lk.bri });
  $('aiGo').onclick = async () => {
    const prompt = $('aiPrompt').value.trim(); if (!prompt) return $('aiPrompt').focus();
    $('aiGo').disabled = true; $('aiStat').innerHTML = '<span class="aispin"></span>The AI service is designing 4 looks for your house…';
    try {
      const r = await fetch('/api/ai/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, n: 4 }) }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'AI error');
      aiLooks = r.looks; closeAI(); $('aiModal').hidden = false;
      $('aiRes').innerHTML = aiLooks.map((lk, i) => '<div class="aicard"><canvas data-ai="' + i + '"></canvas><div class="m"><b>' + esc(lk.name) + '</b><p>' + esc(lk.desc) + '</p><small>' + esc((WL.effects[lk.fx] || TLFX?.names?.[lk.fx] || 'Effect ' + lk.fx) + ' · ' + (CAT_LABEL[lk.category] || lk.category)) + ' — ' + esc(lk.why) + '</small><button class="use" data-use="' + i + '">Use this one →</button></div></div>').join('');
      $('aiRes').querySelectorAll('canvas[data-ai]').forEach(cv => { const v = makeView(cv, CROP_CARD, 1.6, 1.5); v.P = aiP(aiLooks[+cv.dataset.ai]); aiViews.push(v); });
      $('aiStat').textContent = 'Pick one to keep and tweak, or change the description and try again.';
    } catch (err) { $('aiStat').textContent = '⚠️ ' + err.message; }
    $('aiGo').disabled = false;
  };
  $('aiRes').addEventListener('click', e => {
    const b = e.target.closest('[data-use]'); if (!b) return;
    const lk = aiLooks[+b.dataset.use];
    if (!CAT_LABEL['c-ai']) { APP.cats.push(['c-ai', 'AI made', '✨']); CAT_LABEL['c-ai'] = 'AI made'; save(['cats']); }
    const id = 'ai-' + Date.now().toString(36);
    APP.userLooks.unshift({ id, name: lk.name, cats: ['mine', 'c-ai', lk.category], desc: lk.desc, fx: lk.fx, labels: Object.fromEntries(Object.entries(lk.labels || {}).filter(([, v]) => v)), P: aiP(lk), ai: { prompt: $('aiPrompt').value.trim(), why: lk.why } });
    save(['userLooks', 'cats']); buildLooks(); renderNav(); renderGallery(true); closeAI();
    openEdit(id, null); toast('Saved “' + lk.name + '” to Saved looks · tweak it here', 'var(--accent)');
  });
  // editor: ask the AI service to change the look being previewed
  function renderAITweak() {
    if (!state.edit) return;
    const d = document.createElement('div'); d.className = 'aitweak';
    d.innerHTML = '<label>✨ Ask AI to change this look</label><div class="r"><input id="aiTw" placeholder="e.g. slower, more red, twinkle on every 3rd bulb"><button id="aiTwGo">Change</button></div><div class="s" id="aiTwS"></div>';
    $('ctrls').appendChild(d);
    $('aiTw').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') $('aiTwGo').click(); };
    $('aiTwGo').onclick = async () => {
      const prompt = $('aiTw').value.trim(); if (!prompt) return $('aiTw').focus();
      $('aiTwGo').disabled = true; $('aiTwS').innerHTML = '<span class="aispin"></span>The AI service is reworking it…';
      try {
        const r = await fetch('/api/ai/tweak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, P: state.edit.P, name: BY_ID[state.edit.id].name }) }).then(r => r.json());
        if (!r.ok) throw new Error(r.error || 'AI error');
        const old = state.edit.P;
        state.edit.P = bakeMaster(upgradeP(aiP(r.look)));
        if (old.cmode === 'bulb') { const nc = visibleColors(state.edit.P); let k = 0; state.edit.P.cmode = 'bulb'; state.edit.P.seq = old.seq.map(e => e.c ? { c: nc[k++ % nc.length].slice(), n: e.n } : { c: null, n: e.n }); }
        state.edit.locks = []; resetStage();
        renderControls(); changed();
        toast('Preview updated: ' + (r.look.why || 'done') + '  ·  Push when you like it', 'var(--accent)');
      } catch (err) { const s = $('aiTwS'); if (s) s.textContent = '⚠️ ' + err.message; }
      const g = $('aiTwGo'); if (g) g.disabled = false;
    };
  }

  /* ======================= 🌙 schedule (controller timers do WHEN; the Studio server loads WHAT into preset 240) ======================= */
  const LOCATION = window.TLSettings.read(), HOME = { lat: LOCATION.lat == null ? null : Number(LOCATION.lat), lon: LOCATION.lon == null ? null : Number(LOCATION.lon) };
  const PS_TONIGHT = 240, PS_NIGHT = 241, PS_OFF = 242, PS_WEEKDAY = 244;
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // WLED counts Monday as bit 0 and Sunday as bit 6.
  const DOW_BITS = [64, 1, 2, 4, 8, 16, 32];
  let persistedSchedule = clone((window.TL_SERVER_STATE ? window.TL_SERVER_STATE.app?.schedule : APP.schedule) ?? null);
  APP.schedule = Object.assign({ onMode: 'sunset', onOffset: 0, onTime: '17:00', eveLook: 'current', nightOn: true, nightTime: '21:30', nightTimeWE: '21:30', nightMode: 'dim', nightLook: 'porch-glow-twinkle', nightBri: 10, nightFade: 5, offMode: 'sunrise', offTime: '01:00', programs: [] }, APP.schedule || {});
  const SC = APP.schedule; SC.programs = SC.programs || []; SC.weeklyLooks = SC.weeklyLooks || {};
  if (!SC.nightTimeWE) SC.nightTimeWE = SC.nightTime;
  const pct2bri = p => bedtimeBrightness(p, WL.brightnessGamma);
  const fmt12 = hhmm => { if (!hhmm) return '—'; const [h, m] = hhmm.split(':').map(Number); return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };
  const toHM = d => {
    if (!d || !Number.isFinite(d.getTime())) return null;
    const timezone = SC.timezone || LOCATION.timezone;
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone || undefined }).format(d);
  };
  // NOAA-style sunrise/sunset (good to a minute or two)
  function sunTimes(date) {
    if (!Number.isFinite(HOME.lat) || !Number.isFinite(HOME.lon) || HOME.lat === 0 && HOME.lon === 0) return { rise: null, set: null };
    const rad = Math.PI / 180, day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 864e5);
    const g = 2 * Math.PI / 365 * (day - 1), eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(HOME.lat * rad) * Math.cos(dec)) - Math.tan(HOME.lat * rad) * Math.tan(dec)) / rad;
    const at = mins => { const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) + mins * 6e4); return d; };
    return { rise: at(720 - 4 * (HOME.lon + ha) - eq), set: at(720 - 4 * (HOME.lon - ha) - eq) };
  }
  const scheduledBody = P => Object.assign(wledBody(P), { transition: clamp(Math.round((APP.fade?.sched ?? 2) * 10), 0, 6000) });
  const bodyOf = id => { if (plName(id)) { const pl = plById(id.slice(3)); return pl && pl.items.length ? plBody(pl) : null; } return BY_ID[id] ? scheduledBody(applyMaster(BY_ID[id].P)) : null; };
  const nameOf = id => BY_ID[id]?.name || plName(id);
  const lookSel = (sel, val, withCurrent) => { sel.innerHTML = (withCurrent ? '<option value="current">Whatever I last pushed</option>' : '') + LOOKS.map(l => '<option value="' + l.id + '">' + esc(l.name) + '</option>').join('') + (APP.playlists.length ? '<optgroup label="Playlists">' + APP.playlists.map(pl => '<option value="pl:' + pl.id + '">▶ ' + esc(pl.name) + '</option>').join('') + '</optgroup>' : ''); sel.value = val; };
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function nthWeekday(y, m, wd, n) { const d = new Date(y, m, 1); while (d.getDay() !== wd) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 7 * (n - 1)); return d; }
  function quickPrograms() {
    const now = new Date(), y = now.getFullYear(), tg = nthWeekday(y, 10, 4, 4);
    const upcoming = (month, day) => new Date(new Date(y, month, day, 23, 59) < now ? y + 1 : y, month, day);
    const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    return [
      ['Thanksgiving week', iso(add(tg, -3)), iso(add(tg, 3)), 'thanksgiving-table'],
      ['Thanksgiving Day', iso(tg), iso(tg), 'harvest-candlelight'],
      ['Christmas season', iso(new Date(y, 11, 1)), iso(new Date(y + 1, 0, 1)), 'trimlight-christmas'],
      ['Christmas Eve & Day', iso(new Date(y, 11, 24)), iso(new Date(y, 11, 25)), 'christmas-twinkle'],
      ['Hanukkah', y === 2026 ? '2026-12-04' : iso(new Date(y, 11, 14)), y === 2026 ? '2026-12-12' : iso(new Date(y, 11, 22)), 'hanukkah-shimmer'],
      ['New Year’s Eve', iso(new Date(y, 11, 31)), iso(new Date(y + 1, 0, 1)), 'fireworks'],
      ['Valentine’s', iso(upcoming(1, 14)), iso(upcoming(1, 14)), 'valentine-glow'],
      ['Fourth of July', iso(upcoming(6, 4)), iso(upcoming(6, 4)), 'fourth-of-july'],
      ['Halloween week', iso(add(upcoming(9, 31), -6)), iso(upcoming(9, 31)), 'halloween-flicker'],
    ];
  }
  function renderPrograms() {
    $('progs').innerHTML = SC.programs.length ? SC.programs.map((p, i) =>
      '<div class="prog" data-i="' + i + '"><input type="checkbox" data-k="on"' + (p.on !== false ? ' checked' : '') + ' title="On"><input type="text" data-k="name" value="' + esc(p.name) + '"><input type="date" data-k="start" value="' + p.start + '"><input type="date" data-k="end" value="' + p.end + '"><select data-k="look"></select><button class="x" data-del="' + i + '" title="Remove">×</button></div>').join('')
      : '<p class="sh">No programs yet. Add one below.</p>';
    $('progs').querySelectorAll('.prog').forEach(r => lookSel(r.querySelector('select'), SC.programs[+r.dataset.i].look, false));
    const have = new Set(SC.programs.map(p => p.name));
    $('progQuick').innerHTML = quickPrograms().filter(q => !have.has(q[0])).map((q, i) => '<button data-q="' + i + '">＋ ' + esc(q[0]) + '</button>').join('') + '<button data-q="custom">＋ Custom</button>';
  }
  $('progs').addEventListener('input', e => { const r = e.target.closest('.prog'); if (!r) return; const p = SC.programs[+r.dataset.i], k = e.target.dataset.k; p[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; refreshNights(); });
  $('progs').addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (d) { SC.programs.splice(+d.dataset.del, 1); renderPrograms(); refreshNights(); } });
  $('progQuick').addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    if (b.dataset.q === 'custom') { const t = iso(new Date()); SC.programs.push({ name: 'My program', start: t, end: t, look: houseLookId() || 'autumn-twinkle', on: true }); }
    else { const q = quickPrograms().filter(x => !SC.programs.some(p => p.name === x[0]))[+b.dataset.q]; SC.programs.push({ name: q[0], start: q[1], end: q[2], look: q[3], on: true }); }
    renderPrograms(); refreshNights();
  });
  function fillSchedule() {
    lookSel($('eveLook'), SC.eveLook, true); lookSel($('nightLook'), SC.nightLook, false);
    document.querySelectorAll('input[name=onMode]').forEach(r => r.checked = r.value === SC.onMode);
    document.querySelectorAll('input[name=nightMode]').forEach(r => r.checked = r.value === SC.nightMode);
    document.querySelectorAll('input[name=offMode]').forEach(r => r.checked = r.value === SC.offMode);
    $('onOffset').value = SC.onOffset; $('onTime').value = SC.onTime; $('nightOn').checked = SC.nightOn; $('nightTime').value = SC.nightTime; $('nightTimeWE').value = SC.nightTimeWE;
    $('nightBri').value = SC.nightBri; $('nightBriO').textContent = SC.nightBri + '%'; $('nightFade').value = SC.nightFade; $('offTime').value = SC.offTime;
    $('nightLookRow').style.display = SC.nightMode === 'look' ? '' : 'none';
    renderPrograms(); renderWeeklyLooks();
  }
  function renderWeeklyLooks() {
    $('weeklyLooks').innerHTML = WEEKDAYS.map((day, dow) => '<label class="weekly-day" data-weekday-row="' + dow + '"><span>' + day + '</span><select data-weekday="' + dow + '" aria-label="Look for ' + day + '"><option value="">Usual look</option>' + LOOKS.map(l => '<option value="' + l.id + '">' + esc(l.name) + '</option>').join('') + '</select></label>').join('');
    $('weeklyLooks').querySelectorAll('[data-weekday]').forEach(sel => sel.value = SC.weeklyLooks[sel.dataset.weekday] || '');
  }
  function readSchedule() {
    const v = n => (document.querySelector('input[name=' + n + ']:checked') || {}).value;
    Object.assign(SC, { onMode: v('onMode'), onOffset: clamp(+$('onOffset').value || 0, -59, 59), onTime: $('onTime').value || '17:00', eveLook: $('eveLook').value, nightOn: $('nightOn').checked, nightTime: $('nightTime').value || '21:30', nightTimeWE: $('nightTimeWE').value || $('nightTime').value || '21:30', nightMode: v('nightMode'), nightLook: $('nightLook').value, nightBri: +$('nightBri').value, nightFade: +$('nightFade').value, offMode: v('offMode'), offTime: $('offTime').value || '01:00' });
    SC.weeklyLooks = Object.fromEntries([...document.querySelectorAll('#weeklyLooks [data-weekday]')].filter(sel => sel.value).map(sel => [sel.dataset.weekday, sel.value]));
    SC.timezone = LOCATION.timezone || SC.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }
  $('schedule').addEventListener('input', e => {
    if (e.target.id === 'nightBri') $('nightBriO').textContent = e.target.value + '%';
    if (e.target.name === 'nightMode') $('nightLookRow').style.display = e.target.value === 'look' ? '' : 'none';
    if (e.target.closest('.schcard') && !e.target.closest('#progs')) { readSchedule(); syncDim(); refreshNights(); }
  });
  $('schedule').addEventListener('change', e => {
    if (e.target.matches('#weeklyLooks [data-weekday]')) { readSchedule(); refreshNights(); }
  });
  const nightKey = d => { const w = d.getDay(); return (w === 5 || w === 6) ? SC.nightTimeWE : SC.nightTime; };   // Fri & Sat nights
  // which look plays on a date: same rules as scheduler.py (game day > latest-starting program > usual look)
  function nightFor(d) {
    const k = iso(d);
    let best = null; SC.programs.forEach(p => { if (p.on !== false && (BY_ID[p.look] || plName(p.look)) && p.start <= k && k <= p.end && (!best || p.start > best.start)) best = p; });
    if (best) return { look: best.look, why: best.name, src: 'program' };
    const weekly = SC.weeklyLooks[d.getDay()];
    if (weekly && BY_ID[weekly]) return { look: weekly, why: WEEKDAYS[d.getDay()] + ' look', src: 'weekly' };
    return { look: SC.eveLook === 'current' ? APP.lastPush?.id : SC.eveLook, why: 'Usual look', src: 'default' };
  }
  let vTonight = null, schedulerStatusTimer = null;
  function refreshNights() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SC.timezone || LOCATION.timezone || undefined, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts();
    const { year, month, day } = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
    const today = new Date(year, month - 1, day, 12), nextDate = new Date(year, month - 1, day + 1, 12);
    const cards = [];
    for (let i = 0; i < 21; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const n = nightFor(d), l = BY_ID[n.look], st = sunTimes(d);
      cards.push('<div class="nt' + (i === 0 ? ' today' : '') + '" data-weekday-card="' + d.getDay() + '" tabindex="0" role="button" title="Edit the ' + WEEKDAYS[d.getDay()] + ' schedule"><small>' + (i === 0 ? 'Tonight' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })) + '</small><b>' + esc(l ? l.name : (nameOf(n.look) || '—')) + '</b><div class="sw">' + (l ? swatchesOf(l.P).map(c => '<i style="background:' + hex(c) + '"></i>').join('') : '') + '</div><em class="' + n.src + '">' + esc(n.why) + '</em><small>' + (SC.onMode === 'sunset' ? fmt12(toHM(st.set && new Date(st.set.getTime() + SC.onOffset * 6e4))) : SC.onMode === 'time' ? fmt12(SC.onTime) : '—') + (SC.nightOn ? ' · 🌙 ' + fmt12(nightKey(d)) : '') + '</small></div>');
    }
    $('nights').innerHTML = cards.join('');
    // tonight panel
    const n = nightFor(today), l = BY_ID[n.look], st = sunTimes(today), tomorrow = sunTimes(nextDate);
    $('tName').textContent = l ? l.name : (nameOf(n.look) || '—'); $('tWhy').textContent = n.src === 'default' ? 'Tonight · usual look' : 'Tonight · ' + n.why;
    vTonight.P = l ? applyMaster(l.P) : null;
    const onAt = SC.onMode === 'sunset' ? toHM(st.set && new Date(st.set.getTime() + SC.onOffset * 6e4)) : SC.onMode === 'time' ? SC.onTime : null;
    const rows = [];
    if (onAt) rows.push([fmt12(onAt), '#62d682', 'On' + (SC.onMode === 'sunset' ? ' at sunset' + (SC.onOffset ? ' ' + (SC.onOffset > 0 ? '+' : '') + SC.onOffset + ' min' : '') : '') + ' · ' + (l ? l.name : 'look')]);
    if (SC.nightOn) rows.push([fmt12(nightKey(today)), '#7a8cff', (SC.nightMode === 'dim' ? 'Dims to ' + SC.nightBri + '%' : 'Switches to ' + (BY_ID[SC.nightLook]?.name || 'a calmer look') + ' at ' + SC.nightBri + '%') + (SC.nightFade ? ' over ' + SC.nightFade + ' min' : '')]);
    if (SC.offMode === 'sunrise') rows.push([fmt12(toHM(tomorrow.rise)), '#6f8175', 'Off at sunrise']);
    else if (SC.offMode === 'time') rows.push([fmt12(SC.offTime), '#6f8175', 'Off']);
    else rows.push(['—', '#6f8175', 'Stays on (dimmed) until the next evening']);
    $('tLine').innerHTML = rows.map(r => '<div class="tl"><b>' + r[0] + '</b><i style="background:' + r[1] + ';box-shadow:0 0 10px ' + r[1] + '"></i><span>' + esc(r[2]) + '</span></div>').join('');
  }
  function editWeekday(dow) {
    const row = $('weeklyLooks').querySelector('[data-weekday-row="' + dow + '"]'), sel = row?.querySelector('select');
    if (!sel) return;
    row.classList.add('active'); $('weeklyLooks').querySelectorAll('.weekly-day').forEach(x => { if (x !== row) x.classList.remove('active'); });
    row.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' }); sel.focus();
  }
  $('nights').addEventListener('click', e => { const c = e.target.closest('[data-weekday-card]'); if (c) editWeekday(+c.dataset.weekdayCard); });
  $('nights').addEventListener('keydown', e => { const c = e.target.closest('[data-weekday-card]'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); editWeekday(+c.dataset.weekdayCard); } });
  let changingScheduler = false, schedulerRequest = 0;
  function showSchedulerStatus(status) {
    const toggle = $('schedulerEnabled'), message = $('schedulerStatus');
    toggle.checked = status.enabled === true;
    toggle.disabled = !window.TL_REAL_WLED || changingScheduler || !status.controllerConfigured;
    message.classList.toggle('error', status.state === 'error');
    message.textContent = status.message || 'Calendar scheduler ready.';
  }
  async function refreshSchedulerStatus() {
    const toggle = $('schedulerEnabled'), message = $('schedulerStatus');
    if (changingScheduler) return;
    if (!window.TL_REAL_WLED) {
      toggle.disabled = true;
      message.textContent = 'Demo mode previews calendar programs.';
      return;
    }
    const request = ++schedulerRequest;
    try {
      const response = await fetch('/api/scheduler/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not read the calendar scheduler status.');
      const status = await response.json();
      if (request === schedulerRequest) showSchedulerStatus(status);
    } catch (error) {
      if (request !== schedulerRequest) return;
      toggle.disabled = true;
      message.textContent = error.message;
      message.classList.add('error');
    }
  }
  $('schedulerEnabled').addEventListener('change', async event => {
    const toggle = event.currentTarget, enabled = toggle.checked;
    changingScheduler = true;
    ++schedulerRequest;
    toggle.disabled = true;
    $('schedulerStatus').textContent = enabled ? 'Resuming calendar updates…' : 'Pausing calendar updates…';
    try {
      const response = await fetch('/api/scheduler/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not change the scheduler setting.');
      changingScheduler = false;
      showSchedulerStatus(result);
    } catch (error) {
      changingScheduler = false;
      toggle.checked = !enabled;
      toggle.disabled = false;
      $('schedulerStatus').textContent = error.message;
      $('schedulerStatus').classList.add('error');
    }
  });
  async function openSchedule() {
    showRoute('schedule'); history.replaceState(null, '', location.href.split('#')[0] + '#schedule');
    if (!vTonight) vTonight = makeView($('tonightCv'), CROP_CARD, 1.4, 2);
    fillSchedule();
    refreshNights();
    refreshSchedulerStatus();
    if (schedulerStatusTimer) clearInterval(schedulerStatusTimer);
    schedulerStatusTimer = setInterval(() => {
      if (state.route !== 'schedule') { clearInterval(schedulerStatusTimer); schedulerStatusTimer = null; return; }
      refreshSchedulerStatus();
    }, 5000);
    try {
      const [i, c, scheduler] = await Promise.all([wget('/json/info'), wget('/json/cfg'), fetch('/api/scheduler/status').then(r => r.json()).catch(() => null)]), on = (c.timers?.ins || []).filter(t => t.en && t.macro).length;
      WL.brightnessGamma = c.light?.gc || {};
      const service = window.TL_REAL_WLED && scheduler?.enabled ? ' · Calendar service ' + (scheduler.state === 'error' ? 'error: ' + scheduler.message : (scheduler.message || scheduler.state)) : '';
      $('clockInfo').textContent = 'Controller clock ' + (i.time || '?') + ' · ' + on + ' timer' + (on === 1 ? '' : 's') + ' active · internet time ' + (c.if?.ntp?.en ? 'on' : 'off') + service;
    } catch { $('clockInfo').textContent = ''; }
  }
  $('schBack').onclick = () => goLibrary();
  function bedtimeBody(schedule = SC) {
    const tt = schedule.nightFade * 600;                     // WLED transition is in 100 ms steps
    if (schedule.nightMode === 'look' && BY_ID[schedule.nightLook]) {
      const body = wledBody(applyMaster(BY_ID[schedule.nightLook].P));
      delete body.on;
      return { ...body, ifon: true, bri: pct2bri(schedule.nightBri), transition: tt };
    }
    return { ifon: true, bri: pct2bri(schedule.nightBri), transition: tt };
  }
  const hm = s => s.split(':').map(Number);
  $('schSave').onclick = async () => {
    readSchedule();
    const modern = controllerV16() || !window.TL_REAL_WLED;
    const weeklyEntries = Object.entries(SC.weeklyLooks).filter(([dow, id]) => Number.isInteger(+dow) && +dow >= 0 && +dow <= 6 && BY_ID[id]);
    const weeklyMask = weeklyEntries.reduce((mask, [dow]) => mask | DOW_BITS[+dow], 0), usualDaysMask = 127 & ~weeklyMask;
    const btn = $('schSave'); btn.disabled = true; $('schStat').innerHTML = '<span class="aispin"></span>Writing to the controller…';
    try {
      if (!WL.info) throw new Error('The WLED controller is offline.');
      if (weeklyEntries.length && SC.onMode === 'none') throw new Error('Choose sunset or a set time for “Lights on” before assigning different looks by weekday.');
      if (weeklyEntries.length && SC.onMode === 'sunset' && !modern) throw new Error('This WLED version cannot assign separate sunset looks by weekday. Set “Lights on” to a fixed time or update to WLED 16.');
      WL.brightnessGamma = (await wget('/json/cfg')).light?.gc || {};
      updateScheduleBodies(SC);
      if (SC.eveLook !== 'current' && !SC.default.body) throw new Error('Choose an available look for the usual schedule.');
      const invalidProgram = SC.programs.find(p => p.on !== false && (!p.body || !p.start || !p.end || p.end < p.start));
      if (invalidProgram) throw new Error('Choose an available look and valid dates for ' + invalidProgram.name + '.');
      if (SC.nightOn && SC.nightMode === 'look' && !BY_ID[SC.nightLook]) throw new Error('Choose an available bedtime look.');
      const presets = [...SC.auxiliaryPresets];
      for (const [dow, id] of weeklyEntries) {
        presets.push({ slot: PS_WEEKDAY + +dow, name: 'Studio · ' + nameOf(id), body: SC.weeklyBodies[dow].body });
      }
      if (SC.onMode !== 'none' && SC.default.body) presets.push({ slot: PS_TONIGHT, name: 'Studio · ' + SC.default.name, body: SC.default.body });
      if (SC.offMode !== 'never') presets.push({ slot: PS_OFF, name: 'Schedule · Off', body: { on: false, transition: 50 } });
      const ntp = { en: true };
      if (Number.isFinite(HOME.lat) && Number.isFinite(HOME.lon)) { ntp.ln = HOME.lon; ntp.lt = HOME.lat; }
      // timers: regular first, then sunrise (hour 255), then sunset (hour 254: WLED 16 marks sunset this way; 0.15 told them apart by order)
      const ins = [], T = (t, macro, dow) => { const [h, m] = hm(t); ins.push({ en: 1, hour: h, min: m, macro, dow }); };
      if (SC.onMode === 'time' && usualDaysMask) T(SC.onTime, PS_TONIGHT, usualDaysMask);
      if (weeklyEntries.length && SC.onMode === 'time') weeklyEntries.forEach(([dow]) => T(SC.onTime, PS_WEEKDAY + +dow, DOW_BITS[+dow]));
      if (SC.nightOn) { if (SC.nightTime === SC.nightTimeWE) T(SC.nightTime, PS_NIGHT, 127); else { T(SC.nightTime, PS_NIGHT, 79); T(SC.nightTimeWE, PS_NIGHT, 48); } }   // Sun–Thu / Fri–Sat
      if (SC.offMode === 'time') T(SC.offTime, PS_OFF, 127);
      const solar = [];
      if (!modern || SC.offMode === 'sunrise') solar.push({ en: SC.offMode === 'sunrise' ? 1 : 0, hour: 255, min: 0, macro: SC.offMode === 'sunrise' ? PS_OFF : 0, dow: 127 });
      if (SC.onMode === 'sunset' && usualDaysMask) solar.push({ en: 1, hour: modern ? 254 : 255, min: SC.onOffset, macro: PS_TONIGHT, dow: usualDaysMask });
      if (weeklyEntries.length && SC.onMode === 'sunset') weeklyEntries.forEach(([dow]) => solar.push({ en: 1, hour: 254, min: SC.onOffset, macro: PS_WEEKDAY + +dow, dow: DOW_BITS[+dow] }));
      if (!modern && SC.onMode !== 'sunset') solar.push({ en: 0, hour: 255, min: 0, macro: 0, dow: 127 });
      const maxTimers = modern ? 64 : 8, essential = ins.length + (modern ? solar.length : 0), spare = maxTimers - essential;
      if (spare < 0) throw new Error('This schedule needs ' + essential + ' timer slots, but this controller supports ' + maxTimers + ' for these events. Reduce weekday overrides or disable an automatic event.');
      if (!modern) {
        while (ins.length < maxTimers) ins.push({ en: 0, hour: 0, min: 0, macro: 0, dow: 0 });
      }
      ins.push(...solar);
      await flushPalettes();
      const schedule = clone(SC);
      const saved = await fetch('/api/schedule/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule, expectedSchedule: persistedSchedule, presets: [...new Map(presets.map(entry => [entry.slot, entry])).values()], timers: ins, location: ntp }) });
      const result = await saved.json();
      if (!saved.ok || !result.ok) throw new Error(result.error || 'The Studio API could not save the schedule.');
      savedSchedule = persistedSchedule = schedule;
      $('schStat').textContent = '✓ Saved · ' + result.timers + ' timers · tonight: ' + (result.tonight || '');
      toast('Schedule saved to the controller 🌙'); openSchedule();
    } catch (err) { $('schStat').textContent = '⚠️ ' + err.message; }
    btn.disabled = false;
  };
  $('schPreview').onclick = async () => {
    readSchedule();
    if (SC.nightMode !== 'look') return dimNow();
    try {
      if (!(await wget('/json/state')).on) return toast('The house lights are off.');
      WL.brightnessGamma = (await wget('/json/cfg')).light?.gc || {};
      const body = bedtimeBody();
      delete body.transition;
      await flushPalettes();
      await wpost({ ...body, tt: 20 }, true);
      WL.state = await wget('/json/state');
      if (APP.dimmedFrom != null) { APP.dimmedFrom = null; save(['dimmedFrom']); }
      onHouseChanged();
      toast('Bedtime look sent to WLED.', 'var(--accent)');
    } catch (error) { toast('Could not preview bedtime: ' + error.message, 'var(--warn)'); }
  };
  function bedtimeBrightness(percent, gamma) {
    const enabled = gamma?.bri === true || (typeof gamma?.bri === 'number' && gamma.bri > 0 && gamma.bri !== 1);
    const configured = Number(gamma?.val ?? gamma?.bri);
    const exponent = enabled && configured >= 0.1 && configured <= 3 ? configured : 1;
    const level = Number(percent);
    if (!Number.isFinite(level)) throw new Error('Set a valid bedtime brightness in Schedule.');
    return clamp(Math.round(255 * Math.pow(clamp(level, 0, 100) / 100, 1 / exponent)), 1, 255);
  }
  function brightnessRestore(state) {
    const dim = APP.dimmedFrom;
    return state?.on && dim?.host === WL.host && dim.to === state.bri && Number.isInteger(dim.from) && dim.from > dim.to && dim.from <= 255 ? dim.from : null;
  }
  async function dimNow() {
    const button = $('dimNowBtn');
    if (button.disabled) return;
    button.disabled = $('schPreview').disabled = true;
    try {
      if (!WL.host) throw new Error('Set up the WLED controller first.');
      const s = await wget('/json/state');
      WL.state = s;
      if (!s.on) return toast('The house lights are off.');
      const restore = brightnessRestore(s);
      if (!restore) WL.brightnessGamma = (await wget('/json/cfg')).light?.gc || {};
      const target = restore || pct2bri(SC.nightBri);
      if (!restore && target >= s.bri) return toast('The lights are already at or below bedtime brightness.');
      await wpost({ bri: target, tt: 30 }, true);
      WL.state = await wget('/json/state');
      if (!WL.state.on || WL.state.bri !== target) throw new Error('WLED did not report the requested brightness.');
      APP.dimmedFrom = restore ? null : { host: WL.host, from: s.bri, to: target };
      save(['dimmedFrom']);
      toast(restore ? 'Previous brightness restored.' : 'Dimming to ' + SC.nightBri + '% · tap again to restore brightness.', 'var(--accent)');
    } catch (error) { toast('Could not change brightness: ' + error.message, 'var(--warn)'); }
    finally { button.disabled = $('schPreview').disabled = false; onHouseChanged(); }
  }
  function syncDim() {
    const on = brightnessRestore(WL.state) !== null;
    $('dimNowBtn').classList.toggle('on', on);
    $('dimNowBtn').firstChild.nextSibling.textContent = on ? 'Back to normal' : 'Bedtime dim now';
    $('dimSub').textContent = on ? 'dimmed' : SC.nightBri + '%';
  }
  syncDim();
  let savedSchedule = clone(SC);
  function updateScheduleBodies(schedule) {
    const id = schedule.eveLook, last = APP.lastPush;
    schedule.default = { look: id, name: id === 'current' ? (last?.name || 'Whatever you last pushed') : nameOf(id), body: id === 'current' ? (last?.P ? scheduledBody(last.P) : bodyOf(last?.id)) : bodyOf(id) };
    (schedule.programs || []).forEach(p => { p.lookName = nameOf(p.look); p.body = p.on === false ? null : bodyOf(p.look); });
    schedule.weeklyBodies = Object.fromEntries(Object.entries(schedule.weeklyLooks || {}).map(([dow, id]) => [dow, { look: id, name: nameOf(id), body: bodyOf(id) }]));
    const presets = new Map();
    const playlistIds = [id === 'current' ? last?.id : id, ...(schedule.programs || []).filter(p => p.on !== false).map(p => p.look)];
    for (const selection of new Set(playlistIds.filter(plName))) {
      const playlist = plById(selection.slice(3));
      if (playlist?.items.length) for (const entry of playlistPresets(playlist)) presets.set(entry.slot, entry);
    }
    if (schedule.nightOn) presets.set(PS_NIGHT, { slot: PS_NIGHT, name: 'Schedule · Bedtime', body: bedtimeBody(schedule) });
    schedule.auxiliaryPresets = [...presets.values()];
  }
  let scheduleRefresh = Promise.resolve();
  function refreshScheduleBodies(transform) {
    scheduleRefresh = scheduleRefresh.then(() => refreshSavedLooks(transform));
    return scheduleRefresh;
  }
  async function refreshSavedLooks(transform) {
    if (!WL.info || !savedSchedule?.default || (savedSchedule.nightOn && !WL.brightnessGamma) || $('schSave').disabled) return;
    try {
      const previous = savedSchedule, next = clone(previous);
      if (transform) transform(next);
      updateScheduleBodies(next);
      if (JSON.stringify(next) === JSON.stringify(previous)) return;
      await flushPalettes();
      if ($('schSave').disabled || savedSchedule !== previous) return;
      const response = await fetch('/api/app', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: next, expectedSchedule: persistedSchedule }) });
      if (response.status === 409) {
        const current = (await (await fetch('/api/app', { cache: 'no-store' })).json()).schedule;
        persistedSchedule = current ?? null;
        savedSchedule = clone(current || {});
        return;
      }
      if (!response.ok) throw new Error('HTTP ' + response.status);
      savedSchedule = persistedSchedule = next;
    } catch (error) { toast('Could not refresh scheduled looks: ' + error.message, 'var(--warn)'); }
  }


  /* ======================= ▤ sections page ======================= */
  const RUNS = (() => { let o = 0; return (layout.runs || []).slice().map((r, k) => ({ r, k })).sort((a, b) => (a.r.port - b.r.port) || (a.k - b.k)).map(({ r }) => { const x = { start: o, stop: o + r.leds, name: r.name, port: r.port }; o += r.leds; return x; }); })();
  const SEC_COL = ['#62d682', '#4dc3ff', '#b98cff', '#4dffa6', '#ff6b9a', '#ffd36b', '#7a8cff', '#ff8a4d'];
  const SEC_SPEEDS = [[0.25, '¼×'], [0.5, '½×'], [0.75, '¾×'], [1, '1×'], [1.5, '1½×'], [2, '2×']];
  const secLooks = () => LOOKS.filter(l => !isSec(l.P));
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
    save(['userLooks']); buildLooks(); renderNav(); renderGallery(true); refreshScheduleBodies();
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
  const plName = v => typeof v === 'string' && v.startsWith('pl:') ? plById(v.slice(3))?.name || null : null;
  function deleteLook(id) {
    const look = BY_ID[id];
    if (!look) return;
    const isUserLook = APP.userLooks.some(item => item.id === id);
    const fallback = LOOKS.find(item => item.id !== id)?.id;
    if (!fallback) return toast('Keep at least one look in the library.', 'var(--warn)');
    const action = isUserLook ? 'permanently delete “' + look.name + '”' : 'remove “' + look.name + '” from this app’s library';
    if (!confirm('Are you sure you want to ' + action + '? Any schedule or playlist entries using it will switch to another available look. The lights currently running on WLED will not be changed.')) return;

    if (isUserLook) APP.userLooks = APP.userLooks.filter(item => item.id !== id);
    else APP.deletedLooks = [...new Set([...(APP.deletedLooks || []), id])];
    delete APP.edits[id]; delete APP.starred[id]; delete APP.plSlots[id];
    APP.history = (APP.history || []).filter(item => item !== id);
    const wasLastPushed = APP.lastPush?.id === id;
    if (wasLastPushed) APP.lastPush = null;

    const replaceLook = schedule => {
      if (schedule.eveLook === id || (schedule.eveLook === 'current' && wasLastPushed)) schedule.eveLook = fallback;
      if (schedule.nightLook === id) schedule.nightLook = fallback;
      (schedule.programs || []).forEach(program => { if (program.look === id) program.look = fallback; });
      for (const [day, look] of Object.entries(schedule.weeklyLooks || {})) if (look === id) schedule.weeklyLooks[day] = fallback;
    };
    replaceLook(SC);
    APP.playlists.forEach(playlist => playlist.items.forEach(item => { if (item.look === id) item.look = fallback; }));
    APP.moments.forEach(moment => { if (moment.look === id) moment.look = fallback; });

    buildLooks();
    save(['userLooks', 'deletedLooks', 'edits', 'starred', 'history', 'lastPush', 'playlists', 'plSlots', 'moments']);
    refreshScheduleBodies(replaceLook);
    renderNav(); renderGallery(true);
    if (state.route === 'schedule') fillSchedule();
    if (state.route === 'playlists') renderPlaylists();
    toast('Deleted “' + look.name + '”.');
  }
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
    save(['playlists']); refreshScheduleBodies(); renderPlaylists();
  });
  $('plEdit').addEventListener('click', e => {
    const pl = plById(PLsel); if (!pl) return; const t = e.target;
    if (t.closest('[data-mode]')) pl.mode = t.closest('[data-mode]').dataset.mode;
    else if (t.id === 'plAdd') pl.items.push({ look: pl.items[pl.items.length - 1]?.look || 'autumn-twinkle', min: 10, fade: 3 });
    else if (t.dataset.rmst != null) pl.items.splice(+t.dataset.rmst, 1);
    else if (t.id === 'plDel') {
      if (!confirmDel.armed) { confirmDel.armed = true; t.textContent = 'Click again to delete'; setTimeout(() => confirmDel.armed = false, 3000); return; }
      const id = 'pl:' + pl.id;
      const replacePlaylist = schedule => {
        const fallback = LOOKS[0]?.id || 'current';
        if (schedule.eveLook === id || (schedule.eveLook === 'current' && APP.lastPush?.id === id)) schedule.eveLook = fallback;
        (schedule.programs || []).forEach(p => { if (p.look === id) p.look = fallback; });
      };
      replacePlaylist(SC);
      APP.playlists = APP.playlists.filter(p => p !== pl);
      PLsel = APP.playlists[0]?.id || null;
      save(['playlists']); refreshScheduleBodies(replacePlaylist); renderPlaylists();
      return;
    }
    else return;
    save(['playlists']); refreshScheduleBodies(); renderPlaylists();
  });
  function confirmDel() { }
  let plDrag = null;
  $('plEdit').addEventListener('dragstart', e => { const s = e.target.closest('[data-st]'); if (s) plDrag = +s.dataset.st; });
  $('plEdit').addEventListener('dragover', e => { if (plDrag != null && e.target.closest('[data-st]')) e.preventDefault(); });
  $('plEdit').addEventListener('drop', e => { const t = e.target.closest('[data-st]'), pl = plById(PLsel); if (plDrag == null || !t || !pl) return; e.preventDefault(); moveItem(pl.items, plDrag, +t.dataset.st); plDrag = null; save(['playlists']); refreshScheduleBodies(); renderPlaylists(); });
  // write the looks a playlist plays into presets 200-229 (no brightness, so bedtime dimming sticks), then the playlist itself
  function plItemSlot(look) {
    const used = new Set(APP.playlists.flatMap(p => p.items.map(i => i.look)));
    if (APP.plSlots[look] != null && !APP.moments.some(m => m.ps === APP.plSlots[look])) return APP.plSlots[look];
    const taken = new Set([...Object.values(APP.plSlots), ...APP.moments.map(m => m.ps)]);
    for (let s = PS_ITEMS; s < PS_PL; s++) if (!taken.has(s)) return APP.plSlots[look] = s;
    for (const k in APP.plSlots) if (!used.has(k) && !APP.moments.some(m => m.ps === APP.plSlots[k])) { const s = APP.plSlots[k]; delete APP.plSlots[k]; return APP.plSlots[look] = s; }
    throw new Error('Too many different looks across playlists (30 max)');
  }
  function plBody(pl) {
    const ps = pl.items.map(it => plItemSlot(it.look));
    return { on: true, bri: clamp(Math.max(...pl.items.map(it => applyMaster(BY_ID[it.look]?.P || { bri: 180 }).bri)), 1, 255), playlist: { ps, dur: pl.items.map(it => clamp(it.min * 600, 10, 65000)), transition: pl.items.map(it => it.fade * 10), repeat: pl.mode === 'once' ? 1 : 0, end: 0, r: pl.mode === 'shuffle' } };
  }
  function playlistPresets(pl) {
    const i = APP.playlists.indexOf(pl);
    if (i < 0 || i > 9) throw new Error('10 playlists max on the controller');
    const body = plBody(pl);
    const presets = pl.items.map((it, k) => {
      const look = BY_ID[it.look];
      if (!look) throw new Error('A playlist look no longer exists.');
      const command = wledBody(applyMaster(look.P));
      delete command.bri; delete command.pl; delete command.on;
      return { slot: body.playlist.ps[k], name: 'Playlist look · ' + look.name, body: command };
    });
    save(['plSlots']);
    return [...presets, { slot: PS_PL + i, name: 'Playlist · ' + pl.name, body }];
  }
  async function writePlaylist(pl) {
    const presets = playlistPresets(pl);
    await flushPalettes();
    await storePresets(presets);
    return presets[presets.length - 1].slot;
  }
  $('plStart').onclick = async () => {
    const pl = plById(PLsel); if (!pl || !pl.items.length) return;
    $('plStart').disabled = true; $('plStat').innerHTML = '<span class="aispin"></span>Loading ' + pl.items.length + ' looks into the controller…';
    try {
      const ps = await writePlaylist(pl);
      await storePresets([{ slot: 3, name: 'Studio · ' + pl.name, body: plBody(pl) }]);   // boot look = the playlist, so a restart resumes it
      if (WL.info?.leds?.bootps !== 3) await cfgPatch({ def: { ps: 3 } }, { preserveBuses: true });
      await wpost({ ps }, true);
      APP.lastPush = { id: 'pl:' + pl.id, name: pl.name, P: null, at: Date.now() }; save(['lastPush']); refreshScheduleBodies();
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
    WL.ledConfig = CT.cfg.hw.led;
    WL.brightnessGamma = CT.cfg.light?.gc || {};
    renderController(); clearInterval(ctPoll); ctPoll = setInterval(pollMic, 700);
  }
  function renderRoofSectionManager() {
    const sections = APP.roofSections || [];
    return '<section class="schcard roof-manager"><h3>🏠 Named roof sections</h3><p class="sh">Define reusable bulb ranges on your mapped layout. These names appear as quick-pick zones in the Look Builder.</p>' +
      (sections.length ? sections.map((s, i) => '<div class="roof-section-row" data-roof-row="' + i + '"><input type="text" data-roof-name value="' + esc(s.name) + '" maxlength="32" aria-label="Section name"><label>Bulbs <input type="number" data-roof-start min="1" max="' + N + '" value="' + (s.start + 1) + '"></label><span>to</span><label><input type="number" data-roof-stop min="1" max="' + N + '" value="' + s.stop + '" aria-label="Last bulb"></label><button type="button" class="x" data-roof-delete title="Delete section">×</button></div>').join('') : '<p class="sh">No named roof sections yet. Add ranges such as “Front gable” or “Garage eave.”</p>') +
      '<button type="button" class="btn" id="roofSectionAdd">＋ Add bulb range</button></section>';
  }
  function powerMode(led) {
    if (led.maxpwr > 0) return 'global';
    return led.ins?.some(b => b.maxpwr > 0 && b.ledma > 0) ? 'output' : 'off';
  }
  function currentInput(input, min, max, label) {
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be ${min}–${max} mA.`);
    return value;
  }
  function supportsCurrentLimit(bus) {
    const type = bus.type & 127; // WLED uses the high bit for off refresh
    return type >= 16 && type <= 39 || type >= 48 && type <= 63;
  }
  function readPowerSettings(led) {
    const mode = $('ctPowerMode').value;
    const maxpwr = mode === 'global' ? currentInput($('ctTotalPower'), 250, 65000, 'Total current limit') : 0;
    const ins = led.ins.map((bus, i) => {
      if (!supportsCurrentLimit(bus)) return bus;
      if (mode === 'off') return { ...bus, maxpwr: 0 };
      const row = $('ctGrid');
      const limit = mode === 'output' ? currentInput(row.querySelector(`[data-abl="${i}"]`), 0, 65000, `Output ${i + 1} current limit`) : 0;
      if (limit > 0 && limit < 250) throw new Error(`Output ${i + 1} current limit must be 0 or at least 250 mA.`);
      const ledma = mode === 'output' && !limit ? 0 : currentInput(row.querySelector(`[data-ledma="${i}"]`), 1, 255, `Output ${i + 1} current per LED`);
      return { ...bus, maxpwr: limit, ledma };
    });
    if (mode === 'global' && !ins.some(bus => supportsCurrentLimit(bus) && bus.ledma > 0)) throw new Error('Set the current per LED for at least one output to use the total limit.');
    if (mode === 'output' && !ins.some(bus => supportsCurrentLimit(bus) && bus.maxpwr > 0)) throw new Error('Set a current limit for at least one output.');
    return { maxpwr, ins };
  }
  function samePowerSettings(led, expected) {
    return led?.maxpwr === expected.maxpwr && led.ins?.length === expected.ins.length && expected.ins.every((bus, i) => {
      const actual = led.ins[i];
      return actual.start === bus.start && actual.len === bus.len && actual.maxpwr === bus.maxpwr && actual.ledma === bus.ledma;
    });
  }
  function renderController() {
    const c = CT.cfg, ins = c.hw.led.ins || [], btn = (c.hw.btn?.ins || [])[0] || { macros: [0, 0, 0] }, ar = c.um?.AudioReactive || {}, nl = c.light?.nl || {};
    const sel = (id, v, opts) => '<select id="' + id + '">' + opts.map(([k, t]) => '<option value="' + k + '"' + (+k === +v ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
    const mode = powerMode(c.hw.led);
    $('ctGrid').innerHTML =
      '<section class="schcard"><h3>💡 WLED output channels</h3><p class="sh">LED counts, color order, home photo, and traced channel paths are configured together.</p>' +
      ins.map((b, k) => '<div class="sl wide"><span>' + esc(PORT_NAME[k + 1] || 'Output ' + (k + 1)) + '</span><b>' + b.len + ' bulbs</b><span></span></div>').join('') +
      '<button type="button" class="btn" id="ctOpenWledSetup">Configure output counts &amp; roof layout</button></section>' +
      renderRoofSectionManager() +
      '<section class="schcard"><h3>⚡ Power limit</h3><p class="sh">WLED estimates <b>' + (CT.info.leds?.pwr ?? '?') + ' mA</b> right now.</p>' +
      '<label class="sl wide"><span>Limiter mode</span><select id="ctPowerMode"><option value="off">Off</option><option value="global">Whole controller</option><option value="output">Per output</option></select></label>' +
      '<label class="sl wide" data-power-global><span>Total current limit</span><input type="number" id="ctTotalPower" min="250" max="65000" value="' + (c.hw.led.maxpwr || '') + '"><span>mA</span></label>' +
      ins.map((b, k) => {
        if (!supportsCurrentLimit(b)) return '';
        const name = esc(PORT_NAME[k + 1] || 'Output ' + (k + 1));
        return '<label class="sl wide" data-power-output><span>' + name + ' current limit</span><input type="number" min="0" max="65000" data-abl="' + k + '" value="' + (b.maxpwr ?? 0) + '"><span>mA (0 turns this limit off)</span></label>' +
          '<label class="sl wide" data-power-led><span>' + name + ' per LED</span><input type="number" min="1" max="255" data-ledma="' + k + '" value="' + (b.ledma || '') + '"><span>mA at full white</span></label>';
      }).join('') +
      '<p class="sh">Use one total limit for a shared supply. Per-output limits apply separately. Set each limit for the supply and wiring that carry that load.</p></section>' +
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
    const select = $('ctPowerMode');
    select.value = mode;
    const showPowerFields = () => {
      $('ctGrid').querySelectorAll('[data-power-global],[data-power-output],[data-power-led]').forEach(row => {
        row.style.display = (row.hasAttribute('data-power-global') ? select.value === 'global' : row.hasAttribute('data-power-output') ? select.value === 'output' : select.value !== 'off') ? '' : 'none';
      });
    };
    select.onchange = showPowerFields;
    showPowerFields();
    $('ctGrid').querySelectorAll('#ctPowerMode,#ctTotalPower,[data-abl],[data-ledma]').forEach(input => { input.dataset.saved = input.value; });
    renderMoments();
  }
  /* ---- optional controller extension cards ---- */
  const hasTls = () => !!(CT && CT.st && CT.st.tls);
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const rng = (id, min, max, v, word) => '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" value="' + v + '"><output data-w="' + (word || '') + '">' + fmtW(word, v) + '</output>';
  function fmtW(w, v) { v = +v; return w === '%' ? v + '%' : w === 's' ? (v >= 60 ? (v / 60).toFixed(v % 60 ? 1 : 0) + ' min' : v + ' s') : w === 'x' ? (v / 10).toFixed(1).replace(/\.0$/, '') + '×' : String(v); }
  function tlsCards() {
    if (!hasTls()) return '<section class="schcard"><h3>✨ More controls</h3><p class="sh">Smooth fades, evening drift, breath, moments and the restart log require optional controller capabilities. This controller runs ' + esc(CT.info.ver || '?') + '.</p></section>';
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
  function momentBody(m) {
    const look = BY_ID[m.look];
    if (!look) throw new Error('That look no longer exists');
    const body = wledBody(applyMaster(look.P));
    delete body.pl;
    return { ...body, transition: 10 };
  }
  async function writeMoment(m) {
    const body = momentBody(m);
    await flushPalettes();
    await storePresets([{ slot: m.ps, name: 'Moment · ' + m.name, body }]);
    m.saved = JSON.stringify([m.look, m.ps, body]);
    save(['moments']);
  }
  const momDirty = m => !BY_ID[m.look] || m.saved !== JSON.stringify([m.look, m.ps, momentBody(m)]);
  $('ctGrid').addEventListener('change', e => {
    const r = e.target.closest('.momrow'); if (r) { const m = APP.moments[+r.dataset.m], k = e.target.dataset.mk; if (k) { m[k] = k === 'dur' || k === 'tt' ? +e.target.value : e.target.value; save(['moments']); renderMoments(); } return; }
    if (e.target.id === 'tlsDSt') { $('tlsDStT').hidden = e.target.value === 'sunset'; }
  });
  $('ctGrid').addEventListener('click', async e => {
    if (e.target.id === 'momAdd') { const used = new Set([...APP.moments.map(m => m.ps), ...Object.values(APP.plSlots)]); let ps = PS_MOM; while (used.has(ps) && ps < PS_MOM + 10) ps++; if (ps >= PS_MOM + 10) return toast('10 moments max', 'var(--warn)');
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
      const powerFields = ['ctPowerMode', 'ctTotalPower'].map(id => $(id)).concat([...$('ctGrid').querySelectorAll('[data-abl],[data-ledma]')]);
      const powerChanged = powerFields.some(input => input.value !== input.dataset.saved);
      const expected = powerChanged ? readPowerSettings(c.hw.led) : null;
      const current = await wget('/json/cfg');
      if (expected && !samePowerSettings(current.hw?.led, c.hw.led)) throw new Error('WLED power or output settings changed. Reopen Controller to load the current values.');
      if (expected) expected.ins = current.hw.led.ins.map((bus, i) => ({ ...bus, maxpwr: expected.ins[i].maxpwr, ledma: expected.ins[i].ledma }));
      const btns = clone(current.hw.btn || {}); if (btns.ins?.[0]) btns.ins[0].macros = [+$('ctB0').value, +$('ctB1').value, +$('ctB2').value];
      WL.brightnessGamma = current.light?.gc || {};
      const nlTbri = +$('ctNlEnd').value ? pct2bri(SC.nightBri) : 0;
      await cfgPatch({ hw: { ...(expected && { led: expected }), btn: btns }, if: { va: { alexa: $('ctAlexa').checked } }, id: { inv: $('ctInv').value.trim() || 'Roof lights' },
        light: { nl: { dur: +$('ctNlDur').value, tbri: nlTbri, mode: +$('ctNlMode').value } },
        um: { AudioReactive: { enabled: $('ctMic').checked, config: { gain: +$('ctGain').value, squelch: +$('ctSq').value } } } }, { current, preserveBuses: !expected });
      let savedConfig;
      if (expected) {
        for (let attempt = 0; attempt < 8; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 350));
          savedConfig = await wget('/json/cfg').catch(() => null);
          if (samePowerSettings(savedConfig?.hw?.led, expected)) break;
        }
        if (!samePowerSettings(savedConfig?.hw?.led, expected)) throw new Error('WLED did not report the requested power settings after saving.');
        WL.ledConfig = savedConfig.hw.led;
      }
      APP.sleepDefaults = { dur: +$('ctNlDur').value, tbri: nlTbri, mode: +$('ctNlMode').value }; save(['sleepDefaults']);
      const tls = tlsSettingsFromForm();
      if (tls) {
        await fetch(`http://${WL.host}/json/cfg`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ um: { TrimlightStudio: tls } }) });
        APP.fade = { push: +$('tlsFadeP').value, sched: +$('tlsFadeS').value }; APP.tlsFx = tls; save(['fade', 'tlsFx']);
        for (const m of APP.moments) if (momDirty(m)) await writeMoment(m);
      }
      CT.cfg = savedConfig || await wget('/json/cfg').catch(() => current);
      WL.ledConfig = CT.cfg.hw.led;
      renderController();
      $('ctStat').textContent = expected ? '✓ Power settings verified on WLED' : '✓ Saved on WLED'; toast('Controller settings saved');
    } catch (err) { $('ctStat').textContent = '⚠️ ' + err.message; }
    btn.disabled = false;
  };
  $('ctWled').onclick = () => { if (window.TL_REAL_WLED && WL.host) window.open(`http://${WL.host}/settings/leds`, '_blank', 'noopener'); };
  $('ctWledSetup').onclick = () => { location.hash = 'wiring'; };
  document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => goLibrary());

  /* ======================= one shared animation loop ======================= */
  let frameN = 0;
  function frame(now) {
    frameN++;
    const previewMotion = APP.previewAnimations !== false;
    if (frameN % 30 === 1 && (state.route !== 'gallery' || previewMotion)) tlsTick();
    const needsLive = state.route !== 'gallery' || previewMotion || vPill.dirty;
    const live = needsLive ? liveBuf() : null, lbri = WL.state ? (WL.state.on ? WL.state.bri : 0) : 255;
    if (state.route === 'gallery') {
      visibleCards.forEach(c => {
        if (c.v.dirty || (previewMotion && !REDUCED && (frameN + c.phase) % 2 === 0)) {
          const P = applyMaster(BY_ID[c.id].P), previewTime = previewMotion ? now + c.phase : 0;
          drawHouse(c.v, renderLook(c.v, P, previewTime), P.bri);
        }
      });
      if (previewMotion ? (!REDUCED || vPill.dirty) : vPill.dirty) drawHouse(vPill, live, lbri);
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
    findCustomPal: st => {
      const slot = Object.keys(APP.palSlots).find(s => APP.palSlots[s].key === stopsKey(st));
      return slot === undefined ? null : CPAL(+slot);
    },
    fwLayers: hasStudioEffects, canPush, fwVer: () => WL.info?.ver || '', fps: () => WL.info?.leds?.fps, ledConfig: () => WL.ledConfig,
    toast, goLibrary, makeView: cv => makeView(cv, CROP_STAGE, 1, 2), drawHouse,
    saveLook({ id, name, desc, P, cats }) {
      const u = id && APP.userLooks.find(x => x.id === id);
      if (u) { Object.assign(u, { name, desc, P: clone(P) }, cats ? { cats: cats.slice() } : {}); delete u.fromSimple; }
      else { id = 'stack-' + Date.now().toString(36); APP.userLooks.unshift({ id, name, cats: cats ? cats.slice() : ['mine'], desc, P: clone(P) }); }
      save(['userLooks']); buildLooks(); renderNav(); renderGallery(true); refreshScheduleBodies(); return id;
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
      const cfg = await wget('/json/cfg').catch(() => null);
      WL.ledConfig = cfg?.hw?.led || null;
      WL.brightnessGamma = cfg ? cfg.light?.gc || {} : null;
      if (HOME.lat == null || HOME.lon == null) {
        const ntp = cfg?.if?.ntp;
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
  if (/[?&]audit\b/.test(location.search)) window.__audit = { looks: () => LOOKS, applyMaster, wledBody, renderLook, N, V16: previewPreGamma, palSlots: () => APP.palSlots, schedule: () => APP.schedule };
})();
