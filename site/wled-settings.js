/* Local controller settings and direct WLED configuration. No credentials are stored. */
(function () {
  'use strict';
  const KEY = 'trimlight-home-studio-wled-v1';
  const ROUTES = [
    [[0.12, 0.39], [0.28, 0.30], [0.44, 0.39]], [[0.44, 0.39], [0.78, 0.40]],
    [[0.10, 0.51], [0.42, 0.52]], [[0.42, 0.52], [0.78, 0.52]],
    [[0.10, 0.61], [0.42, 0.62]], [[0.42, 0.62], [0.78, 0.61]]
  ];
  // WLED /json/cfg LED bus types with both RGB and white channels.
  const RGBW_BUS_TYPES = new Set([28, 29, 30, 31, 32, 34, 35, 44, 45, 88, 89]);
  function whiteCapabilities(ledConfig, bus) {
    const globalMode = ledConfig.rgbwm ?? 255;
    const mode = globalMode === 255 ? (bus.rgbwm ?? 0) : globalMode;
    return { rgbw: RGBW_BUS_TYPES.has(bus.type), manualWhite: mode === 0 || mode === 3 };
  }
  const DEFAULT_NAMES = ['Front gable', 'Main eave', 'Garage edge', 'Lower eave', 'Porch line', 'Side eave'];
  const clone = x => JSON.parse(JSON.stringify(x));
  const localTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const read = () => {
    let value;
    if (window.TL_SERVER_STATE?.has_settings) value = Object.assign({ mode: 'demo', host: '', outputs: [] }, window.TL_SERVER_STATE.settings || {});
    else if (window.TL_SERVER_STATE?.controller && window.TL_SERVER_STATE.controller !== 'primary') value = { mode: 'demo', host: '', outputs: [] };
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
        id: i + 1, name: o.name || `Output ${i + 1}`, port: i + 1,
        points: Array.isArray(o.points) && o.points.length >= 2 ? clone(o.points) : clone(ROUTES[i] || ROUTES[ROUTES.length - 1]),
        leds: Math.max(1, Math.min(10000, Number(o.leds) || 1)), auto: false, reverse: !!o.reverse, landscape: o.use === 'landscape', rgbw: o.rgbw === true, manualWhite: o.manualWhite
      }));
    }
    const layout = { ...fallback, photo, photoSize, runs, landscape: [] };
    let offset = 0;
    runs.forEach(run => { run.start = offset; offset += run.leds; });
    const reserved = new Set();
    const visibleLandscape = [];
    for (const run of runs) {
      if (run.landscape) for (let i = run.start; i < run.start + run.leds; i++) reserved.add(i);
    }
    for (const [side, houseView] of Object.entries(s.houseViews || {})) {
      for (const line of houseView.lines || []) {
        if (line.kind !== 'landscape') continue;
        const run = runs[line.output - 1];
        if (!run || !(1 <= line.first && line.first <= line.last && line.last <= run.leds)) continue;
        const start = run.start + line.first - 1, stop = run.start + line.last;
        const zone = { id: `landscape:${side}:${line.id}`, name: line.name, start, stop };
        layout.landscape.push(zone);
        for (let i = start; i < stop; i++) reserved.add(i);
        if (side === selectedSide.id) visibleLandscape.push({ line, zone });
      }
    }
    if (!view?.lines?.length && !reserved.size) return layout;
    const pathsFor = line => {
      if (line.points.length === 1) return [line.points.map(point => point.map(x => x / 100))];
      const wires = new Set(line.wireSegments || []), pieces = [];
      let lit = [];
      for (let i = 0; i < line.points.length - 1; i++) {
        if (wires.has(i)) {
          if (lit.length) pieces.push(lit);
          lit = [];
        } else {
          if (!lit.length) lit.push(line.points[i]);
          lit.push(line.points[i + 1]);
        }
      }
      if (lit.length) pieces.push(lit);
      return pieces.map(piece => piece.map(point => point.map(x => x / 100)));
    };
    const divide = (paths, indices) => {
      const spans = paths.slice(0, indices.length);
      const ratio = photoSize[1] / photoSize[0];
      const lengths = spans.map(path => path.slice(1).reduce((len, point, i) => (
        len + Math.hypot(point[0] - path[i][0], (point[1] - path[i][1]) * ratio)
      ), 0));
      const length = lengths.reduce((sum, value) => sum + value, 0);
      let used = 0, distance = 0;
      return spans.map((points, i) => {
        distance += lengths[i];
        const share = length ? distance / length : (i + 1) / spans.length;
        const end = i === spans.length - 1 ? indices.length : i + 1 + Math.round((indices.length - spans.length) * share);
        const part = { points, indices: indices.slice(used, end) };
        used = end;
        return part;
      });
    };
    const indices = (from, to) => Array.from({ length: to - from }, (_, i) => i + from);
    const roofPaths = (view?.lines || []).filter(line => line.kind !== 'landscape').flatMap(pathsFor);
    const roofIndices = indices(0, offset).filter(i => !reserved.has(i));
    if (roofPaths.length) layout.mappedPaths = divide(roofPaths, roofIndices);
    else if (!view?.photo) {
      layout.mappedPaths = runs.flatMap(run => {
        const unreserved = indices(run.start, run.start + run.leds).filter(i => !reserved.has(i));
        if (run.reverse) unreserved.reverse();
        return divide([run.points], unreserved);
      });
    } else layout.mappedPaths = [];
    for (const { line, zone } of visibleLandscape) {
      layout.mappedPaths.push(...divide(pathsFor(line), indices(zone.start, zone.stop)));
    }
    return layout;
  }

  async function saveSettings(patch) {
    const next = Object.assign(read(), patch || {});
    if (window.TL_SERVER_STATE) {
      const response = await fetch(window.TLApi('/api/settings'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
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
    const order = String(o.order ?? 'GRB');
    const orders = /^\d+$/.test(order) ? ['0', '1', '2', '3', '4', '5'] : ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'];
    const labels = ['GRB', 'RGB', 'BRG', 'RBG', 'BGR', 'GBR'];
    if (!orders.includes(order)) orders.push(order);
    return `<div class="wled-output" data-output="${i}" data-rgbw="${o.rgbw === true ? 1 : 0}" data-points="${esc(JSON.stringify(o.points || []))}" data-reverse="${o.reverse ? '1' : '0'}">
      <label>Output ${i + 1} name${o.rgbw === true ? ' · RGBW' : ''}<input data-name value="${esc(o.name || DEFAULT_NAMES[i] || `Output ${i + 1}`)}" maxlength="24"></label>
      <label>GPIO pin<input data-pin value="${esc(Array.isArray(o.pin) ? o.pin.join(', ') : o.pin ?? '')}" readonly aria-label="WLED output pin"></label>
      <label>LEDs on channel<input data-leds type="number" min="1" max="10000" step="1" value="${Math.max(1, Number(o.leds) || 1)}" required></label>
      <label>Lighting use<select data-use><option value="roof"${o.use !== 'landscape' ? ' selected' : ''}>Roofline</option><option value="landscape"${o.use === 'landscape' ? ' selected' : ''}>Landscape</option></select></label>
      <label>Color order<select data-order>${orders.map(x => `<option value="${esc(x)}"${x === order ? ' selected' : ''}>${esc(labels[x] || x)}</option>`).join('')}</select></label>
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
      use: r.querySelector('[data-use]').value,
      rgbw: r.dataset.rgbw === '1', points: JSON.parse(r.dataset.points || '[]'), reverse: r.dataset.reverse === '1'
    }));
  }
  const demoRows = () => window.DEMO_DATA.layout.runs.slice(0, Number(channelCount.value)).map(r => ({ name: r.name, leds: r.leds, pin: '', order: 'GRB' }));
  function loadForm() {
    const s = read(); mode.value = s.mode || 'demo'; addr.value = s.host || ''; channelCount.value = String([2, 4, 6].includes(Number(s.channelCount)) ? Number(s.channelCount) : ([2, 4, 6].includes(s.outputs?.length) ? s.outputs.length : 4)); lat.value = s.lat ?? ''; lon.value = s.lon ?? '';
    if (s.outputs?.length) drawRows(s.outputs);
    else if (s.mode === 'demo') drawRows(demoRows());
    else drawRows([]);
    document.getElementById('applyWled').disabled = s.mode === 'wled';
    document.getElementById('demoReset').hidden = s.mode === 'wled';
    document.getElementById('addDemoOutput').hidden = s.mode === 'wled';
    document.getElementById('applyWled').textContent = s.mode === 'wled' ? 'Apply settings & connect' : 'Save demo setup';
    const banner = document.getElementById('modeBanner');
    if (banner) {
      const name = window.TL_SERVER_STATE?.controllers?.[window.TL_SERVER_STATE.controller];
      banner.querySelector('b').textContent = s.mode === 'wled' ? 'WLED' : 'DEMO';
      banner.querySelector('span').textContent = s.mode === 'wled' ? (name || 'WLED controller') : `${name || 'Demo controller'} · simulated lights`;
    }
  }
  addr.addEventListener('input', () => {
    window.__TLWLED_TEST = null;
    if (mode.value === 'wled') document.getElementById('applyWled').disabled = true;
  });
  mode.addEventListener('change', () => {
    const s = read();
    if (mode.value === 'wled' && s.mode !== 'wled') drawRows([]);
    if (mode.value === 'demo') drawRows(rows.children.length ? readRows() : demoRows());
    document.getElementById('applyWled').disabled = mode.value === 'wled';
    document.getElementById('demoReset').hidden = mode.value === 'wled';
    document.getElementById('addDemoOutput').hidden = mode.value !== 'demo';
    document.getElementById('applyWled').textContent = mode.value === 'wled' ? 'Apply settings & connect' : 'Save demo setup';
  });
  const test = document.getElementById('testWled'), apply = document.getElementById('applyWled');
  test.addEventListener('click', async () => {
    let host;
    try { host = hostOf(addr.value); } catch (e) { return setStatus(e.message, true); }
    test.disabled = true;
    if (mode.value === 'wled') apply.disabled = true;
    window.__TLWLED_TEST = null;
    setStatus('Connecting to WLED…');
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 6000);
    try {
      const [siRes, cfgRes] = await Promise.all([
        fetch(`http://${host}/json/si`, { cache: 'no-store', signal: ac.signal }),
        fetch(`http://${host}/json/cfg`, { cache: 'no-store', signal: ac.signal })
      ]);
      if (!siRes.ok || !cfgRes.ok) throw new Error(`WLED returned HTTP ${siRes.status || cfgRes.status}.`);
      const si = await siRes.json(), cfg = await cfgRes.json(), info = si.info || {};
      if (hostOf(addr.value) !== host) throw new Error('The address changed. Test the current address.');
      const ins = cfg.hw?.led?.ins || [];
      if (!ins.length) throw new Error('WLED responded, but no LED outputs were found in /json/cfg.');
      if (ins.length > 6) throw new Error(`WLED reports ${ins.length} outputs; this setup supports 2, 4, or 6 channels.`);
      const previous = mode.value === 'wled' ? readRows() : [];
      mode.value = 'wled';
      drawRows(ins.map((x, i) => ({ name: previous[i]?.name || `Output ${i + 1}`, pin: x.pin, leds: x.len, order: x.order ?? 'GRB', ...whiteCapabilities(cfg.hw.led, x), points: previous[i]?.points || [], reverse: previous[i]?.reverse, use: previous[i]?.use })));
      if (cfg.if?.ntp) { lat.value = cfg.if.ntp.lt ?? ''; lon.value = cfg.if.ntp.ln ?? ''; }
      document.getElementById('applyWled').disabled = false;
      document.getElementById('demoReset').hidden = true;
      document.getElementById('addDemoOutput').hidden = true;
      document.getElementById('applyWled').textContent = 'Apply settings & connect';
      const selected = Number(channelCount.value), mismatch = ins.length > selected;
      setStatus(`${info.name || 'WLED controller'} connected · ${info.leds?.count ?? cfg.hw.led.total ?? '?'} LEDs · WLED reports ${ins.length} configured outputs; ${selected} channel capacity.${mismatch ? ' Select a larger controller capacity.' : ' Review the per-channel counts, then apply and connect.'}`, mismatch);
      window.__TLWLED_TEST = { host, info, cfg };
    } catch (e) {
      const message = e.name === 'AbortError' ? 'Connection timed out. Check the address and confirm this page is open over HTTP on the same LAN.' : `Could not connect: ${e.message || 'check the address, network, and WLED API access.'}`;
      setStatus(message, true); window.__TLWLED_TEST = null;
    } finally { test.disabled = false; clearTimeout(timer); }
  });
  apply.addEventListener('click', async () => {
    let host, outputs, latitude, longitude, selectedChannels;
    try {
      const isDemo = mode.value === 'demo';
      host = isDemo ? '' : hostOf(addr.value); outputs = readRows();
      selectedChannels = Number(channelCount.value);
      if (![2, 4, 6].includes(selectedChannels)) throw new Error('Select a 2-, 4-, or 6-channel controller.');
      if (outputs.length > selectedChannels) throw new Error(`${outputs.length} configured outputs exceed the selected ${selectedChannels}-channel capacity. Remove unused rows or select a larger controller.`);
      latitude = lat.value.trim() === '' ? null : Number(lat.value); longitude = lon.value.trim() === '' ? null : Number(lon.value);
      if ((latitude === null) !== (longitude === null)) throw new Error('Enter both latitude and longitude, or leave both blank to keep the WLED location.');
      if (latitude !== null && (!Number.isFinite(latitude) || latitude < -66.6 || latitude > 66.6 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)) throw new Error('Enter a valid latitude (-66.6 to 66.6) and longitude (-180 to 180).');
      const total = outputs.reduce((n, o) => n + o.leds, 0);
      if (outputs.some(o => !Number.isInteger(o.leds) || o.leds < 1 || o.leds > 10000) || total > 10000) throw new Error('Enter a whole-number LED count from 1 to 10,000 per channel; the total must not exceed 10,000.');
    } catch (e) { return setStatus(e.message, true); }
    if (mode.value === 'demo') {
      apply.disabled = true;
      try {
        const saved = read();
        const next = { ...saved, mode: 'demo', host: '', channelCount: Number(channelCount.value), outputs, lat: null, lon: null, timezone: localTimezone() };
        await saveSettings(next);
        setStatus(`Demo setup saved · ${outputs.length} output${outputs.length === 1 ? '' : 's'} configured within the ${next.channelCount}-channel capacity. House photos and traces are saved with this setup.`);
        setTimeout(() => location.reload(), 500);
      } catch (e) { apply.disabled = false; setStatus(`Could not save demo settings: ${e.message || e}`, true); }
      return;
    }
    apply.disabled = test.disabled = true;
    setStatus('Reading the current WLED configuration…');
    try {
      const cfgRes = await fetch(`http://${host}/json/cfg`, { cache: 'no-store' });
      if (!cfgRes.ok) throw new Error(`WLED returned HTTP ${cfgRes.status}.`);
      const cfg = await cfgRes.json(), ins = cfg.hw?.led?.ins;
      if (!Array.isArray(ins) || ins.length !== outputs.length) throw new Error('The number of rows must match the outputs WLED currently reports. Test the connection again to reload them.');
      const detected = window.__TLWLED_TEST;
      if (!detected || detected.host !== host || JSON.stringify(ins.map(bus => bus.pin)) !== JSON.stringify(detected.cfg.hw.led.ins.map(bus => bus.pin))) {
        throw new Error('Test this controller again to confirm its configured outputs.');
      }
      let start = 0, changed = false;
      outputs.forEach((o, i) => {
        Object.assign(o, whiteCapabilities(cfg.hw.led, ins[i]));
        const order = typeof ins[i].order === 'number' ? Number(o.order) : o.order;
        if (ins[i].start !== start || ins[i].len !== o.leds || ins[i].order !== order) changed = true;
        ins[i].start = start; ins[i].len = o.leds; ins[i].order = order; start += o.leds;
      });
      cfg.hw.led.total = start;
      if (latitude !== null && longitude !== null) {
        cfg.if = cfg.if || {}; cfg.if.ntp = cfg.if.ntp || {};
        if (cfg.if.ntp.lt !== latitude || cfg.if.ntp.ln !== longitude) changed = true;
        cfg.if.ntp.lt = latitude; cfg.if.ntp.ln = longitude;
      }
      const saved = read();
      const mac = String(detected.info.mac || '').replace(/[:-]/g, '').toLowerCase();
      const next = { ...saved, mode: 'wled', host, mac: /^[0-9a-f]{12}$/.test(mac) ? mac : null, channelCount: selectedChannels, outputs, lat: latitude, lon: longitude, timezone: localTimezone(), photo: saved.photo || '', photoSize: saved.photoSize || [2000, 1500], houseViews: saved.houseViews || {} };
      const payload = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) };
      const check = await fetch(window.TLApi('/api/settings?validate=1'), payload);
      if (!check.ok) throw new Error((await check.json().catch(() => ({}))).error || 'The controller settings could not be validated.');
      if (changed) {
        setStatus('Applying channel counts and color order to WLED…');
        const res = await fetch(`http://${host}/json/cfg`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg) });
        const ack = await res.json().catch(() => null);
        if (!res.ok || ack?.success !== true) throw new Error(`WLED rejected the configuration (HTTP ${res.status}).`);
      }
      const stored = await fetch(window.TLApi('/api/settings'), payload);
      if (!stored.ok) { const failure = await stored.json().catch(() => ({})); throw new Error(failure.error || `Server could not save the settings (HTTP ${stored.status}).`); }
      write(next);
      if (!window.TL_SERVER_STATE?.controller || window.TL_SERVER_STATE.controller === 'primary') {
        try { localStorage.removeItem('tlstudio-demo-v1'); } catch { }
      }
      setStatus(changed ? 'Settings applied. WLED may restart; reconnecting…' : 'Settings saved. Connecting to WLED…');
      setTimeout(() => location.reload(), changed ? 3500 : 500);
    } catch (e) { apply.disabled = test.disabled = false; setStatus(`Could not apply settings: ${e.message || e}`, true); }
  });
  document.getElementById('demoReset').addEventListener('click', async () => {
    if (!window.TL_SERVER_STATE?.controller || window.TL_SERVER_STATE.controller === 'primary') {
        try { localStorage.removeItem('tlstudio-demo-v1'); } catch { }
      }
    const next = { mode: 'demo', host: '', channelCount: 4, outputs: [], photo: '', photoSize: [2000, 1500], timezone: localTimezone() };
    if (window.TL_SERVER_STATE) {
      const saved = await fetch(window.TLApi('/api/settings'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      if (!saved.ok) return setStatus('Could not save demo mode to the server.', true);
    }
    write(next); location.reload();
  });
  document.getElementById('addDemoOutput')?.addEventListener('click', () => {
    if (mode.value !== 'demo') return;
    const outputs = readRows(), capacity = Number(channelCount.value);
    if (outputs.length >= capacity) return setStatus(`All ${capacity} channel slots are already populated.`, true);
    outputs.push({ name: `Output ${outputs.length + 1}`, leds: 100, order: 'GRB', pin: '', points: [] });
    drawRows(outputs); setStatus(`${outputs.length} of ${capacity} channel slots populated. Save demo settings to keep this setup.`);
  });
  loadForm();
  if (window.TL_SERVER_STATE?.controller === 'primary' && !window.TL_SERVER_STATE.has_settings) {
    try { const legacy = localStorage.getItem(KEY); if (legacy) fetch(window.TLApi('/api/settings'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: legacy }).then(r => { if (r.ok) localStorage.removeItem(KEY); }); } catch { }
  }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI, { once: true }); else initUI();
})();
