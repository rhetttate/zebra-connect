// Print station: runs on the tablet docked next to the printer. Polls the
// server's job queue and relays each job to the printer over Bluetooth LE
// (Zebra Link-OS BLE printing service).
const ZEBRA_SERVICE = '38eb4a80-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_WRITE = '38eb4a82-c570-11e3-9507-0002a5d5c51b';
const CHUNK = 240;

let device = null;
let writeChar = null;
let running = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function renderStation(container) {
  if (!('bluetooth' in navigator)) {
    container.innerHTML = `
      <div class="deck" style="padding:16px">
        <p class="deck-bar" style="padding:0 0 8px">Print station · one-time setup</p>
        <p style="color:#e8e6df">Chrome on this tablet needs Bluetooth switched on for this site:</p>
        <ol style="color:#c9c7c0; line-height:1.9; padding-left:20px; margin-top:8px">
          <li>Open a new tab and go to<br><code style="user-select:all">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code></li>
          <li>In that setting's text box enter<br><code style="user-select:all">${location.origin}</code></li>
          <li>Set the dropdown to <strong>Enabled</strong> and tap <strong>Relaunch</strong>.</li>
          <li>Come back to this page.</li>
        </ol>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="deck" style="padding:16px">
      <p class="deck-bar" style="padding:0 0 10px">Print station</p>
      <div class="row" style="margin:0 0 10px">
        <button id="st-connect" class="accent">Connect printer</button>
      </div>
      <div id="st-state" style="font-family:var(--mono);font-size:13px;color:#e8e6df;margin-bottom:8px">
        Printer: not connected
      </div>
      <div id="st-log" style="font-family:var(--mono);font-size:12px;line-height:1.8;color:#9a9ca6;min-height:180px"></div>
    </div>
    <p class="hint">Keep this page open on the tablet near the printer. The screen stays
    awake while it's connected. Labels printed from any phone appear here and
    print automatically.</p>`;

  const stateEl = container.querySelector('#st-state');
  const logEl = container.querySelector('#st-log');
  const log = (msg) => {
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
    logEl.prepend(line);
    while (logEl.children.length > 30) logEl.lastChild.remove();
  };
  const setState = (text) => { stateEl.textContent = `Printer: ${text}`; };

  let wakeLock = null;
  async function keepAwake() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not fatal */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
  });

  async function connectGatt() {
    const server = await device.gatt.connect();
    const svc = await server.getPrimaryService(ZEBRA_SERVICE);
    writeChar = await svc.getCharacteristic(ZEBRA_WRITE);
    setState(`connected to ${device.name || 'printer'}`);
    log('Connected');
  }

  async function sendBytes(bytes) {
    const noResp = writeChar.properties.writeWithoutResponse;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const slice = bytes.slice(i, i + CHUNK);
      if (noResp) await writeChar.writeValueWithoutResponse(slice);
      else await writeChar.writeValueWithResponse(slice);
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    while (running) {
      if (!writeChar) { await sleep(2000); continue; }
      let job = null;
      try {
        const res = await fetch('/api/station/next', { method: 'POST' });
        if (res.status !== 200) { await sleep(2500); continue; }
        job = await res.json();
        log(`Printing: ${job.name}`);
        const bytes = Uint8Array.from(atob(job.zpl), (c) => c.charCodeAt(0));
        await sendBytes(bytes);
        await fetch(`/api/station/${job.id}/done`, { method: 'POST' });
        log(`Printed: ${job.name}`);
      } catch (err) {
        log(`Error: ${err.message}`);
        if (job) {
          fetch(`/api/station/${job.id}/failed`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error: err.message }),
          }).catch(() => {});
        }
        await sleep(3000);
      }
    }
  }

  container.querySelector('#st-connect').onclick = async () => {
    try {
      device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [ZEBRA_SERVICE] }],
      });
      device.addEventListener('gattserverdisconnected', async () => {
        writeChar = null;
        setState('reconnecting…');
        log('Disconnected — retrying');
        for (let attempt = 0; attempt < 5 && !writeChar; attempt++) {
          await sleep(2000 * (attempt + 1));
          try { await connectGatt(); } catch { /* retry */ }
        }
        if (!writeChar) setState('disconnected — tap Connect printer');
      });
      await connectGatt();
      keepAwake();
      pump();
    } catch (err) {
      log(`Connect failed: ${err.message}`);
    }
  };

  log('Ready. Tap "Connect printer" and pick the Zebra from the list.');
}
