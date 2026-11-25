/* Photo mapping for rooflines and addressable landscape lights. */
(function () {
  'use strict';
  const DEFAULT_SIDES = [{ id: 'front', label: 'Front' }, { id: 'right', label: 'Right side' }, { id: 'rear', label: 'Rear' }, { id: 'left', label: 'Left side' }, { id: 'shed', label: 'Shed' }];
  const COLORS = ['#62d682', '#7fb3ff', '#ffc46b', '#d99bff', '#ff879c'];
  const uid = () => `line-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalizeViews = (value, legacyPhoto = '', legacySize = [4, 3], sides = DEFAULT_SIDES) => Object.fromEntries(sides.map(({ id }) => {
    const view = value?.[id] || {};
    return [id, { photo: typeof view.photo === 'string' ? view.photo : (id === 'front' ? legacyPhoto : ''), photoSize: Array.isArray(view.photoSize) ? view.photoSize : (id === 'front' ? legacySize : [4, 3]), lines: Array.isArray(view.lines) ? view.lines : [] }];
  }));
  function init() {
    const host = document.getElementById('houseMapper');
    if (!host || !window.TLSettings) return;
    let side = window.TLSettings.read().previewSide || 'front', flat = false, manageSides = false, tracing = false, editing = '', draft = [], wires = [], kind = 'edge', title = '', busy = false, dragging = -1, notice = 'Photos and traced sections save to the persistent studio settings.';
    const status = message => { notice = message; const node = host.querySelector('[data-hm-status]'); if (node) node.textContent = message; };
    const currentSettings = () => window.TLSettings.read();
    const sidesNow = () => { const configured = currentSettings().houseSides; return Array.isArray(configured) && configured.length ? configured : DEFAULT_SIDES; };
    const viewsNow = () => { const s = currentSettings(); return normalizeViews(s.houseViews, s.photo || '', s.photoSize || [4, 3], sidesNow()); };
    const current = () => viewsNow()[side];
    const outputs = () => currentSettings().outputs;
    const kindLabel = { edge: 'Roof edge', ridge: 'Ridge', landscape: 'Landscape lighting' };
    const landscapeColor = '#ffc46b';
    let output = 1, first = '', last = '';
    const lineSegments = line => (line.points || []).slice(1).map((b, i) => ({ a: line.points[i], b, index: i, lit: !(line.wireSegments || []).includes(i) }));
    async function persist(views, message, sides = sidesNow(), onSaved) {
      busy = true; render();
      try {
        const s = currentSettings(), legacyView = views.front || Object.values(views)[0] || {};
        await window.TLSettings.saveSettings({ houseSides: sides, houseViews: views, previewSide: side, photo: legacyView.photo || '', photoSize: legacyView.photoSize || [2000, 1500] });
        onSaved?.();
        status(message || 'Property layout saved.');
      } catch (error) { status(`Could not save house layout: ${error.message || error}`); }
      finally { busy = false; render(); }
    }
    function cancelTrace() { tracing = false; editing = ''; draft = []; wires = []; dragging = -1; }
    function svgLine(line, colorIndex) {
      if (line.kind === 'landscape' && line.points.length === 1) {
        const [x, y] = line.points[0];
        return `<circle cx="${x}" cy="${y}" r="1.2" fill="${landscapeColor}"/>`;
      }
      return lineSegments(line).map(segment => {
        const color = segment.lit ? (line.kind === 'landscape' ? landscapeColor : line.kind === 'ridge' ? '#c7b2ff' : COLORS[colorIndex % COLORS.length]) : '#86928b';
        const dash = !segment.lit ? '3 5' : line.kind === 'ridge' ? '7 5' : '';
        return `<line x1="${segment.a[0]}" y1="${segment.a[1]}" x2="${segment.b[0]}" y2="${segment.b[1]}" stroke="${color}" stroke-width="${tracing ? 4 : 3}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''} vector-effect="non-scaling-stroke"/>`;
      }).join('');
    }
    function tracedSegments() {
      return draft.slice(1).map((b, i) => `<line data-wire-segment="${i}" x1="${draft[i][0]}" y1="${draft[i][1]}" x2="${b[0]}" y2="${b[1]}" stroke="${wires.includes(i) ? '#86928b' : '#fff'}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${wires.includes(i) ? '3 5' : ''}" vector-effect="non-scaling-stroke" class="hm-segment-toggle"/>`).join('');
    }
    function flatSvg(views, sides) {
      const width = 390, height = 255;
      const panels = sides.map(({ id, label }, i) => {
        const v = views[id];
        const fixtures = v.lines.filter(line => line.kind === 'landscape' && line.points.length === 1).map(({ points: [[x, y]] }) =>
          `<circle cx="${22 + x * 3.46}" cy="${53 + y * 1.55}" r="3" fill="${landscapeColor}"/>`).join('');
        const lines = v.lines.flatMap((line, j) => lineSegments(line).map(segment => {
          const color = segment.lit ? (line.kind === 'landscape' ? landscapeColor : line.kind === 'ridge' ? '#c7b2ff' : COLORS[j % COLORS.length]) : '#86928b';
          const dash = !segment.lit ? '3 5' : line.kind === 'ridge' ? '7 5' : '';
          return `<line x1="${22 + segment.a[0] * 3.46}" y1="${53 + segment.a[1] * 1.55}" x2="${22 + segment.b[0] * 3.46}" y2="${53 + segment.b[1] * 1.55}" stroke="${color}" stroke-width="${segment.lit ? 3 : 2}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
        })).join('');
        const name = v.lines.length ? '' : '<text x="195" y="147" text-anchor="middle" fill="#98a79d" font-size="13">No traced sections</text>';
        return `<g transform="translate(${i * width},0)"><rect x="7" y="7" width="376" height="238" rx="12" fill="#141a17" stroke="#2d3831"/><text x="22" y="34" fill="#f4f7f5" font-size="16" font-weight="600">${escape(label)}</text>${lines}${fixtures}${name}<text x="22" y="229" fill="#98a79d" font-size="11">${v.lines.length} section${v.lines.length === 1 ? '' : 's'}${v.photo ? ' · photo added' : ''}</text></g>`;
      }).join('');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width * sides.length} ${height}" role="img" aria-label="Combined lighting map across ${sides.length} house elevations" style="display:block;width:100%;height:auto;min-width:900px"><rect width="100%" height="100%" fill="#0b0e0d"/>${panels}</svg>`;
    }
    function render() {
      const sides = sidesNow(); if (!sides.some(item => item.id === side)) side = sides[0].id;
      const views = viewsNow(), view = views[side], label = sides.find(item => item.id === side).label;
      const tabs = sides.map(({ id, label: name }) => `<button type="button" class="hm-tab${!flat && side === id ? ' active' : ''}" data-side="${escape(id)}" aria-pressed="${!flat && side === id}" ${busy || tracing || manageSides ? 'disabled' : ''}>${escape(name)}<small>${views[id].photo ? 'Photo added' : 'Add photo'} · ${views[id].lines.length} section${views[id].lines.length === 1 ? '' : 's'}</small></button>`).join('');
      const hasLandscape = Object.values(views).some(item => item.lines.some(line => line.kind === 'landscape'));
      const sideSvg = view.photo ? `<div class="hm-photo" style="aspect-ratio:${Math.max(1, Number(view.photoSize[0]) || 4)}/${Math.max(1, Number(view.photoSize[1]) || 3)}"><img src="${escape(view.photo)}" alt="${escape(label)} property photo"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="${escape(label)} lighting map" data-hm-canvas>${view.lines.filter(line => line.id !== editing).map((line, i) => svgLine(line, i)).join('')}${tracing ? tracedSegments() + draft.map((p, i) => `<circle data-point="${i}" cx="${p[0]}" cy="${p[1]}" r="${i === dragging ? 1.6 : 1.1}" fill="${COLORS[i % COLORS.length]}" stroke="#fff" stroke-width=".4" vector-effect="non-scaling-stroke"/>`).join('') : ''}</svg></div>` : `<div class="hm-empty">Upload a photo of the ${escape(label.toLowerCase())} to start mapping this elevation.</div>`;
      const landscapeFields = kind === 'landscape' ? `<div class="hm-landscape-fields">
        <label>WLED output<select data-landscape-output>${outputs().map((bus, i) => `<option value="${i + 1}"${output === i + 1 ? ' selected' : ''}>${i + 1} · ${escape(bus.name || 'Output ' + (i + 1))}</option>`).join('')}</select></label>
        <label>First bulb<input type="number" data-first min="1" max="${outputs()[output - 1]?.leds || 1}" step="1" value="${escape(first)}"></label>
        <label>Last bulb<input type="number" data-last min="1" max="${outputs()[output - 1]?.leds || 1}" step="1" value="${escape(last)}"></label>
        <p class="hm-legend">${outputs().length ? 'Number bulbs from 1 on the selected output. Tap once for one bulb or trace in data-flow order for a run.' : 'Save the controller’s output counts above to assign a landscape section.'}</p>
      </div>` : '';
      const savedLines = view.lines.map((line, i) => {
        const landscape = line.kind === 'landscape', label = kindLabel[line.kind], name = line.name || `${label} ${i + 1}`;
        const range = landscape ? ` · Output ${line.output}, bulbs ${line.first}–${line.last}` : '';
        const disabled = busy || tracing ? 'disabled' : '';
        const rgbw = outputs()[line.output - 1]?.rgbw === true;
        const controls = landscape ? `<form class="hm-zone-controls" data-control-line="${escape(line.id)}" aria-label="Control ${escape(name)}">
          <label>Color<input name="color" type="color" value="#ffb86b" ${disabled}></label>
          ${rgbw ? `<label>White mix %<input name="white" type="number" value="0" min="0" max="100" step="1" required ${disabled}></label>` : ''}
          <label>Brightness %<input name="brightness" type="number" value="50" min="1" max="100" step="1" required ${disabled}></label>
          <button class="hm-button" type="submit" ${disabled}>Apply color</button>
          ${rgbw ? `<button class="hm-button" type="submit" value="white" ${disabled}>White only</button>` : ''}
          <button class="hm-button" type="submit" value="off" formnovalidate ${disabled}>Turn off</button>
        </form>` : '';
        return `<div class="hm-line-row"><span><b>${escape(name)}</b><small>${label}${range} · ${line.points.length} point${line.points.length === 1 ? '' : 's'}</small></span><span><button type="button" class="hm-small" data-edit-line="${escape(line.id)}" ${disabled}>Adjust</button><button type="button" class="hm-small danger" data-remove-line="${escape(line.id)}" ${disabled}>Remove</button></span>${controls}</div>`;
      }).join('');
      const segmentButtons = tracing && draft.length > 1 ? `<div class="hm-segments"><p>Toggle each connection to mark a wire-only gap in the house map.</p>${draft.slice(1).map((_, i) => `<button type="button" class="hm-small${wires.includes(i) ? ' wire' : ''}" data-toggle-wire="${i}" aria-pressed="${wires.includes(i)}">Point ${i + 1} → ${i + 2}: ${wires.includes(i) ? 'Wire only' : 'Lights'}</button>`).join('')}</div>` : '';
      const sideManager = `<div class="hm-side-manager">${sides.map(({ id, label: name }) => `<div class="hm-side-row"><input type="text" maxlength="32" value="${escape(name)}" aria-label="Elevation name" data-side-name="${escape(id)}"><button type="button" class="hm-small" data-rename-side="${escape(id)}" ${busy ? 'disabled' : ''}>Save name</button><button type="button" class="hm-small danger" data-remove-side="${escape(id)}" ${busy || sides.length <= 1 ? 'disabled' : ''}>Remove</button></div>`).join('')}<div class="hm-side-add"><input type="text" maxlength="32" placeholder="e.g. Sunroom roof" aria-label="New elevation name" data-new-side><button type="button" class="hm-button" data-add-side ${busy || sides.length >= 12 ? 'disabled' : ''}>＋ Add elevation</button></div><p class="hm-note">Each elevation can have its own photo and traced sections. Removing an elevation also removes its saved photo and traces.</p></div>`;
      const mapContent = manageSides ? sideManager : (flat
        ? `<div class="hm-tabs" aria-label="House elevations">${tabs}</div><div class="hm-flat">${flatSvg(views, sides)}</div><p class="hm-legend"><span class="edge">Roof edge</span><span class="ridge">Ridge</span><span class="landscape">Landscape</span><span class="wire">Wire only</span></p>`
        : `<div class="hm-tabs" aria-label="House elevations">${tabs}</div><div class="hm-toolbar"><label class="hm-button">${view.photo ? `Replace ${escape(label)} photo` : `Upload ${escape(label)} photo`}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-photo hidden ${busy || tracing ? 'disabled' : ''}></label>${view.photo ? `<button type="button" class="hm-button" data-new-line ${busy || tracing || view.lines.length >= 40 ? 'disabled' : ''}>Trace a section</button><button type="button" class="hm-button" data-use-preview ${busy || tracing ? 'disabled' : ''}>Use this photo in previews</button>` : ''}</div>${sideSvg}${tracing ? `<div class="hm-edit"><label>Section name<input type="text" maxlength="48" data-line-name value="${escape(title)}" placeholder="e.g. Front upper eave" ${busy ? 'disabled' : ''}></label><label>Section type<select data-line-kind ${busy ? 'disabled' : ''}><option value="edge"${kind === 'edge' ? ' selected' : ''}>Roof edge</option><option value="ridge"${kind === 'ridge' ? ' selected' : ''}>Ridge</option><option value="landscape"${kind === 'landscape' ? ' selected' : ''}>Landscape lighting</option></select></label>${landscapeFields}<div class="hm-toolbar"><button type="button" class="hm-button primary" data-save-line ${busy || draft.length < (kind === 'landscape' ? 1 : 2) ? 'disabled' : ''}>Save section</button><button type="button" class="hm-button" data-undo ${busy || !draft.length ? 'disabled' : ''}>Undo point</button><button type="button" class="hm-button" data-cancel ${busy ? 'disabled' : ''}>Cancel</button></div>${segmentButtons}<p class="hm-legend">Tap or click to place points. Drag a point to adjust it.</p></div>` : ''}<div class="hm-lines">${savedLines || '<p class="hm-empty small">No mapped sections on this side yet.</p>'}</div>`);
      host.innerHTML = `<div class="hm-head"><div><span class="eyebrow">YOUR WHOLE PROPERTY</span><h2>Map property lighting</h2><p>Upload a photo, trace the roofline or landscape lights, and assign landscape sections to their WLED bulb ranges.</p></div><div class="hm-toolbar"><button type="button" class="hm-button" data-manage-sides ${busy || tracing ? 'disabled' : ''}>${manageSides ? 'Done' : 'Manage elevations'}</button><button type="button" class="hm-button" data-flat ${busy || tracing || manageSides ? 'disabled' : ''}>${flat ? 'Return to photo & trace' : 'Combined flat view'}</button></div></div>${mapContent}<p class="hm-status" data-hm-status role="status" aria-live="polite">${busy ? 'Saving house layout…' : escape(notice)}</p><p class="hm-note">${hasLandscape ? '<button type="button" class="hm-small" data-section-looks>Open Section looks</button> to assign effects to the mapped ranges and save or schedule the result.' : 'Landscape sections can be used in saved looks and schedules.'}</p>`;
      bind();
    }
    function begin(line) {
      tracing = true; flat = false; editing = line?.id || ''; draft = line ? line.points.map(p => [...p]) : []; wires = line ? [...(line.wireSegments || [])] : []; title = line?.name || ''; kind = line?.kind || 'edge';
      const landscapeOutput = outputs().findIndex(bus => bus.use === 'landscape');
      output = line?.output ?? (landscapeOutput >= 0 ? landscapeOutput + 1 : 1);
      first = line?.first ?? ''; last = line?.last ?? ''; render();
    }
    function bind() {
      host.querySelector('[data-section-looks]')?.addEventListener('click', async () => {
        await window.TLFlushApp?.();
        history.replaceState(null, '', '#sections');
        location.reload();
      });
      host.querySelector('[data-use-preview]')?.addEventListener('click', async () => {
        try {
          await window.TLSettings.saveSettings({ previewSide: side });
          await window.TLFlushApp?.();
          location.reload();
        } catch (error) { status(error.message); }
      });
      host.querySelectorAll('[data-control-line]').forEach(form => form.addEventListener('submit', async event => {
        event.preventDefault();
        const buttons = [...form.querySelectorAll('button')];
        const action = event.submitter?.value;
        const brightness = action === 'off' ? 0 : Math.round(Number(form.elements.brightness.value) * 255 / 100);
        const white = action === 'white' ? 255 : brightness ? Math.round(Number(form.elements.white?.value || 0) * 255 / 100) : 0;
        const color = action === 'white' ? '#000000' : form.elements.color.value;
        buttons.forEach(button => { button.disabled = true; });
        status('Updating landscape lights…');
        try {
          const response = await fetch(window.TLApi('/api/controller/landscape'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ side, line: form.dataset.controlLine, brightness, color, white }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'WLED could not update the section.');
          status(brightness ? (action === 'white' ? 'Dedicated white applied.' : 'Landscape color applied.') : 'Landscape section turned off.');
        } catch (error) { status(error.message); }
        finally { buttons.forEach(button => { button.disabled = false; }); }
      }));
      host.querySelectorAll('[data-side]').forEach(button => button.addEventListener('click', () => { side = button.dataset.side; status(''); render(); }));
      host.querySelector('[data-manage-sides]')?.addEventListener('click', () => { manageSides = !manageSides; render(); });
      host.querySelectorAll('[data-rename-side]').forEach(button => button.addEventListener('click', async () => {
        const id = button.dataset.renameSide, input = host.querySelector(`[data-side-name="${id}"]`), label = input?.value.trim();
        if (!label) return status('Enter a name for this elevation.');
        const sides = sidesNow().map(item => item.id === id ? { ...item, label } : item);
        await persist(viewsNow(), `Elevation renamed to ${label}.`, sides);
      }));
      host.querySelectorAll('[data-remove-side]').forEach(button => button.addEventListener('click', async () => {
        const id = button.dataset.removeSide, sides = sidesNow(), removed = sides.find(item => item.id === id);
        if (!removed || sides.length <= 1) return;
        if (!window.confirm(`Remove ${removed.label}? Its photo and traced sections will also be removed.`)) return;
        const nextSides = sides.filter(item => item.id !== id), views = viewsNow(); delete views[id];
        if (side === id) side = nextSides[0].id;
        await persist(views, `${removed.label} elevation removed.`, nextSides);
      }));
      host.querySelector('[data-add-side]')?.addEventListener('click', async () => {
        const sides = sidesNow(), input = host.querySelector('[data-new-side]');
        if (sides.length >= 12) return status('A property can have up to 12 elevations.');
        const label = input?.value.trim() || `Elevation ${sides.length + 1}`;
        const base = `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'elevation'}`;
        let id = base, suffix = 2; while (sides.some(item => item.id === id)) id = `${base}-${suffix++}`;
        const nextSides = [...sides, { id, label }], views = viewsNow();
        views[id] = { photo: '', photoSize: [4, 3], lines: [] }; side = id;
        await persist(views, `${label} elevation added.`, nextSides); side = id; manageSides = true; render();
      });
      host.querySelector('[data-flat]')?.addEventListener('click', () => { flat = !flat; render(); });
      host.querySelector('[data-new-line]')?.addEventListener('click', () => begin());
      host.querySelectorAll('[data-edit-line]').forEach(button => button.addEventListener('click', () => { const line = current().lines.find(item => item.id === button.dataset.editLine); if (line) begin(line); }));
      host.querySelectorAll('[data-remove-line]').forEach(button => button.addEventListener('click', async () => { const views = viewsNow(); views[side].lines = views[side].lines.filter(line => line.id !== button.dataset.removeLine); await persist(views, 'Lighting section removed.'); }));
      host.querySelector('[data-photo]')?.addEventListener('change', async event => {
        const input = event.currentTarget, elevation = side, file = input.files?.[0]; if (!file) return;
        if (current().lines.length && !window.confirm('Replace the photo and clear the traces on this view?')) { input.value = ''; return; }
        try {
          const image = await createImageBitmap(file); let data = '', size = [image.width, image.height];
          for (const width of [1400, 1100, 850, 650]) { const scale = Math.min(1, width / image.width); const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale); canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); data = canvas.toDataURL('image/jpeg', .72); size = [canvas.width, canvas.height]; if (data.length <= 180000) break; }
          image.close(); if (data.length > 180000) throw new Error('This photo is still too large. Choose a smaller or lower-resolution image.');
          const target = sidesNow().find(item => item.id === elevation);
          if (!target) throw new Error('The selected elevation was removed.');
          const views = viewsNow(); views[elevation] = { photo: data, photoSize: size, lines: [] }; await persist(views, `${target.label} photo saved. Existing traces for this view were cleared.`);
        } catch (error) { status(error.message || 'Could not prepare the photo. Use JPG, PNG, or WebP.'); }
        input.value = '';
      });
      host.querySelector('[data-line-name]')?.addEventListener('input', event => { title = event.currentTarget.value; });
      host.querySelector('[data-line-kind]')?.addEventListener('change', event => { kind = event.currentTarget.value; render(); });
      host.querySelector('[data-landscape-output]')?.addEventListener('change', event => {
        output = Number(event.currentTarget.value); first = last = ''; render();
      });
      host.querySelector('[data-first]')?.addEventListener('input', event => { first = event.currentTarget.value; });
      host.querySelector('[data-last]')?.addEventListener('input', event => { last = event.currentTarget.value; });
      host.querySelector('[data-cancel]')?.addEventListener('click', () => { cancelTrace(); render(); });
      host.querySelector('[data-undo]')?.addEventListener('click', () => { draft.pop(); wires = wires.filter(i => i < draft.length - 1); render(); });
      host.querySelectorAll('[data-toggle-wire]').forEach(button => button.addEventListener('click', () => { const i = Number(button.dataset.toggleWire); wires = wires.includes(i) ? wires.filter(n => n !== i) : [...wires, i]; render(); }));
      host.querySelector('[data-save-line]')?.addEventListener('click', async () => {
        if (draft.length < (kind === 'landscape' ? 1 : 2)) return;
        const views = viewsNow(), line = { id: editing || uid(), name: title.trim() || `${kindLabel[kind]} ${views[side].lines.length + 1}`, kind, points: draft.map(p => [...p]), wireSegments: [...wires] };
        if (kind === 'landscape') {
          const count = outputs()[output - 1]?.leds || 0;
          const a = Number(first), b = Number(last || (draft.length === 1 ? first : ''));
          if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || a > b || b > count) return status(`Choose an ordered bulb range within output ${output} (1–${count}).`);
          if (draft.length === 1 && a !== b) return status('One point maps to one bulb. Use the same first and last bulb.');
          Object.assign(line, { output, first: a, last: b });
        }
        views[side].lines = editing ? views[side].lines.map(item => item.id === editing ? line : item) : [...views[side].lines, line];
        await persist(views, 'Lighting section saved. Reload previews to see the updated trace.', sidesNow(), cancelTrace);
      });
      const svg = host.querySelector('[data-hm-canvas]');
      svg?.addEventListener('click', event => {
        const wire = event.target.closest('[data-wire-segment]');
        if (wire && tracing) { const i = Number(wire.dataset.wireSegment); wires = wires.includes(i) ? wires.filter(n => n !== i) : [...wires, i]; render(); return; }
        const point = event.target.closest('[data-point]'); if (point) return;
        if (!tracing || busy) return;
        if (draft.length >= 100) { status('A section can contain at most 100 points. Save this section and start another to continue.'); return; }
        const rect = svg.getBoundingClientRect(), x = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y = Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100));
        draft.push([+x.toFixed(3), +y.toFixed(3)]); render();
      });
      svg?.addEventListener('pointerdown', event => { const point = event.target.closest('[data-point]'); if (!point || !tracing || busy) return; dragging = Number(point.dataset.point); svg.setPointerCapture(event.pointerId); event.preventDefault(); });
      svg?.addEventListener('pointermove', event => { if (dragging < 0 || !tracing) return; const rect = svg.getBoundingClientRect(), x = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100)), y = Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100)); draft[dragging] = [+x.toFixed(3), +y.toFixed(3)]; const circle = svg.querySelector(`[data-point="${dragging}"]`); if (circle) { circle.setAttribute('cx', draft[dragging][0]); circle.setAttribute('cy', draft[dragging][1]); } });
      for (const event of ['pointerup', 'pointercancel']) svg?.addEventListener(event, () => {
        if (dragging < 0) return;
        dragging = -1; render();
      });
    }
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
