/* Portable, versioned backup of data owned by this application. */
(function () {
  'use strict';
  const FORMAT = 'trimlight-home-studio-wled-backup';
  const VERSION = 1;
  const MAX_BYTES = 8 * 1024 * 1024;
  const onReady = fn => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once: true }) : fn();

  onReady(() => {
    const status = document.getElementById('backupStatus');
    const exportButton = document.getElementById('backupExport');
    const importInput = document.getElementById('backupImport');
    if (!status || !exportButton || !importInput) return;
    const setStatus = (message, error = false) => { status.textContent = message; status.classList.toggle('bad', error); };
    const getJSON = async path => {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not read ${path} (HTTP ${response.status}).`);
      return response.json();
    };
    const validateEnvelope = backup => {
      if (!backup || backup.format !== FORMAT || backup.version !== VERSION) throw new Error('This is not a supported Trimlight Home Studio WLED backup.');
      const app = backup.application, controller = backup.controller;
      if (!app || Array.isArray(app) || typeof app !== 'object') throw new Error('Backup application data is missing or invalid.');
      if (!controller || Array.isArray(controller) || typeof controller !== 'object') throw new Error('Backup controller settings are missing or invalid.');
      for (const [key, type] of [['userLooks', 'array'], ['roofSections', 'array'], ['playlists', 'array'], ['schedule', 'object'], ['edits', 'object'], ['starred', 'object']]) {
        if (key in app && (app[key] === null || (type === 'array' ? !Array.isArray(app[key]) : typeof app[key] !== 'object' || Array.isArray(app[key])))) throw new Error(`Backup has an invalid ${key} value.`);
      }
    };

    exportButton.addEventListener('click', async () => {
      exportButton.disabled = true;
      setStatus('Preparing backup…');
      try {
        const [application, controller] = await Promise.all([getJSON('/api/app'), getJSON('/api/settings')]);
        const backup = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), application, controller };
        const text = JSON.stringify(backup, null, 2);
        if (new Blob([text]).size > MAX_BYTES) throw new Error('Backup exceeds the 8 MB file limit. Reduce the size of stored data before exporting.');
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `trimlight-home-studio-wled-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
        setStatus('Backup downloaded. Store the file somewhere separate from the Docker host.');
      } catch (error) { setStatus(error.message || 'Could not create the backup.', true); }
      finally { exportButton.disabled = false; }
    });

    importInput.addEventListener('change', async () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      importInput.value = '';
      try {
        if (file.size > MAX_BYTES) throw new Error('Backup file exceeds the 8 MB limit.');
        const backup = JSON.parse(await file.text());
        validateEnvelope(backup);
        if (!window.confirm('Restore this backup? It will replace the current patterns, schedules, roof sections, controller setup, photos, and traced rooflines. Export a backup of the current data first if you may need it.')) return;
        setStatus('Validating and restoring backup…');
        const response = await fetch('/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error || `Restore failed (HTTP ${response.status}).`);
        setStatus('Restore complete. Reloading the app…');
        setTimeout(() => location.reload(), 350);
      } catch (error) { setStatus(error.message || 'Could not restore the backup.', true); }
    });
  });
})();
