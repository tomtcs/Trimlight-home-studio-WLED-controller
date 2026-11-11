/* Trimlight Home Studio · WLED Edition: Ask AI to change a layered look. Shared by the advanced Look Builder and Make a look.
   Sends the look + the motion library to /api/ai/stack (the configured AI service endpoint); gets back an explanation and
   2-3 options, each a short list of edit operations. Options are previewed live (same engine as the roof) before you pick one.
   window.TLAsk: open({ name, P, onApply(P2, option) }) · applyOps(P, ops) → P2 */
(function (g) {
  'use strict';
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nearWhite = c => { const hi = Math.max(...c), lo = Math.min(...c); return hi > 110 && lo > .55 * hi; };
  const warm = c => nearWhite(c) ? [255, 170, 30] : c;
  const cleanCols = cs => (Array.isArray(cs) ? cs : []).filter(c => Array.isArray(c) && c.length >= 3).slice(0, 8).map(c => c.slice(0, 3).map(v => clamp(Math.round(+v || 0), 0, 255)));
  const BLENDS = ['cover', 'add', 'screen', 'lighter', 'reveal', 'tint', 'dim'], SHAPES = ['sine', 'tri', 'up', 'down', 'square', 'wander'], TARGETS = ['opacity', 'hue', 'pos', 'speed', 'size'];

  function setCols(L, cols, smooth) {
    const B = g.TLBuilder, M = g.TLMotions; if (!cols.length) return;
    L.cmode = 'swatches'; L.sw = { cols, blend: smooth == null ? (L.sw ? L.sw.blend : true) : !!smooth }; L.stops = B.make.swToStops(L.sw);
    if (L.mo && M.byId[L.mo.id]) M.apply(L, L.mo.id, L.mo.speed, L.mo.amount);
    else if (L.src.kind === 'fx') { const c = cols.concat([cols[0], cols[0]]); L.src.col = [c[0], c[1], c[2]]; }
  }
  const isTwinkle = L => (L.mo && g.TLMotions.byId[L.mo.id]?.cat === 'twinkle') || (L.src.kind === 'shape' && L.src.type === 'glints');
  function applyOps(P, ops) {
    const M = g.TLMotions, out = clone(P), Ls = out.stack.layers, notes = [];
    for (const op of ops || []) {
      const L = Ls[op.layer | 0];
      try {
        switch (op.op) {
          case 'motion': if (L && M.byId[op.id]) M.apply(L, op.id, op.speed != null ? clamp(+op.speed, 0, 1) : undefined, op.amount != null ? clamp(+op.amount, 0, 1) : undefined); break;
          case 'tune': if (L && L.mo) M.tune(L, clamp(op.speed ?? L.mo.speed, 0, 1), clamp(op.amount ?? L.mo.amount, 0, 1)); break;
          case 'colors': if (L) setCols(L, cleanCols(op.cols), op.smooth); break;
          case 'set': if (!L) break;
            if (op.key === 'blend' && BLENDS.includes(op.value)) L.blend = op.value;
            else if (op.key === 'opacity') L.opacity = clamp(Math.round(+op.value), 0, 100);
            else if (op.key === 'feather') L.zone.feather = clamp(Math.round(+op.value), 0, 20);
            else if (op.key === 'slow') L.motion.slow = [1, 2, 4, 8, 16].includes(+op.value) ? +op.value : 1;
            else if (op.key === 'reverse') L.motion.rev = !!op.value;
            else if (op.key === 'mirror') L.motion.mi = !!op.value;
            break;
          case 'zone': if (L) { const n = g.TLBuilder.runs().length, r = (op.runs || []).map(Number).filter(x => x >= 0 && x < n); if (r.length) { L.zone.runs = [...new Set(r)].sort((a, b) => a - b); delete L.zone.custom; } } break;
          case 'mods': if (L) L.mods = (op.mods || []).filter(m => TARGETS.includes(m.target)).slice(0, 4).map(m => ({ target: m.target, shape: SHAPES.includes(m.shape) ? m.shape : 'sine', per: clamp(+m.per || 10, .5, 7200), depth: clamp(+m.depth || 30, 0, 100), phase: 0 })); break;
          case 'add': {
            if (!M.byId[op.id] || Ls.length >= 8) break;
            const cols = cleanCols(op.cols); const base = Ls[Ls.length - 1];
            const nl = M.layer(op.id, cols.length ? cols : (base?.sw?.cols || [[255, 170, 30]]), op.smooth ?? true, clamp(op.speed ?? .4, 0, 1), clamp(op.amount ?? .5, 0, 1));
            nl.blend = BLENDS.includes(op.blend) ? op.blend : 'screen'; if (op.opacity != null) nl.opacity = clamp(Math.round(+op.opacity), 0, 100); if (op.name) nl.name = String(op.name).slice(0, 40);
            const n = g.TLBuilder.runs().length, r = (op.runs || []).map(Number).filter(x => x >= 0 && x < n); if (r.length) nl.zone.runs = [...new Set(r)].sort((a, b) => a - b);
            Ls.splice(clamp(op.at ?? Ls.length, 0, Ls.length), 0, nl); break;
          }
          case 'remove': if (L && Ls.length > 1) Ls.splice(op.layer | 0, 1); break;
          case 'brightness': out.bri = clamp(Math.round(+op.value), 10, 255); break;
        }
      } catch (e) { notes.push(op.op + ': ' + e.message); }
    }
    if (out.stack.knobs) out.stack.knobs.forEach(k => k.maps = k.maps.filter(m => Ls.some(l => l.id === m.id)));
    if (notes.length) console.warn('[ask] skipped', notes);
    return out;
  }

  /* ---- panel ---- */
  const CSS = `
#askAI{position:fixed;inset:0;z-index:400;background:rgba(2,3,8,.74);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:44px 20px;overflow-y:auto;font:14px/1.45 Inter,system-ui,sans-serif;color:#f4f7f5}
#askAI[hidden]{display:none}
#askAI .box{width:min(980px,100%);background:#141a17;border:1px solid rgba(71,94,77,.45);border-radius:20px;padding:20px 22px;box-shadow:0 30px 80px rgba(0,0,0,.6)}
#askAI h2{margin:0;font:600 21px "Space Grotesk",Inter,sans-serif}#askAI .hd{display:flex;gap:12px;align-items:flex-start}#askAI .hd p{margin:3px 0 0;color:#98a79d;font-size:13px}
#askAI .x{margin-left:auto;width:34px;height:34px;border-radius:10px;border:1px solid rgba(71,94,77,.45);background:#1b231e;color:#98a79d;font-size:18px;cursor:pointer}
#askAI textarea{width:100%;margin-top:14px;background:#0b0e0d;border:1px solid rgba(71,94,77,.45);border-radius:12px;color:#f4f7f5;padding:12px 14px;font:15px Inter,sans-serif;resize:vertical;min-height:70px}
#askAI textarea:focus{outline:none;border-color:#62d682}
#askAI .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}#askAI .chips button{border:1px solid rgba(45,56,49,.4);background:#1b231e;color:#98a79d;border-radius:999px;padding:4px 11px;font-size:12px;cursor:pointer}#askAI .chips button:hover{color:#f4f7f5;border-color:#62d682}
#askAI .row{display:flex;gap:10px;align-items:center;margin-top:12px}#askAI .st{color:#98a79d;font-size:13px;flex:1}#askAI .st.err{color:#ff9f9f}
#askAI .go{border:0;border-radius:12px;height:42px;padding:0 20px;background:linear-gradient(135deg,#7ce59a,#35b354);color:#092211;font:600 14px Inter;cursor:pointer}#askAI .go[disabled]{opacity:.5;cursor:default}
#askAI .now{margin-top:16px;display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:center;font-size:12px;color:#98a79d}
#askAI canvas{display:block;width:100%;height:16px;border-radius:5px;background:#101612}
#askAI .ex{margin-top:16px;padding:12px 14px;border-radius:12px;background:rgba(98,214,130,.07);border:1px solid rgba(98,214,130,.25);color:#e6d3b3}
#askAI .opts{display:grid;gap:10px;margin-top:12px}
#askAI .opt{border:1px solid rgba(45,56,49,.4);border-radius:14px;background:#1b231e;padding:12px 14px;display:grid;grid-template-columns:1fr auto;gap:6px 14px;align-items:center}
#askAI .opt b{font:600 15px "Space Grotesk",Inter,sans-serif}#askAI .opt p{margin:2px 0 0;color:#98a79d;font-size:13px}
#askAI .opt canvas{grid-column:1/-1;height:20px;margin-top:6px}
#askAI .opt .use{border:1px solid #62d682;background:rgba(98,214,130,.12);color:#b9f4c9;border-radius:10px;height:36px;padding:0 14px;font:600 13px Inter;cursor:pointer}#askAI .opt .use:hover{background:#62d682;color:#092211}
#askAI .opt small{grid-column:1/-1;color:#6f8175;font-size:11.5px}`;
  let el = null, ctx = null, views = [], raf = 0, t = 0, last = 0;
  const EX = ['Never show purple or any in-between colors, only my exact colors', 'Make it calmer and slower', 'Add a few gold sparkles on top', 'Only the upper roofline should move, keep the rest steady', 'Make it feel more festive', 'Dimmer, for late at night'];
  function mount() {
    if (el) return; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    el = document.createElement('div'); el.id = 'askAI'; el.hidden = true;
    el.innerHTML = '<div class="box"><div class="hd"><div><h2 id="askT">✨ Ask AI</h2><p>Say what to change, in your own words. AI suggests a few ways to do it, each previewed live. Nothing changes until you pick one.</p></div><button class="x" id="askX">×</button></div>' +
      '<textarea id="askQ" rows="3" placeholder="e.g. When it fades from blue to red it shows purple. I only want red, white and blue."></textarea><div class="chips" id="askChips"></div>' +
      '<div class="row"><span class="st" id="askS"></span><button class="go" id="askGo">✨ Suggest changes</button></div><div class="now"><span>Now</span><canvas id="askNow"></canvas></div><div id="askR"></div></div>';
    document.body.appendChild(el);
    el.querySelector('#askChips').innerHTML = EX.map(x => '<button>' + esc(x) + '</button>').join('');
    el.querySelector('#askChips').onclick = e => { const b = e.target.closest('button'); if (b) { el.querySelector('#askQ').value = b.textContent; el.querySelector('#askQ').focus(); } };
    el.querySelector('#askX').onclick = close; el.onclick = e => { if (e.target === el) close(); };
    el.querySelector('#askGo').onclick = ask;
    el.querySelector('#askQ').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask(); };
    addEventListener('keydown', e => { if (e.key === 'Escape' && el && !el.hidden) close(); });
  }
  function close() { el.hidden = true; cancelAnimationFrame(raf); raf = 0; views = []; }
  function strip(cv, buf) { const N = buf.length / 3; if (!cv.width || cv.width === 300) { const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width * 2) || 600; cv.height = Math.round(r.height * 2) || 32; } const x = cv.getContext('2d'), cw = cv.width / N; for (let i = 0; i < N; i++) { x.fillStyle = 'rgb(' + buf[i * 3] + ',' + buf[i * 3 + 1] + ',' + buf[i * 3 + 2] + ')'; x.fillRect(i * cw, 0, Math.ceil(cw), cv.height); } }
  function loop(now) { const dt = Math.min(.1, (now - (last || now)) / 1000); last = now; t += dt * 1000; for (const v of views) strip(v.cv, g.TLBuilder.render(v.v, v.P, t)); raf = requestAnimationFrame(loop); }
  async function ask() {
    const q = el.querySelector('#askQ').value.trim(); if (!q) { el.querySelector('#askQ').focus(); return; }
    const S = el.querySelector('#askS'), go = el.querySelector('#askGo'); go.disabled = true; S.className = 'st'; el.querySelector('#askR').innerHTML = '';
    const t0 = Date.now(), tick = setInterval(() => S.textContent = 'The AI service is looking at your look… ' + Math.round((Date.now() - t0) / 1000) + ' s (usually 20–60 s)', 500);
    try {
      const M = g.TLMotions, body = { prompt: q, name: ctx.name, bri: ctx.P.bri, stack: ctx.P.stack, runs: g.TLBuilder.runs().map(r => r.name), motions: M.LIST.map(m => ({ id: m.id, name: m.name, cat: m.cat, desc: m.desc, amWord: m.amWord })) };
      body.stack = clone(body.stack); body.stack.layers.forEach(L => { if (L.src.kind === 'fx') L.src.fxName = (g.TLFX && g.TLFX.names[L.src.fx]) || L.src.fx; });
      const r = await fetch('/api/ai/stack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || 'Something went wrong');
      S.textContent = ''; showResult(r);
    } catch (e) { S.className = 'st err'; S.textContent = e.message; }
    clearInterval(tick); go.disabled = false;
  }
  function showResult(r) {
    const R = el.querySelector('#askR');
    const opts = r.options.map(o => ({ o, P: applyOps(ctx.P, o.ops) }));
    R.innerHTML = (r.explain ? '<div class="ex">' + esc(r.explain) + '</div>' : '') + '<div class="opts">' + opts.map((x, i) => '<div class="opt"><div><b>' + (i === 0 ? '★ ' : '') + esc(x.o.title) + '</b><p>' + esc(x.o.why) + '</p></div><button class="use" data-use="' + i + '">Use this</button><canvas></canvas><small>' + x.P.stack.layers.length + ' layer' + (x.P.stack.layers.length > 1 ? 's' : '') + ': ' + x.P.stack.layers.slice().reverse().map(l => esc(l.name)).join(' · ') + '</small></div>').join('') + '</div>';
    views = views.slice(0, 1).concat([...R.querySelectorAll('.opt canvas')].map((cv, i) => ({ cv, v: {}, P: opts[i].P })));
    R.querySelectorAll('[data-use]').forEach(b => b.onclick = () => { const x = opts[+b.dataset.use]; close(); ctx.onApply(x.P, x.o); });
  }
  g.TLAsk = {
    applyOps,
    open(c) {
      mount(); ctx = { name: c.name, P: clone(c.P), onApply: c.onApply };
      el.querySelector('#askT').textContent = '✨ Ask AI to change “' + (c.name || 'this look') + '”';
      el.querySelector('#askR').innerHTML = ''; el.querySelector('#askS').textContent = ''; el.hidden = false;
      views = [{ cv: el.querySelector('#askNow'), v: {}, P: ctx.P }]; last = 0; if (!raf) raf = requestAnimationFrame(loop);
      setTimeout(() => el.querySelector('#askQ').focus(), 30);
    },
  };
})(window);
