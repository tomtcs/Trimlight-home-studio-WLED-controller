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
      photo: 'demo-house.svg', nextId: outputs.length + 1,
      settings: { ledSpacing: 20, ledSize: 1.4 },
      runs: outputs.map((o, i) => {
        const leds = Math.max(1, Math.min(10000, Number(o.leds) || 1));
        const row = { id: i + 1, name: o.name || DEFAULT_NAMES[i] || `Output ${i + 1}`, port: i + 1, points: clone(ROUTES[i]), leds, auto: false, reverse: false, start };
        start += leds;
        return row;
      })
    };
  }
  const T = window.TLSettings = { key: KEY, read, write, hostOf, layout: getLayout, isReal: () => read().mode === 'wled' };
  const mode = document.getElementById('wledMode'), addr = document.getElementById('wledAddress'), lat = document.getElementById('wledLatitude'), lon = document.getElementById('wledLongitude'), rows = document.getElementById('wledOutputs'), result = document.getElementById('wledStatus');
  if (!mode || !addr || !rows || !result) return;
  const setStatus = (message, bad = false) => { result.textContent = message; result.classList.toggle('bad', bad); };
  const htmlRow = (o, i) => {
    const order = String(o.order || 'GRB');
    const orders = ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'];
    if (!orders.includes(order)) orders.push(order);
    return `<div class="wled-output" data-output="${i}">
      <label>Channel name<input data-name value="${esc(o.name || DEFAULT_NAMES[i] || `Output ${i + 1}`)}" maxlength="24"></label>
      <label>GPIO pin<input data-pin value="${esc(Array.isArray(o.pin) ? o.pin.join(', ') : o.pin ?? '')}" readonly aria-label="WLED output pin"></label>
      <label>LEDs on channel<input data-leds type="number" min="1" max="10000" step="1" value="${Math.max(1, Number(o.leds) || 1)}" required></label>
      <label>Color order<select data-order>${orders.map(x => `<option${x === order ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
    </div>`;
  };
  function drawRows(outputs) { rows.innerHTML = outputs.map(htmlRow).join(''); }
  function readRows() {
    return [...rows.querySelectorAll('.wled-output')].map((r, i) => ({
      name: r.querySelector('[data-name]').value.trim() || DEFAULT_NAMES[i] || `Output ${i + 1}`,
      pin: r.querySelector('[data-pin]').value,
      leds: Number(r.querySelector('[data-leds]').value),
      order: r.querySelector('[data-order]').value
    }));
  }
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
      drawRows(ins.map((x, i) => ({ name: previous[i]?.name || DEFAULT_NAMES[i] || `Output ${i + 1}`, pin: x.pin, leds: x.len, order: x.order || 'GRB' })));
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
      const next = { mode: 'wled', host, outputs, lat: latitude, lon: longitude };
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
  loadForm();
})();
