/* Local controller settings and direct WLED configuration. No credentials are stored. */
(function () {
  'use strict';
  const KEY = 'trimlight-home-studio-wled-v1';
  const ROUTES = [
    [[0.12, 0.39], [0.28, 0.30], [0.44, 0.39]], [[0.44, 0.39], [0.78, 0.40]],
    [[0.10, 0.51], [0.42, 0.52]], [[0.42, 0.52], [0.78, 0.52]],
    [[0.10, 0.61], [0.42, 0.62]], [[0.42, 0.62], [0.78, 0.61]]
  ];
  const DEFAULT_NAMES = ['Front gable', 'Main eave', 'Garage edge', 'Lower eave', 'Porch line', 'Side eave'];
  const clone = x => JSON.parse(JSON.stringify(x));
  const read = () => {
    let value;
    if (window.TL_SERVER_STATE?.has_settings) value = Object.assign({ mode: 'demo', host: '', outputs: [] }, window.TL_SERVER_STATE.settings || {});
    else { try { value = Object.assign({ mode: 'demo', host: '', outputs: [] }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { value = { mode: 'demo', host: '', outputs: [] }; } }
    if (!Array.isArray(value.outputs)) value.outputs = [];
    if ([2, 4, 6].includes(Number(value.channelCount))) value.channelCount = Number(value.channelCount);
    else {
      const populated = value.outputs.length;
      value.channelCount = populated === 0 ? 4 : populated <= 2 ? 2 : populated <= 4 ? 4 : 6;
    }
    if (value.outputs.length > Number(value.channelCount)) value.channelCount = value.outputs.length <= 4 ? 4 : 6;
    return value;
  };
  const write = x => {
    if (window.TL_SERVER_STATE) { window.TL_SERVER_STATE.settings = x; window.TL_SERVER_STATE.has_settings = true; return; }
    localStorage.setItem(KEY, JSON.stringify(x));
  };
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
    const s = read(), fallback = clone(window.DEMO_DATA.layout);
    const sides = Array.isArray(s.houseSides) && s.houseSides.length ? s.houseSides : [{ id: 'front', label: 'Front' }, { id: 'right', label: 'Right side' }, { id: 'rear', label: 'Rear' }, { id: 'left', label: 'Left side' }, { id: 'shed', label: 'Shed' }];
    const selectedSide = sides.find(x => x.id === s.previewSide) || sides.find(x => x.id === 'front') || sides[0];
    const view = selectedSide ? s.houseViews?.[selectedSide.id] : null;
    const photo = view?.photo || s.photo || fallback.photo;
    const photoSize = view?.photoSize || s.photoSize || fallback.photoSize || [2000, 1500];
    let runs = fallback.runs;
    if (Array.isArray(s.outputs) && s.outputs.length) {
      runs = s.outputs.slice(0, 6).map((o, i) => ({
        id: i + 1, name: o.name || DEFAULT_NAMES[i] || `Output ${i + 1}`, port: i + 1,
        points: Array.isArray(o.points) && o.points.length >= 2 ? clone(o.points) : clone(ROUTES[i] || ROUTES[ROUTES.length - 1]),
        leds: Math.max(1, Math.min(10000, Number(o.leds) || 1)), auto: false, reverse: !!o.reverse
      }));
    }
    const layout = { ...fallback, photo, photoSize, runs };
    if (!Array.isArray(view?.lines) || !view.lines.length) return layout;
    const routes = [];
    for (const line of view.lines) {
      const points = Array.isArray(line.points) ? line.points : [], wires = new Set(line.wireSegments || []);
      let lit = [];
      for (let i = 0; i < points.length - 1; i++) {
        if (wires.has(i)) { if (lit.length > 1) routes.push({ name: line.name || selectedSide.label, points: lit }); lit = []; }
        else { if (!lit.length) lit.push(points[i]); lit.push(points[i + 1]); }
      }
      if (lit.length > 1) routes.push({ name: line.name || selectedSide.label, points: lit });
    }
    if (!routes.length) return layout;
    const total = runs.reduce((n, run) => n + run.leds, 0), visibleRoutes = routes.slice(0, total);
    const lengths = visibleRoutes.map(route => route.points.slice(1).reduce((n, point, i) => n + Math.hypot(point[0] - route.points[i][0], point[1] - route.points[i][1]), 0));
    const lengthTotal = lengths.reduce((a, b) => a + b, 0) || visibleRoutes.length;
    let used = 0;
    layout.mappedPaths = visibleRoutes.map((route, i) => {
      const count = i === visibleRoutes.length - 1 ? total - used : Math.max(1, Math.floor(total * lengths[i] / lengthTotal)); used += count;
      return { name: route.name, points: route.points.map(p => [p[0] / 100, p[1] / 100]), leds: count, reverse: false };
    });
    return layout;
  }
  async function saveSettings(patch) {
    const next = Object.assign(read(), patch || {});
    if (window.TL_SERVER_STATE) {
      const response = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!response.ok) { const failure = await response.json().catch(() => ({})); throw new Error(failure.error || `Could not save settings (HTTP ${response.status}).`); }
    }
    write(next);
    return next;
  }
  const T = window.TLSettings = { key: KEY, read, write, saveSettings, hostOf, layout: getLayout, isReal: () => read().mode === 'wled' };
  function initUI() {
  const mode = document.getElementById('wledMode'), addr = document.getElementById('wledAddress'), channelCount = document.getElementById('wledChannelCount'), lat = document.getElementById('wledLatitude'), lon = document.getElementById('wledLongitude'), rows = document.getElementById('wledOutputs'), result = document.getElementById('wledStatus');
    if (!mode || !addr || !channelCount || !rows || !result) return;
  const setStatus = (message, bad = false) => { result.textContent = message; result.classList.toggle('bad', bad); };
  channelCount.addEventListener('change', () => { const detected = rows.querySelectorAll('.wled-output').length; if (detected > Number(channelCount.value)) setStatus(`${detected} configured outputs exceed the selected ${channelCount.value}-channel capacity. Remove unused rows or select a larger controller.`, true); else setStatus(`${detected} output${detected === 1 ? '' : 's'} configured within the ${channelCount.value}-channel capacity.`); });
  const htmlRow = (o, i) => {
    const order = String(o.order || 'GRB');
    const orders = ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'];
    if (!orders.includes(order)) orders.push(order);
    return `<div class="wled-output" data-output="${i}" data-points="${esc(JSON.stringify(o.points || []))}" data-reverse="${o.reverse ? '1' : '0'}">
      <label>Channel name<input data-name value="${esc(o.name || DEFAULT_NAMES[i] || `Output ${i + 1}`)}" maxlength="24"></label>
      <label>GPIO pin<input data-pin value="${esc(Array.isArray(o.pin) ? o.pin.join(', ') : o.pin ?? '')}" readonly aria-label="WLED output pin"></label>
      <label>LEDs on channel<input data-leds type="number" min="1" max="10000" step="1" value="${Math.max(1, Number(o.leds) || 1)}" required></label>
      <label>Roofline mapping<small>${o.points?.length >= 2 ? `${o.points.length} legacy points · use the house mapper below for elevations` : 'Use the house mapper below to trace elevations'}</small></label>
      <label>Color order<select data-order>${orders.map(x => `<option${x === order ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      ${mode.value === 'demo' ? `<button type="button" class="hm-small danger" data-remove-demo="${i}">Remove channel</button>` : ''}
    </div>`;
  };
  function drawRows(outputs) { rows.innerHTML = outputs.map(htmlRow).join(''); }
  rows.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-demo]'); if (!remove || mode.value !== 'demo') return;
    const outputs = readRows(); outputs.splice(Number(remove.dataset.removeDemo), 1); drawRows(outputs);
    setStatus(`${outputs.length} of ${channelCount.value} channel slots populated. Save demo settings to keep this setup.`);
  });
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
      const hue = ['#62d682', '#7fb3ff', '#ffc46b', '#d99bff', '#ff7f9f', '#75d6d0'][i % 6];
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
    drawing = -1; draft = []; finishMap.disabled = true; undoMap.disabled = true; setStatus('Roofline mapping saved with the controller settings. Continue tracing other output channels.'); drawMap();
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
    const s = read(); mode.value = s.mode || 'demo'; addr.value = s.host || ''; channelCount.value = String([2, 4, 6].includes(Number(s.channelCount)) ? Number(s.channelCount) : ([2, 4, 6].includes(s.outputs?.length) ? s.outputs.length : 4)); lat.value = s.lat ?? ''; lon.value = s.lon ?? '';
    if (s.outputs?.length) drawRows(s.outputs);
    else if (s.mode === 'demo') drawRows(window.DEMO_DATA.layout.runs.map((r, i) => ({ name: r.name, leds: r.leds, pin: '', order: 'GRB' })));
    else drawRows([]);
    document.getElementById('applyWled').disabled = s.mode === 'wled';
    document.getElementById('demoReset').hidden = s.mode === 'wled';
    document.getElementById('addDemoOutput').hidden = s.mode === 'wled';
    document.getElementById('applyWled').textContent = s.mode === 'wled' ? 'Apply settings & connect' : 'Save demo setup';
    const banner = document.getElementById('modeBanner');
    if (banner) banner.innerHTML = s.mode === 'wled' ? '<b>WLED</b><span>Controller mode · settings saved with this installation</span>' : '<b>DEMO</b><span>A simulated controller · no physical lights are controlled</span>';
  }
  mode.addEventListener('change', () => {
    const s = read();
    if (mode.value === 'wled' && s.mode !== 'wled') drawRows([]);
    if (mode.value === 'demo') drawRows(rows.children.length ? readRows() : window.DEMO_DATA.layout.runs.map(r => ({ name: r.name, leds: r.leds, order: 'GRB' })));
    document.getElementById('applyWled').disabled = mode.value === 'wled';
    document.getElementById('demoReset').hidden = mode.value === 'wled';
    document.getElementById('addDemoOutput').hidden = mode.value !== 'demo';
    document.getElementById('applyWled').textContent = mode.value === 'wled' ? 'Apply settings & connect' : 'Save demo setup';
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
      if (ins.length > 6) throw new Error(`WLED reports ${ins.length} outputs; this setup supports 2, 4, or 6 channels.`);
      const previous = readRows();
      drawRows(ins.map((x, i) => ({ name: previous[i]?.name || DEFAULT_NAMES[i] || `Output ${i + 1}`, pin: x.pin, leds: x.len, order: x.order || 'GRB', points: previous[i]?.points || [], reverse: previous[i]?.reverse })));
      if (cfg.if?.ntp) { lat.value = cfg.if.ntp.lt ?? ''; lon.value = cfg.if.ntp.ln ?? ''; }
      mode.value = 'wled'; document.getElementById('applyWled').disabled = false;
      const selected = Number(channelCount.value), mismatch = ins.length > selected;
      setStatus(`${info.name || 'WLED controller'} connected · ${info.leds?.count ?? cfg.hw.led.total ?? '?'} LEDs · WLED reports ${ins.length} configured outputs; ${selected} channel capacity.${mismatch ? ' Select a larger controller capacity.' : ' Review the per-channel counts, then apply and connect.'}`, mismatch);
      window.__TLWLED_TEST = { host, info, cfg };
    } catch (e) {
      const message = e.name === 'AbortError' ? 'Connection timed out. Check the address and confirm this page is open over HTTP on the same LAN.' : `Could not connect: ${e.message || 'check the address, network, and WLED API access.'}`;
      setStatus(message, true); window.__TLWLED_TEST = null;
    } finally { clearTimeout(timer); }
  });
  document.getElementById('applyWled').addEventListener('click', async () => {
    let host, outputs, latitude, longitude;
    try {
      const isDemo = mode.value === 'demo';
      host = isDemo ? '' : hostOf(addr.value); outputs = readRows();
      const selectedChannels = Number(channelCount.value);
      if (![2, 4, 6].includes(selectedChannels)) throw new Error('Select a 2-, 4-, or 6-channel controller.');
      if (outputs.length > selectedChannels) throw new Error(`${outputs.length} configured outputs exceed the selected ${selectedChannels}-channel capacity. Remove unused rows or select a larger controller.`);
      latitude = lat.value.trim() === '' ? null : Number(lat.value); longitude = lon.value.trim() === '' ? null : Number(lon.value);
      if ((latitude === null) !== (longitude === null)) throw new Error('Enter both latitude and longitude, or leave both blank to keep the WLED location.');
      if (latitude !== null && (!Number.isFinite(latitude) || latitude < -66.6 || latitude > 66.6 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new Error('Enter a valid latitude (-66.6 to 66.6) and longitude (-180 to 180).');
      const total = outputs.reduce((n, o) => n + o.leds, 0);
      if (outputs.some(o => !Number.isInteger(o.leds) || o.leds < 1 || o.leds > 10000) || total > 10000) throw new Error('Enter a whole-number LED count from 1 to 10,000 per channel; the total must not exceed 10,000.');
    } catch (e) { return setStatus(e.message, true); }
    if (mode.value === 'demo') {
      try {
        const saved = read();
        const next = { ...saved, mode: 'demo', host: '', channelCount: Number(channelCount.value), outputs, lat: null, lon: null };
        await saveSettings(next);
        setStatus(`Demo setup saved · ${outputs.length} output${outputs.length === 1 ? '' : 's'} configured within the ${next.channelCount}-channel capacity. House photos and traces are saved with this setup.`);
        setTimeout(() => { history.replaceState(null, '', location.pathname + location.search); location.reload(); }, 500);
      } catch (e) { setStatus(`Could not save demo settings: ${e.message || e}`, true); }
      return;
    }
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
      const saved = read();
      const next = { ...saved, mode: 'wled', host, channelCount: selectedChannels, outputs, lat: latitude, lon: longitude, photo: saved.photo || '', photoSize: saved.photoSize || [2000, 1500], houseViews: saved.houseViews || {} };
      if (changed) {
        setStatus('Applying channel counts and color order to WLED…');
        const res = await fetch(`http://${host}/json/cfg`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
        if (!res.ok) throw new Error(`WLED rejected the configuration (HTTP ${res.status}).`);
      }
      const stored = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!stored.ok) { const failure = await stored.json().catch(() => ({})); throw new Error(failure.error || `Server could not save the settings (HTTP ${stored.status}).`); }
      write(next);
      try { localStorage.removeItem('tlstudio-demo-v1'); } catch { }
      setStatus(changed ? 'Settings applied. WLED may restart; reconnecting…' : 'Settings saved. Connecting to WLED…');
      setTimeout(() => location.reload(), changed ? 3500 : 500);
    } catch (e) { setStatus(`Could not apply settings: ${e.message || e}`, true); }
  });
  document.getElementById('demoReset').addEventListener('click', async () => {
    try { localStorage.removeItem('tlstudio-demo-v1'); } catch { }
    const next = { mode: 'demo', host: '', channelCount: 4, outputs: [], photo: '', photoSize: [2000, 1500] };
    if (window.TL_SERVER_STATE) {
      const saved = await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!saved.ok) return setStatus('Could not save demo mode to the server.', true);
    }
    write(next); location.reload();
  });
  document.getElementById('addDemoOutput')?.addEventListener('click', () => {
    if (mode.value !== 'demo') return;
    const outputs = readRows(), capacity = Number(channelCount.value);
    if (outputs.length >= capacity) return setStatus(`All ${capacity} channel slots are already populated.`, true);
    outputs.push({ name: DEFAULT_NAMES[outputs.length] || `Output ${outputs.length + 1}`, leds: 100, order: 'GRB', pin: '', points: [] });
    drawRows(outputs); setStatus(`${outputs.length} of ${capacity} channel slots populated. Save demo settings to keep this setup.`);
  });
  loadForm(); drawMap();
  if (window.TL_SERVER_STATE && !window.TL_SERVER_STATE.has_settings) {
    try { const legacy = localStorage.getItem(KEY); if (legacy) fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: legacy }).then(r => { if (r.ok) localStorage.removeItem(KEY); }); } catch { }
  }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI, { once: true }); else initUI();
})();
