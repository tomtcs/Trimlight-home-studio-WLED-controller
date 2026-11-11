/* Local controller settings and direct WLED configuration. No credentials are stored. */
(function () {
  'use strict';
  const KEY = 'trimlight-home-studio-wled-v1';
  const ROUTES = [
    [[0.12, 0.39], [0.28, 0.30], [0.44, 0.39]],
    [[0.44, 0.39], [0.78, 0.40]],
    [[0.10, 0.51], [0.42, 0.52]],
    [[0.42, 0.52], [0.78, 0.52]]
  ];
  const DEFAULT_NAMES = ['Front gable', 'Main eave', 'Garage edge', 'Lower eave'];
  const clone = x => JSON.parse(JSON.stringify(x));
  const read = () => {
    try { return Object.assign({ mode: 'demo', host: '', outputs: [] }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch { return { mode: 'demo', host: '', outputs: [] }; }
  };
  const write = x => localStorage.setItem(KEY, JSON.stringify(x));
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hostOf(value) {
    let input = String(value || '').trim();
    if (!input) throw new Error('Enter the WLED controller IP address or hostname.');
    if (/^https:\/\//i.test(input)) throw new Error('WLED uses HTTP for its local API. Serve this app over HTTP on your LAN, or use a trusted local proxy.');
    if (/^http:\/\//i.test(input)) input = input.slice(7);
    if (/[/?#@]/.test(input)) throw new Error('Enter only the IP address or hostname, without a path or credentials.');
    const u = new URL('http://' + input);
    if (!u.hostname || u.username || u.password || u.port && (+u.port < 1 || +u.port > 65535)) throw new Error('That controller address is not valid.');
    return u.host;
  }
  function getLayout() {
    const s = read();
    if (s.mode !== 'wled' || !Array.isArray(s.outputs) || !s.outputs.length) return clone(window.DEMO_DATA.layout);
    const outputs = s.outputs.slice(0, 4);
    let start = 0;
    return {
      photo: s.photo || 'demo-house.svg', photoSize: s.photoSize || [2000, 1500], nextId: outputs.length + 1,
      settings: { ledSpacing: 20, ledSize: 1.4 },
      runs: outputs.map((o, i) => {
        const leds = Math.max(1, Math.min(10000, Number(o.leds) || 1));
        const row = { id: i + 1, name: o.name || DEFAULT_NAMES[i] || `Output ${i + 1}`, port: i + 1, points: Array.isArray(o.points) && o.points.length >= 2 ? clone(o.points) : clone(ROUTES[i]), leds, auto: false, reverse: !!o.reverse, start };
        start += leds;
        return row;
      })
    };
  }
  const T = window.TLSettings = { key: KEY, read, write, hostOf, layout: getLayout, isReal: () => read().mode === 'wled' };
  function initUI() {
  const mode = document.getElementById('wledMode'), addr = document.getElementById('wledAddress'), lat = document.getElementById('wledLatitude'), lon = document.getElementById('wledLongitude'), rows = document.getElementById('wledOutputs'), result = document.getElementById('wledStatus');
  if (!mode || !addr || !rows || !result) return;
  const setStatus = (message, bad = false) => { result.textContent = message; result.classList.toggle('bad', bad); };
  const htmlRow = (o, i) => {
    const order = String(o.order || 'GRB');
    const orders = ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'];
    if (!orders.includes(order)) orders.push(order);
    return `<div class="wled-output" data-output="${i}" data-points="${esc(JSON.stringify(o.points || []))}" data-reverse="${o.reverse ? '1' : '0'}">
      <label>Channel name<input data-name value="${esc(o.name || DEFAULT_NAMES[i] || `Output ${i + 1}`)}" maxlength="24"></label>
      <label>GPIO pin<input data-pin value="${esc(Array.isArray(o.pin) ? o.pin.join(', ') : o.pin ?? '')}" readonly aria-label="WLED output pin"></label>
      <label>LEDs on channel<input data-leds type="number" min="1" max="10000" step="1" value="${Math.max(1, Number(o.leds) || 1)}" required></label>
      <label>Roofline mapping<button type="button" class="map-run" data-trace>${o.points?.length >= 2 ? 'Edit traced line' : 'Trace roofline'}</button><small data-mapstat>${o.points?.length >= 2 ? `${o.points.length} points mapped` : 'Using preview route'}</small></label>
      <label>Color order<select data-order>${orders.map(x => `<option${x === order ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
    </div>`;
  };
  function drawRows(outputs) { rows.innerHTML = outputs.map(htmlRow).join(''); }
  function readRows() {
    return [...rows.querySelectorAll('.wled-output')].map((r, i) => ({
      name: r.querySelector('[data-name]').value.trim() || DEFAULT_NAMES[i] || `Output ${i + 1}`,
      pin: r.querySelector('[data-pin]').value,
      leds: Number(r.querySelector('[data-leds]').value),
      order: r.querySelector('[data-order]').value,
      points: JSON.parse(r.dataset.points || '[]'), reverse: r.dataset.reverse === '1'
    }));
  }
  const photoInput = document.getElementById('wledPhoto'), mapCanvas = document.getElementById('roofMap'), finishMap = document.getElementById('finishMap'), undoMap = document.getElementById('undoMap');
  let savedPhoto = read().photo || '', photoSize = read().photoSize || [2000, 1500], photoImg = null, drawing = -1, draft = [], mapRect = null;
  function drawMap() {
    if (!mapCanvas) return;
    const box = mapCanvas.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    mapCanvas.width = Math.max(1, Math.round(box.width * dpr)); mapCanvas.height = Math.max(1, Math.round(box.height * dpr));
    const ctx = mapCanvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#0b0e0d'; ctx.fillRect(0, 0, box.width, box.height); mapRect = null;
    if (photoImg?.complete && photoImg.naturalWidth) {
      const scale = Math.min(box.width / photoImg.naturalWidth, box.height / photoImg.naturalHeight), w = photoImg.naturalWidth * scale, h = photoImg.naturalHeight * scale, x = (box.width - w) / 2, y = (box.height - h) / 2;
      ctx.drawImage(photoImg, x, y, w, h); mapRect = { x, y, w, h };
    } else {
      ctx.fillStyle = '#98a79d'; ctx.font = '14px Inter,system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Upload a clear photo of the front of your home to trace rooflines', box.width / 2, box.height / 2);
    }
    const outputs = readRows();
    outputs.forEach((o, i) => {
      const pts = i === drawing ? draft : o.points;
      if (!pts?.length || !mapRect) return;
      const hue = ['#62d682', '#7fb3ff', '#ffc46b', '#d99bff'][i % 4];
      ctx.strokeStyle = hue; ctx.fillStyle = hue; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach((p, k) => { const x = mapRect.x + p[0] * mapRect.w, y = mapRect.y + p[1] * mapRect.h; if (!k) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
      pts.forEach((p, k) => { const x = mapRect.x + p[0] * mapRect.w, y = mapRect.y + p[1] * mapRect.h; ctx.beginPath(); ctx.arc(x, y, k === 0 ? 6 : 4.5, 0, Math.PI * 2); ctx.fill(); });
      const p = pts[Math.floor(pts.length / 2)]; if (p) { ctx.font = '600 12px Inter,system-ui,sans-serif'; ctx.textAlign = 'left'; ctx.fillText(o.name || `Output ${i + 1}`, mapRect.x + p[0] * mapRect.w + 7, mapRect.y + p[1] * mapRect.h - 8); }
    });
  }
  function drawPhoto(data) {
    savedPhoto = data || ''; photoImg = null;
    if (savedPhoto) { photoImg = new Image(); photoImg.onload = drawMap; photoImg.onerror = () => setStatus('The saved home photo could not be loaded. Upload it again.', true); photoImg.src = savedPhoto; }
    drawMap();
  }
  rows.addEventListener('click', e => {
    const b = e.target.closest('[data-trace]'); if (!b) return;
    const row = b.closest('.wled-output'); drawing = Number(row.dataset.output); draft = [];
    if (!savedPhoto) setStatus('Upload a home photo, then click along the selected channel’s roofline.');
    else setStatus(`Tracing ${row.querySelector('[data-name]').value || `Output ${drawing + 1}`} · click points in data-flow order, then finish.`);
    if (finishMap) finishMap.disabled = !savedPhoto;
    if (undoMap) undoMap.disabled = true;
    drawMap(); mapCanvas?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  mapCanvas?.addEventListener('click', e => {
    if (drawing < 0) return setStatus('Select “Trace roofline” for an output channel first.');
    if (!mapRect) return setStatus('Upload a home photo before placing roofline points.');
    const box = mapCanvas.getBoundingClientRect(), x = e.clientX - box.left, y = e.clientY - box.top;
    if (x < mapRect.x || y < mapRect.y || x > mapRect.x + mapRect.w || y > mapRect.y + mapRect.h) return;
    draft.push([+((x - mapRect.x) / mapRect.w).toFixed(5), +((y - mapRect.y) / mapRect.h).toFixed(5)]);
    if (finishMap) finishMap.disabled = draft.length < 2;
    if (undoMap) undoMap.disabled = !draft.length;
    drawMap();
  });
  finishMap?.addEventListener('click', () => {
    if (drawing < 0 || draft.length < 2) return;
    const row = rows.querySelector(`.wled-output[data-output="${drawing}"]`);
    row.dataset.points = JSON.stringify(draft); row.querySelector('[data-mapstat]').textContent = `${draft.length} points mapped`; row.querySelector('[data-trace]').textContent = 'Edit traced line';
    drawing = -1; draft = []; finishMap.disabled = true; undoMap.disabled = true; setStatus('Roofline saved in this browser. Continue tracing other output channels.'); drawMap();
  });
  undoMap?.addEventListener('click', () => { draft.pop(); finishMap.disabled = draft.length < 2; undoMap.disabled = !draft.length; drawMap(); });
  photoInput?.addEventListener('change', () => {
    const file = photoInput.files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/')) return setStatus('Choose an image file such as JPG, PNG, or WebP.', true);
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / img.naturalWidth, 1200 / img.naturalHeight), w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale), cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(img, 0, 0, w, h);
      const data = cv.toDataURL('image/jpeg', .78); URL.revokeObjectURL(url);
      if (data.length > 2200000) return setStatus('This image is still too large for browser storage. Choose a smaller or lower-resolution photo.', true);
      savedPhoto = data; photoSize = [w, h]; drawing = -1; draft = [];
      rows.querySelectorAll('.wled-output').forEach(row => { row.dataset.points = '[]'; row.querySelector('[data-mapstat]').textContent = 'Trace this photo'; row.querySelector('[data-trace]').textContent = 'Trace roofline'; });
      photoImg = new Image(); photoImg.onload = drawMap; photoImg.src = data; setStatus('Home photo loaded. Trace each WLED output channel in the order its LEDs run.');
    };
    img.onerror = () => { URL.revokeObjectURL(url); setStatus('Could not read that image. Try a JPG, PNG, or WebP photo.', true); }; img.src = url;
  });
  window.addEventListener('resize', drawMap);
  if (savedPhoto) drawPhoto(savedPhoto);
  function loadForm() {
    const s = read(); mode.value = s.mode || 'demo'; addr.value = s.host || ''; lat.value = s.lat ?? ''; lon.value = s.lon ?? '';
    if (s.outputs?.length) drawRows(s.outputs);
    else if (s.mode === 'demo') drawRows(window.DEMO_DATA.layout.runs.map((r, i) => ({ name: r.name, leds: r.leds, pin: '', order: 'GRB' })));
    else drawRows([]);
    document.getElementById('applyWled').disabled = s.mode !== 'wled';
    document.getElementById('demoReset').hidden = s.mode === 'wled';
    const banner = document.getElementById('modeBanner');
    if (banner) banner.innerHTML = s.mode === 'wled' ? '<b>WLED</b><span>Controller mode · settings stay in this browser</span>' : '<b>DEMO</b><span>A simulated controller · no physical lights are controlled</span>';
  }
  mode.addEventListener('change', () => {
    const s = read();
    if (mode.value === 'wled' && s.mode !== 'wled') drawRows([]);
    if (mode.value === 'demo' && !rows.children.length) drawRows(window.DEMO_DATA.layout.runs.map(r => ({ name: r.name, leds: r.leds, order: 'GRB' })));
    document.getElementById('applyWled').disabled = mode.value !== 'wled';
    document.getElementById('demoReset').hidden = mode.value === 'wled';
  });
  document.getElementById('testWled').addEventListener('click', async () => {
    let host;
    try { host = hostOf(addr.value); } catch (e) { return setStatus(e.message, true); }
    setStatus('Connecting to WLED…');
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 6000);
    try {
      const [siRes, cfgRes] = await Promise.all([
        fetch(`http://${host}/json/si`, { cache: 'no-store', signal: ac.signal }),
        fetch(`http://${host}/json/cfg`, { cache: 'no-store', signal: ac.signal })
      ]);
      if (!siRes.ok || !cfgRes.ok) throw new Error(`WLED returned HTTP ${siRes.status || cfgRes.status}.`);
      const si = await siRes.json(), cfg = await cfgRes.json(), info = si.info || {};
      const ins = cfg.hw?.led?.ins || [];
      if (!ins.length) throw new Error('WLED responded, but no LED outputs were found in /json/cfg.');
      const previous = readRows();
      drawRows(ins.map((x, i) => ({ name: previous[i]?.name || DEFAULT_NAMES[i] || `Output ${i + 1}`, pin: x.pin, leds: x.len, order: x.order || 'GRB', points: previous[i]?.points || [], reverse: previous[i]?.reverse })));
      if (cfg.if?.ntp) { lat.value = cfg.if.ntp.lt ?? ''; lon.value = cfg.if.ntp.ln ?? ''; }
      mode.value = 'wled'; document.getElementById('applyWled').disabled = false;
      setStatus(`${info.name || 'WLED controller'} connected · ${info.leds?.count ?? cfg.hw.led.total ?? '?'} LEDs · ${ins.length} output channel${ins.length === 1 ? '' : 's'}. Review the per-channel counts, then apply and connect.`);
      window.__TLWLED_TEST = { host, info, cfg };
    } catch (e) {
      const message = e.name === 'AbortError' ? 'Connection timed out. Check the address and confirm this page is open over HTTP on the same LAN.' : `Could not connect: ${e.message || 'check the address, network, and WLED API access.'}`;
      setStatus(message, true); window.__TLWLED_TEST = null;
    } finally { clearTimeout(timer); }
  });
  document.getElementById('applyWled').addEventListener('click', async () => {
    let host, outputs;
    try {
      host = hostOf(addr.value); outputs = readRows();
      if (!outputs.length || outputs.length > 4) throw new Error('WLED must report one to four output channels.');
      const latitude = lat.value.trim() === '' ? null : Number(lat.value), longitude = lon.value.trim() === '' ? null : Number(lon.value);
      if ((latitude === null) !== (longitude === null)) throw new Error('Enter both latitude and longitude, or leave both blank to keep the WLED location.');
      if (latitude !== null && (!Number.isFinite(latitude) || latitude < -66.6 || latitude > 66.6 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new Error('Enter a valid latitude (-66.6 to 66.6) and longitude (-180 to 180).');
      const total = outputs.reduce((n, o) => n + o.leds, 0);
      if (outputs.some(o => !Number.isInteger(o.leds) || o.leds < 1 || o.leds > 10000) || total > 10000) throw new Error('Enter a whole-number LED count from 1 to 10,000 per channel; the total must not exceed 10,000.');
    } catch (e) { return setStatus(e.message, true); }
    setStatus('Reading the current WLED configuration…');
    try {
      const cfgRes = await fetch(`http://${host}/json/cfg`, { cache: 'no-store' });
      if (!cfgRes.ok) throw new Error(`WLED returned HTTP ${cfgRes.status}.`);
      const cfg = await cfgRes.json(), ins = cfg.hw?.led?.ins;
      if (!Array.isArray(ins) || ins.length !== outputs.length) throw new Error('The number of rows must match the outputs WLED currently reports. Test the connection again to reload them.');
      let start = 0, changed = false;
      outputs.forEach((o, i) => {
        if (ins[i].start !== start || ins[i].len !== o.leds || ins[i].order !== o.order) changed = true;
        ins[i].start = start; ins[i].len = o.leds; ins[i].order = o.order; start += o.leds;
      });
      cfg.hw.led.total = start;
      if (latitude !== null && longitude !== null) {
        cfg.if = cfg.if || {}; cfg.if.ntp = cfg.if.ntp || {};
        if (cfg.if.ntp.lt !== latitude || cfg.if.ntp.ln !== longitude) changed = true;
        cfg.if.ntp.lt = latitude; cfg.if.ntp.ln = longitude;
      }
      const next = { mode: 'wled', host, outputs, lat: latitude, lon: longitude, photo: savedPhoto, photoSize };
      if (changed) {
        setStatus('Applying channel counts and color order to WLED…');
        const res = await fetch(`http://${host}/json/cfg`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
        if (!res.ok) throw new Error(`WLED rejected the configuration (HTTP ${res.status}).`);
      }
      write(next);
      try { localStorage.removeItem('tlstudio-demo-v1'); } catch { }
      setStatus(changed ? 'Settings applied. WLED may restart; reconnecting…' : 'Settings saved. Connecting to WLED…');
      setTimeout(() => location.reload(), changed ? 3500 : 500);
    } catch (e) { setStatus(`Could not apply settings: ${e.message || e}`, true); }
  });
  document.getElementById('demoReset').addEventListener('click', () => {
    try { localStorage.removeItem('tlstudio-demo-v1'); } catch { }
    write({ mode: 'demo', host: '', outputs: [] }); location.reload();
  });
  loadForm(); drawMap();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI, { once: true }); else initUI();
})();
