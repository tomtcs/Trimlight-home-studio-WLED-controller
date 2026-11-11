/* Trimlight Studio · Look Builder (approved mockup: /mockups/v5-builder.html).
   A look = a stack of layers. Each layer draws a controller effect (tlfx.js) or a Studio shape, on chosen stretches of roof,
   blended onto the layers below. Each layer maps to WLED segments and may use optional Studio firmware extensions.
   window.TLBuilder: init(host) · render(view, P, nowMs) → Uint8Array (screen space) · segments(P) · open(id) · isStack(P) */
(function (g) {
  'use strict';
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, f) => a + (b - a) * f;
  const frac = x => x - Math.floor(x);
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hex = c => '#' + c.slice(0, 3).map(x => ('0' + Math.round(clamp(x, 0, 255)).toString(16)).slice(-2)).join('');
  const unhex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const UNG = new Uint8Array(256).map((_, v) => Math.round(255 * Math.pow(v / 255, 1 / 2.8)));
  const GAM = new Float32Array(256).map((_, v) => Math.pow(v / 255, 2.8));
  const isStack = P => !!(P && P.stack && P.stack.layers);
  let H = null, N = 0, RUNS = [], FXL = null;   // host (app.js) + house geometry

  /* ======================= Studio shapes: settings ⇄ the firmware's slider encodings ======================= */
  const e8 = v => clamp(Math.round(v), 0, 255);
  const SH_W = ['sine', 'tri', 'saw', 'pulse', 'blob'], SH_P = ['breathe', 'beat', 'swell', 'flick'];
  const SHAPES = {
    field: { name: 'Color field', fw: 'Studio Field', icon: '▬', desc: 'A solid color or gradient laid along the roof. Can slowly scroll. A good base layer.',
      params: [{ k: 'scroll', l: 'Scroll', min: -20, max: 19.75, step: .25, u: 'bulbs/s', d: 0 }, { k: 'repeats', l: 'Repeats along the roof', min: .25, max: 7.75, step: .25, u: '×', d: 1 }, { k: 'wrap', l: 'Gradient ends', opts: [['mirror', 'Mirror (smooth)'], ['repeat', 'Repeat']], d: 'mirror' }],
      enc: p => ({ sx: e8(p.scroll * 128 / 20 + 128), ix: clamp(Math.round(p.repeats * 32), 8, 255), c1: 0, c2: 0, c3: 0, o1: p.wrap === 'repeat', o2: false }),
      dec: s => ({ scroll: (s.sx - 128) * 20 / 128, repeats: Math.max(s.ix, 8) / 32, wrap: s.o1 ? 'repeat' : 'mirror' }) },
    waves: { name: 'Waves', fw: 'Studio Waves', icon: '∿', desc: 'Repeating swells of light that travel along the eaves. Pick the wave shape.',
      params: [{ k: 'shape', l: 'Shape', opts: [['sine', 'Sine'], ['tri', 'Triangle'], ['saw', 'Saw'], ['pulse', 'Pulse'], ['blob', 'Blob']], d: 'sine' }, { k: 'count', l: 'Waves on the roof', min: .5, max: 15.5, step: .5, u: '', d: 3, size: 1 }, { k: 'speed', l: 'Travel speed', min: -60, max: 59.5, step: .5, u: 'bulbs/s', d: 8, speed: 1 }, { k: 'width', l: 'Width (pulse/blob)', min: 5, max: 100, step: 1, u: '%', d: 40 }, { k: 'floor', l: 'Never darker than', min: 0, max: 90, step: 1, u: '%', d: 0 }, { k: 'colorBy', l: 'Color by', opts: [['pos', 'Position'], ['wave', 'Each wave'], ['time', 'Over time']], d: 'pos' }],
      enc: p => ({ sx: e8(p.speed * 128 / 60 + 128), ix: clamp(Math.round(p.count * 16), 8, 255), c1: e8((p.width - 5) * 255 / 95), c2: e8(p.floor * 255 / 90), c3: Math.max(0, SH_W.indexOf(p.shape)), o1: p.colorBy === 'wave', o2: p.colorBy === 'time' }),
      dec: s => ({ speed: (s.sx - 128) * 60 / 128, count: Math.max(s.ix, 8) / 16, width: 5 + s.c1 * 95 / 255, floor: s.c2 * 90 / 255, shape: SH_W[s.c3] || 'sine', colorBy: s.o1 ? 'wave' : s.o2 ? 'time' : 'pos' }) },
    comets: { name: 'Comets', fw: 'Studio Comets', icon: '☄', desc: 'Bright heads with fading tails, looping or bouncing along each stretch of roof.',
      params: [{ k: 'count', l: 'Comets', min: 1, max: 12, step: 1, u: '', d: 3 }, { k: 'speed', l: 'Speed', min: -80, max: 79.5, step: .5, u: 'bulbs/s', d: 12, speed: 1 }, { k: 'tail', l: 'Tail length', min: 1, max: 80, step: 1, u: 'bulbs', d: 18, size: 1 }, { k: 'head', l: 'Head size', min: 1, max: 6, step: 1, u: 'bulbs', d: 2 }, { k: 'path', l: 'Path', opts: [['loop', 'Loop'], ['bounce', 'Bounce']], d: 'loop' }, { k: 'colorBy', l: 'Color by', opts: [['comet', 'Each comet'], ['tail', 'Head → tail']], d: 'comet' }],
      enc: p => ({ sx: e8(p.speed * 128 / 80 + 128), ix: clamp(Math.round(p.tail), 1, 255), c1: clamp(Math.round(p.head), 1, 6), c2: 0, c3: clamp(Math.round(p.count), 1, 12), o1: p.path === 'bounce', o2: p.colorBy === 'tail' }),
      dec: s => ({ speed: (s.sx - 128) * 80 / 128, tail: Math.max(s.ix, 1), head: clamp(s.c1, 1, 6), count: clamp(s.c3, 1, 12), path: s.o1 ? 'bounce' : 'loop', colorBy: s.o2 ? 'tail' : 'comet' }) },
    glints: { name: 'Glints', fw: 'Studio Glints', icon: '✦', desc: 'Bulbs that softly light and fade at random. Shape the fade-in, hold and fade-out yourself.',
      params: [{ k: 'rate', l: 'How many', min: .2, max: 60, step: .1, u: '/s', d: 6, speed: 1 }, { k: 'attack', l: 'Fade in', min: 0, max: 6, step: .05, u: 's', d: .5 }, { k: 'hold', l: 'Hold', min: 0, max: 6, step: .05, u: 's', d: .3 }, { k: 'decay', l: 'Fade out', min: .05, max: 10, step: .05, u: 's', d: 1.6 }, { k: 'size', l: 'Size', min: 1, max: 5, step: 1, u: 'bulbs', d: 1, size: 1 }],
      enc: p => ({ sx: e8(255 * Math.log(Math.max(.2, p.rate) / .2) / Math.log(300)), ix: clamp(Math.round(p.decay * 255 / 10), 1, 255), c1: e8(p.attack * 255 / 6), c2: e8(p.hold * 255 / 6), c3: clamp(Math.round(p.size), 1, 5), o1: false, o2: false }),
      dec: s => ({ rate: .2 * Math.pow(300, s.sx / 255), decay: Math.max(s.ix, 1) * 10 / 255, attack: s.c1 * 6 / 255, hold: s.c2 * 6 / 255, size: clamp(s.c3, 1, 5) }) },
    noise: { name: 'Drifting noise', fw: 'Studio Noise', icon: '≋', desc: 'Organic patches that drift and morph, like light through leaves or water.',
      params: [{ k: 'scale', l: 'Patch size', min: 2, max: 60, step: 1, u: 'bulbs', d: 16, size: 1 }, { k: 'speed', l: 'Drift', min: 0, max: 10, step: .1, u: '', d: 1.5, speed: 1 }, { k: 'contrast', l: 'Contrast', min: 0, max: 100, step: 1, u: '%', d: 50 }, { k: 'floor', l: 'Never darker than', min: 0, max: 90, step: 1, u: '%', d: 10 }],
      enc: p => ({ sx: e8(p.speed * 25.5), ix: clamp(Math.round(p.scale), 2, 255), c1: e8(p.contrast * 2.55), c2: e8(p.floor * 255 / 90), c3: 0, o1: false, o2: false }),
      dec: s => ({ speed: s.sx / 25.5, scale: Math.max(s.ix, 2), contrast: s.c1 * 100 / 255, floor: s.c2 * 90 / 255 }) },
    pulse: { name: 'Breathe & beat', fw: 'Studio Breathe', icon: '♡', desc: 'The whole zone breathes, beats or swells together, optionally rolling across the roof.',
      params: [{ k: 'shape', l: 'Shape', opts: [['breathe', 'Breathe'], ['beat', 'Heartbeat'], ['swell', 'Swell & fade'], ['flick', 'Candle flicker']], d: 'breathe' }, { k: 'period', l: 'One cycle', min: .3, max: 60, step: .1, u: 's', d: 6 }, { k: 'floor', l: 'Never darker than', min: 0, max: 95, step: 1, u: '%', d: 25 }, { k: 'roll', l: 'Roll across the roof', min: 0, max: 100, step: 1, u: '%', d: 0 }, { k: 'cycle', l: 'Color cycle', min: 0, max: 120, step: 1, u: 's', d: 0 }],
      enc: p => ({ sx: e8(255 * Math.log(Math.max(.3, p.period) / .3) / Math.log(200)), ix: e8(p.cycle * 255 / 120), c1: e8(p.roll * 2.55), c2: e8(p.floor * 255 / 95), c3: Math.max(0, SH_P.indexOf(p.shape)), o1: false, o2: false }),
      dec: s => ({ period: .3 * Math.pow(200, s.sx / 255), cycle: s.ix * 120 / 255, roll: s.c1 * 100 / 255, floor: s.c2 * 95 / 255, shape: SH_P[s.c3] || 'breathe' }) },
  };
  const shapeDefaults = t => { const p = {}; SHAPES[t].params.forEach(q => p[q.k] = q.d); return p; };
  const shapeOnRoof = (t, p) => SHAPES[t].dec(SHAPES[t].enc(p));   // what the controller will actually use

  function samp(st, x) {
    if (x <= st[0][0]) return st[0][1]; const L = st.length - 1; if (x >= st[L][0]) return st[L][1];
    for (let k = 0; k < L; k++) if (x <= st[k + 1][0]) { const a = st[k], b = st[k + 1], f = (x - a[0]) / Math.max(1e-6, b[0] - a[0]); return [lerp(a[1][0], b[1][0], f), lerp(a[1][1], b[1][1], f), lerp(a[1][2], b[1][2], f)]; }
    return st[L][1];
  }
  const pingpong = x => { x = frac(x * 0.5) * 2; return x > 1 ? 2 - x : x; };
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function h2(x, y, s) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  function vnoise(x, y, s) { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return lerp(lerp(h2(xi, yi, s), h2(xi + 1, yi, s), u), lerp(h2(xi, yi + 1, s), h2(xi + 1, yi + 1, s), u), v); }

  // renders `len` virtual pixels, screen space 0..1 (tls_shapes.cpp does the same per virtual pixel)
  function renderShape(type, p, st, len, clk, dt, S, out) {
    const put = (i, col, b) => { out[i * 3] = col[0] / 255 * b; out[i * 3 + 1] = col[1] / 255 * b; out[i * 3 + 2] = col[2] / 255 * b; };
    if (type === 'field') {
      for (let i = 0; i < len; i++) { let x = (i - clk * p.scroll) / len * p.repeats; x = p.wrap === 'repeat' ? frac(x) : pingpong(x); put(i, samp(st, x), 1); }
    } else if (type === 'waves') {
      const w = p.width / 100, fl = p.floor / 100, cnt = Math.max(.25, p.count);
      for (let i = 0; i < len; i++) {
        const u = (i - clk * p.speed) * cnt / len, ph = frac(u); let s;
        switch (p.shape) { case 'tri': s = 1 - Math.abs(2 * ph - 1); break; case 'saw': s = p.speed >= 0 ? 1 - ph : ph; break; case 'pulse': s = clamp((w - ph) * len / cnt / 1.5 + .5, 0, 1); break; case 'blob': { const d = (ph - .5) / (w * .32 + .01); s = Math.exp(-d * d); break; } default: s = .5 - .5 * Math.cos(6.2831853 * ph); }
        s = s * s * (3 - 2 * s) * .35 + s * .65;
        const col = p.colorBy === 'wave' ? samp(st, frac(Math.floor(u) / Math.max(1, Math.ceil(cnt)) + .0001)) : p.colorBy === 'time' ? samp(st, pingpong(clk / 20)) : samp(st, i / Math.max(1, len - 1));
        put(i, col, fl + (1 - fl) * s);
      }
    } else if (type === 'comets') {
      const n = Math.max(1, p.count | 0), tail = Math.max(1, p.tail), hd = Math.max(1, p.head), L = len;
      out.fill(0, 0, len * 3);
      for (let k = 0; k < n; k++) {
        let pos, dir;
        if (p.path === 'bounce') { const span = Math.max(1, L - 1); let q = (clk * Math.abs(p.speed) + k * 2 * span / n) % (2 * span); if (q < 0) q += 2 * span; pos = q <= span ? q : 2 * span - q; dir = (q <= span ? 1 : -1) * (p.speed < 0 ? -1 : 1); if (p.speed < 0) pos = span - pos; }
        else { pos = (clk * p.speed + k * L / n) % L; if (pos < 0) pos += L; dir = p.speed < 0 ? -1 : 1; }
        const hc = samp(st, n > 1 ? k / (n - 1) : 0);
        for (let i = 0; i < L; i++) {
          let d = (pos - i) * dir; if (p.path !== 'bounce') { d %= L; if (d < 0) d += L; if (d > L / 2) d -= L; }
          let b = 0; if (d >= -hd / 2 && d <= hd / 2) b = 1; else if (d > hd / 2 && d < hd / 2 + tail) { const f = 1 - (d - hd / 2) / tail; b = f * f; } else if (d < -hd / 2 && d > -hd / 2 - 1) b = (1 + (d + hd / 2)) * .5;
          if (b <= 0) continue;
          const col = p.colorBy === 'tail' ? samp(st, clamp((d - hd / 2) / tail, 0, 1)) : hc;
          const o = i * 3; out[o] = Math.max(out[o], col[0] / 255 * b); out[o + 1] = Math.max(out[o + 1], col[1] / 255 * b); out[o + 2] = Math.max(out[o + 2], col[2] / 255 * b);
        }
      }
    } else if (type === 'glints') {
      S.spots = S.spots || []; S.acc = S.acc || 0; S.r = S.r || rng(S.seed || 7);
      S.acc += p.rate * (len / 190) * dt;
      while (S.acc >= 1) { S.acc -= 1; if (S.spots.length >= 128) S.spots.shift(); S.spots.push({ i: Math.floor(S.r() * len), t0: clk, c: samp(st, S.r()) }); }
      out.fill(0, 0, len * 3);
      const life = p.attack + p.hold + p.decay, half = (p.size - 1) / 2;
      S.spots = S.spots.filter(s => clk - s.t0 < life);
      for (const s of S.spots) {
        const a = clk - s.t0; let e = a < p.attack ? a / Math.max(1e-3, p.attack) : a < p.attack + p.hold ? 1 : 1 - (a - p.attack - p.hold) / p.decay; e = clamp(e, 0, 1); e = e * e * (3 - 2 * e);
        for (let j = Math.floor(s.i - half - .5); j <= Math.ceil(s.i + half + .5); j++) { if (j < 0 || j >= len) continue; const f = clamp(1 - Math.max(0, Math.abs(j - s.i) - half), 0, 1) * e; if (f <= 0) continue; const o = j * 3; out[o] = Math.min(1, out[o] + s.c[0] / 255 * f); out[o + 1] = Math.min(1, out[o + 1] + s.c[1] / 255 * f); out[o + 2] = Math.min(1, out[o + 2] + s.c[2] / 255 * f); }
      }
    } else if (type === 'noise') {
      const sc = Math.max(1, p.scale), k = 1 + p.contrast / 18, fl = p.floor / 100;
      for (let i = 0; i < len; i++) { let b = vnoise(i / sc, clk * p.speed * .35, 3); b = clamp((b - .5) * k + .5, 0, 1); const cx = vnoise(i / sc * .5 + 40, clk * p.speed * .15, 9); put(i, samp(st, clamp((cx - .2) / .6, 0, 1)), fl + (1 - fl) * b); }
    } else if (type === 'pulse') {
      const fl = p.floor / 100, per = Math.max(.1, p.period);
      for (let i = 0; i < len; i++) {
        const ph = frac(clk / per - (p.roll / 100) * i / len); let s;
        if (p.shape === 'beat') { const gg = (x, m, w) => Math.exp(-(((x - m) / w) ** 2)); s = Math.min(1, gg(ph, .08, .045) + .75 * gg(ph, .26, .05)); }
        else if (p.shape === 'swell') s = ph < .35 ? Math.pow(ph / .35, 1.6) : Math.pow(1 - (ph - .35) / .65, 2.2);
        else if (p.shape === 'flick') { s = .62 + .38 * (vnoise(clk * 7 / per * 6 + i * 3.1, i * .7, 5) * .7 + vnoise(clk * 19 / per * 6, i, 6) * .3); s = clamp((s - .55) * 2.2, 0, 1); }
        else s = .5 - .5 * Math.cos(6.2831853 * ph);
        const col = p.cycle > 0 ? samp(st, pingpong(clk / p.cycle)) : samp(st, i / Math.max(1, len - 1));
        put(i, col, fl + (1 - fl) * s);
      }
    }
  }
  // WLED's virtual → physical mapping for a segment (Segment::setPixelColor: grouping, spacing, reverse, mirror)
  function wledMap(len, grp, spc, rev, mi) {
    const gl = grp + spc; let VL = Math.floor((len + gl - 1) / gl); if (mi) VL = Math.floor((VL + 1) / 2);
    const map = [];
    for (let vi = 0; vi < VL; vi++) {
      let i = vi * gl; if (rev) i = mi ? Math.floor((len - 1) / 2) - i : (len - 1) - i;
      const o = []; for (let j = 0; j < grp; j++) { const s = i + (rev ? -j : j); if (s >= 0 && s < len) { o.push(s); if (mi) o.push(len - 1 - s); } }
      map.push(o);
    }
    return { VL, map };
  }

  /* ======================= blends + modulators ======================= */
  const BLENDS = {
    cover: { name: 'Cover', d: 'Replaces what’s under it, dark bulbs too.', code: 1 },
    add: { name: 'Add light', d: 'Adds its light on top. Dark parts are see-through.', code: 2 },
    screen: { name: 'Soft add', d: 'Like Add, but never blows out to flat.', code: 3 },
    lighter: { name: 'Brighter wins', d: 'Each bulb shows whichever layer is brighter.', code: 4 },
    reveal: { name: 'Reveal', d: 'Only lets the layers below show where this one is bright.', code: 5 },
    tint: { name: 'Tint', d: 'Recolors the layers below, keeps their brightness.', code: 6 },
    dim: { name: 'Shade', d: 'Gently darkens the layers below where this one is dark (never fully off).', code: 7 },
  };
  const lum = (r, g, b) => Math.max(r, g, b);
  function blendPx(mode, d, o, s, a) {
    const dr = d[o], dg = d[o + 1], db = d[o + 2]; let r, gg, b;
    switch (mode) {
      case 'add': r = Math.min(1, dr + s[0]); gg = Math.min(1, dg + s[1]); b = Math.min(1, db + s[2]); break;
      case 'screen': r = 1 - (1 - dr) * (1 - s[0]); gg = 1 - (1 - dg) * (1 - s[1]); b = 1 - (1 - db) * (1 - s[2]); break;
      case 'lighter': { const ls = lum(s[0], s[1], s[2]), ld = lum(dr, dg, db); if (ls > ld) { r = s[0]; gg = s[1]; b = s[2]; } else { r = dr; gg = dg; b = db; } break; }
      case 'reveal': { const l = lum(s[0], s[1], s[2]); r = dr * l; gg = dg * l; b = db * l; break; }
      case 'tint': { const ls = lum(s[0], s[1], s[2]), ld = lum(dr, dg, db); if (ls < .004) { r = dr; gg = dg; b = db; } else { r = s[0] / ls * ld; gg = s[1] / ls * ld; b = s[2] / ls * ld; } break; }
      case 'dim': { const k = .25 + .75 * lum(s[0], s[1], s[2]); r = dr * k; gg = dg * k; b = db * k; break; }
      default: r = s[0]; gg = s[1]; b = s[2];
    }
    d[o] = dr + (r - dr) * a; d[o + 1] = dg + (gg - dg) * a; d[o + 2] = db + (b - db) * a;
  }
  const MOD_SHAPES = [['sine', 'Sine'], ['tri', 'Triangle'], ['up', 'Ramp up'], ['down', 'Ramp down'], ['square', 'Step'], ['wander', 'Wander']];
  const MOD_T = { opacity: 0, hue: 1, pos: 2, speed: 3, size: 4, sx: 5, ix: 6, c1: 7, c2: 8, c3: 9 };
  function modVal(m, t) {
    const ph = frac(t / Math.max(.05, m.per) + (m.phase || 0) / 100);
    switch (m.shape) {
      case 'tri': return 1 - 4 * Math.abs(ph - .5);
      case 'up': return 2 * ph - 1;
      case 'down': return 1 - 2 * ph;
      case 'square': return ph < .5 ? 1 : -1;
      case 'wander': return (vnoise(t / Math.max(.05, m.per) * 2 % 100000, 0, 17) - .5) * 2.6;
      default: return Math.sin(6.2831853 * ph);
    }
  }
  function hueRot(deg) { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928, .213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283, .213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072]; }
  function fxMeta(fx) {
    const raw = (H && H.fxdata(fx)) ?? (FXL.meta && FXL.meta[fx]) ?? '', parts = raw === '' ? [] : raw.split(';');
    const sl = parts[0] !== undefined ? parts[0].split(',') : ['!', '!'];
    const K = ['sx', 'ix', 'c1', 'c2', 'c3', 'o1', 'o2', 'o3'], DEF = { sx: 'Speed', ix: 'Intensity', c1: 'Custom 1', c2: 'Custom 2', c3: 'Custom 3', o1: 'Option 1', o2: 'Option 2', o3: 'Option 3' };
    const ctl = []; K.forEach((k, i) => { const s = sl[i]; if (s === undefined || s === '') return; ctl.push({ k, label: s === '!' ? DEF[k] : s, bool: k[0] === 'o' }); });
    const colors = parts.length > 1 ? (parts[1] ? parts[1].split(',').map(s => s === '!' ? '' : s) : []) : ['', '', ''];
    const usesPal = parts.length > 2 ? parts[2] !== '' : true;
    const defs = {}; (parts[4] || '').split(',').forEach(kv => { const m = kv.match(/^(sx|ix|c1|c2|c3|pal|o1|o2|o3)=(\d+)/); if (m) defs[m[1]] = +m[2]; });
    return { ctl, colors, usesPal, defs, audio: H ? H.isAudio(fx) : false };
  }
  const fxName = fx => (H && H.fxName(fx)) || FXL.names[fx] || ('Effect ' + fx);
  function fakeAudio(t) { const beat = (t * 2) % 1, v = Math.round(60 + 170 * Math.pow(1 - beat, 3) + 25 * Math.sin(t * 7.3)); const fft = new Uint8Array(16); for (let i = 0; i < 16; i++) fft[i] = clamp(Math.round(v * (1 - i / 22) * (0.6 + 0.4 * Math.sin(t * (1 + i * 0.37) + i))), 0, 255); return { volume: clamp(v, 0, 255), peak: beat < 0.06, fft }; }

  /* ======================= stack → pixels ======================= */
  function ranges(L) {
    if (L.zone.custom && L.zone.custom.length) return L.zone.custom.map(r => ({ start: r.start, len: r.len }));   // drawn on the layer lanes
    const runs = (L.zone.runs.length ? L.zone.runs : RUNS.map((_, i) => i)).filter(i => RUNS[i]).slice().sort((a, b) => a - b), out = [];
    for (const ri of runs) { const r = RUNS[ri], last = out[out.length - 1]; if (last && last.start + last.len === r.start) last.len += r.len; else out.push({ start: r.start, len: r.len }); }
    return out;
  }
  const qStops = st => st.map(([p, c]) => [Math.round(clamp(p, 0, 1) * 255) / 255, c.map(v => clamp(Math.round(v), 0, 255))]);   // as the controller stores them
  function effOf(L, t) {
    const e = { op: Math.round(L.opacity * 2.55) / 255, hue: 0, pos: 0, speed: 1, size: 1, fx: {} };
    for (const m of L.mods) {
      const v = modVal(m, t), dp = m.depth / 100;
      if (m.target === 'opacity') e.op *= clamp(1 - dp * (.5 - .5 * v), 0, 1);
      else if (m.target === 'hue') e.hue += dp * 180 * v;
      else if (m.target === 'pos') e.pos += dp * v;
      else if (m.target === 'speed') e.speed *= Math.max(0, 1 + dp * v);
      else if (m.target === 'size') e.size *= Math.max(.05, 1 + dp * v);
      else e.fx[m.target] = (e.fx[m.target] || 0) + dp * 127 * v;
    }
    return e;
  }
  let palN = 5000; const palFor = {};
  function customPal(L) { const st = qStops(L.stops), key = JSON.stringify(st); const c = palFor[L.id]; if (c && c.key === key) return c.id; const id = c ? c.id : palN++; FXL.setCustomPalette(id, st.map(([p, col]) => [Math.round(p * 255), col])); palFor[L.id] = { id, key }; return id; }
  // S: per-view state {inst, clk, ms}. Writes S.out[layer.id] (N*4: rgb + alpha) and returns the mix (N*3, 0..1)
  function renderStackInto(S, layers, t, dt, opts) {
    const comp = S.comp && S.comp.length === N * 3 ? S.comp : (S.comp = new Float32Array(N * 3)); comp.fill(0);
    S.out = S.out || {};
    for (const L of layers) {
      const out = S.out[L.id] && S.out[L.id].length === N * 4 ? S.out[L.id] : (S.out[L.id] = new Float32Array(N * 4)); out.fill(0);
      const e = effOf(L, t), slow = Math.max(1, L.motion.slow || 1), shape = L.src.kind === 'shape';
      S.clk[L.id] = (S.clk[L.id] || 0) + dt * e.speed / slow; S.ms[L.id] = (S.ms[L.id] || 0) + dt * 1000;
      const st = qStops(L.stops), rot = Math.abs(e.hue) > .01 ? hueRot(e.hue) : null, grp = L.zone.grp, spc = L.zone.spc, gl = grp + spc;
      ranges(L).forEach((r, ri) => {
        const key = L.id + ':' + ri, len = r.len;
        const sig = shape ? 'S' + L.src.type + len + ':' + grp + ':' + spc + (L.motion.mi ? 'm' : '') + (L.motion.rev ? 'r' : '') : 'F' + L.src.fx + ':' + len + ':' + grp + ':' + spc;
        let it = S.inst[key];
        if (!it || it.sig !== sig) it = S.inst[key] = { sig, S: { seed: (ri * 131 + L.id.length * 977 + L.id.charCodeAt(L.id.length - 1) * 7919) >>> 0 }, buf: new Float32Array(len * 3), vb: null, map: shape ? wledMap(len, grp, spc, L.motion.rev, L.motion.mi) : null, inst: shape ? null : FXL.create(L.src.fx, len) };
        const buf = it.buf;
        if (shape) {
          const p = shapeOnRoof(L.src.type, L.src.p); SHAPES[L.src.type].params.forEach(q => { if (q.size && e.size !== 1) p[q.k] = p[q.k] * e.size; });
          const VL = it.map.VL; if (!it.vb || it.vb.length !== VL * 3) it.vb = new Float32Array(VL * 3);
          renderShape(L.src.type, p, st, VL, S.clk[L.id], dt * e.speed / slow, it.S, it.vb);
          buf.fill(0); it.map.map.forEach((ph, vi) => ph.forEach(pi => { buf[pi * 3] = it.vb[vi * 3]; buf[pi * 3 + 1] = it.vb[vi * 3 + 1]; buf[pi * 3 + 2] = it.vb[vi * 3 + 2]; }));
        } else {
          const s = L.src, m = fxMeta(s.fx), q = { sx: s.sx, ix: s.ix, c1: s.c1, c2: s.c2, c3: s.c3 };
          for (const k in e.fx) if (q[k] !== undefined) q[k] = clamp(Math.round(q[k] + e.fx[k]), 0, k === 'c3' ? 31 : 255);
          if (FXL.config) FXL.config.globalBri = 255;
          const raw = it.inst.render({ sx: q.sx, ix: q.ix, c1: q.c1, c2: q.c2, c3: q.c3, o1: s.o1, o2: s.o2, o3: s.o3, pal: L.customPal ? customPal(L) : s.pal, col: s.col, grp, spc, rev: L.motion.rev, mi: L.motion.mi, slow, bri: 255, audio: m.audio ? fakeAudio(S.ms[L.id] / 1000) : undefined }, S.ms[L.id]);
          for (let i = 0; i < len * 3; i++) buf[i] = UNG[raw[i]] / 255;
        }
        const sh = Math.round(e.pos * len / 2), fe = L.zone.feather;
        for (let i = 0; i < len; i++) {
          const rel = L.motion.rev ? len - 1 - i : i; if (gl > 1 && (rel % gl) >= grp) continue;
          let j = (i - sh) % len; if (j < 0) j += len; const o = (r.start + i) * 4;
          let R = buf[j * 3], G = buf[j * 3 + 1], B = buf[j * 3 + 2];
          if (rot) { const r2 = R * rot[0] + G * rot[1] + B * rot[2], g2 = R * rot[3] + G * rot[4] + B * rot[5], b2 = R * rot[6] + G * rot[7] + B * rot[8]; R = clamp(r2, 0, 1); G = clamp(g2, 0, 1); B = clamp(b2, 0, 1); }
          let a = e.op; if (fe > 0) a *= clamp(Math.min(i + .5, len - i - .5) / fe, 0, 1);
          out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = a;
        }
      });
      const vis = opts && opts.solo ? L.id === opts.solo : L.on;
      if (!vis) continue;
      const mode = opts && opts.solo ? 'cover' : L.blend, s = [0, 0, 0];
      for (let i = 0; i < N; i++) { const a = out[i * 4 + 3]; if (a <= 0) continue; s[0] = out[i * 4]; s[1] = out[i * 4 + 1]; s[2] = out[i * 4 + 2]; blendPx(mode, comp, i * 3, s, opts && opts.solo ? 1 : a); }
    }
    return comp;
  }
  // for gallery cards / sections / schedule previews in app.js
  function render(v, P, nowMs) {
    const S = v._stk && v._stkP === P.stack ? v._stk : (v._stk = { inst: {}, clk: {}, ms: {}, last: null }, v._stkP = P.stack, v._stk);
    const dt = S.last == null ? 0 : clamp((nowMs - S.last) / 1000, 0, .1); S.last = nowMs;
    const comp = renderStackInto(S, P.stack.layers, nowMs / 1000, dt);
    const d = v._stkBuf && v._stkBuf.length === N * 3 ? v._stkBuf : (v._stkBuf = new Uint8Array(N * 3));
    for (let i = 0; i < N * 3; i++) d[i] = comp[i] * 255 + .5;
    return d;
  }

  /* ======================= stack → controller segments with optional extensions ======================= */
  function segments(P, dry) {   // dry: for previews/matching, never claims a palette slot
    const segs = []; let id = 0;
    P.stack.layers.forEach(L => ranges(L).forEach(r => {
      const base = { id: id++, start: r.start, stop: r.start + r.len, grp: L.zone.grp, spc: L.zone.spc, of: 0, rev: !!L.motion.rev, mi: !!L.motion.mi, slow: L.motion.slow || 1, on: L.on, bri: clamp(Math.round(L.opacity * 2.55), 0, 255), n: (L.name || '').slice(0, 30),
        bm: BLENDS[L.blend].code, fe: L.zone.feather | 0, tlc: qStops(L.stops).map(([p, c]) => [c[0], c[1], c[2], Math.round(p * 255)]),
        mod: L.mods.map(m => [MOD_T[m.target] ?? 0, Math.max(0, MOD_SHAPES.findIndex(s => s[0] === m.shape)), Math.round(m.depth), Math.round(m.phase || 0), Math.round(m.per * 1000)]) };
      if (L.src.kind === 'shape') {
        let fx = H.shapeFx(SHAPES[L.src.type].fw); if (fx == null) { if (!dry) throw new Error('The controller doesn’t have the Studio shapes yet (needs Studio firmware extensions)'); fx = SHAPES[L.src.type].fw + ' (not on the controller yet)'; }
        const q = SHAPES[L.src.type].enc(L.src.p); Object.assign(base, { fx, sx: q.sx, ix: q.ix, c1: q.c1, c2: q.c2, c3: q.c3, o1: q.o1, o2: q.o2, o3: false, pal: 0, col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]] });
      } else {
        const s = L.src; Object.assign(base, { fx: s.fx, sx: s.sx, ix: s.ix, c1: s.c1, c2: s.c2, c3: Math.min(31, s.c3), o1: !!s.o1, o2: !!s.o2, o3: !!s.o3, pal: L.customPal ? (dry ? 'custom slot' : H.customPalId(qStops(L.stops).map(([p, c]) => [Math.round(p * 255), c]))) : s.pal, col: s.col.map(c => c.slice(0, 3)) });
      }
      segs.push(base);
    }));
    return segs;
  }
  const segCount = P => P.stack.layers.reduce((a, l) => a + ranges(l).length, 0);
  // does the roof run this stack? (live segments vs ours: bounds, effect, blend)
  function matches(P, live) {
    let want; try { want = segments(P, true); } catch { return false; }
    const segs = (live || []).filter(x => x.stop > x.start);
    return segs.length === want.length && want.every((w, k) => { const x = segs[k]; return x.start === w.start && x.stop === w.stop && x.fx === w.fx && (x.bm || 0) === w.bm && x.sx === w.sx && x.ix === w.ix; });
  }

  /* ======================= model: layers, recipes ======================= */
  let uid = Date.now() % 100000; const nid = () => 'L' + (uid++).toString(36);
  const ST = (...a) => a.map((c, i) => [a.length === 1 ? 0 : i / (a.length - 1), c]);
  const QUICK = [['White', [255, 255, 255]], ['Soft white 4000K', [255, 209, 163]], ['Warm white 3000K', [255, 180, 107]], ['Warm white 2700K', [255, 166, 87]], ['Candle white 2400K', [255, 150, 55]], ['Warm 2000K', [255, 130, 30]], ['Amber', [255, 90, 0]], ['Gold', [255, 170, 0]], ['Red', [220, 0, 10]], ['Cranberry', [160, 0, 30]], ['Pink', [255, 40, 120]], ['Magenta', [200, 0, 200]], ['Purple', [120, 0, 255]], ['Blue', [0, 60, 255]], ['Navy', [0, 30, 120]], ['Sky', [0, 150, 255]], ['Teal', [0, 200, 170]], ['Green', [0, 200, 40]], ['Action green', [100, 255, 0]], ['Ember', [120, 10, 0]]];
  function swToStops(sw) { const c = sw.cols; if (c.length === 1) return [[0, c[0].slice()]]; if (sw.blend) return c.map((x, i) => [i / (c.length - 1), x.slice()]); const st = []; c.forEach((x, k) => st.push([k / c.length, x.slice()], [(k + 1) / c.length - 1e-4, x.slice()])); return st; }
  const dedupeCols = cs => cs.filter((c, i) => cs.findIndex(d => d.join() === c.join()) === i).slice(0, 8).map(c => c.slice());
  function initCols(L) { L.cmode = 'swatches'; L.sw = { cols: dedupeCols(L.stops.map(s => s[1])), blend: true }; L.stops = swToStops(L.sw); return L; }
  function syncStops(L) { if (L.cmode !== 'gradient' && L.sw) L.stops = swToStops(L.sw); }
  const allRuns = () => RUNS.map((_, i) => i);
  function mkShape(type, name, o) { const L = Object.assign({ id: nid(), name, on: true, stops: ST([255, 120, 20], [255, 60, 0]), blend: 'add', opacity: 100, zone: { runs: allRuns(), feather: 0, grp: 1, spc: 0 }, motion: { slow: 1, rev: false, mi: false }, mods: [] }, o); L.src = { kind: 'shape', type, p: Object.assign(shapeDefaults(type), o.p || {}) }; delete L.p; return initCols(L); }
  function mkFx(fx, name, o) { const m = fxMeta(fx); const src = Object.assign({ kind: 'fx', fx, sx: 128, ix: 128, c1: 128, c2: 128, c3: 16, o1: false, o2: false, o3: false, pal: 0, col: [[255, 160, 0], [0, 0, 0], [0, 0, 0]] }, m.defs, o.src || {}); const L = Object.assign({ id: nid(), name, on: true, stops: ST([255, 100, 0], [255, 40, 0], [180, 0, 40]), customPal: false, blend: 'cover', opacity: 100, zone: { runs: allRuns(), feather: 0, grp: 1, spc: 0 }, motion: { slow: 1, rev: false, mi: false }, mods: [] }, o); L.src = src; return initCols(L); }
  let ZONE_GROUPS = [];
  function zoneGroups() {
    const port = p => RUNS.map((r, i) => r.port === p ? i : -1).filter(i => i >= 0);
    const outputs = [...new Set(RUNS.map(r => r.port))].sort((a, b) => a - b).map(p => ['Output ' + p, port(p)]);
    const sections = (H?.sections?.() || []).filter(s => Number.isInteger(s.start) && Number.isInteger(s.stop) && s.start >= 0 && s.stop <= N && s.stop > s.start)
      .map(s => [s.name, RUNS.map((r, i) => r.start >= s.start && r.start + r.len <= s.stop ? i : -1).filter(i => i >= 0), { start: s.start, len: s.stop - s.start, id: s.id }]);
    ZONE_GROUPS = [['Whole layout', allRuns()], ...outputs, ...sections].filter(z => z[1].length || z[2]);
  }
  const RECIPES = {
    'Ember Comets': () => {
      const a = mkShape('field', 'Ember base', { blend: 'cover', opacity: 70, stops: ST([70, 6, 0], [150, 22, 0], [90, 10, 0]), p: { scroll: 1.25, repeats: 2.5 }, mods: [{ target: 'opacity', shape: 'sine', per: 14, depth: 35, phase: 0 }] });
      const b = mkShape('comets', 'Amber comets', { blend: 'add', stops: ST([255, 150, 20], [255, 90, 0], [255, 120, 10]), p: { count: 3, speed: 9, tail: 24, head: 2 } });
      const c = mkShape('glints', 'Gold glints', { blend: 'screen', opacity: 85, stops: ST([255, 170, 30], [255, 120, 0]), p: { rate: 5, attack: .6, hold: .2, decay: 1.8 } });
      return { layers: [a, b, c], knobs: [{ name: 'Energy', v: 45, maps: [{ id: b.id, path: 'src.p.speed', min: 3, max: 22 }, { id: c.id, path: 'src.p.rate', min: 1, max: 14 }] }, { name: 'Glow', v: 60, maps: [{ id: a.id, path: 'opacity', min: 30, max: 95 }] }] };
    },
    'Aurora + Stars': () => {
      const a = mkFx(38, 'Aurora curtains', { src: { sx: 24, ix: 150, pal: 50 }, mods: [{ target: 'hue', shape: 'wander', per: 90, depth: 12, phase: 0 }] });
      const b = mkShape('glints', 'Cool stars', { blend: 'lighter', stops: ST([120, 120, 255], [60, 160, 255], [150, 80, 255]), p: { rate: 3, attack: 1.2, hold: .4, decay: 2.5 } });
      return { layers: [a, b], knobs: [{ name: 'Stars', v: 30, maps: [{ id: b.id, path: 'src.p.rate', min: .5, max: 12 }] }] };
    },
    'Candle Tide': () => {
      const a = mkFx(102, 'Candles', { src: { sx: 96, ix: 200, pal: 0, col: [[255, 120, 20], [40, 8, 0], [0, 0, 0]] } });
      const b = mkShape('waves', 'Slow tide', { blend: 'reveal', stops: ST([255, 255, 255]), p: { shape: 'blob', count: 1.5, speed: 5, width: 55, floor: 22 } });
      return { layers: [a, b], knobs: [{ name: 'Tide speed', v: 30, maps: [{ id: b.id, path: 'src.p.speed', min: 1, max: 16 }] }] };
    },
    'Green Rush': () => {
      const a = mkShape('field', 'Navy field', { blend: 'cover', stops: ST([0, 25, 110], [0, 70, 200], [0, 25, 110]), p: { scroll: 3, repeats: 3 }, opacity: 75 });
      const b = mkShape('comets', 'Action green', { blend: 'add', stops: ST([100, 255, 0], [60, 220, 0]), p: { count: 2, speed: 28, tail: 16, head: 2 }, zone: { runs: ZONE_GROUPS[1][1].slice(), feather: 3, grp: 1, spc: 0 } });
      const c = mkShape('pulse', 'Header beat', { blend: 'screen', stops: ST([100, 255, 0]), p: { shape: 'beat', period: 1.1, floor: 0 }, zone: { runs: (ZONE_GROUPS[2] || ZONE_GROUPS[0])[1].slice(), feather: 0, grp: 1, spc: 0 }, opacity: 70 });
      return { layers: [a, b, c], knobs: [{ name: 'Hype', v: 50, maps: [{ id: b.id, path: 'src.p.speed', min: 10, max: 50 }, { id: c.id, path: 'src.p.period', min: 2, max: .6 }] }] };
    },
    'Harvest Drift': () => {
      const a = mkShape('noise', 'Harvest patches', { blend: 'cover', stops: ST([200, 30, 0], [255, 90, 0], [255, 160, 20]), p: { scale: 18, speed: 1.2, contrast: 55, floor: 15 } });
      const b = mkShape('waves', 'Gold swell', { blend: 'screen', opacity: 55, stops: ST([255, 150, 20]), p: { shape: 'sine', count: 1, speed: -3, floor: 0 }, mods: [{ target: 'pos', shape: 'sine', per: 24, depth: 40, phase: 0 }] });
      return { layers: [a, b], knobs: [] };
    },
    'Blank': () => ({ layers: [mkShape('field', 'Warm base', { blend: 'cover', stops: ST([255, 130, 30]) })], knobs: [] }),
  };

  /* ======================= page ======================= */
  const $ = id => document.getElementById('bd-' + id);
  let LOOK = null, sel = null, tab = 'source', view = 'all', showZone = false, hoverBulb = -1, gSel = 0, swSel = 0;
  let PS = { inst: {}, clk: {}, ms: {} };   // page render state
  let SV = null, mounted = false, playing = true, rate = 1, tReal = 0, last = 0, raf = 0, active = false;
  const getP = (o, path) => path.split('.').reduce((a, k) => a == null ? a : a[k], o);
  const setP = (o, path, v) => { const ks = path.split('.'), lst = ks.pop(); const t = ks.reduce((a, k) => a[k], o); t[lst] = v; };
  const layerById = id => LOOK.layers.find(l => l.id === id);
  function toast(m, c) { H.toast(m, c); }

  const MARKUP = `
<header class="top">
  <button class="back" id="bd-back"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Library</button>
  <div class="crumb"><small id="bd-crumb">Builder · new look</small><input id="bd-name" value="" spellcheck="false"></div>
  <span class="chip fw" id="bd-fw">Checking the controller…</span>
  <span class="sp"></span>
  <button class="ib" id="bd-undo" title="Undo (⌘Z)">↶</button>
  <button class="ib" id="bd-redo" title="Redo (⇧⌘Z)">↷</button>
  <button class="btn" id="bd-ask" title="Describe a change and AI suggests ways to do it">✨ Ask AI</button>
  <button class="btn" id="bd-new" title="Start a new look">＋ New</button>
  <button class="btn" id="bd-save"><span style="color:var(--accent)">☆</span>Save as my look</button>
  <button class="btn go" id="bd-push">Push to house</button>
</header>
<div class="app">
  <aside class="col left">
    <div class="lsec"><div class="lbl">Start from</div><div class="recipes" id="bd-recipes"></div></div>
    <div class="layhead"><span class="lbl">Layers <span style="letter-spacing:0;text-transform:none;font-weight:500">· top covers bottom</span></span><span class="chip" id="bd-count"></span></div>
    <div class="layers" id="bd-layers"></div>
    <button class="addl" id="bd-add">＋ Add layer</button>
    <div class="budget" id="bd-budget"></div>
    <div class="lookrow" id="bd-lookrow"><span style="font-size:18px">⚙</span><div><b>Look settings &amp; knobs</b><small id="bd-lookrowsub"></small></div></div>
  </aside>
  <main class="col mid">
    <div class="stage" id="bd-stage">
      <canvas id="bd-cv"></canvas>
      <div class="stbar">
        <div class="seg" id="bd-play"><button data-play="1" class="on" title="Play / pause (space)">❚❚</button><button data-restart="1" title="Start over">↺</button></div>
        <div class="seg" id="bd-rate" title="Preview speed (the roof always runs at 1×)"><button data-r=".25">¼×</button><button data-r=".5">½×</button><button data-r="1" class="on">1×</button><button data-r="2">2×</button><button data-r="4">4×</button></div>
        <span class="sp"></span>
        <div class="seg" id="bd-view"><button data-v="all" class="on">All layers</button><button data-v="solo">Only selected</button></div>
        <div class="seg"><button id="bd-zone" title="Outline the bulbs the selected layer covers">Show zone</button></div>
      </div>
      <div class="stip" id="bd-tip"></div>
      <div class="tagl"><i></i><span id="bd-tag">Preview · same maths as the controller</span></div>
    </div>
    <section class="card"><h4>Layer lanes <small>drag a layer’s edges to change where it plays (snaps to the ends of each stretch) · drag the middle to slide it · drag empty space (or ⌥-drag anywhere) to draw a range, ⇧ adds one · double-click to reset · drag a name to reorder</small></h4><div class="lanes" id="bd-lanes"></div><div class="ticks"><span></span><canvas id="bd-ticks"></canvas></div></section>
    <section class="card"><h4>Time map <small>how the mix moves</small></h4><div class="tm"><canvas id="bd-tm" width="190" height="150"></canvas><div>
      <p>Every row is one moment (newest at the top, ~6 seconds tall). Left to right is the roofline in wiring order.</p>
      <p><b style="color:var(--text)">Diagonal streaks</b> are things moving along the roof. <b style="color:var(--text)">Vertical bands</b> are bulbs that stay put. <b style="color:var(--text)">Flat rows</b> are the whole roof changing at once.</p></div></div></section>
    <section class="card"><h4>On the controller <small>estimates for this stack</small></h4><div class="stats" id="bd-stats"></div><div class="pw" id="bd-pw"></div><div class="warnline" id="bd-pwwarn"></div>
      <details><summary>What gets sent to the controller</summary><pre id="bd-json"></pre></details></section>
  </main>
  <aside class="col right" id="bd-insp"></aside>
</div>
<div class="modal" id="bd-picker" hidden><div class="mbox">
  <div class="mh"><div><h2 id="bd-pktitle">Add a layer</h2><p id="bd-pksub"></p></div><button class="mx" id="bd-pkclose">×</button></div>
  <div class="mtabs"><div class="seg" id="bd-pktabs"><button data-t="motions" class="on">Motions</button><button data-t="studio">Studio shapes</button><button data-t="fx">Controller effects</button><button data-t="looks">From saved looks</button></div><div class="seg" id="bd-pkfilt"></div><input id="bd-pkq" placeholder="Search…" autocomplete="off"></div>
  <div class="pgrid" id="bd-pkgrid"></div>
</div></div>`;

  /* ---- undo ---- */
  const hist = [], fut = []; let snapT = null;
  function snap(now) { clearTimeout(snapT); const go = () => { const s = JSON.stringify(LOOK); if (hist[hist.length - 1] !== s) { hist.push(s); if (hist.length > 120) hist.shift(); fut.length = 0; } syncUndo(); saveDraft(); }; if (now) go(); else snapT = setTimeout(go, 350); }
  function syncUndo() { $('undo').disabled = hist.length < 2; $('redo').disabled = !fut.length; }
  function undo() { if (hist.length < 2) return; fut.push(hist.pop()); LOOK = JSON.parse(hist[hist.length - 1]); afterHist(); }
  function redo() { if (!fut.length) return; const s = fut.pop(); hist.push(s); LOOK = JSON.parse(s); afterHist(); }
  function afterHist() { if (sel !== 'look' && !layerById(sel)) sel = LOOK.layers[LOOK.layers.length - 1]?.id || 'look'; $('name').value = LOOK.name; renderAll(); syncUndo(); }
  function changed(full) { LOOK.dirty = true; snap(); if (full) renderAll(); else { renderLayers(); renderLanes(); renderJSON(); } }
  function saveDraft() {
    if (H && H.saveDraft) { H.saveDraft(clone(LOOK)); return; }
    try { localStorage.setItem('tls-builder-draft', JSON.stringify(LOOK)); } catch { }
  }

  /* ---- knobs ---- */
  function numericParams(L) {
    const out = [['opacity', 'Opacity', 0, 100]];
    if (L.src.kind === 'shape') SHAPES[L.src.type].params.filter(q => q.min !== undefined).forEach(q => out.push(['src.p.' + q.k, q.l, q.min, q.max]));
    else fxMeta(L.src.fx).ctl.filter(c => !c.bool).forEach(c => out.push(['src.' + c.k, c.label, 0, c.k === 'c3' ? 31 : 255]));
    return out;
  }
  function applyKnob(k) { k.maps.forEach(m => { const L = layerById(m.id); if (!L) return; const v = lerp(+m.min, +m.max, k.v / 100); const isInt = m.path.startsWith('src.') && !m.path.startsWith('src.p.'); setP(L, m.path, isInt ? Math.round(clamp(v, 0, 255)) : m.path === 'opacity' ? Math.round(clamp(v, 0, 100)) : Math.round(v * 100) / 100); }); }

  function newLook(recipe) {
    const r = RECIPES[recipe](); LOOK = { id: null, name: recipe === 'Blank' ? 'My new look' : recipe, bri: 200, fade: 2, layers: r.layers, knobs: r.knobs, recipe };
    LOOK.knobs.forEach(applyKnob); afterLoad();
  }
  function afterLoad() { sel = LOOK.layers[LOOK.layers.length - 1].id; tab = 'source'; PS = { inst: {}, clk: {}, ms: {} }; tmClear = true; $('name').value = LOOK.name; hist.length = 0; fut.length = 0; snap(true); renderAll(); }

  /* ---- stats / power ---- */
  const MA_PER_BULB = 55, LIMIT = 850; let pwHist = [], PORTS = [];
  function renderStats() {
    const segs = segCount({ stack: LOOK }), nl = LOOK.layers.length, shapes = LOOK.layers.filter(l => l.src.kind === 'shape').length, mods = LOOK.layers.reduce((a, l) => a + l.mods.length, 0);
    const cost = LOOK.layers.reduce((a, l) => a + ranges(l).length * (l.src.kind === 'fx' ? 1.2 : .7), 0) + mods * .1, word = cost < 3 ? 'Light' : cost < 6 ? 'Moderate' : cost < 9 ? 'Heavy' : 'Too heavy';
    $('stats').innerHTML = [['Layers', nl + ' of 8', shapes + ' Studio · ' + (nl - shapes) + ' WLED'], ['Segments', segs + ' of 32', 'one per stretch of roof'], ['Modulators', mods, mods ? 'moving settings' : 'none yet'], ['Controller load', word, 'measured after push: ' + (H.fps() || '—') + ' fps now']]
      .map(s => '<div class="stat"><small>' + s[0] + '</small><b>' + s[1] + '</b><em>' + s[2] + '</em></div>').join('');
    $('count').textContent = nl + ' / 8';
    $('budget').innerHTML = 'Controller budget · ' + word.toLowerCase() + '<div class="bar"><i style="width:' + clamp(cost / 9 * 100, 4, 100) + '%"></i></div>';
  }
  function samplePower(comp) {
    const g = GAM[clamp(Math.round(LOOK.bri), 0, 255)], per = PORTS.map(() => 0);
    PORTS.forEach((p, k) => { for (const ri of p.runs) { const r = RUNS[ri]; for (let i = r.start; i < r.start + r.len; i++) per[k] += (GAM[comp[i * 3] * 255 | 0] + GAM[comp[i * 3 + 1] * 255 | 0] + GAM[comp[i * 3 + 2] * 255 | 0]) / 3 * MA_PER_BULB * g + .8; } });
    pwHist.push(per); if (pwHist.length > 60) pwHist.shift();
  }
  function renderPower() {
    if (!pwHist.length) return; const avg = PORTS.map((_, k) => pwHist.reduce((a, h) => a + h[k], 0) / pwHist.length), peak = PORTS.map((_, k) => Math.max(...pwHist.map(h => h[k])));
    $('pw').innerHTML = PORTS.map((p, k) => '<div>Output ' + p.port + ' · ' + p.n + ' bulbs<div class="m"><i style="width:' + clamp(avg[k] / (LIMIT * 1.4) * 100, 1, 100) + '%"></i><u style="left:' + (100 / 1.4) + '%"></u></div><b>' + Math.round(avg[k]) + ' mA</b> avg · peak ' + Math.round(peak[k]) + ' · limit ' + LIMIT + '</div>').join('');
    const over = PORTS.map((p, k) => ({ p, f: LIMIT / peak[k] })).filter(o => o.f < 1), w = $('pwwarn');
    if (over.length) { w.style.display = 'block'; w.textContent = '⚠ Over the controller’s 850 mA-per-output limit on output ' + over.map(o => o.p.port).join(' & ') + ': at its brightest the roof would dim this look to about ' + Math.round(Math.min(...over.map(o => o.f)) * 100) + '%. Lower brightness, or raise the limit once the power supply rating is known.'; } else w.style.display = 'none';
  }
  function renderJSON() { let txt; try { txt = JSON.stringify({ bri: LOOK.bri, transition: Math.round(LOOK.fade * 10), seg: segments({ stack: LOOK }, true) }, null, 1); } catch (e) { txt = e.message; } $('json').textContent = txt.replace(/\n\s+(-?\d|"#|false|true)/g, ' $1').replace(/\[\s+/g, '[').replace(/\s+\]/g, ']'); }

  /* ---- layer list ---- */
  const srcLabel = L => L.src.kind === 'shape' ? SHAPES[L.src.type].name : fxName(L.src.fx);
  function zoneLabel(L) { if (L.zone.custom && L.zone.custom.length) { const c = L.zone.custom; return c.length === 1 ? 'Bulbs ' + (c[0].start + 1) + '–' + (c[0].start + c[0].len) : c.length + ' custom ranges'; }
    return zoneLabelRuns(L); }
  function zoneLabelRuns(L) { const rs = L.zone.runs.slice().sort((a, b) => a - b); const gz = ZONE_GROUPS.find(z => z[1].length === rs.length && z[1].every((x, i) => x === rs[i])); return gz ? gz[0] : rs.length === 1 ? RUNS[rs[0]].name : rs.length + ' stretches'; }
  function renderLayers() {
    $('layers').innerHTML = LOOK.layers.slice().reverse().map(L => '<div class="layer' + (L.id === sel ? ' sel' : '') + (L.on ? '' : ' off') + '" draggable="true" data-id="' + L.id + '"><span class="grip" title="Drag to reorder">⋮⋮</span><div class="lt"><b>' + esc(L.name) + '</b><small><span class="bm">' + BLENDS[L.blend].name + '</span>' + esc(srcLabel(L)) + ' · ' + esc(zoneLabel(L)) + (L.mods.length ? ' · ∿' + L.mods.length : '') + '</small><canvas data-mini="' + L.id + '"></canvas></div><div class="lbtns"><button class="ib" data-eye="1" title="' + (L.on ? 'Hide' : 'Show') + ' layer">' + (L.on ? '◉' : '○') + '</button><button class="ib" data-dup="1" title="Duplicate">⧉</button><button class="ib" data-del="1" title="Delete">✕</button></div></div>').join('');
    $('lookrow').classList.toggle('sel', sel === 'look');
    $('lookrowsub').textContent = 'Brightness ' + Math.round(LOOK.bri / 2.55) + '% · ' + (LOOK.knobs.length ? LOOK.knobs.length + ' knob' + (LOOK.knobs.length > 1 ? 's' : '') + ': ' + LOOK.knobs.map(k => k.name).join(', ') : 'no knobs yet');
    document.querySelectorAll('#bd-recipes button').forEach(b => b.classList.toggle('on', !LOOK.id && b.dataset.rec === LOOK.recipe));
    renderStats();
  }
  function drawMinis() {
    $('layers').querySelectorAll('canvas[data-mini]').forEach(c => {
      const o = PS.out && PS.out[c.dataset.mini]; if (!o) return; if (!c.width || c.width === 300) { const r = c.getBoundingClientRect(); c.width = Math.max(1, Math.round(r.width * 2)); c.height = Math.round(r.height * 2); }
      const x = c.getContext('2d'), cw = c.width / N; x.fillStyle = '#05070d'; x.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < N; i++) { const a = o[i * 4 + 3]; if (a <= 0) continue; x.fillStyle = 'rgb(' + (o[i * 4] * a * 255 | 0) + ',' + (o[i * 4 + 1] * a * 255 | 0) + ',' + (o[i * 4 + 2] * a * 255 | 0) + ')'; x.fillRect(i * cw, 0, Math.ceil(cw), c.height); }
    });
  }
  function select(id) { if (sel === id) return; sel = id; swSel = 0; gSel = 0; renderLayers(); renderLanes(); renderInspector(); }

  /* ---- inspector ---- */
  const TABS = [['source', 'Draws'], ['colors', 'Colors'], ['where', 'Where'], ['blend', 'Blend'], ['motion', 'Motion'], ['mod', 'Modulate']];
  const fmtV = (v, u) => (u === 's' ? (+v).toFixed(+v < 10 ? 2 : 1).replace(/\.?0+$/, '') : u === '/s' ? (+v).toFixed(+v < 10 ? 1 : 0) : Math.abs(v) < 10 && v % 1 ? (+v).toFixed(2).replace(/0$/, '') : Math.round(v * 10) / 10) + (u ? ' ' + u : '');
  function slider(path, label, v, min, max, step, unit) { return '<div class="ctl"><div class="r"><span>' + esc(label) + '</span><output data-o="' + path + '">' + fmtV(v, unit) + '</output></div><input type="range" data-p="' + path + '" data-u="' + (unit || '') + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + v + '"></div>'; }
  const sgs = (path, cur, opts) => '<div class="sgs">' + opts.map(o => '<button data-sg="' + path + '" data-v="' + esc(String(o[0])) + '" class="' + (String(cur) === String(o[0]) ? 'on' : '') + '">' + esc(o[1]) + '</button>').join('') + '</div>';
  const fmtPer = s => s >= 3600 ? (s / 3600).toFixed(s % 3600 ? 1 : 0) + ' h' : s >= 60 ? (s / 60).toFixed(s % 60 ? 1 : 0) + ' min' : (s < 10 ? s.toFixed(1) : Math.round(s)) + ' s';
  const perToPos = s => Math.log(s / .5) / Math.log(7200 / .5) * 1000, posToPer = v => { const s = .5 * Math.pow(7200 / .5, v / 1000); return s < 10 ? Math.round(s * 10) / 10 : s < 120 ? Math.round(s) : Math.round(s / 30) * 30; };
  function modTargets(L) {
    const t = [['opacity', 'Opacity'], ['hue', 'Hue shift'], ['pos', 'Position (sway)']];
    if (L.src.kind === 'shape') { if (SHAPES[L.src.type].params.some(q => q.speed)) t.push(['speed', 'Speed']); if (SHAPES[L.src.type].params.some(q => q.size)) t.push(['size', 'Size']); }
    else fxMeta(L.src.fx).ctl.filter(c => !c.bool).forEach(c => t.push([c.k, c.label]));
    return t;
  }
  const nearWhite = c => { const hi = Math.max(...c), lo = Math.min(...c); return hi > 110 && lo > .6 * hi; };
  const TWINKLY = new Set([17, 18, 20, 21, 22, 49, 51, 74, 80, 81, 87, 106]);
  const isTwinkly = L => L.src.kind === 'shape' ? L.src.type === 'glints' : TWINKLY.has(L.src.fx);
  function renderInspector() {
    const el = $('insp');
    if (sel === 'look') { el.innerHTML = lookPanel(); bindInsp(); return; }
    const L = layerById(sel); if (!L) { el.innerHTML = ''; return; }
    const kind = L.src.kind === 'shape' ? '<span class="chip ok">Studio shape</span>' + esc(SHAPES[L.src.type].name) : '<span class="chip">Controller effect</span>' + esc(fxName(L.src.fx)) + ' <span style="color:var(--dim)">#' + L.src.fx + '</span>';
    el.innerHTML = '<div class="ihead"><input data-name value="' + esc(L.name) + '" spellcheck="false"><div class="kind">' + kind + '<button class="btn sm" data-swap>Change…</button></div>' +
      '<div class="quick"><label>Blend<select data-blend>' + Object.entries(BLENDS).map(([k, b]) => '<option value="' + k + '"' + (L.blend === k ? ' selected' : '') + '>' + b.name + '</option>').join('') + '</select></label><label>Opacity · <output data-o="opacity" style="color:var(--accent);font:600 11px Space Grotesk">' + L.opacity + ' %</output><input type="range" data-p="opacity" data-u="%" min="0" max="100" value="' + L.opacity + '" style="margin-top:6px"></label></div></div>' +
      '<div class="tabs">' + TABS.map(t => '<button data-tab="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + (t[0] === 'mod' && L.mods.length ? '<sup>' + L.mods.length + '</sup>' : '') + '</button>').join('') + '</div><div class="ibody">' + tabBody(L) + '</div>';
    bindInsp();
  }
  function knobHint(L) { const ks = LOOK.knobs.filter(k => k.maps.some(m => m.id === L.id)); return ks.length ? '<div class="note">Also moved by your knob' + (ks.length > 1 ? 's' : '') + ' <b>' + ks.map(k => esc(k.name)).join(', ') + '</b> (Look settings).</div>' : ''; }
  function tabBody(L) {
    if (tab === 'source') {
      if (L.src.kind === 'shape') { const S = SHAPES[L.src.type]; return '<div class="note">' + esc(S.desc) + '</div>' + S.params.map(q => q.opts ? '<div class="ctl"><div class="r"><span>' + esc(q.l) + '</span></div>' + sgs('src.p.' + q.k, L.src.p[q.k], q.opts) + '</div>' : slider('src.p.' + q.k, q.l, L.src.p[q.k], q.min, q.max, q.step, q.u)).join('') + knobHint(L); }
      const m = fxMeta(L.src.fx);
      return (m.audio ? '<div class="note">♪ Reacts to the controller’s mic. The preview fakes a 120 bpm song.</div>' : '') +
        m.ctl.map(c => c.bool ? '<label class="chk"><input type="checkbox" data-c="src.' + c.k + '"' + (L.src[c.k] ? ' checked' : '') + '> ' + esc(c.label) + '</label>' : slider('src.' + c.k, c.label, L.src[c.k], 0, c.k === 'c3' ? 31 : 255, 1, '')).join('') +
        '<div class="note">These are the controller’s own sliders for <b>' + esc(fxName(L.src.fx)) + '</b>, so the preview matches the roof.</div>' + knobHint(L);
    }
    if (tab === 'colors') return colorsTab(L);
    if (tab === 'where') {
      const cu = L.zone.custom && L.zone.custom.length, on = new Set(cu ? [] : L.zone.runs), currentRanges = cu ? JSON.stringify(L.zone.custom) : '';
      return (cu ? '<div class="note"><b>Custom range' + (L.zone.custom.length > 1 ? 's' : '') + ':</b> ' + L.zone.custom.map(r => 'bulbs ' + (r.start + 1) + '–' + (r.start + r.len)).join(', ') + ' (dragged on the layer lanes or selected from a saved roof section). <button class="btn sm" data-zclear style="margin-left:6px">Back to stretches</button></div>' : '<div class="note">Tip: drag this layer’s edges on its <b>layer lane</b>, or choose a saved roof section below.</div>') + '<div class="sub">Quick picks</div><div class="sgs" style="margin-bottom:12px">' + ZONE_GROUPS.map((gz, i) => '<button data-zg="' + i + '" class="' + (gz[2] ? currentRanges === JSON.stringify([gz[2]]) ? 'on' : '' : gz[1].length === on.size && gz[1].every(r => on.has(r)) ? 'on' : '') + '">' + esc(gz[0]) + (gz[2] ? ' · ' + (gz[2].start + 1) + '–' + (gz[2].start + gz[2].len) : '') + '</button>').join('') + '</div>' +
        '<div class="sub">Stretches of roof <span class="lbl" style="letter-spacing:.04em">' + L.zone.runs.reduce((a, r) => a + (RUNS[r]?.len || 0), 0) + ' bulbs</span></div><div class="zones">' + RUNS.map((r, i) => '<label class="zone' + (on.has(i) ? ' on' : '') + '"><input type="checkbox" data-run="' + i + '"' + (on.has(i) ? ' checked' : '') + '><span>' + esc(r.name) + '</span><small>' + r.len + ' · out ' + r.port + '</small></label>').join('') + '</div>' +
        '<div class="note" style="margin-top:10px">Neighbouring stretches join into one run, so a comet can travel round the corner. Separate stretches each get their own copy.</div>' +
        slider('zone.feather', 'Soft edges', L.zone.feather, 0, 20, 1, 'bulbs') +
        '<div class="ctl"><div class="r"><span>Lit bulbs</span></div>' + sgs('zone.pat', L.zone.grp + ':' + L.zone.spc, [['1:0', 'Every bulb'], ['1:1', '1 on 1 off'], ['1:2', '1 on 2 off'], ['2:2', '2 on 2 off'], ['3:1', '3 on 1 off']]) + '</div>' +
        '<div class="note">Off bulbs in this layer are see-through, so the layers below show in the gaps.</div>';
    }
    if (tab === 'blend') return '<div class="note">How this layer mixes with the layers <b>under</b> it. The bottom layer blends onto darkness.</div><div class="blends">' + Object.entries(BLENDS).map(([k, b]) => '<button class="blend' + (L.blend === k ? ' on' : '') + '" data-bl="' + k + '"><b>' + b.name + '</b><small>' + b.d + '</small><canvas data-bdemo="' + k + '"></canvas></button>').join('') + '</div><div class="note" style="margin-top:12px">Demo strips: an orange gradient underneath, this mode applied with a blue wave on top.</div>';
    if (tab === 'motion') return motionGallery(L) + '<div class="sub" style="margin-top:20px">Fine-tune</div><div class="ctl"><div class="r"><span>Slow motion</span><small>Studio firmware</small></div>' + sgs('motion.slow', L.motion.slow, [[1, '1×'], [2, '½×'], [4, '¼×'], [8, '⅛×'], [16, '1/16×']]) + '</div><div class="note">Slows this layer only, without the stutter you get from just turning the speed down.</div>' +
      '<label class="chk"><input type="checkbox" data-c="motion.rev"' + (L.motion.rev ? ' checked' : '') + '> Run the other way</label><label class="chk"><input type="checkbox" data-c="motion.mi"' + (L.motion.mi ? ' checked' : '') + '> Mirror from the middle of each stretch</label>';
    if (tab === 'mod') return modsTab(L);
    return '';
  }
  // ---- motion gallery (motions.js): every motion in this layer's colours; click to switch, keeping zone/blend/mods ----
  let motCat = 'all', motCards = [], motObs = null;
  const MO = () => g.TLMotions;
  const layerCols = L => (L.sw && L.cmode !== 'gradient' ? L.sw.cols : L.stops.map(s => s[1])).filter(c => Math.max(...c) > 8);
  function motionGallery(L) {
    if (!MO()) return '';
    const cur = L.mo && MO().byId[L.mo.id];
    let h = '';
    if (cur) h += '<div class="ctl"><div class="r"><span>' + esc(cur.spWord) + '</span><output data-o="mos">' + Math.round(L.mo.speed * 100) + '</output></div><input type="range" data-mos min="0" max="100" value="' + Math.round(L.mo.speed * 100) + '"></div>' +
      (cur.am.length ? '<div class="ctl"><div class="r"><span>' + esc(cur.amWord || 'Amount') + '</span><output data-o="moa">' + Math.round(L.mo.amount * 100) + '</output></div><input type="range" data-moa min="0" max="100" value="' + Math.round(L.mo.amount * 100) + '"></div>' : '');
    else h += '<div class="note">This layer uses its own settings (see <b>Draws</b>). Pick a motion below to switch it to one of the ready-made motions.</div>';
    h += '<div class="sub">Motion <span class="lbl">' + MO().LIST.length + ' · in this layer’s colors</span></div><div class="sgs" style="margin-bottom:8px">' + [['all', 'All']].concat(MO().CATS.map(c => [c[0], c[2] + ' ' + c[1].split(' ')[0]])).map(c => '<button data-mcat="' + c[0] + '" class="' + (motCat === c[0] ? 'on' : '') + '">' + esc(c[1]) + '</button>').join('') + '</div>';
    h += '<div class="mgrid">' + MO().LIST.filter(m => motCat === 'all' || m.cat === motCat).map(m => '<button class="mcard' + (L.mo && L.mo.id === m.id ? ' on' : '') + '" data-mo="' + m.id + '" title="' + esc(m.desc) + '"><canvas></canvas><b>' + esc(m.name) + '</b></button>').join('') + '</div>';
    return h;
  }
  function bindMotions(el, L) {
    if (motObs) motObs.disconnect(); motCards = [];
    if (!L || tab !== 'motion' || !MO()) return;
    el.querySelector('[data-mos]')?.addEventListener('input', e => { MO().tune(L, +e.target.value / 100, L.mo.amount); el.querySelector('[data-o="mos"]').textContent = e.target.value; changed(); });
    el.querySelector('[data-moa]')?.addEventListener('input', e => { MO().tune(L, L.mo.speed, +e.target.value / 100); el.querySelector('[data-o="moa"]').textContent = e.target.value; changed(); });
    el.querySelectorAll('[data-mcat]').forEach(b => b.onclick = () => { motCat = b.dataset.mcat; renderInspector(); });
    el.querySelectorAll('[data-mo]').forEach(b => b.onclick = () => { MO().apply(L, b.dataset.mo); changed(true); toast('“' + L.name + '” now runs ' + MO().byId[b.dataset.mo].name); });
    const cols = layerCols(L), blend = L.sw ? L.sw.blend : true;
    motObs = new IntersectionObserver(es => es.forEach(en => { const c = motCards.find(x => x.el === en.target); if (c) c.vis = en.isIntersecting; }), { root: el });
    motCards = [...el.querySelectorAll('[data-mo]')].map(card => ({ el: card, cv: card.querySelector('canvas'), v: {}, vis: false, P: { stack: { layers: [MO().layer(card.dataset.mo, cols.length ? cols : [[255, 140, 20]], blend, .4, .5)], knobs: [] } } }));
    motCards.forEach(c => motObs.observe(c.el));
  }
  function stripN(cv, buf) { if (!cv.width || cv.width === 300) { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * 2) || 200; cv.height = Math.round(r.height * 2) || 12; } const x = cv.getContext('2d'), cw = cv.width / N; x.fillStyle = '#05070d'; x.fillRect(0, 0, cv.width, cv.height); for (let i = 0; i < N; i++) { x.fillStyle = 'rgb(' + buf[i * 3] + ',' + buf[i * 3 + 1] + ',' + buf[i * 3 + 2] + ')'; x.fillRect(i * cw, 0, Math.ceil(cw), cv.height); } }
  let motT = 0, motAcc = 0;
  function drawMotionCards(dt) { motT += dt * 1000; motAcc += dt; if (motAcc < 1 / 30) return; motAcc = 0; for (const c of motCards) if (c.vis) stripN(c.cv, render(c.v, c.P, motT)); }
  function colorPick(L) {
    const gm = L.cmode === 'gradient';
    let h = '<div class="sub">' + (gm ? 'Gradient' : 'Colors') + ' <span class="sgs" style="gap:3px"><button data-cm="swatches" class="' + (gm ? '' : 'on') + '">Colors</button><button data-cm="gradient" class="' + (gm ? 'on' : '') + '">Gradient</button></span></div>';
    if (gm) return h + '<div class="lbl" style="margin:-2px 0 6px">click the bar to add a stop · drag stops to move them</div>' + gradEditor(L);
    const c = L.sw.cols; swSel = clamp(swSel, 0, c.length - 1);
    h += '<div class="sws">' + c.map((x, i) => '<label class="sw' + (i === swSel ? ' sel' : '') + '" style="background:' + hex(x) + '" title="Click to pick a color"><input type="color" data-sw="' + i + '" value="' + hex(x) + '"><span>' + (i + 1) + '</span>' + (c.length > 1 ? '<button data-swdel="' + i + '" title="Remove">✕</button>' : '') + '</label>').join('') + (c.length < 8 ? '<button class="swadd" data-swadd title="Add a color">＋</button>' : '') + '</div>';
    h += '<div class="ctl"><div class="r"><span>Between colors</span></div>' + sgs('sw.blend', L.sw.blend, [[false, 'Blocks (crisp)'], [true, 'Blend (smooth)']]) + '</div>';
    h += '<div class="lbl" style="margin:10px 0 6px">Quick colors <span style="letter-spacing:0;text-transform:none">· sets color ' + (swSel + 1) + '</span></div><div class="quickc">' + QUICK.map((q, i) => '<button data-qc="' + i + '" title="' + q[0] + '" style="background:' + hex(q[1]) + '"></button>').join('') + '</div>';
    h += '<div class="note">' + (L.src.kind === 'shape' ? ({ comets: 'Each comet takes the next color.', glints: 'Each glint picks one of these colors at random.', waves: 'Colors run along the roof (or one per wave, under Draws › Color by).', field: 'Colors are laid along the roof in order.', noise: 'Patches drift between these colors.', pulse: 'Colors run along the roof, or cycle over time (Draws › Color cycle).' })[L.src.type] : 'Sent as a custom palette, in this order.') + '</div>';
    return h;
  }
  function colorsTab(L) {
    let h = '';
    const cols = L.src.kind === 'shape' || L.customPal ? L.stops.map(s => s[1]) : L.src.col;
    if (isTwinkly(L) && cols.some(nearWhite)) h += '<div class="note w">⚠ Near-white in a twinkle. You asked for no white bulbs in twinkles. <button class="btn sm" data-warm style="margin-left:6px">Warm them up</button></div>';
    if (L.src.kind === 'fx') {
      const m = fxMeta(L.src.fx);
      h += '<div class="sub">Colors <span class="lbl">' + (m.colors.length ? 'used by this effect' : 'not used') + '</span></div><div class="cols">' + [0, 1, 2].map(i => i < Math.max(1, m.colors.length) ? '<label><input type="color" data-col="' + i + '" value="' + hex(L.src.col[i]) + '">' + esc(m.colors[i] || ['Color 1', 'Color 2', 'Color 3'][i]) + '</label>' : '').join('') + '</div>';
      if (m.usesPal) {
        h += '<div class="sub" style="margin-top:16px">Palette</div><label class="chk"><input type="checkbox" data-cpal' + (L.customPal ? ' checked' : '') + '> Use my own colors (saved to a custom palette slot)</label>';
        if (L.customPal) h += colorPick(L);
        else h += '<div class="pals">' + H.palettes().filter(p => p.id <= 70).map(p => '<button data-pal="' + p.id + '" class="' + (L.src.pal === p.id ? 'on' : '') + '"><i style="background:' + FXL.paletteCss(p.id, L.src.col) + '"></i><span>' + esc(p.name) + '</span></button>').join('') + '</div>';
      }
    } else h += colorPick(L);
    if (L.src.kind === 'shape' || L.customPal) h += '<div class="sub" style="margin-top:14px">Your color themes</div><div class="themes">' + H.themes().map((t, i) => '<button data-theme="' + i + '" title="' + esc(t[0]) + '"><i style="background:linear-gradient(90deg,' + t[1].map(hex).join(',') + ')"></i><span>' + esc(t[0]) + '</span></button>').join('') + '</div>';
    return h;
  }
  const gradCss = st => 'linear-gradient(90deg,' + st.map(s => hex(s[1]) + ' ' + (s[0] * 100).toFixed(1) + '%').join(',') + ')';
  function gradEditor(L) {
    gSel = clamp(gSel, 0, L.stops.length - 1); const s = L.stops[gSel];
    return '<div class="gradwrap" data-grad><div class="gbar" style="background:' + gradCss(L.stops) + '"></div>' + L.stops.map((st, i) => '<div class="gstop' + (i === gSel ? ' sel' : '') + '" data-gs="' + i + '" style="left:' + (st[0] * 100) + '%"><i style="background:' + hex(st[1]) + '"></i></div>').join('') + '</div>' +
      '<div class="gedit"><input type="color" data-gcol value="' + hex(s[1]) + '"><span>Stop ' + (gSel + 1) + ' of ' + L.stops.length + ' · at ' + Math.round(s[0] * 100) + '%</span><span class="sp"></span><button class="btn sm" data-gflip title="Reverse">⇄</button><button class="btn sm" data-gdel' + (L.stops.length < 2 ? ' disabled' : '') + '>Remove stop</button></div>';
  }
  function modsTab(L) {
    const T = modTargets(L);
    let h = '<div class="note">Modulators move a setting up and down by themselves, on the controller. Slow ones (minutes to hours) make a look evolve through the evening; fast ones add life.</div>';
    h += L.mods.map((m, i) => '<div class="mod"><div class="mh"><select data-mt="' + i + '">' + T.map(t => '<option value="' + t[0] + '"' + (m.target === t[0] ? ' selected' : '') + '>' + esc(t[1]) + '</option>').join('') + '</select><button class="ib" data-mdel="' + i + '" title="Remove">✕</button></div>' +
      sgs('mods.' + i + '.shape', m.shape, MOD_SHAPES) + '<canvas data-mcv="' + i + '"></canvas>' +
      '<div class="ctl"><div class="r"><span>One cycle</span><output data-o="per' + i + '">' + fmtPer(m.per) + '</output></div><input type="range" data-per="' + i + '" min="0" max="1000" value="' + Math.round(perToPos(m.per)) + '"></div>' +
      slider('mods.' + i + '.depth', 'Amount', m.depth, 0, 100, 1, '%') + slider('mods.' + i + '.phase', 'Start point', m.phase, 0, 100, 1, '%') + '</div>').join('');
    if (L.mods.length < 4) h += '<button class="addl" style="margin:0;width:100%" data-madd>＋ Add modulator</button>'; else h += '<div class="note">4 modulators per layer is the controller’s limit.</div>';
    return h;
  }
  function lookPanel() {
    const allP = LOOK.layers.flatMap(L => numericParams(L).map(p => ({ id: L.id, path: p[0], label: L.name + ' › ' + p[1], min: p[2], max: p[3] })));
    let h = '<div class="ihead"><input data-lname value="' + esc(LOOK.name) + '" spellcheck="false"><div class="kind">Settings for the whole look</div></div><div class="ibody">';
    h += slider('L.bri', 'Brightness', LOOK.bri, 10, 255, 1, '') + slider('L.fade', 'Fade in from the previous look', LOOK.fade, 0, 10, .1, 's');
    h += '<div class="sub" style="margin-top:18px">Your knobs <span class="lbl">' + LOOK.knobs.length + ' of 4</span></div><div class="note">A knob moves several settings at once, across layers. Set it where you like it before you save.</div>';
    h += LOOK.knobs.map((k, i) => '<div class="knob"><div class="kh"><input type="text" data-kn="' + i + '" value="' + esc(k.name) + '"><button class="ib" data-kdel="' + i + '" title="Remove knob">✕</button></div>' +
      '<div class="ctl" style="margin:8px 0 4px"><div class="r"><span>Try it</span><output data-o="knob' + i + '">' + k.v + '</output></div><input type="range" data-kv="' + i + '" min="0" max="100" value="' + k.v + '"></div>' +
      '<div class="lbl" style="margin-top:8px">Moves <span style="letter-spacing:0;text-transform:none">· from (knob at 0) → to (knob at 100)</span></div>' +
      k.maps.map((m, j) => '<div class="kmap"><select data-km="' + i + ':' + j + '">' + allP.map(p => '<option value="' + p.id + '|' + p.path + '"' + (p.id === m.id && p.path === m.path ? ' selected' : '') + '>' + esc(p.label) + '</option>').join('') + '</select><input data-kmin="' + i + ':' + j + '" value="' + m.min + '"><input data-kmax="' + i + ':' + j + '" value="' + m.max + '"><button class="ib" data-kmdel="' + i + ':' + j + '">✕</button></div>').join('') +
      '<button class="btn sm" data-kmadd="' + i + '" style="margin-top:8px">＋ Also move…</button></div>').join('');
    if (LOOK.knobs.length < 4) h += '<button class="addl" style="margin:0;width:100%" data-kadd>＋ Add a knob</button>';
    h += '<div class="sub" style="margin-top:18px">Where it shows up</div><div class="note"><b>Save as my look</b> puts it in Saved looks with a live card, ready for the schedule, playlists and moments. Pushing writes it to the controller, so it keeps running if the app is closed.</div></div>';
    return h;
  }
  function bindInsp() {
    const el = $('insp'), L = layerById(sel);
    fillRanges(el);
    el.querySelectorAll('input[type=range][data-p]').forEach(inp => inp.oninput = () => {
      const p = inp.dataset.p, v = +inp.value;
      if (p === 'L.bri') LOOK.bri = v; else if (p === 'L.fade') LOOK.fade = v; else setP(L, p, v);
      const o = el.querySelector('[data-o="' + p + '"]'); if (o) o.textContent = p === 'opacity' ? v + ' %' : fmtV(v, inp.dataset.u);
      changed();
    });
    el.querySelectorAll('[data-sg]').forEach(b => b.onclick = () => {
      const p = b.dataset.sg; let v = b.dataset.v;
      if (p === 'zone.pat') { const [gp, s] = v.split(':').map(Number); L.zone.grp = gp; L.zone.spc = s; }
      else { if (/^-?\d+(\.\d+)?$/.test(v)) v = +v; else if (v === 'true' || v === 'false') v = v === 'true'; setP(L, p, v); }
      syncStops(L); changed(); renderInspector();
    });
    el.querySelectorAll('input[type=checkbox][data-c]').forEach(c => c.onchange = () => { setP(L, c.dataset.c, c.checked); changed(); });
    el.querySelector('[data-name]')?.addEventListener('input', e => { L.name = e.target.value || 'Layer'; changed(); });
    el.querySelector('[data-lname]')?.addEventListener('input', e => { LOOK.name = e.target.value; $('name').value = LOOK.name; LOOK.dirty = true; snap(); });
    el.querySelector('[data-blend]')?.addEventListener('change', e => { L.blend = e.target.value; changed(); renderInspector(); });
    el.querySelector('[data-swap]')?.addEventListener('click', () => openPicker('swap'));
    el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { tab = b.dataset.tab; renderInspector(); });
    el.querySelectorAll('[data-bl]').forEach(b => b.onclick = () => { L.blend = b.dataset.bl; changed(); renderInspector(); });
    el.querySelector('[data-zclear]')?.addEventListener('click', () => { delete L.zone.custom; changed(true); });
    el.querySelectorAll('[data-zg]').forEach(b => b.onclick = () => { const z = ZONE_GROUPS[+b.dataset.zg]; if (z[2]) L.zone.custom = [{ start: z[2].start, len: z[2].len }]; else { delete L.zone.custom; L.zone.runs = z[1].slice(); } changed(); renderInspector(); });
    el.querySelectorAll('[data-run]').forEach(c => c.onchange = () => { const i = +c.dataset.run, s = new Set(L.zone.custom && L.zone.custom.length ? [] : L.zone.runs); delete L.zone.custom; c.checked ? s.add(i) : s.delete(i); if (!s.size) { c.checked = true; toast('A layer needs at least one stretch of roof', 'var(--warn)'); return; } L.zone.runs = [...s].sort((a, b) => a - b); if (segCount({ stack: LOOK }) > 32) { s.delete(i); L.zone.runs = [...s]; c.checked = false; toast('That would need more than the controller’s 32 segments', 'var(--warn)'); return; } changed(); renderInspector(); });
    el.querySelectorAll('[data-col]').forEach(c => { c.oninput = () => { L.src.col[+c.dataset.col] = unhex(c.value); changed(); }; c.onchange = () => renderInspector(); });
    el.querySelectorAll('[data-pal]').forEach(b => b.onclick = () => { L.src.pal = +b.dataset.pal; changed(); el.querySelectorAll('[data-pal]').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelector('[data-cpal]')?.addEventListener('change', e => { L.customPal = e.target.checked; changed(); renderInspector(); });
    el.querySelectorAll('[data-theme]').forEach(b => b.onclick = () => { const t = H.themes()[+b.dataset.theme]; if (L.cmode === 'gradient') L.stops = ST(...clone(t[1])); else { L.sw.cols = clone(t[1]); syncStops(L); } gSel = 0; changed(); renderInspector(); });
    el.querySelectorAll('[data-cm]').forEach(b => b.onclick = () => { const m = b.dataset.cm; if (m === L.cmode) return; if (m === 'swatches') L.sw = { cols: dedupeCols(L.stops.map(s => s[1])), blend: L.sw ? L.sw.blend : true }; L.cmode = m; syncStops(L); changed(); renderInspector(); });
    el.querySelectorAll('input[data-sw]').forEach(c => { const i = +c.dataset.sw; c.onclick = () => { swSel = i; el.querySelectorAll('.sw').forEach((x, k) => x.classList.toggle('sel', k === i)); }; c.oninput = () => { L.sw.cols[i] = unhex(c.value); c.parentElement.style.background = c.value; syncStops(L); changed(); }; c.onchange = () => renderInspector(); });
    el.querySelectorAll('[data-swdel]').forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); L.sw.cols.splice(+b.dataset.swdel, 1); swSel = Math.min(swSel, L.sw.cols.length - 1); syncStops(L); changed(); renderInspector(); });
    el.querySelector('[data-swadd]')?.addEventListener('click', () => { const used = new Set(L.sw.cols.map(c => c.join())), q = QUICK.find(x => !used.has(x[1].join()) && !/white/i.test(x[0])); L.sw.cols.push((q ? q[1] : [255, 170, 0]).slice()); swSel = L.sw.cols.length - 1; syncStops(L); changed(); renderInspector(); });
    el.querySelectorAll('[data-qc]').forEach(b => b.onclick = () => { L.sw.cols[swSel] = QUICK[+b.dataset.qc][1].slice(); syncStops(L); changed(); renderInspector(); });
    el.querySelector('[data-warm]')?.addEventListener('click', () => { const w = c => nearWhite(c) ? [255, Math.round(c[1] * .55), Math.round(c[2] * .18)] : c; L.stops = L.stops.map(s => [s[0], w(s[1])]); if (L.sw) L.sw.cols = L.sw.cols.map(w); if (L.src.kind === 'fx') L.src.col = L.src.col.map(w); changed(); renderInspector(); toast('Warmed the near-white colors to amber'); });
    bindGrad(L);
    el.querySelectorAll('[data-mt]').forEach(s => s.onchange = () => { L.mods[+s.dataset.mt].target = s.value; changed(); });
    el.querySelectorAll('[data-per]').forEach(s => s.oninput = () => { const i = +s.dataset.per; L.mods[i].per = posToPer(+s.value); el.querySelector('[data-o="per' + i + '"]').textContent = fmtPer(L.mods[i].per); changed(); });
    el.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => { L.mods.splice(+b.dataset.mdel, 1); changed(); renderInspector(); });
    el.querySelector('[data-madd]')?.addEventListener('click', () => { L.mods.push({ target: 'opacity', shape: 'sine', per: 10, depth: 40, phase: 0 }); changed(); renderInspector(); });
    el.querySelectorAll('[data-kv]').forEach(s => s.oninput = () => { const k = LOOK.knobs[+s.dataset.kv]; k.v = +s.value; el.querySelector('[data-o="knob' + s.dataset.kv + '"]').textContent = k.v; applyKnob(k); changed(); });
    el.querySelectorAll('[data-kn]').forEach(s => s.oninput = () => { LOOK.knobs[+s.dataset.kn].name = s.value; changed(); });
    el.querySelectorAll('[data-kdel]').forEach(b => b.onclick = () => { LOOK.knobs.splice(+b.dataset.kdel, 1); changed(); renderInspector(); });
    el.querySelector('[data-kadd]')?.addEventListener('click', () => { const L0 = LOOK.layers[LOOK.layers.length - 1], p = numericParams(L0)[1] || numericParams(L0)[0]; LOOK.knobs.push({ name: 'Knob ' + (LOOK.knobs.length + 1), v: 50, maps: [{ id: L0.id, path: p[0], min: p[2], max: p[3] }] }); changed(); renderInspector(); });
    el.querySelectorAll('[data-kmadd]').forEach(b => b.onclick = () => { const k = LOOK.knobs[+b.dataset.kmadd], L0 = LOOK.layers[0], p = numericParams(L0)[0]; k.maps.push({ id: L0.id, path: p[0], min: p[2], max: p[3] }); changed(); renderInspector(); });
    el.querySelectorAll('[data-km]').forEach(s => s.onchange = () => { const [i, j] = s.dataset.km.split(':').map(Number), [id, path] = s.value.split('|'), p = numericParams(layerById(id)).find(q => q[0] === path); Object.assign(LOOK.knobs[i].maps[j], { id, path, min: p[2], max: p[3] }); changed(); renderInspector(); });
    el.querySelectorAll('[data-kmin],[data-kmax]').forEach(s => s.onchange = () => { const key = s.dataset.kmin ? 'min' : 'max', [i, j] = (s.dataset.kmin || s.dataset.kmax).split(':').map(Number); LOOK.knobs[i].maps[j][key] = +s.value || 0; applyKnob(LOOK.knobs[i]); changed(); });
    el.querySelectorAll('[data-kmdel]').forEach(b => b.onclick = () => { const [i, j] = b.dataset.kmdel.split(':').map(Number); LOOK.knobs[i].maps.splice(j, 1); changed(); renderInspector(); });
    drawBlendDemos(); bindMotions(el, L);
  }
  function bindGrad(L) {
    const wrap = $('insp').querySelector('[data-grad]'); if (!wrap || !L) return;
    const bar = wrap.querySelector('.gbar'), sync = () => { bar.style.background = gradCss(L.stops); wrap.querySelectorAll('.gstop').forEach((s, i) => { s.style.left = L.stops[i][0] * 100 + '%'; }); };
    const sortKeep = () => { const cur = L.stops[gSel]; L.stops.sort((a, b) => a[0] - b[0]); gSel = L.stops.indexOf(cur); };
    bar.onclick = e => { const r = bar.getBoundingClientRect(), x = clamp((e.clientX - r.left) / r.width, 0, 1); if (L.stops.length >= 16) { toast('16 stops is the controller’s limit'); return; } L.stops.push([x, samp(L.stops, x).map(Math.round)]); gSel = L.stops.length - 1; sortKeep(); changed(); renderInspector(); };
    wrap.querySelectorAll('.gstop').forEach(hd => hd.onpointerdown = e => {
      e.preventDefault(); gSel = +hd.dataset.gs; wrap.querySelectorAll('.gstop').forEach(x => x.classList.toggle('sel', x === hd)); hd.setPointerCapture(e.pointerId); const r = bar.getBoundingClientRect();
      hd.onpointermove = ev => { L.stops[gSel][0] = clamp((ev.clientX - r.left) / r.width, 0, 1); sortKeep(); sync(); changed(); };
      hd.onpointerup = () => { hd.onpointermove = null; renderInspector(); };
    });
    const ci = $('insp').querySelector('[data-gcol]'); if (ci) { ci.oninput = () => { L.stops[gSel][1] = unhex(ci.value); sync(); wrap.querySelectorAll('.gstop i')[gSel].style.background = ci.value; changed(); }; ci.onchange = () => renderInspector(); }
    $('insp').querySelector('[data-gdel]')?.addEventListener('click', () => { if (L.stops.length < 2) return; L.stops.splice(gSel, 1); if (L.stops.length === 1) L.stops[0][0] = 0; gSel = 0; changed(); renderInspector(); });
    $('insp').querySelector('[data-gflip]')?.addEventListener('click', () => { L.stops = L.stops.map(s => [1 - s[0], s[1]]).reverse(); changed(); renderInspector(); });
  }
  function drawBlendDemos() {
    $('insp').querySelectorAll('canvas[data-bdemo]').forEach(c => {
      const r = c.getBoundingClientRect(); c.width = Math.round(r.width * 2); c.height = Math.round(r.height * 2); const x = c.getContext('2d'), n = 48, cw = c.width / n, d = new Float32Array(n * 3);
      const base = ST([255, 40, 0], [255, 150, 10], [200, 20, 0]), top = [40, 110, 255];
      for (let i = 0; i < n; i++) { const b = samp(base, i / (n - 1)); d[i * 3] = b[0] / 255 * .8; d[i * 3 + 1] = b[1] / 255 * .8; d[i * 3 + 2] = b[2] / 255 * .8; const w = .5 - .5 * Math.cos(i / n * 6.2832 * 2); blendPx(c.dataset.bdemo, d, i * 3, [top[0] / 255 * w, top[1] / 255 * w, top[2] / 255 * w], 1); }
      for (let i = 0; i < n; i++) { x.fillStyle = 'rgb(' + (d[i * 3] * 255 | 0) + ',' + (d[i * 3 + 1] * 255 | 0) + ',' + (d[i * 3 + 2] * 255 | 0) + ')'; x.fillRect(i * cw, 0, Math.ceil(cw), c.height); }
    });
  }
  function drawModCurves(t) {
    const L = layerById(sel); if (!L || tab !== 'mod') return;
    $('insp').querySelectorAll('canvas[data-mcv]').forEach(c => {
      const m = L.mods[+c.dataset.mcv]; if (!m) return; if (!c.width || c.width === 300) { const r = c.getBoundingClientRect(); c.width = Math.round(r.width * 2); c.height = Math.round(r.height * 2); }
      const x = c.getContext('2d'), w = c.width, h = c.height, span = m.per * 2; x.clearRect(0, 0, w, h);
      x.strokeStyle = 'rgba(90,120,190,.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
      const t0 = t - span * .75; x.strokeStyle = '#62d682'; x.lineWidth = 3; x.beginPath();
      for (let k = 0; k <= 120; k++) { const v = modVal(m, t0 + span * k / 120) * m.depth / 100, y = h / 2 - v * (h / 2 - 8); k ? x.lineTo(k / 120 * w, y) : x.moveTo(0, y); } x.stroke();
      const vx = .75 * w, vy = h / 2 - modVal(m, t) * m.depth / 100 * (h / 2 - 8); x.fillStyle = '#fff'; x.beginPath(); x.arc(vx, vy, 6, 0, 6.2832); x.fill();
    });
  }

  /* ---- picker ---- */
  let pkMode = 'add', pkTab = 'motions', pkFilt = 'all', pkCards = [], pkObs = null;
  const STROBE = new Set([1, 23, 24, 25, 26, 57, 13, 14]);
  function openPicker(mode) { pkMode = mode; $('pktitle').textContent = mode === 'swap' ? 'Change what this layer draws' : 'Add a layer'; $('pksub').textContent = mode === 'swap' ? 'Keeps its zone, blend, opacity and modulators.' : 'Pick what this layer draws. You can change colors, zone and blend after.'; $('picker').hidden = false; $('pkq').value = ''; renderPicker(); setTimeout(() => $('pkq').focus(), 30); }
  function renderPicker() {
    const q = $('pkq').value.trim().toLowerCase(); let items = [];
    const lookFx = {}; H.looks().forEach(l => { if (l.P && l.P.fx != null) lookFx[l.P.fx] = (lookFx[l.P.fx] || 0) + 1; });
    const F = pkTab === 'motions' ? [['all', 'All']].concat((g.TLMotions ? g.TLMotions.CATS : []).map(c => [c[0], c[2] + ' ' + c[1].split(' ')[0]])) : pkTab === 'fx' ? [['all', 'All'], ['lib', 'In saved looks'], ['calm', 'Calm'], ['mic', '♪ Mic'], ['flash', '⚡ Flashes']] : pkTab === 'looks' ? [['all', 'All'], ...H.cats().map(c => [c[0], c[1].split(' ')[0]])] : [];
    $('pkfilt').innerHTML = F.map(f => '<button data-f="' + f[0] + '" class="' + (pkFilt === f[0] ? 'on' : '') + '">' + esc(f[1]) + '</button>').join(''); $('pkfilt').style.display = F.length ? '' : 'none';
    const selL = layerById(sel), pcols = selL ? layerCols(selL) : [], pblend = selL && selL.sw ? selL.sw.blend : true;
    if (pkTab === 'motions') items = g.TLMotions.LIST.filter(m => pkFilt === 'all' || m.cat === pkFilt).map(m => ({ name: m.name, desc: m.desc, tags: [[m.kind === 'shape' ? 'n' : '', m.kind === 'shape' ? 'Studio' : 'controller fx']], prev: { kind: 'motion', id: m.id, P: { stack: { layers: [g.TLMotions.layer(m.id, pcols.length ? pcols : [[255, 120, 20], [255, 60, 0]], pblend, .4, .5)], knobs: [] } } } }));
    else if (pkTab === 'studio') items = Object.entries(SHAPES).map(([k, s]) => ({ name: s.icon + ' ' + s.name, desc: s.desc, tags: [['n', H.shapeFx(s.fw) != null ? 'runs on the controller' : 'needs Studio firmware extensions']], prev: { kind: 'shape', type: k } }));
    else if (pkTab === 'fx') {
      items = FXL.supported.map(id => ({ id, n: fxName(id), m: fxMeta(id) })).filter(o => !(pkFilt === 'lib' && !lookFx[o.id]) && !(pkFilt === 'mic' && !o.m.audio) && !(pkFilt === 'flash' && !STROBE.has(o.id)) && !(pkFilt === 'calm' && (STROBE.has(o.id) || o.m.audio)))
        .sort((a, b) => (lookFx[b.id] || 0) - (lookFx[a.id] || 0) || a.n.localeCompare(b.n))
        .map(o => ({ name: o.n, em: '#' + o.id, desc: o.m.ctl.filter(c => !c.bool).map(c => c.label).slice(0, 3).join(' · ') || 'No sliders', tags: [lookFx[o.id] ? ['', 'in ' + lookFx[o.id] + ' of saved looks'] : null, o.m.audio ? ['', '♪ mic'] : null, STROBE.has(o.id) ? ['f', '⚡ flashes'] : null].filter(Boolean), prev: { kind: 'fx', fx: o.id } }));
    } else items = H.looks().filter(l => !isStack(l.P) && !(l.P.parts) && (pkFilt === 'all' || (l.cats || []).includes(pkFilt))).map(l => ({ name: l.name, desc: l.desc || '', tags: [['', fxName(l.P.fx)]], prev: { kind: 'look', l } }));
    if (q) items = items.filter(i => (i.name + ' ' + i.desc + ' ' + (i.em || '')).toLowerCase().includes(q));
    $('pkgrid').innerHTML = items.length ? items.map((it, i) => '<button class="pcard' + (pkTab === 'studio' ? ' big' : '') + '" data-pk="' + i + '"><canvas></canvas><b>' + esc(it.name) + (it.em ? ' <em>' + it.em + '</em>' : '') + '</b><small>' + esc(it.desc) + '</small>' + (it.tags.length ? '<div class="tg">' + it.tags.map(t => '<span class="' + t[0] + '">' + esc(t[1]) + '</span>').join('') + '</div>' : '') + '</button>').join('') : '<p style="color:var(--muted)">Nothing matches.</p>';
    if (pkObs) pkObs.disconnect();
    pkObs = new IntersectionObserver(es => es.forEach(en => { const c = pkCards.find(x => x.el === en.target); if (c) c.vis = en.isIntersecting; }), { root: $('picker') });
    pkCards = [...$('pkgrid').querySelectorAll('.pcard')].map((el, i) => ({ el, it: items[i], cv: el.querySelector('canvas'), vis: false, S: { seed: i * 31 + 5 }, inst: null, buf: new Float32Array(64 * 3), clk: 0, ms: 0 }));
    pkCards.forEach(c => pkObs.observe(c.el));
    $('pkgrid').onclick = e => { const b = e.target.closest('[data-pk]'); if (b) choose(items[+b.dataset.pk]); };
  }
  const PK_STOPS = ST([255, 70, 0], [255, 150, 20], [200, 20, 40]);
  function drawPicker(dt) {
    if ($('picker').hidden) return; const n = 64;
    for (const c of pkCards) {
      if (!c.vis) continue; const pv = c.it.prev; c.clk += dt; c.ms += dt * 1000;
      if (pv.kind === 'motion') { stripN(c.cv, render(c.v || (c.v = {}), pv.P, c.ms)); continue; }
      if (pv.kind === 'shape') { const p = shapeDefaults(pv.type); if (pv.type === 'comets') { p.tail = 10; p.count = 2; } if (pv.type === 'waves') p.count = 1.5; if (pv.type === 'noise') p.scale = 7; if (pv.type === 'glints') p.rate = 30; renderShape(pv.type, p, PK_STOPS, n, c.clk, dt, c.S, c.buf); }
      else { const P = pv.kind === 'look' ? H.lookSrc(pv.l) : Object.assign({ sx: 128, ix: 128, pal: 0, col: [[255, 120, 0], [120, 0, 40], [0, 0, 0]] }, fxMeta(pv.fx).defs); const fx = pv.kind === 'look' ? P.fx : pv.fx; if (!c.inst) c.inst = FXL.create(fx, n);
        const raw = c.inst.render({ sx: P.sx, ix: P.ix, c1: P.c1 ?? 128, c2: P.c2 ?? 128, c3: P.c3 ?? 16, o1: !!P.o1, o2: !!P.o2, o3: !!P.o3, pal: P.pal ?? 0, col: P.col || [[255, 120, 0], [0, 0, 0], [0, 0, 0]], grp: 1, spc: P.spc || 0, bri: 255, audio: fxMeta(fx).audio ? fakeAudio(c.ms / 1000) : undefined }, c.ms); for (let i = 0; i < n * 3; i++) c.buf[i] = UNG[raw[i]] / 255; }
      const cv = c.cv; if (!cv.width || cv.width === 300) { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * 2) || 200; cv.height = Math.round(r.height * 2) || 12; }
      const x = cv.getContext('2d'), cw = cv.width / n; x.fillStyle = '#05070d'; x.fillRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < n; i++) { x.fillStyle = 'rgb(' + (c.buf[i * 3] * 255 | 0) + ',' + (c.buf[i * 3 + 1] * 255 | 0) + ',' + (c.buf[i * 3 + 2] * 255 | 0) + ')'; x.fillRect(i * cw + .5, 0, Math.ceil(cw) - 1, cv.height); }
    }
  }
  function layerFromLook(l) {
    const s = H.lookSrc(l), L = mkFx(s.fx, l.name, { src: { sx: s.sx, ix: s.ix, c1: s.c1 ?? 128, c2: s.c2 ?? 128, c3: s.c3 ?? 16, o1: !!s.o1, o2: !!s.o2, o3: !!s.o3, pal: s.pal, col: clone(s.col) } });
    if (s.cpal) { L.customPal = true; L.stops = s.cpal.map(([p, c]) => [p / 255, c.slice(0, 3)]); L.cmode = 'gradient'; L.sw = { cols: dedupeCols(L.stops.map(x => x[1])), blend: true }; }
    if (s.spc) { L.zone.spc = s.spc; } if (s.slow > 1) L.motion.slow = s.slow; L.motion.rev = !!s.rev; L.motion.mi = !!s.mi;
    return L;
  }
  function choose(it) {
    const pv = it.prev; let L;
    if (pv.kind === 'motion') { if (pkMode === 'swap') { g.TLMotions.apply(layerById(sel), pv.id); $('picker').hidden = true; changed(true); toast('Layer now runs ' + it.name); return; } const src = layerById(sel), cols = src ? layerCols(src) : []; L = g.TLMotions.layer(pv.id, cols.length ? cols : [[255, 120, 20], [255, 60, 0]], src && src.sw ? src.sw.blend : true, .4, .5); L.blend = LOOK.layers.length ? 'screen' : 'cover'; }
    else if (pv.kind === 'shape') L = mkShape(pv.type, SHAPES[pv.type].name, { blend: LOOK.layers.length ? 'add' : 'cover', stops: ST([255, 120, 20], [255, 60, 0]) });
    else if (pv.kind === 'fx') L = mkFx(pv.fx, fxName(pv.fx), { blend: LOOK.layers.length ? 'screen' : 'cover' });
    else { L = layerFromLook(pv.l); L.blend = LOOK.layers.length ? 'screen' : 'cover'; }
    if (pkMode === 'swap') { const old = layerById(sel); Object.assign(old, { src: L.src, name: L.name, customPal: L.customPal || false }); if (L.customPal) { old.stops = L.stops; old.cmode = L.cmode; old.sw = L.sw; } old.mods = old.mods.filter(m => modTargets(old).some(t => t[0] === m.target)); tab = 'source'; }
    else { const si = LOOK.layers.findIndex(l => l.id === sel); LOOK.layers.splice(si >= 0 ? si + 1 : LOOK.layers.length, 0, L); sel = L.id; tab = 'source'; if (segCount({ stack: LOOK }) > 32) { LOOK.layers.splice(LOOK.layers.indexOf(L), 1); sel = LOOK.layers[LOOK.layers.length - 1].id; toast('That would need more than the controller’s 32 segments', 'var(--warn)'); $('picker').hidden = true; return; } }
    $('picker').hidden = true; changed(true); toast(pkMode === 'swap' ? 'Layer now draws ' + it.name.replace(/^\S+ /, '') : 'Added “' + L.name + '” above the selected layer');
  }

  /* ---- editing where a layer plays, right on its lane ---- */
  let laneDrag = null, laneJustDragged = false, laneOrderId = null;
  const runEdges = () => [0].concat(RUNS.map(r => r.start + r.len));
  const snapB = b => { for (const e of runEdges()) if (Math.abs(e - b) <= 2) return e; return b; };
  function normRanges(rs) {
    rs = rs.map(r => { const st = clamp(Math.round(r.start), 0, N - 1); return { start: st, len: clamp(Math.round(r.len), 1, N - st) }; }).sort((a, b) => a.start - b.start);
    const out = []; for (const r of rs) { const l = out[out.length - 1]; if (l && r.start <= l.start + l.len) l.len = Math.max(l.len, r.start + r.len - l.start); else out.push(Object.assign({}, r)); } return out;
  }
  function settleZone(L) {   // ranges that are exactly whole stretches go back to being stretches
    if (!L.zone.custom) return; const rs = normRanges(L.zone.custom), runs = RUNS.map((r, i) => rs.some(g => r.start >= g.start && r.start + r.len <= g.start + g.len) ? i : -1).filter(i => i >= 0);
    const back = normRanges(runs.map(i => ({ start: RUNS[i].start, len: RUNS[i].len })));
    if (runs.length && JSON.stringify(back) === JSON.stringify(rs)) { L.zone.runs = runs; delete L.zone.custom; } else L.zone.custom = rs;
  }
  const laneB = (e, cv) => { const r = cv.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width * N, 0, N); };
  function laneHit(L, b, cv) {
    const tol = Math.max(1.2, 7 / (cv.getBoundingClientRect().width / N)), rs = ranges(L);
    for (let k = 0; k < rs.length; k++) { if (Math.abs(b - rs[k].start) <= tol) return { k, mode: 'l' }; if (Math.abs(b - (rs[k].start + rs[k].len)) <= tol) return { k, mode: 'r' }; }
    for (let k = 0; k < rs.length; k++) if (b > rs[k].start && b < rs[k].start + rs[k].len) return { k, mode: 'move' };
    return null;
  }
  function bindLaneEditing() {
    const box = $('lanes');
    box.addEventListener('pointerdown', e => {
      const cv = e.target.closest('canvas'), ln = cv && cv.closest('[data-lane]'); if (!ln || ln.dataset.lane === 'comp') return;
      const L = layerById(ln.dataset.lane); if (!L) return; e.preventDefault();
      if (sel !== L.id) { sel = L.id; swSel = 0; gSel = 0; renderLayers(); renderInspector(); box.querySelectorAll('.lane').forEach(x => x.classList.toggle('sel', x.dataset.lane === sel)); }
      const b = laneB(e, cv); let hit = laneHit(L, b, cv); const rs0 = ranges(L);
      if (e.altKey || (hit && hit.mode === 'move' && rs0[hit.k].len >= N)) hit = null;   // ⌥, or a layer covering the whole roof: draw a new range
      laneDrag = { L, cv, b0: b, rs0, zone0: clone(L.zone), hit, add: e.shiftKey, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', e => {
      const cv = e.target.closest('canvas');
      if (!laneDrag) { const ln = cv && cv.closest('[data-lane]'), L = ln && layerById(ln.dataset.lane); if (cv) { const h = L && laneHit(L, laneB(e, cv), cv); cv.style.cursor = !L ? 'crosshair' : h ? (h.mode === 'move' ? 'grab' : 'ew-resize') : 'copy'; } return; }
      const d = laneDrag, b = laneB(e, d.cv); if (!d.moved && Math.abs(b - d.b0) < .6) return; d.moved = true;
      let rs = d.rs0.map(r => Object.assign({}, r));
      if (d.hit && d.hit.mode === 'move') { const r = rs[d.hit.k]; r.start = clamp(Math.round(r.start + (b - d.b0)), 0, N - r.len); const s1 = snapB(r.start), s2 = snapB(r.start + r.len); if (s1 !== r.start && s1 + r.len <= N) r.start = s1; else if (s2 !== r.start + r.len && s2 - r.len >= 0) r.start = s2 - r.len; d.cv.style.cursor = 'grabbing'; }
      else if (d.hit) { const r = rs[d.hit.k], end = r.start + r.len, bb = snapB(Math.round(b)); if (d.hit.mode === 'l') { const ns = clamp(bb, 0, end - 1); r.len = end - ns; r.start = ns; } else r.len = clamp(bb, r.start + 1, N) - r.start; }
      else { const a = snapB(Math.round(Math.min(b, d.b0))), z = snapB(Math.round(Math.max(b, d.b0))), nr = { start: a, len: Math.max(1, z - a) }; rs = d.add ? rs.concat([nr]) : [nr]; }
      d.L.zone.custom = normRanges(rs); LOOK.dirty = true;
      const t = $('tip'), r0 = d.cv.getBoundingClientRect(), st = $('stage').getBoundingClientRect(); t.style.display = 'none';
      d.cv.title = d.L.zone.custom.map(r => 'bulbs ' + (r.start + 1) + '–' + (r.start + r.len)).join(', ');
      renderStats(); renderJSON(); void r0; void st;
    });
    const end = () => {
      const d = laneDrag; laneDrag = null; if (!d) return; if (!d.moved) return;
      laneJustDragged = true; setTimeout(() => laneJustDragged = false, 50);
      settleZone(d.L);
      if (segCount({ stack: LOOK }) > 32) { d.L.zone = d.zone0; toast('That would need more than the controller’s 32 segments', 'var(--warn)'); }
      changed(true); toast('“' + d.L.name + '” now plays on ' + zoneLabel(d.L).replace(/^Bulbs/, 'bulbs') + '. Double-click its lane to go back to whole stretches.');
    };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
    box.addEventListener('dblclick', e => { const ln = e.target.closest('[data-lane]'), L = ln && layerById(ln.dataset.lane); if (!L || !L.zone.custom) return; delete L.zone.custom; changed(true); toast('“' + L.name + '” is back on its stretches of roof'); });
    // drag a lane's name up/down to reorder layers (top lane = top layer)
    box.addEventListener('dragstart', e => { const ln = e.target.closest('[data-lane]'); if (!ln || ln.dataset.lane === 'comp') return; laneOrderId = ln.dataset.lane; e.dataTransfer.effectAllowed = 'move'; });
    box.addEventListener('dragover', e => { const ln = e.target.closest('[data-lane]'); if (!ln || !laneOrderId || ln.dataset.lane === 'comp') return; e.preventDefault(); box.querySelectorAll('.lane').forEach(x => x.style.boxShadow = ''); const r = ln.getBoundingClientRect(); ln.style.boxShadow = (e.clientY < r.top + r.height / 2 ? '0 -2px 0 #62d682' : '0 2px 0 #62d682'); ln.dataset.above = e.clientY < r.top + r.height / 2 ? '1' : ''; });
    box.addEventListener('drop', e => { const ln = e.target.closest('[data-lane]'); box.querySelectorAll('.lane').forEach(x => x.style.boxShadow = ''); if (!ln || !laneOrderId || ln.dataset.lane === 'comp') return; e.preventDefault(); const L = layerById(laneOrderId), T = layerById(ln.dataset.lane); laneOrderId = null; if (!L || L === T) return; LOOK.layers.splice(LOOK.layers.indexOf(L), 1); const ti = LOOK.layers.indexOf(T); LOOK.layers.splice(ln.dataset.above ? ti + 1 : ti, 0, L); changed(true); });
    box.addEventListener('dragend', () => { laneOrderId = null; box.querySelectorAll('.lane').forEach(x => x.style.boxShadow = ''); });
  }
  /* ---- lanes / ticks / time map ---- */
  let laneCvs = [];
  function renderLanes() {
    const rows = [{ id: 'comp', comp: true }].concat(LOOK.layers.slice().reverse().map(l => ({ id: l.id, l })));
    $('lanes').innerHTML = rows.map(r => '<div class="lane' + (r.comp ? ' comp' : '') + (r.id === sel ? ' sel' : '') + '" data-lane="' + r.id + '"><span' + (r.comp ? '' : ' draggable="true" title="Drag up or down to reorder"') + '>' + (r.comp ? '<b>The mix</b> · what the roof shows' : esc(r.l.name) + (r.l.on ? '' : ' (hidden)') + ' · ' + BLENDS[r.l.blend].name) + '</span><canvas></canvas></div>').join('');
    laneCvs = [...$('lanes').querySelectorAll('canvas')].map((c, i) => ({ c, id: rows[i].id, w: 0 }));
    drawTicks();
  }
  function drawLanes(comp) {
    for (const lc of laneCvs) {
      const c = lc.c; if (!lc.w) { const r = c.getBoundingClientRect(); lc.w = c.width = Math.round(r.width * 2); lc.h = c.height = Math.round(r.height * 2); }
      const x = c.getContext('2d'), w = lc.w, h = lc.h, cw = w / N; x.fillStyle = '#05070d'; x.fillRect(0, 0, w, h);
      const o = lc.id === 'comp' ? null : PS.out && PS.out[lc.id];
      for (let i = 0; i < N; i++) {
        let r, gg, b, a = 1;
        if (lc.id === 'comp') { r = comp[i * 3]; gg = comp[i * 3 + 1]; b = comp[i * 3 + 2]; }
        else { if (!o) continue; a = o[i * 4 + 3]; if (a <= 0) { x.fillStyle = (i & 1) ? '#0b101c' : '#080c16'; x.fillRect(i * cw, 0, Math.ceil(cw), h); continue; } r = o[i * 4] * a; gg = o[i * 4 + 1] * a; b = o[i * 4 + 2] * a; }
        x.fillStyle = 'rgb(' + (r * 255 | 0) + ',' + (gg * 255 | 0) + ',' + (b * 255 | 0) + ')'; x.fillRect(i * cw + (cw > 3 ? .5 : 0), 0, Math.max(1, Math.ceil(cw) - (cw > 3 ? 1 : 0)), h);
      }
      if (hoverBulb >= 0) { x.strokeStyle = 'rgba(255,225,170,.9)'; x.lineWidth = 2; x.strokeRect(hoverBulb * cw + .5, .5, cw, h - 1); }
      if (lc.id !== 'comp' && lc.id === sel) { const L = layerById(lc.id); if (L) ranges(L).forEach(rg => { const x0 = rg.start * cw, x1 = (rg.start + rg.len) * cw; x.strokeStyle = 'rgba(255,179,71,.95)'; x.lineWidth = 2; x.strokeRect(x0 + 1, 1, x1 - x0 - 2, h - 2); x.fillStyle = '#fff'; x.fillRect(x0, 0, 4, h); x.fillRect(x1 - 4, 0, 4, h); }); }
      RUNS.forEach(rn => { if (!rn.start) return; x.fillStyle = 'rgba(0,0,0,.85)'; x.fillRect(rn.start * cw - 1, 0, 2, h); });
    }
  }
  function drawTicks() {
    const c = $('ticks'), r = c.getBoundingClientRect(); if (!r.width) return; const D = 2; c.width = r.width * D; c.height = r.height * D; const x = c.getContext('2d'), cw = c.width / N;
    x.font = (10 * D) + 'px Inter, system-ui, sans-serif'; x.textBaseline = 'top';
    RUNS.forEach(rn => { const x0 = rn.start * cw, x1 = (rn.start + rn.len) * cw; x.fillStyle = 'rgba(120,140,190,.5)'; x.fillRect(x0, 0, D, 7 * D); x.fillStyle = ['#62d682', '#7fb3ff', '#8affc8'][rn.port - 1] || '#aaa'; x.fillRect(x0 + 2 * D, 2 * D, x1 - x0 - 4 * D, 2 * D);
      const label = rn.len >= 12 ? rn.name.replace(/ · /g, ' ') : ''; x.fillStyle = '#8d9aba'; const tw = x.measureText(label).width; if (label && tw < x1 - x0 - 4) x.fillText(label, (x0 + x1) / 2 - tw / 2, 10 * D); else if (label) { const s = rn.name.split(' ').slice(-1)[0], t2 = x.measureText(s).width; if (t2 < x1 - x0) x.fillText(s, (x0 + x1) / 2 - t2 / 2, 10 * D); } });
    x.fillStyle = '#6f8175'; PORTS.forEach(p => { const r0 = RUNS[p.runs[0]]; x.fillText('Output ' + p.port + ' (' + p.n + ')', r0.start * cw + 3, 21 * D); });
  }
  let tmClear = true, tmAcc = 0, tmRow = null;
  function drawTM(comp, dt) {
    const tm = $('tm'), tx = tm.getContext('2d'); if (tm.width !== N) { tm.width = N; tmClear = true; } if (!tmRow) tmRow = tx.createImageData(N, 1);
    if (tmClear) { tx.fillStyle = '#05070d'; tx.fillRect(0, 0, tm.width, tm.height); tmClear = false; }
    tmAcc += dt; if (tmAcc < .04) return; tmAcc = 0;
    tx.drawImage(tm, 0, 0, tm.width, tm.height - 1, 0, 1, tm.width, tm.height - 1);
    for (let i = 0; i < N; i++) { tmRow.data[i * 4] = comp[i * 3] * 255; tmRow.data[i * 4 + 1] = comp[i * 3 + 1] * 255; tmRow.data[i * 4 + 2] = comp[i * 3 + 2] * 255; tmRow.data[i * 4 + 3] = 255; }
    tx.putImageData(tmRow, 0, 0);
  }

  /* ---- stage ---- */
  const px = l => [l.x * SV.k + SV.ox, l.y * SV.k + SV.oy];
  function bulbAt(cx, cy) { if (!SV.k) return -1; let best = -1, bd = 1e9; const LEDS = H.leds(); for (let i = 0; i < N; i++) { const [x, y] = px(LEDS[i]), d = (x - cx) ** 2 + (y - cy) ** 2; if (d < bd) { bd = d; best = i; } } return bd < (24 * SV.dpr) ** 2 ? best : -1; }
  function litBy(i) { return LOOK.layers.slice().reverse().filter(L => { const o = PS.out && PS.out[L.id]; return L.on && o && o[i * 4 + 3] > 0 && Math.max(o[i * 4], o[i * 4 + 1], o[i * 4 + 2]) * o[i * 4 + 3] > .03; }); }
  function drawOverlay() {
    const ctx = SV.ctx, LEDS = H.leds(), L = layerById(sel), o = L && PS.out && PS.out[L.id];
    if (showZone && o) { ctx.strokeStyle = 'rgba(255,179,71,.85)'; ctx.lineWidth = 1.2 * SV.dpr; for (let i = 0; i < N; i++) { if (o[i * 4 + 3] <= 0) continue; const [x, y] = px(LEDS[i]); ctx.beginPath(); ctx.arc(x, y, 6.5 * SV.dpr, 0, 6.2832); ctx.stroke(); } }
    if (hoverBulb >= 0) { const [x, y] = px(LEDS[hoverBulb]); ctx.strokeStyle = 'rgba(255,225,170,.95)'; ctx.lineWidth = 1.6 * SV.dpr; ctx.beginPath(); ctx.arc(x, y, 9 * SV.dpr, 0, 6.2832); ctx.stroke(); }
  }

  /* ---- loop ---- */
  let slowAcc = 0, pwAcc = 0; const dbuf = () => SV._d && SV._d.length === N * 3 ? SV._d : (SV._d = new Uint8Array(N * 3));
  function frame(now) {
    if (!active) { raf = 0; return; }
    let dt = Math.min(.1, (now - (last || now)) / 1000); last = now; const real = dt; if (!playing) dt = 0; dt *= rate; tReal += dt;
    const comp = renderStackInto(PS, LOOK.layers, tReal, dt, view === 'solo' ? { solo: sel } : null);
    const d = dbuf(); for (let i = 0; i < N * 3; i++) d[i] = comp[i] * 255 + .5;
    H.drawHouse(SV, d, LOOK.bri); drawOverlay(); drawLanes(comp); drawTM(comp, dt); drawPicker(dt); drawModCurves(tReal); drawMotionCards(real);
    pwAcc += dt; if (pwAcc > .05) { pwAcc = 0; samplePower(comp); }
    slowAcc += real; if (slowAcc > .25) { slowAcc = 0; drawMinis(); renderPower(); syncFw(); }
    raf = requestAnimationFrame(frame);
  }
  function syncFw() {
    const ok = H.fwLayers(), el = $('fw'); el.textContent = ok ? 'Controller ready · ' + H.fwVer() : H.fwVer() ? 'Controller runs ' + H.fwVer() + ': needs Studio firmware extensions to push' : 'Controller offline'; el.className = 'chip ' + (ok ? 'ok' : 'fw');
    $('push').disabled = !ok; $('push').title = ok ? '' : 'Needs Studio firmware extensions on the controller';
  }
  function renderAll() { renderLayers(); renderLanes(); renderInspector(); renderJSON(); $('crumb').textContent = LOOK.id ? 'Builder · your look' : 'Builder · new look'; }

  const fillRange = r => r.style.setProperty('--v', ((r.value - r.min) / ((r.max - r.min) || 1) * 100) + '%');   // the app's slider style fills up to --v
  const fillRanges = el => el.querySelectorAll('input[type=range]').forEach(fillRange);
  /* ---- save / push ---- */
  function lookP() { const L = clone(LOOK); delete L.dirty; const P = { stack: { layers: L.layers, knobs: L.knobs }, bri: L.bri, fade: L.fade }; return P; }
  function save() {
    const desc = LOOK.layers.slice().reverse().map(l => l.name).join(' · ');
    LOOK.id = H.saveLook({ id: LOOK.id, name: LOOK.name || 'My look', desc, P: lookP() }); LOOK.dirty = false;
    history.replaceState(null, '', location.href.split('#')[0] + '#builder=' + LOOK.id); renderAll(); saveDraft();
    return LOOK.id;
  }

  /* ---- mount ---- */
  function mount() {
    if (mounted) return; mounted = true;
    const sec = document.getElementById('builder'); sec.innerHTML = MARKUP;
    sec.addEventListener('input', e => { if (e.target.type === 'range') fillRange(e.target); });
    SV = H.makeView($('cv'));
    $('recipes').innerHTML = Object.keys(RECIPES).map(n => '<button data-rec="' + esc(n) + '">' + esc(n) + '</button>').join('');
    $('recipes').onclick = e => { const b = e.target.closest('[data-rec]'); if (!b) return; if (LOOK && LOOK.dirty && !confirmLeave()) return; newLook(b.dataset.rec); history.replaceState(null, '', location.href.split('#')[0] + '#builder'); toast('Started from “' + b.dataset.rec + '”. Every layer is yours to change.'); };
    $('layers').addEventListener('click', e => {
      const t = e.target.closest('button'), row = e.target.closest('.layer'); if (!row) return; const id = row.dataset.id, L = layerById(id);
      if (t && t.dataset.eye) { L.on = !L.on; changed(); return; }
      if (t && t.dataset.dup) { const c = clone(L); c.id = nid(); c.name = L.name + ' copy'; LOOK.layers.splice(LOOK.layers.indexOf(L) + 1, 0, c); if (segCount({ stack: LOOK }) > 32) { LOOK.layers.splice(LOOK.layers.indexOf(c), 1); toast('That would need more than the controller’s 32 segments', 'var(--warn)'); return; } if (LOOK.layers.length > 8) { LOOK.layers.splice(LOOK.layers.indexOf(c), 1); toast('8 layers is the most the controller blends smoothly', 'var(--warn)'); return; } sel = c.id; changed(true); return; }
      if (t && t.dataset.del) { if (LOOK.layers.length === 1) { toast('A look needs at least one layer'); return; } LOOK.layers.splice(LOOK.layers.indexOf(L), 1); LOOK.knobs.forEach(k => k.maps = k.maps.filter(m => m.id !== id)); if (sel === id) sel = LOOK.layers[LOOK.layers.length - 1].id; changed(true); toast('Deleted “' + L.name + '”. ⌘Z brings it back.'); return; }
      select(id);
    });
    let dragId = null; const clr = () => $('layers').querySelectorAll('.layer').forEach(x => x.classList.remove('drop-above', 'drop-below'));
    $('layers').addEventListener('dragstart', e => { const r = e.target.closest('.layer'); if (!r) return; dragId = r.dataset.id; e.dataTransfer.effectAllowed = 'move'; });
    $('layers').addEventListener('dragover', e => { const r = e.target.closest('.layer'); if (!r || !dragId) return; e.preventDefault(); const b = r.getBoundingClientRect(); clr(); r.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-above' : 'drop-below'); });
    $('layers').addEventListener('drop', e => { const r = e.target.closest('.layer'); if (!r || !dragId) return; e.preventDefault(); const above = r.classList.contains('drop-above'), L = layerById(dragId), T = layerById(r.dataset.id); dragId = null; clr(); if (!L || L === T) return; LOOK.layers.splice(LOOK.layers.indexOf(L), 1); const ti = LOOK.layers.indexOf(T); LOOK.layers.splice(above ? ti + 1 : ti, 0, L); changed(true); });
    $('layers').addEventListener('dragend', () => { dragId = null; clr(); });
    $('lookrow').onclick = () => select('look');
    $('add').onclick = () => { if (LOOK.layers.length >= 8) { toast('8 layers is the most the controller blends smoothly', 'var(--warn)'); return; } openPicker('add'); };
    $('pkclose').onclick = () => $('picker').hidden = true;
    $('picker').onclick = e => { if (e.target === $('picker')) $('picker').hidden = true; };
    $('pktabs').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; pkTab = b.dataset.t; pkFilt = 'all'; $('pktabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); renderPicker(); };
    $('pkq').oninput = () => renderPicker();
    $('pkfilt').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; pkFilt = b.dataset.f; renderPicker(); };
    $('stage').addEventListener('pointermove', e => { const r = SV.canvas.getBoundingClientRect(), i = bulbAt((e.clientX - r.left) * SV.dpr, (e.clientY - r.top) * SV.dpr); hoverBulb = i; const t = $('tip'); if (i < 0) { t.style.display = 'none'; return; } const [x, y] = px(H.leds()[i]), ls = litBy(i); t.innerHTML = 'Bulb ' + (i + 1) + ' · ' + esc(RUNS[H.leds()[i].run]?.name || '') + '<small>' + (ls.length ? 'Lit by ' + ls.map(L => esc(L.name)).join(', ') : 'Dark right now') + ' · click to select</small>'; t.style.left = x / SV.dpr + 'px'; t.style.top = y / SV.dpr + 'px'; t.style.display = 'block'; });
    $('stage').addEventListener('pointerleave', () => { hoverBulb = -1; $('tip').style.display = 'none'; });
    $('cv').addEventListener('click', () => { if (hoverBulb < 0) return; const ls = litBy(hoverBulb); if (ls.length) select(ls[0].id); });
    $('lanes').addEventListener('pointermove', e => { const c = e.target.closest('canvas'); if (!c) return; const r = c.getBoundingClientRect(); hoverBulb = clamp(Math.floor((e.clientX - r.left) / r.width * N), 0, N - 1); });
    $('lanes').addEventListener('pointerleave', () => { hoverBulb = -1; });
    bindLaneEditing();
    $('lanes').addEventListener('click', e => { if (laneJustDragged) { laneJustDragged = false; return; } const ln = e.target.closest('[data-lane]'); if (!ln) return; if (ln.dataset.lane === 'comp') { const ls = hoverBulb >= 0 ? litBy(hoverBulb) : []; if (ls.length) select(ls[0].id); } else select(ln.dataset.lane); });
    $('play').onclick = e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.play) { playing = !playing; b.textContent = playing ? '❚❚' : '▶'; b.classList.toggle('on', playing); } else { PS = { inst: {}, clk: {}, ms: {} }; tReal = 0; tmClear = true; } };
    $('rate').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; rate = +b.dataset.r; $('rate').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('tag').textContent = rate === 1 ? 'Preview · same maths as the controller' : 'Preview at ' + b.textContent + ' (the roof runs at 1×)'; };
    $('view').onclick = e => { const b = e.target.closest('[data-v]'); if (!b) return; view = b.dataset.v; $('view').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); };
    $('zone').onclick = () => { showZone = !showZone; $('zone').classList.toggle('on', showZone); };
    $('name').oninput = e => { LOOK.name = e.target.value; LOOK.dirty = true; snap(); const i = $('insp').querySelector('[data-lname]'); if (i) i.value = LOOK.name; };
    $('undo').onclick = undo; $('redo').onclick = redo;
    $('back').onclick = () => H.goLibrary();
    $('new').onclick = () => { if (LOOK.dirty && !confirmLeave()) return; newLook('Blank'); history.replaceState(null, '', location.href.split('#')[0] + '#builder'); };
    $('ask').onclick = () => {
      if (!g.TLAsk) return toast('Ask AI didn’t load', 'var(--warn)');
      g.TLAsk.open({ name: LOOK.name, P: { stack: { layers: LOOK.layers, knobs: LOOK.knobs }, bri: LOOK.bri }, onApply: (P2, o) => {
        LOOK.layers = P2.stack.layers; LOOK.knobs = P2.stack.knobs || []; LOOK.bri = P2.bri ?? LOOK.bri;
        if (sel !== 'look' && !layerById(sel)) sel = LOOK.layers[LOOK.layers.length - 1].id;
        changed(true); toast('Applied “' + o.title + '”. ⌘Z undoes it.', 'var(--accent)');
      } });
    };
    $('save').onclick = () => { save(); toast('Saved “' + LOOK.name + '” to Saved looks', 'var(--accent)'); };
    $('push').onclick = async () => {
      if (segCount({ stack: LOOK }) > 32) return toast('More than 32 segments: remove a layer or a stretch', 'var(--warn)');
      const id = save(); $('push').disabled = true;
      try { await H.push(id); toast(LOOK.name + ' is fading onto the house'); } catch (err) { toast('Push failed: ' + err.message, 'var(--warn)'); }
      $('push').disabled = false;
    };
    addEventListener('resize', () => { if (laneCvs) laneCvs.forEach(c => c.w = 0); if (active) drawTicks(); });
    document.addEventListener('keydown', e => {
      if (!active) return;
      const ae = document.activeElement, inField = /INPUT|TEXTAREA|SELECT/.test(ae.tagName) && ae.type !== 'range' && ae.type !== 'checkbox';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (e.key === 'Escape') $('picker').hidden = true;
      if (inField) return;
      if (e.key === ' ') { e.preventDefault(); $('play').querySelector('[data-play]').click(); }
    });
  }
  let pendingDraft = null;
  const confirmLeave = () => window.confirm('Start over? Your unsaved changes to “' + LOOK.name + '” will be lost.');

  /* ======================= public ======================= */
  g.TLBuilder = {
    isStack, render, segments, matches, segCount, SHAPES, BLENDS, QUICK,
    make: { shape: (...a) => mkShape(...a), fx: (...a) => mkFx(...a), swToStops, ST },
    zoneGroups: () => ZONE_GROUPS, runs: () => RUNS, refreshZones: zoneGroups,
    init(host) {
      H = host; FXL = host.FXL; RUNS = host.runs().map(r => ({ name: r.name, port: r.port, start: r.start, len: r.stop - r.start })); N = host.N;
      zoneGroups();
      PORTS = [...new Set(RUNS.map(r => r.port))].sort().map(p => ({ port: p, runs: RUNS.map((r, i) => r.port === p ? i : -1).filter(i => i >= 0) }));
      PORTS.forEach(p => { p.n = p.runs.reduce((a, i) => a + RUNS[i].len, 0); });
    },
    // the app's look (non-stack) → a one-layer stack, for "Open in Builder"
    fromLook(l) { return { layers: [Object.assign(layerFromLook(l), { blend: 'cover' })], knobs: [] }; },
    openDraft(d) { pendingDraft = d; },
    open(id) {
      mount(); active = true;
      if (pendingDraft) { const d = pendingDraft; pendingDraft = null; LOOK = Object.assign({ recipe: null }, clone(d)); afterLoad(); LOOK.dirty = true; syncFw(); last = 0; if (!raf) raf = requestAnimationFrame(frame); return; }
      const l = id && H.lookById(id);
      if (l && isStack(l.P)) { if (!LOOK || LOOK.id !== l.id) { LOOK = Object.assign({ id: l.id, name: l.name, bri: l.P.bri ?? 200, fade: l.P.fade ?? 2, recipe: null }, clone(l.P.stack)); afterLoad(); } }
      else if (l) { LOOK = Object.assign({ id: null, name: l.name + ' (layers)', bri: l.P.bri ?? 180, fade: 2, recipe: null }, this.fromLook(l)); afterLoad(); }
      else if (!LOOK) { let d = H.loadDraft ? H.loadDraft() : null; if (!d) { try { d = JSON.parse(localStorage.getItem('tls-builder-draft') || 'null'); } catch { } if (d && H.saveDraft) H.saveDraft(clone(d)); } if (d && d.layers && d.layers.length) { LOOK = d; afterLoad(); LOOK.dirty = d.dirty; } else newLook('Ember Comets'); }
      else renderAll();
      syncFw(); SV.cw = 0; laneCvs.forEach(c => c.w = 0); setTimeout(drawTicks, 30);
      last = 0; if (!raf) raf = requestAnimationFrame(frame);
    },
    close() { active = false; if ($('picker')) $('picker').hidden = true; },
  };
})(window);
