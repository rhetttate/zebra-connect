import { api } from './api.js';
import { showToast } from './app.js';
import { icon } from './icons.js';
import { connectStation } from './station.js';

export async function renderSettings(container) {
  const settings = await api.getSettings();
  const local = api.mode === 'local';
  container.innerHTML = `
    ${local ? `
    <label class="field">Printer</label>
    <p class="hint" style="margin-top:0">Prints go over Bluetooth to the connected printer.</p>
    <div class="row" style="margin-bottom:12px">
      <button id="s-connect" class="quiet">Connect printer</button>
    </div>` : `
    <label class="field">How prints reach the printer</label>
    <div class="choice" data-conn="network">
      <strong>WiFi network</strong>
      <span>the printer is on the same network — prints go straight to its IP</span>
    </div>
    <div class="choice" data-conn="station">
      <strong>Bluetooth print station</strong>
      <span>a tablet near the printer relays prints over Bluetooth</span>
    </div>
    <p class="hint" id="station-hint" hidden>
      On the tablet, open <strong>${location.origin}/#/station</strong> in Chrome
      and tap "Connect printer". Keep that page open.
    </p>
    <label class="field">Printer IP address</label>
    <div class="row">
      <input id="s-ip" placeholder="e.g. 192.168.1.50" autocomplete="off">
      <button id="s-discover" class="quiet tight">${icon('search')} Find</button>
    </div>
    <div id="s-found" class="hint"></div>`}
    <label class="field">Darkness · 0–30</label>
    <input id="s-darkness" type="number" min="0" max="30">
    <label class="field">Anthropic API key
      <span class="keystate ${settings.apiKeySet ? 'ok' : 'off'}">${settings.apiKeySet ? 'set' : 'not set'}</span>
    </label>
    <input id="s-key" type="password" placeholder="${settings.apiKeySet ? 'leave blank to keep the current key' : 'sk-ant-…'}">
    <div class="row">
      <button id="s-save">${icon('check')} Save settings</button>
    </div>
    <div class="row">
      <button id="s-test" class="quiet">${icon('print')} Test print</button>
      <button id="s-zpl" class="quiet">Fix printer language</button>
    </div>
    <p class="hint">
      If the test print comes out blank or as gibberish text, tap
      "Fix printer language" and try again — it switches the printer to
      ZPL-compatible mode. Power-cycle the printer after switching.
    </p>
    <label class="field">Backup</label>
    <div class="row">
      <button id="s-export" class="quiet">${icon('file')} Export labels</button>
      <button id="s-import" class="quiet">${icon('file')} Import labels</button>
    </div>
    <p class="hint">Export downloads every label as one file. Import adds the labels from such a file that are not already here.</p>
    <input id="s-import-input" type="file" accept=".json,application/json" hidden>`;

  const ip = container.querySelector('#s-ip'); // absent on the tablet
  const darkness = container.querySelector('#s-darkness');
  const key = container.querySelector('#s-key');
  if (ip) ip.value = settings.printerIp;
  darkness.value = settings.darkness;

  if (local) {
    container.querySelector('#s-connect').onclick = async () => {
      try { await connectStation({ interactive: true }); showToast('Printer connected'); }
      catch (err) { showToast(err.message, true); }
    };
  } else {
    const selectConnection = (mode) => {
      container.querySelectorAll('[data-conn]').forEach((c) =>
        c.classList.toggle('selected', c.dataset.conn === mode));
      container.querySelector('#station-hint').hidden = mode !== 'station';
    };
    selectConnection(settings.connection || 'network');
    container.querySelectorAll('[data-conn]').forEach((c) => {
      c.onclick = async () => {
        selectConnection(c.dataset.conn);
        try { await api.putSettings({ connection: c.dataset.conn }); }
        catch (err) { showToast(err.message, true); }
      };
    });
  }

  container.querySelector('#s-save').onclick = async () => {
    try {
      const patch = { darkness: Number(darkness.value) };
      if (ip) patch.printerIp = ip.value.trim();
      if (key.value.trim()) patch.apiKey = key.value.trim();
      await api.putSettings(patch);
      showToast('Settings saved');
      renderSettings(container);
    } catch (err) { showToast(err.message, true); }
  };

  if (!local) container.querySelector('#s-discover').onclick = async () => {
    const found = container.querySelector('#s-found');
    found.textContent = 'Scanning your network — this can take up to 30 seconds…';
    try {
      const { printers } = await api.discover();
      found.innerHTML = printers.length ? 'Tap an address to use it: ' : 'No printers found. Check the printer is on your WiFi.';
      for (const p of printers) {
        const btn = document.createElement('button');
        btn.className = 'quiet';
        btn.style.margin = '4px 4px 0 0';
        btn.textContent = p;
        btn.onclick = () => { ip.value = p; };
        found.appendChild(btn);
      }
    } catch (err) { found.textContent = err.message; }
  };

  container.querySelector('#s-test').onclick = async () => {
    try { await api.testPrint(); showToast('Test print sent'); }
    catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#s-zpl').onclick = async () => {
    try { await api.zplMode(); showToast('Printer set to ZPL mode — power-cycle it, then test print'); }
    catch (err) { showToast(err.message, true); }
  };

  container.querySelector('#s-export').onclick = async () => {
    try {
      const labels = await api.exportLabels();
      const blob = new Blob([JSON.stringify(labels, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `labels-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      showToast(`Exported ${labels.length} labels`);
    } catch (err) { showToast(err.message, true); }
  };
  const importInput = container.querySelector('#s-import-input');
  container.querySelector('#s-import').onclick = () => { importInput.value = ''; importInput.click(); };
  importInput.onchange = async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const result = await api.importLabels(json);
      let msg = `Imported ${result.added} labels (${result.skipped} already here)`;
      if (result.skippedFiles) msg += ` · ${result.skippedFiles} printer files can't be used on this device`;
      showToast(msg);
    } catch (err) { showToast(`Import failed: ${err.message}`, true); }
  };
}
