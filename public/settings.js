import { api } from './api.js';
import { showToast } from './app.js';
import { icon } from './icons.js';

export async function renderSettings(container) {
  const settings = await api.getSettings();
  container.innerHTML = `
    <label class="field">Printer IP address</label>
    <div class="row">
      <input id="s-ip" placeholder="e.g. 192.168.1.50" autocomplete="off">
      <button id="s-discover" class="quiet tight">${icon('search')} Find</button>
    </div>
    <div id="s-found" class="hint"></div>
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
    </p>`;

  const ip = container.querySelector('#s-ip');
  const darkness = container.querySelector('#s-darkness');
  const key = container.querySelector('#s-key');
  ip.value = settings.printerIp;
  darkness.value = settings.darkness;

  container.querySelector('#s-save').onclick = async () => {
    try {
      const patch = { printerIp: ip.value.trim(), darkness: Number(darkness.value) };
      if (key.value.trim()) patch.apiKey = key.value.trim();
      await api.putSettings(patch);
      showToast('Settings saved');
      renderSettings(container);
    } catch (err) { showToast(err.message, true); }
  };

  container.querySelector('#s-discover').onclick = async () => {
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
}
