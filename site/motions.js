/* Trimlight Studio · motion library. ~50 named motions, each one a recipe for a Look Builder layer that draws in whatever
   colours you picked. Used by the simple step-by-step builder (Step 2) and the advanced builder (Motion gallery, Add layer).
   Every motion has two plain knobs: speed (0 slow … 1 fast) and amount (0 … 1, with its own word: how many, how big…).
   window.TLMotions: { CATS, LIST, byId, layer(id, colors, blend, speed, amount) → builder layer, apply(layer, id, speed, amount) } */
(function (g) {
  'use strict';
  const lerp = (a, b, f) => a + (b - a) * f;
  // sp / am: [[key, at 0, at 1], …]; key 'p.x' = Studio shape setting, otherwise a controller slider (sx, ix, c1…)
  const S = (type, p, sp, am, o) => Object.assign({ kind: 'shape', type, p, sp, am }, o);
  const F = (fx, base, sp, am, o) => Object.assign({ kind: 'fx', fx, base, sp, am }, o);
  const CATS = [['glow', 'Glow & breathe', '◐'], ['twinkle', 'Twinkle & sparkle', '✦'], ['travel', 'Travel & chase', '➠'], ['water', 'Waves & water', '≈'], ['organic', 'Drifting & organic', '≋'], ['fire', 'Fire & candle', '🔥'], ['party', 'Party', '✷']];
  const LIST = [
    // ---- glow ----
    ['steady', 'Steady glow', 'glow', 'Just your colors, laid along the roof. No movement.', S('field', { scroll: 0, repeats: 1, wrap: 'mirror' }, [], [['p.repeats', .5, 4]]), '', 'Color bands'],
    ['breathe', 'Slow breathe', 'glow', 'The whole roof gently brightens and dims together.', S('pulse', { shape: 'breathe', period: 8, floor: 30, roll: 0, cycle: 0 }, [['p.period', 20, 2]], [['p.floor', 70, 0]]), 'Breath length', 'Depth'],
    ['rollbreath', 'Rolling breath', 'glow', 'A breath that rolls along the eaves like a slow wave.', S('pulse', { shape: 'breathe', period: 10, floor: 25, roll: 100, cycle: 0 }, [['p.period', 24, 3]], [['p.roll', 40, 300]]), '', 'Wave length'],
    ['heartbeat', 'Heartbeat', 'glow', 'A soft double beat, like a resting heart.', S('pulse', { shape: 'beat', period: 1.4, floor: 15, roll: 0, cycle: 0 }, [['p.period', 2.4, .6]], [['p.floor', 60, 0]]), '', 'Depth'],
    ['swell', 'Swell & fade', 'glow', 'Rises slowly, then melts away.', S('pulse', { shape: 'swell', period: 9, floor: 10, roll: 0, cycle: 0 }, [['p.period', 24, 3]], [['p.floor', 60, 0]]), '', 'Depth'],
    ['colorcycle', 'Color cycle', 'glow', 'The whole roof slowly moves through your colors together.', S('pulse', { shape: 'breathe', period: 30, floor: 85, roll: 0, cycle: 20 }, [['p.cycle', 90, 6]], [['p.floor', 100, 60]]), '', 'Breathing'],
    // ---- twinkle ----
    ['softtwinkle', 'Soft twinkle', 'twinkle', 'Bulbs slowly light and fade at random.', S('glints', { rate: 6, attack: .8, hold: .3, decay: 2, size: 1 }, [['p.attack', 2, .2], ['p.decay', 4, .6]], [['p.rate', 1.5, 30]]), 'Fade speed', 'How many'],
    ['stars', 'Starfield', 'twinkle', 'Long, slow stars coming and going.', S('glints', { rate: 3, attack: 1.6, hold: .8, decay: 3, size: 1 }, [['p.attack', 3, .6], ['p.decay', 6, 1.2]], [['p.rate', .6, 12]]), 'Fade speed', 'How many'],
    ['fireflies', 'Fireflies', 'twinkle', 'Quick little glows popping up along the roof.', S('glints', { rate: 5, attack: .25, hold: .1, decay: .9, size: 1 }, [['p.decay', 1.8, .3]], [['p.rate', 1, 20]]), 'Glow speed', 'How many'],
    ['sparkle', 'Quick sparkle', 'twinkle', 'Short bright sparkles, like frost catching light.', S('glints', { rate: 18, attack: 0, hold: 0, decay: .3, size: 1 }, [['p.decay', .7, .1]], [['p.rate', 4, 60]]), 'Sparkle speed', 'How many'],
    ['bigglints', 'Big glints', 'twinkle', 'Wider patches that bloom and fade.', S('glints', { rate: 3, attack: .9, hold: .4, decay: 2.2, size: 3 }, [['p.attack', 2, .3], ['p.decay', 4, .8]], [['p.size', 2, 5]]), 'Fade speed', 'Size'],
    ['fairy', 'Fairy lights', 'twinkle', 'Classic fairy-light twinkle (controller effect).', F(51, { sx: 80, ix: 128 }, [['sx', 20, 200]], [['ix', 40, 230]], { bg: true }), '', 'How many'],
    ['twinklefox', 'Twinklefox', 'twinkle', 'Smooth random twinkles that never look repetitive.', F(80, { sx: 80, ix: 150 }, [['sx', 20, 200]], [['ix', 40, 240]], { pal: true }), '', 'How many'],
    ['colortwinkle', 'Color twinkles', 'twinkle', 'Bulbs swell in different colors and fade out.', F(74, { sx: 60, ix: 128 }, [['sx', 20, 200]], [['ix', 30, 230]], { pal: true }), '', 'How many'],
    ['twinkleup', 'Twinkle up', 'twinkle', 'Twinkles that gently rise in and out.', F(106, { sx: 80, ix: 160 }, [['sx', 20, 200]], [['ix', 40, 240]], { pal: true }), '', 'How many'],
    // ---- travel ----
    ['drift', 'Color drift', 'travel', 'Your colors slide slowly along the roof.', S('field', { scroll: 3, repeats: 1.5, wrap: 'mirror' }, [['p.scroll', .5, 18]], [['p.repeats', .5, 5]]), '', 'Color bands'],
    ['blocks', 'Marching blocks', 'travel', 'Crisp blocks of each color march along the roof.', S('field', { scroll: 3, repeats: 3, wrap: 'repeat' }, [['p.scroll', .5, 18]], [['p.repeats', 1, 7]], { crisp: true }), '', 'Block count'],
    ['river', 'Color river', 'travel', 'Smooth waves of light flowing down the eaves.', S('waves', { shape: 'sine', count: 3, speed: 8, width: 40, floor: 0, colorBy: 'pos' }, [['p.speed', 2, 40]], [['p.count', 1, 8]]), '', 'Waves'],
    ['pulses', 'Marching pulses', 'travel', 'Short pulses of light walking along the roof.', S('waves', { shape: 'pulse', count: 6, speed: 10, width: 30, floor: 0, colorBy: 'wave' }, [['p.speed', 2, 40]], [['p.count', 2, 14]]), '', 'Pulses'],
    ['comets', 'Comets', 'travel', 'Bright heads with fading tails looping round.', S('comets', { count: 3, speed: 12, tail: 18, head: 2, path: 'loop', colorBy: 'comet' }, [['p.speed', 3, 50]], [['p.count', 1, 8]]), '', 'How many'],
    ['longcomets', 'Shooting stars', 'travel', 'Long, fast tails streaking across.', S('comets', { count: 2, speed: 30, tail: 45, head: 1, path: 'loop', colorBy: 'tail' }, [['p.speed', 10, 75]], [['p.tail', 15, 80]]), '', 'Tail length'],
    ['bounce', 'Bouncing comets', 'travel', 'Comets that bounce end to end.', S('comets', { count: 2, speed: 14, tail: 14, head: 2, path: 'bounce', colorBy: 'comet' }, [['p.speed', 3, 50]], [['p.count', 1, 6]]), '', 'How many'],
    ['scanner', 'Scanner', 'travel', 'One bright eye sweeping back and forth.', S('comets', { count: 1, speed: 18, tail: 8, head: 3, path: 'bounce', colorBy: 'comet' }, [['p.speed', 5, 60]], [['p.tail', 2, 30]]), '', 'Trail'],
    ['theater', 'Theater chase', 'travel', 'The classic marquee: every few bulbs stepping along.', F(13, { sx: 80, ix: 120 }, [['sx', 20, 220]], [['ix', 0, 255]], { bg: true }), '', 'Gap size'],
    ['running', 'Running lights', 'travel', 'Smooth running bands, like old shop signs.', F(15, { sx: 60, ix: 120 }, [['sx', 10, 200]], [['ix', 20, 255]], { bg: true }), '', 'Band width'],
    ['chase3', 'Three-color chase', 'travel', 'Blocks of your first three colors marching.', F(54, { sx: 40, ix: 90 }, [['sx', 5, 200]], [['ix', 20, 250]]), '', 'Block size'],
    ['meteor', 'Meteor', 'travel', 'A meteor with a sparkling, crumbling trail.', F(76, { sx: 100, ix: 128 }, [['sx', 30, 230]], [['ix', 40, 250]], { pal: true }), '', 'Trail'],
    ['sinelon', 'Sinelon', 'travel', 'A dot swinging smoothly with a long trail.', F(92, { sx: 60, ix: 128 }, [['sx', 10, 200]], [['ix', 40, 250]], { pal: true, bg: true }), '', 'Trail'],
    ['wipe', 'Color wipe', 'travel', 'One color wipes over the roof, then the next.', F(3, { sx: 80, ix: 128 }, [['sx', 20, 220]], [['ix', 0, 255]]), '', 'Softness'],
    ['sweep', 'Sweep', 'travel', 'A wipe that sweeps back and forth.', F(6, { sx: 80, ix: 128 }, [['sx', 20, 220]], [['ix', 0, 255]]), '', 'Softness'],
    ['rain', 'Rain', 'travel', 'Drops sliding down the roofline.', F(43, { sx: 80, ix: 128 }, [['sx', 20, 220]], [['ix', 40, 250]], { pal: true, bg: true }), '', 'How many'],
    // ---- water ----
    ['tide', 'Slow tide', 'water', 'One wide, slow swell washing along the roof.', S('waves', { shape: 'blob', count: .5, speed: 4, width: 60, floor: 25, colorBy: 'pos' }, [['p.speed', 1, 15]], [['p.width', 30, 100]]), '', 'Swell size'],
    ['oceanswell', 'Ocean swell', 'water', 'Rolling swells of light, one after another.', S('waves', { shape: 'blob', count: 2, speed: 6, width: 45, floor: 10, colorBy: 'pos' }, [['p.speed', 1.5, 25]], [['p.count', 1, 6]]), '', 'Swells'],
    ['ripple', 'Ripples', 'water', 'Drops landing and rippling outward.', F(79, { sx: 80, ix: 100 }, [['sx', 20, 220]], [['ix', 20, 220]], { pal: true }), '', 'How many'],
    ['lake', 'Lake', 'water', 'Light shimmering on still water.', F(75, { sx: 60 }, [['sx', 10, 200]], [], { pal: true }), '', ''],
    ['shadows', 'Dancing shadows', 'water', 'Soft shadows drifting over a glow.', F(112, { sx: 60, ix: 100 }, [['sx', 10, 200]], [['ix', 20, 250]], { pal: true }), '', 'Shadows'],
    ['pacifica', 'Pacifica', 'water', 'Layered ocean light (uses its own sea colors).', F(101, { sx: 60, ix: 128 }, [['sx', 10, 200]], [['ix', 30, 230]], { own: true }), '', 'Angle'],
    // ---- organic ----
    ['noise', 'Drifting patches', 'organic', 'Organic patches morphing slowly, like light through leaves.', S('noise', { scale: 16, speed: 1.5, contrast: 50, floor: 10 }, [['p.speed', .2, 6]], [['p.scale', 40, 5]]), '', 'Busyness'],
    ['embers', 'Embers', 'organic', 'Dark patches with hot spots slowly shifting.', S('noise', { scale: 10, speed: 1, contrast: 85, floor: 0 }, [['p.speed', .2, 5]], [['p.contrast', 30, 100]]), '', 'Contrast'],
    ['aurora', 'Aurora', 'organic', 'Curtains of light drifting like the northern lights.', F(38, { sx: 24, ix: 150 }, [['sx', 5, 120]], [['ix', 40, 255]], { pal: true }), '', 'Curtains'],
    ['flow', 'Flow', 'organic', 'Zones of color flowing past each other.', F(110, { sx: 40, ix: 90 }, [['sx', 5, 160]], [['ix', 20, 250]], { pal: true }), '', 'Zones'],
    ['plasma', 'Plasma', 'organic', 'Slowly morphing color, like a lava lamp.', F(97, { sx: 40, ix: 128 }, [['sx', 5, 160]], [['ix', 20, 250]], { pal: true }), '', 'Detail'],
    ['colorwaves', 'Colorwaves', 'organic', 'Bright, saturated waves of color.', F(67, { sx: 40, ix: 128 }, [['sx', 5, 160]], [['ix', 20, 250]], { pal: true }), '', 'Hue spread'],
    ['perlin', 'Wandering lights', 'organic', 'A few lights wandering lazily along the roof.', F(147, { sx: 60, ix: 80, c1: 128 }, [['sx', 10, 200]], [['ix', 20, 250]], { pal: true, bg: true }), '', 'How many'],
    // ---- fire ----
    ['candleflicker', 'Candle flicker', 'fire', 'The whole roof flickers softly, like one big candle.', S('pulse', { shape: 'flick', period: 3, floor: 40, roll: 0, cycle: 0 }, [['p.period', 8, 1]], [['p.floor', 80, 10]]), '', 'Flicker depth'],
    ['candles', 'Row of candles', 'fire', 'Every bulb its own candle flame.', F(102, { sx: 96, ix: 224 }, [['sx', 30, 220]], [['ix', 100, 255]], { bg: true }), '', 'Flicker amount'],
    ['fire', 'Fire', 'fire', 'Flames licking along the roof (try reds and ambers).', F(66, { sx: 64, ix: 160 }, [['ix', 60, 240]], [['sx', 120, 30]], { pal: true }), 'Flame rate', 'Flame height'],
    // ---- party ----
    ['juggle', 'Juggle', 'party', 'Colored dots weaving around each other.', F(64, { sx: 64, ix: 128 }, [['sx', 20, 200]], [['ix', 40, 250]], { pal: true }), '', 'Trail'],
    ['bpm', 'BPM pulse', 'party', 'Stripes pulsing to a steady beat.', F(68, { sx: 64 }, [['sx', 20, 220]], [], { pal: true }), '', ''],
    ['popcorn', 'Popcorn', 'party', 'Little kernels popping up and falling back.', F(95, { sx: 120, ix: 128 }, [['sx', 40, 230]], [['ix', 30, 250]], { pal: true, bg: true }), '', 'How many'],
    ['fireworks', 'Fireworks', 'party', 'Rockets bursting along the roof.', F(90, { sx: 128, ix: 128 }, [['sx', 60, 220]], [['ix', 40, 250]], { pal: true }), 'Gravity', 'Firing'],
    ['balls', 'Bouncing balls', 'party', 'Balls bouncing at the ends of each stretch.', F(91, { sx: 128, ix: 80 }, [['sx', 60, 240]], [['ix', 20, 200]], { pal: true, bg: true }), 'Gravity', 'How many'],
    ['dissolve', 'Dissolve', 'party', 'Colors dissolving in and out bulb by bulb.', F(18, { sx: 80, ix: 128 }, [['sx', 20, 220]], [['ix', 20, 250]]), '', 'Dissolve speed'],
    ['blends', 'Blends', 'party', 'Colors sliding and blending into each other.', F(115, { sx: 40, ix: 128 }, [['sx', 10, 200]], [['ix', 20, 250]], { pal: true }), '', 'Blend speed'],
  ].map(([id, name, cat, desc, spec, spWord, amWord]) => Object.assign({ id, name, cat, desc, spWord: spWord || 'Speed', amWord: amWord || '' }, spec));
  const byId = {}; LIST.forEach(m => byId[m.id] = m);

  const set = (L, key, v) => { if (key.startsWith('p.')) L.src.p[key.slice(2)] = Math.round(v * 100) / 100; else L.src[key] = Math.round(Math.max(0, Math.min(key === 'c3' ? 31 : 255, v))); };
  // apply a motion's speed / amount to an existing layer of that motion
  function tune(L, m, speed, amount) { m.sp.forEach(([k, a, b]) => set(L, k, lerp(a, b, speed))); m.am.forEach(([k, a, b]) => set(L, k, lerp(a, b, amount))); L.mo = { id: m.id, speed, amount }; return L; }
  // colours: the swatches drive Studio shapes (and custom palettes); controller effects also get them as colour 1-3
  function colorize(L, m, cols, blend) {
    const B = g.TLBuilder; cols = (cols && cols.length ? cols : [[255, 120, 20]]).map(c => c.slice(0, 3));
    L.cmode = 'swatches'; L.sw = { cols: cols.slice(0, 8).map(c => c.slice()), blend: m.crisp ? false : !!blend }; L.stops = B.make.swToStops(L.sw);
    if (L.src.kind === 'fx') {
      const c = cols.concat([cols[0], cols[0]]);
      L.src.col = m.bg ? [c[0], [0, 0, 0], c[1]] : [c[0], c[1], c[2]];
      L.customPal = !!m.pal; if (!m.pal) L.src.pal = 0; if (m.own) { L.customPal = false; L.src.pal = 0; }
    }
    return L;
  }
  function layer(id, cols, blend, speed = .35, amount = .5) {
    const m = byId[id], B = g.TLBuilder; if (!m) return null;
    const L = m.kind === 'shape' ? B.make.shape(m.type, m.name, { blend: 'cover', p: Object.assign({}, m.p) }) : B.make.fx(m.fx, m.name, { blend: 'cover', src: Object.assign({}, m.base) });
    colorize(L, m, cols, blend); return tune(L, m, speed, amount);
  }
  // swap an existing layer to another motion, keeping its colours, zone, blend, opacity and modulators
  function apply(L, id, speed, amount) {
    const m = byId[id], fresh = layer(id, L.sw ? L.sw.cols : L.stops.map(s => s[1]), L.sw ? L.sw.blend : true, speed ?? L.mo?.speed ?? .35, amount ?? L.mo?.amount ?? .5);
    Object.assign(L, { src: fresh.src, customPal: fresh.customPal, mo: fresh.mo, cmode: fresh.cmode, sw: fresh.sw, stops: fresh.stops, name: L.mo && L.name === byId[L.mo.id]?.name ? m.name : (L.name || m.name) });
    return L;
  }
  g.TLMotions = { CATS, LIST, byId, layer, apply, tune: (L, speed, amount) => L.mo && byId[L.mo.id] ? tune(L, byId[L.mo.id], speed, amount) : L };
})(window);
