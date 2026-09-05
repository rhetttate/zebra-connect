import { api } from './api.js';
import { showToast } from './app.js';

export async function renderSettings(container) {
  const settings = await api.getSettings();
  container.innerHTML = `
    <label class="field">Printer IP address</label>
    <div class="row">
      <input id="s-ip" placeholder="e.g. 192.168.1.50">
      <button id="s-discover" class="secondary" style="flex:0 0 auto">🔍 Find</button>
    </div>
    <div id="s-found"></div>
    <label class="field">Darkness (0–30)</label>
    <input id="s-darkness" type="number" min="0" max="30">
    <label class="field">Anthropic API key ${settings.apiKeySet ? '✅ set' : '❌ not set'}</label>
    <input id="s-key" type="password" placeholder="${settings.apiKeySet ? 'leave blank to keep current key' : 'sk-ant-…'}">
    <div class="row">
      <button id="s-save">Save settings</button>
    </div>
    <div class="row">
      <button id="s-test" class="secondary">🖨 Test print</button>
      <button id="s-zpl" class="secondary">Fix printer language (ZPL)</button>
    </div>
    <p style="color:#666;font-size:13px;margin-top:8px">
      If the test print comes out blank or as gibberish text, tap
      "Fix printer language" and try again — it switches the printer to
      ZPL-compatible mode.
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
    found.textContent = 'Scanning your network (up to ~30s)…';
    try {
      const { printers } = await api.discover();
      found.innerHTML = printers.length ? 'Tap to use: ' : 'No printers found — check the printer is on WiFi.';
      for (const p of printers) {
        const btn = document.createElement('button');
        btn.className = 'secondary';
        btn.style.margin = '4px';
        btn.textContent = p;
        btn.onclick = () => { ip.value = p; };
        found.appendChild(btn);
      }
    } catch (err) { found.textContent = err.message; }
  };

  container.querySelector('#s-test').onclick = async () => {
    try { await api.testPrint(); showToast('Test sent 🖨'); }
    catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#s-zpl').onclick = async () => {
    try { await api.zplMode(); showToast('Printer set to ZPL mode — power-cycle the printer, then test print'); }
    catch (err) { showToast(err.message, true); }
  };
}
