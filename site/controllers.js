const page = new URL(location.href);
const requested = page.searchParams.get('controller');
const scope = requested || 'primary';
window.TLApi = path => {
  if (scope === 'primary') return path;
  const url = new URL(path, location.origin);
  url.searchParams.set('controller', scope);
  return url.pathname + url.search;
};

try { await import(window.TLApi('/api/bootstrap.js')); } catch { /* Standalone demo has no persistence API. */ }
if (requested && (!window.TL_SERVER_STATE || scope !== window.TL_SERVER_STATE.controller)) {
  document.querySelectorAll('.route, #wiringGuide').forEach(node => { node.hidden = true; });
  document.getElementById('controllerUnavailable').hidden = false;
} else {
  const profiles = window.TL_SERVER_STATE?.controllers || { primary: 'Primary controller' };
  const inputs = [...document.querySelectorAll('[data-controller-select]')];
  const navigate = async (id, hash) => {
    await window.TLFlushApp?.();
    const next = new URL(location.href);
    if (id === 'primary') next.searchParams.delete('controller');
    else next.searchParams.set('controller', id);
    next.hash = hash;
    location.assign(next);
  };
  inputs.forEach(select => {
    select.replaceChildren(...Object.entries(profiles).map(([id, name]) => new Option(name, id, false, id === scope)));
    select.addEventListener('change', () => navigate(select.value, select.id === 'setupController' ? '#wiring' : '#library'));
  });
  const add = document.getElementById('addController');
  add.hidden = !window.TL_SERVER_STATE;
  add.addEventListener('submit', async event => {
    event.preventDefault();
    const button = add.querySelector('button'), status = document.getElementById('controllerProfileStatus');
    button.disabled = true;
    status.textContent = 'Adding controller…';
    try {
      const response = await fetch('/api/controllers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: add.elements.name.value.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not add the controller.');
      await navigate(result.id, '#wiring');
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  await import('./wled-settings.js?v=landscape-2');
  await import('./house-mapper.js?v=landscape-2');
  await import('./demo-shim.js?v=landscape-1');
  await import('./app.js?v=landscape-1');
  await import('./backup.js?v=landscape-1');
}
