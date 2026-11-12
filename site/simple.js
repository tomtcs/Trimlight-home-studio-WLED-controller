/* Trimlight Studio · Make a look: the simple, step-by-step builder (approved mockup: /mockups/v6-simple-builder.html).
   Colors → Motion → Feel → Where → Extras → Save. It builds an ordinary Look Builder stack (builder.js) from a few choices
   (P.simple keeps those choices, so the look reopens here); "Advanced builder" opens the same layers for deeper editing.
   window.TLSimple: init(host) · open(id) · close() */
(function (g) {
  'use strict';
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hex = c => '#' + c.slice(0, 3).map(x => ('0' + Math.round(clamp(x, 0, 255)).toString(16)).slice(-2)).join('');
  const unhex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const $ = id => document.getElementById('sm-' + id);
  let H = null, B = null, M = null, RUNS = [], THEMES = [], ZG = [], N = 0;
  let WZ = null, P = null, view = {}, SV = null, step = 0, cat = 'all', swSel = 0, cards = [], obs = null, mounted = false, active = false, raf = 0, last = 0, t = 0, cardT = 0, dirty = false;

  const defaults = () => ({ id: null, cols: (THEMES.find(x => x[0] === 'Autumn Twinkle') || THEMES[0])[1].map(c => c.slice()), blend: true, theme: 'Autumn Twinkle', motion: 'tide', speed: .35, amount: .5, bri: 190, dir: 'fwd', runs: RUNS.map((_, i) => i), sections: [], rest: 'off', extras: { twinkle: false, breathe: false, sway: false, soft: true }, twCol: 'gold', name: '', named: false, cats: ['mine'] });

  const savedZones = () => ZG.filter(z => z[2]);
  const sectionRanges = () => (WZ.sections || []).map(id => savedZones().find(z => z[2].id === id)).filter(Boolean).map(z => ({ start: z[2].start, len: z[2].len }));
  function mergeRanges(ranges) {
    const sorted = ranges.map(r => ({ start: Math.max(0, Math.round(r.start)), len: Math.max(0, Math.round(r.len)) })).filter(r => r.len).sort((a, b) => a.start - b.start);
    const out = [];
    for (const r of sorted) { const last = out[out.length - 1]; if (last && r.start <= last.start + last.len) last.len = Math.max(last.start + last.len, r.start + r.len) - last.start; else out.push(r); }
    return out;
  }
  function selectedRanges() {
    if (WZ.sections?.length) return mergeRanges(sectionRanges());
    return mergeRanges(WZ.runs.map(i => RUNS[i]).filter(Boolean).map(r => ({ start: r.start, len: r.len })));
  }
  function rangeBulbs(ranges) { return ranges.reduce((n, r) => n + r.len, 0); }
  function rangeComplement(ranges) {
    const out = []; let at = 0;
    for (const r of mergeRanges(ranges)) { if (r.start > at) out.push({ start: at, len: r.start - at }); at = Math.max(at, r.start + r.len); }
    if (at < N) out.push({ start: at, len: N - at });
    return out;
  }
  function whereLabel() {
    if (WZ.sections?.length) return WZ.sections.map(id => savedZones().find(z => z[2].id === id)?.[0]).filter(Boolean).join(', ');
    return WZ.runs.length === RUNS.length ? 'Whole roof' : WZ.runs.map(i => RUNS[i]?.name).filter(Boolean).join(', ');
  }

  /* ---- choices → layers (same recipe as the mockup) ---- */
  function buildStack() {
    const layers = [], custom = !!WZ.sections?.length, chosen = selectedRanges(), whole = rangeBulbs(chosen) >= N;
    if (!whole && WZ.rest === 'glow') { const gl = M.layer('steady', [WZ.cols[0]], true, 0, 0); gl.name = 'Everywhere else'; gl.opacity = 22; if (custom) gl.zone.custom = rangeComplement(chosen); else gl.zone.runs = RUNS.map((_, i) => i).filter(i => !WZ.runs.includes(i)); layers.push(gl); }
    const L = M.layer(WZ.motion, WZ.cols, WZ.blend, WZ.speed, WZ.amount); if (custom) L.zone.custom = chosen; else L.zone.runs = WZ.runs.slice();
    L.motion.rev = WZ.dir === 'rev'; L.motion.mi = WZ.dir === 'mid'; if (WZ.extras.soft && !whole) L.zone.feather = 3;
    if (WZ.extras.breathe) L.mods.push({ target: 'opacity', shape: 'sine', per: 20, depth: 40, phase: 0 });
    if (WZ.extras.sway) L.mods.push({ target: 'pos', shape: 'sine', per: 40, depth: 25, phase: 0 });
    layers.push(L);
    if (WZ.extras.twinkle) { const tc = WZ.twCol === 'gold' ? [[255, 170, 30]] : WZ.twCol === 'same' ? WZ.cols.filter(c => !nearWhite(c)) : [[150, 140, 255]]; const tw = M.layer('softtwinkle', tc.length ? tc : [[255, 170, 30]], true, .4, .3); tw.name = 'Twinkle on top'; tw.blend = 'lighter'; /* brighter wins: twinkles never mix into the colors below */ if (custom) tw.zone.custom = chosen; else tw.zone.runs = WZ.runs.slice(); layers.push(tw); }
    return { stack: { layers, knobs: [] }, bri: WZ.bri, fade: 2, simple: clone(WZ) };
  }
  const nearWhite = c => { const hi = Math.max(...c), lo = Math.min(...c); return hi > 110 && lo > .6 * hi; };
  function suggestName() { const th = WZ.theme ? WZ.theme.replace(/ \(.*\)/, '') : 'My'; return th + ' · ' + M.byId[WZ.motion].name; }
  function rebuild(touch) { P = buildStack(); view = {}; if (touch !== false) dirty = true; if (!WZ.named) { WZ.name = suggestName(); } $('name').textContent = WZ.name || 'New look'; renderRecipe(); }

  /* ---- steps ---- */
  const STEPS = [
    ['Colors', 'Pick your colors', 'Start from a theme or build your own set. They’ll be used by whatever motion you choose.'],
    ['Motion', 'Pick a motion', 'Every motion is shown in your colors. Click one to see it on the house.'],
    ['Feel', 'Speed & feel', 'Make it calmer or livelier.'],
    ['Where', 'Where on the roof', 'All of it, or just some stretches.'],
    ['Extras', 'Add a little extra', 'Optional touches on top. Leave them off for a clean look.'],
    ['Save', 'Name it & save', 'It goes to Saved looks, ready for the schedule and playlists.'],
  ];
  function renderSteps() {
    $('steps').innerHTML = STEPS.map((s, i) => '<button data-st="' + i + '" class="' + (i === step ? 'on' : i < step ? 'done' : '') + '"><i>' + (i < step ? '✓' : i + 1) + '</i><span>' + s[0] + '</span></button>').join('');
    $('pstep').textContent = 'Step ' + (step + 1) + ' of ' + STEPS.length; $('ptitle').textContent = STEPS[step][1]; $('psub').textContent = STEPS[step][2];
    $('prev').style.visibility = step ? 'visible' : 'hidden';
    $('next').textContent = step === STEPS.length - 1 ? (WZ.id ? 'Save changes' : 'Save to Saved looks') : 'Next: ' + STEPS[step + 1][0] + ' →';
    $('hint').textContent = step === 1 ? M.byId[WZ.motion].name + ' selected' : '';
    renderBody();
  }
  function renderRecipe() {
    const m = M.byId[WZ.motion];
    $('recipe').innerHTML = '<span><b>' + WZ.cols.length + '</b> colors</span><span><b>' + esc(m.name) + '</b></span><span>speed <b>' + Math.round(WZ.speed * 100) + '</b></span><span><b>' + (WZ.sections?.length ? WZ.sections.length + ' roof sections' : WZ.runs.length === RUNS.length ? 'Whole roof' : WZ.runs.length + ' stretches') + '</b></span>' +
      Object.entries(WZ.extras).filter(([k, v]) => v && k !== 'soft').map(([k]) => '<span>+ ' + ({ twinkle: 'twinkle', breathe: 'breathing', sway: 'sway' })[k] + '</span>').join('') +
      '<span style="margin-left:auto;border:0;background:none">' + P.stack.layers.length + ' layer' + (P.stack.layers.length > 1 ? 's' : '') + ' on the controller' + (dirty ? ' · unsaved' : '') + '</span>';
  }
  function big(k, label, v, lo, hi) { return '<div class="big"><div class="r"><b>' + esc(label) + '</b><output data-o="' + k + '">' + Math.round(v * 100) + '</output></div><input type="range" data-big="' + k + '" min="0" max="100" value="' + Math.round(v * 100) + '"><div class="ends"><span>' + lo + '</span><span>' + hi + '</span></div></div>'; }
  function drawStrip(cv, buf, n) { if (!cv.width || cv.width === 300) { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * 2) || 300; cv.height = Math.round(r.height * 2) || 16; } const x = cv.getContext('2d'), cw = cv.width / n; x.fillStyle = '#05070d'; x.fillRect(0, 0, cv.width, cv.height); for (let i = 0; i < n; i++) { x.fillStyle = 'rgb(' + buf[i * 3] + ',' + buf[i * 3 + 1] + ',' + buf[i * 3 + 2] + ')'; x.fillRect(i * cw, 0, Math.ceil(cw), cv.height); } }
  function renderBody() {
    const el = $('body'); cards = []; if (obs) obs.disconnect();
    if (step === 0) {
      const near = WZ.cols.some(nearWhite);
      el.innerHTML = '<div class="lbl">Your colors <span>' + WZ.cols.length + ' of 6 · click one to change it</span></div><div class="sws">' + WZ.cols.map((c, i) => '<label class="sw' + (i === swSel ? ' sel' : '') + '" style="background:' + hex(c) + '"><input type="color" data-sw="' + i + '" value="' + hex(c) + '"><span>' + (i + 1) + '</span>' + (WZ.cols.length > 1 ? '<button data-swdel="' + i + '">✕</button>' : '') + '</label>').join('') + (WZ.cols.length < 6 ? '<button class="swadd" data-swadd>＋</button>' : '') + '</div>' +
        '<div class="lbl">Quick colors <span>sets color ' + (swSel + 1) + '</span></div><div class="quickc">' + B.QUICK.map((q, i) => '<button data-qc="' + i + '" title="' + q[0] + '" style="background:' + hex(q[1]) + '"></button>').join('') + '</div>' +
        (near ? '<div class="warn">A color is white or close to it. Great for glows and chases; twinkles stay warm per your rule (“Twinkle on top” skips white).</div>' : '') +
        '<div class="lbl">Between colors</div><div class="pair"><button class="opt' + (WZ.blend ? '' : ' on') + '" data-bl="0"><b>Crisp blocks</b><small>Each color keeps its own bulbs</small><canvas data-demo="0"></canvas></button><button class="opt' + (WZ.blend ? ' on' : '') + '" data-bl="1"><b>Smooth blend</b><small>Colors fade into each other</small><canvas data-demo="1"></canvas></button></div>' +
        '<div class="lbl">Or start from a theme</div><div class="themes">' + THEMES.map((th, i) => '<button data-th="' + i + '" class="' + (WZ.theme === th[0] ? 'on' : '') + '"><i style="background:linear-gradient(90deg,' + th[1].map(hex).join(',') + ')"></i><span>' + esc(th[0]) + '</span></button>').join('') + '</div>';
      el.querySelectorAll('canvas[data-demo]').forEach(c => { const st = B.make.swToStops({ cols: WZ.cols, blend: c.dataset.demo === '1' }), n = 60, b = new Uint8Array(n * 3); for (let i = 0; i < n; i++) { const x = i / (n - 1); let col = st[st.length - 1][1]; for (let k = 0; k < st.length - 1; k++) if (x <= st[k + 1][0]) { const f = (x - st[k][0]) / Math.max(1e-6, st[k + 1][0] - st[k][0]); col = st[k][1].map((v, j) => v + (st[k + 1][1][j] - v) * f); break; } b[i * 3] = col[0]; b[i * 3 + 1] = col[1]; b[i * 3 + 2] = col[2]; } drawStrip(c, b, n); });
    } else if (step === 1) {
      el.innerHTML = '<div class="cats">' + [['all', 'All ' + M.LIST.length]].concat(M.CATS.map(c => [c[0], c[2] + ' ' + c[1]])).map(c => '<button data-cat="' + c[0] + '" class="' + (cat === c[0] ? 'on' : '') + '">' + esc(c[1]) + '</button>').join('') + '</div><div class="mgrid">' +
        M.LIST.filter(m => cat === 'all' || m.cat === cat).map(m => '<button class="mcard' + (m.id === WZ.motion ? ' on' : '') + '" data-m="' + m.id + '"><canvas></canvas><b>' + esc(m.name) + '</b><small>' + esc(m.desc) + '</small><em>' + (m.kind === 'shape' ? 'Studio' : 'controller fx') + '</em></button>').join('') + '</div>';
      obs = new IntersectionObserver(es => es.forEach(en => { const c = cards.find(x => x.el === en.target); if (c) c.vis = en.isIntersecting; }), { root: el });
      cards = [...el.querySelectorAll('.mcard')].map(card => ({ el: card, P: { stack: { layers: [M.layer(card.dataset.m, WZ.cols, WZ.blend, .4, .5)], knobs: [] } }, v: {}, vis: false, cv: card.querySelector('canvas') }));
      cards.forEach(c => obs.observe(c.el));
    } else if (step === 2) {
      const m = M.byId[WZ.motion];
      el.innerHTML = big('speed', m.spWord, WZ.speed, 'Slow & calm', 'Fast & lively') + (m.am.length ? big('amount', m.amWord || 'Amount', WZ.amount, 'Less', 'More') : '<div class="note">' + esc(m.name) + ' has no amount setting.</div>') + big('bri', 'Brightness', WZ.bri / 255, 'Dim', 'Bright') +
        '<div class="lbl">Direction</div><div class="dirs">' + [['fwd', 'Forward', 'From the garage end'], ['rev', 'Backward', 'Toward the garage'], ['mid', 'From the middle', 'Mirrored outward']].map(d => '<button class="opt' + (WZ.dir === d[0] ? ' on' : '') + '" data-dir="' + d[0] + '"><b>' + d[1] + '</b><small>' + d[2] + '</small></button>').join('') + '</div>';
    } else if (step === 3) {
      const on = new Set(WZ.runs), selected = new Set(WZ.sections || []), quick = ZG.map((z, i) => ({ z, i })).filter(x => !x.z[2]), saved = savedZones();
      const selectedCount = rangeBulbs(selectedRanges());
      el.innerHTML = '<div class="lbl">Quick picks</div><div class="pair">' + quick.map(({ z, i }) => '<button class="opt' + (!selected.size && z[1].length === on.size && z[1].every(r => on.has(r)) ? ' on' : '') + '" data-zg="' + i + '"><b>' + esc(z[0]) + '</b><small>' + z[1].reduce((a, r) => a + RUNS[r].len, 0) + ' bulbs</small></button>').join('') + '</div>' +
        (saved.length ? '<div class="lbl">Your saved roof sections <span>select one or more bulb ranges</span></div><div class="pair">' + saved.map(z => '<button class="opt' + (selected.has(z[2].id) ? ' on' : '') + '" data-section="' + esc(z[2].id) + '"><b>' + esc(z[0]) + '</b><small>Bulbs ' + (z[2].start + 1) + '–' + (z[2].start + z[2].len) + ' · ' + z[2].len + ' bulbs</small></button>').join('') + '</div>' + (selected.size ? '<div class="note">Selected sections: ' + selected.size + ' · ' + selectedCount + ' bulbs</div>' : '') : '') +
        (selected.size ? '<div class="note">Named sections use their saved bulb ranges, including ranges that begin or end partway through a WLED output.</div>' : '<div class="lbl">Or pick output stretches</div>' + RUNS.map((r, i) => '<label class="zone' + (on.has(i) ? ' on' : '') + '"><input type="checkbox" data-run="' + i + '"' + (on.has(i) ? ' checked' : '') + '><span>' + esc(r.name) + '</span><small>' + r.len + ' bulbs</small></label>').join('')) +
        (selectedCount < N ? '<div class="lbl">Everywhere else</div><div class="pair"><button class="opt' + (WZ.rest === 'off' ? ' on' : '') + '" data-rest="off"><b>Off</b><small>Only the chosen areas light up</small></button><button class="opt' + (WZ.rest === 'glow' ? ' on' : '') + '" data-rest="glow"><b>Soft glow</b><small>A dim glow of color 1</small></button></div>' : '');
    } else if (step === 4) {
      const X = [['twinkle', 'Twinkle on top', 'Soft twinkles sprinkled over your motion.', '<div class="sub2"><div class="pair" style="grid-template-columns:repeat(3,1fr)">' + [['gold', 'Gold'], ['same', 'My colors'], ['cool', 'Cool']].map(o => '<button class="opt' + (WZ.twCol === o[0] ? ' on' : '') + '" data-twc="' + o[0] + '" style="padding:7px 9px"><b style="font-size:12.5px">' + o[1] + '</b></button>').join('') + '</div></div>'],
        ['breathe', 'Breathe slowly', 'The whole look gently brightens and dims every 20 seconds.', ''], ['sway', 'Gentle sway', 'The pattern slowly sways back and forth along the roof.', ''], ['soft', 'Soft edges', 'Fades in at the ends of each stretch instead of a hard start.', '']];
      el.innerHTML = X.map(x => '<div class="extra' + (WZ.extras[x[0]] ? ' on' : '') + '" data-ex="' + x[0] + '"><div><b>' + x[1] + '</b><small>' + x[2] + '</small>' + x[3] + '</div><div class="tog"></div></div>').join('') + '<div class="note">Want more? The <b>Advanced builder</b> stacks any motions, blends them and animates any setting.</div>';
    } else {
      const m = M.byId[WZ.motion], ok = H.canPush(P);
      el.innerHTML = '<div class="lbl">Name</div><input class="namein" id="sm-namein" value="' + esc(WZ.name) + '">' +
        '<div class="lbl">Summary</div><div class="sum">' + [['Colors', '<span style="display:inline-flex;gap:3px">' + WZ.cols.map(c => '<i style="width:14px;height:14px;border-radius:4px;display:inline-block;background:' + hex(c) + '"></i>').join('') + '</span> ' + (WZ.blend ? 'blended' : 'blocks'), 0], ['Motion', esc(m.name), 1], ['Feel', 'speed ' + Math.round(WZ.speed * 100) + (m.am.length ? ' · ' + (m.amWord || 'amount').toLowerCase() + ' ' + Math.round(WZ.amount * 100) : '') + ' · brightness ' + Math.round(WZ.bri / 2.55) + '%', 2], ['Where', esc(whereLabel()), 3], ['Extras', Object.entries(WZ.extras).filter(([, v]) => v).map(([k]) => ({ twinkle: 'twinkle', breathe: 'breathing', sway: 'sway', soft: 'soft edges' })[k]).join(', ') || 'none', 4]].map(r => '<div><span>' + r[0] + '</span><b>' + r[1] + '<a data-go="' + r[2] + '">change</a></b></div>').join('') + '</div>' +
        '<div class="lbl">Show it in</div><div class="catpick">' + H.cats().map(c => '<button data-cp="' + c[0] + '" class="' + (WZ.cats.includes(c[0]) ? 'on' : '') + '">' + c[2] + ' ' + esc(c[1]) + '</button>').join('') + '</div>' +
        '<div style="display:flex;gap:8px;margin-top:18px"><button class="btn go" id="sm-pushnow"' + (ok ? '' : ' disabled title="Needs Studio firmware extensions"') + '>▶ Save &amp; push to house</button><button class="btn" id="sm-advnow">Open in advanced builder</button></div>' +
        '<div class="note">Runs on the controller as <b>' + P.stack.layers.length + ' layer' + (P.stack.layers.length > 1 ? 's' : '') + '</b>, so it keeps going if the app is closed. Schedules, playlists and moments can use it like any look.</div>';
      $('namein').oninput = e => { WZ.name = e.target.value; WZ.named = true; dirty = true; $('name').textContent = WZ.name; };
      $('pushnow').onclick = async () => { const id = save(); try { await H.push(id); H.toast('“' + WZ.name + '” is fading onto the house'); } catch (err) { H.toast('Push failed: ' + err.message, 'var(--warn)'); } };
      $('advnow').onclick = toAdvanced;
    }
    bindBody(el);
  }
  function bindBody(el) {
    const re = () => { rebuild(); renderBody(); };
    el.querySelectorAll('input[data-sw]').forEach(c => { const i = +c.dataset.sw; c.onclick = () => { swSel = i; el.querySelectorAll('.sw').forEach((x, k) => x.classList.toggle('sel', k === i)); }; c.oninput = () => { WZ.cols[i] = unhex(c.value); WZ.theme = ''; c.parentElement.style.background = c.value; rebuild(); }; c.onchange = () => renderBody(); });
    el.querySelectorAll('[data-swdel]').forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); WZ.cols.splice(+b.dataset.swdel, 1); swSel = Math.min(swSel, WZ.cols.length - 1); WZ.theme = ''; re(); });
    el.querySelector('[data-swadd]')?.addEventListener('click', () => { const used = new Set(WZ.cols.map(c => c.join())), q = B.QUICK.find(x => !used.has(x[1].join()) && !/white/i.test(x[0])); WZ.cols.push((q ? q[1] : [255, 170, 0]).slice()); swSel = WZ.cols.length - 1; WZ.theme = ''; re(); });
    el.querySelectorAll('[data-qc]').forEach(b => b.onclick = () => { WZ.cols[swSel] = B.QUICK[+b.dataset.qc][1].slice(); WZ.theme = ''; re(); });
    el.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { const th = THEMES[+b.dataset.th]; WZ.cols = th[1].map(c => c.slice()); WZ.theme = th[0]; swSel = 0; re(); });
    el.querySelectorAll('[data-bl]').forEach(b => b.onclick = () => { WZ.blend = b.dataset.bl === '1'; re(); });
    el.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { cat = b.dataset.cat; renderBody(); });
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { WZ.motion = b.dataset.m; rebuild(); el.querySelectorAll('.mcard').forEach(x => x.classList.toggle('on', x === b)); $('hint').textContent = M.byId[WZ.motion].name + ' selected'; });
    el.querySelectorAll('[data-big]').forEach(r => r.oninput = () => { const k = r.dataset.big, v = +r.value / 100; if (k === 'bri') WZ.bri = Math.round(clamp(v, .05, 1) * 255); else WZ[k] = v; el.querySelector('[data-o="' + k + '"]').textContent = r.value; r.style.setProperty('--v', r.value + '%'); rebuild(); });
    el.querySelectorAll('input[type=range]').forEach(r => r.style.setProperty('--v', r.value + '%'));
    el.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => { WZ.dir = b.dataset.dir; re(); });
    el.querySelectorAll('[data-zg]').forEach(b => b.onclick = () => { WZ.sections = []; WZ.runs = ZG[+b.dataset.zg][1].slice(); re(); });
    el.querySelectorAll('[data-section]').forEach(b => b.onclick = () => { const s = new Set(WZ.sections || []), id = b.dataset.section; s.has(id) ? s.delete(id) : s.add(id); if (!s.size) { H.toast('Keep at least one roof section selected', 'var(--warn)'); return; } WZ.sections = [...s]; re(); });
    el.querySelectorAll('[data-run]').forEach(c => c.onchange = () => { const s = new Set(WZ.runs), i = +c.dataset.run; c.checked ? s.add(i) : s.delete(i); if (!s.size) { H.toast('Pick at least one stretch', 'var(--warn)'); renderBody(); return; } WZ.sections = []; WZ.runs = [...s].sort((a, b) => a - b); re(); });
    el.querySelectorAll('[data-rest]').forEach(b => b.onclick = () => { WZ.rest = b.dataset.rest; re(); });
    el.querySelectorAll('[data-ex]').forEach(d => d.onclick = e => { if (e.target.closest('[data-twc]')) return; const k = d.dataset.ex; WZ.extras[k] = !WZ.extras[k]; re(); });
    el.querySelectorAll('[data-twc]').forEach(b => b.onclick = () => { WZ.twCol = b.dataset.twc; re(); });
    el.querySelectorAll('[data-go]').forEach(a => a.onclick = () => { step = +a.dataset.go; renderSteps(); });
    el.querySelectorAll('[data-cp]').forEach(b => b.onclick = () => { const c = b.dataset.cp, i = WZ.cats.indexOf(c); i >= 0 ? WZ.cats.splice(i, 1) : WZ.cats.push(c); if (!WZ.cats.length) WZ.cats.push('mine'); dirty = true; b.classList.toggle('on'); });
  }

  /* ---- save / advanced ---- */
  function save() {
    P = buildStack(); const desc = M.byId[WZ.motion].name + (P.stack.layers.length > 1 ? ' + ' + (P.stack.layers.length - 1) + ' more' : '');
    WZ.id = H.saveLook({ id: WZ.id, name: WZ.name || suggestName(), desc, P, cats: WZ.cats }); P.simple.id = WZ.id; dirty = false;
    history.replaceState(null, '', location.href.split('#')[0] + '#make=' + WZ.id); renderRecipe(); renderSteps();
    return WZ.id;
  }
  function toAdvanced() {
    const id = WZ.id && !dirty ? WZ.id : null;
    if (id) { location.hash = 'builder=' + id; return; }
    H.openBuilderDraft({ id: WZ.id, name: WZ.name || suggestName(), bri: WZ.bri, fade: 2, layers: clone(P.stack.layers), knobs: [] });
  }

  /* ---- loop ---- */
  function frame(now) {
    if (!active) { raf = 0; return; }
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now; t += dt * 1000;
    const buf = B.render(view, P, t); H.drawHouse(SV, buf, WZ.bri); drawStrip($('strip'), buf, N);
    cardT += dt; if (cardT > 1 / 30) { cardT = 0; for (const c of cards) if (c.vis) drawStrip(c.cv, B.render(c.v, c.P, t), N); }
    raf = requestAnimationFrame(frame);
  }
  const MARKUP = `
<header class="top">
  <button class="back" id="sm-back"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>Library</button>
  <div class="ttl"><small>Make a look</small><b id="sm-name">New look</b></div>
  <nav class="steps" id="sm-steps"></nav>
  <button class="adv" id="sm-ask" title="Describe a change and AI suggests ways to do it">✨ Ask AI</button>
  <button class="adv" id="sm-new" title="Start over with a new look">＋ New</button>
  <button class="adv" id="sm-toadv" title="Open these layers in the advanced builder (layers, blends, modulators)">Advanced builder ↗</button>
</header>
<div class="wrap">
  <div class="left">
    <div class="stage"><canvas id="sm-cv"></canvas><div class="tag">Preview · same maths as the controller</div></div>
    <div class="strip"><canvas id="sm-strip"></canvas></div>
    <div class="recipe" id="sm-recipe"></div>
  </div>
  <div class="right">
    <div class="phead"><small id="sm-pstep"></small><h2 id="sm-ptitle"></h2><p id="sm-psub"></p></div>
    <div class="pbody" id="sm-body"></div>
    <div class="pfoot"><button class="btn" id="sm-prev">← Back</button><span class="sp"></span><span id="sm-hint" style="color:var(--dim);font-size:12.5px"></span><button class="btn go" id="sm-next">Next →</button></div>
  </div>
</div>`;
  function mount() {
    if (mounted) return; mounted = true;
    document.getElementById('simple').innerHTML = MARKUP;
    SV = H.makeView($('cv'));
    $('steps').onclick = e => { const b = e.target.closest('[data-st]'); if (b) { step = +b.dataset.st; renderSteps(); } };
    $('prev').onclick = () => { if (step) { step--; renderSteps(); } };
    $('next').onclick = () => { if (step < STEPS.length - 1) { step++; renderSteps(); } else { save(); H.toast('Saved “' + WZ.name + '” to Saved looks', 'var(--accent)'); } };
    $('back').onclick = () => H.goLibrary();
    $('toadv').onclick = toAdvanced;
    $('ask').onclick = () => {
      if (!g.TLAsk) return H.toast('Ask AI didn’t load', 'var(--warn)');
      g.TLAsk.open({ name: WZ.name || suggestName(), P: buildStack(), onApply: (P2, o) => {
        // changes the six steps can express stay here; anything else (extra layers, blends…) continues in the advanced builder
        const main = rangeBulbs(selectedRanges()) < N && WZ.rest === 'glow' ? 1 : 0;
        const simpleOk = o.ops.every(op => op.op === 'brightness' || (['motion', 'tune', 'colors'].includes(op.op) && (op.layer | 0) === main) || (op.op === 'set' && ['reverse', 'mirror'].includes(op.key) && (op.layer | 0) === main));
        if (!simpleOk) { H.openBuilderDraft({ id: WZ.id, name: WZ.name || suggestName(), bri: P2.bri ?? WZ.bri, fade: 2, layers: P2.stack.layers, knobs: [] }); H.toast('“' + o.title + '” needs layers, so it opened in the advanced builder. Save it there.', 'var(--accent)'); return; }
        for (const op of o.ops) {
          if (op.op === 'motion' && M.byId[op.id]) { WZ.motion = op.id; if (op.speed != null) WZ.speed = clamp(+op.speed, 0, 1); if (op.amount != null) WZ.amount = clamp(+op.amount, 0, 1); }
          else if (op.op === 'tune') { if (op.speed != null) WZ.speed = clamp(+op.speed, 0, 1); if (op.amount != null) WZ.amount = clamp(+op.amount, 0, 1); }
          else if (op.op === 'colors') { const cs = (op.cols || []).filter(c => Array.isArray(c) && c.length >= 3).slice(0, 6).map(c => c.slice(0, 3).map(v => clamp(Math.round(+v || 0), 0, 255))); if (cs.length) { WZ.cols = cs; WZ.theme = ''; } if (op.smooth != null) WZ.blend = !!op.smooth; }
          else if (op.op === 'brightness') WZ.bri = clamp(Math.round(+op.value), 10, 255);
          else if (op.op === 'set') WZ.dir = op.key === 'mirror' ? (op.value ? 'mid' : 'fwd') : (op.value ? 'rev' : 'fwd');
        }
        rebuild(); renderSteps(); H.toast('Applied “' + o.title + '”', 'var(--accent)');
      } });
    };
    $('new').onclick = () => { if (dirty && !confirm('Start a new look? Unsaved changes to “' + WZ.name + '” will be lost.')) return; WZ = defaults(); step = 0; swSel = 0; dirty = false; history.replaceState(null, '', location.href.split('#')[0] + '#make'); rebuild(false); renderSteps(); };
    addEventListener('resize', () => { if (SV) SV.cw = 0; });
  }
  g.TLSimple = {
    init(host) { H = host; B = g.TLBuilder; M = g.TLMotions; RUNS = B.runs(); N = host.N; THEMES = host.themes(); ZG = B.zoneGroups(); },
    // a look made here (or its saved choices) → reopen with those choices
    canOpen: l => !!(l && l.P && (l.P.simple || l.fromSimple)),
    open(id) {
      mount(); active = true;
      const l = id && H.lookById(id), s = l && (l.P.simple || l.fromSimple);
      if (s && (!WZ || WZ.id !== l.id)) { WZ = Object.assign(defaults(), clone(s), { id: l.id, name: l.name, named: true, cats: (l.cats || ['mine']).slice() }); if (!M.byId[WZ.motion]) WZ.motion = 'tide'; step = 5; dirty = false; }
      else if (!WZ) { WZ = defaults(); step = 0; }
      rebuild(false); renderSteps(); SV.cw = 0; last = 0; if (!raf) raf = requestAnimationFrame(frame);
    },
    close() { active = false; },
  };
})(window);
