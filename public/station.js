// Print station: the tablet docked next to the printer keeps a Bluetooth LE
// link to it (Zebra Link-OS BLE printing service) and relays queued jobs.
// The link lives here at module level so it survives moving around the app;
// the /#/station page is just a view of it, and the header chip another.
const ZEBRA_SERVICE = '38eb4a80-c570-11e3-9507-0002a5d5c51b';
const ZEBRA_WRITE = '38eb4a82-c570-11e3-9507-0002a5d5c51b';
// What the printer actually puts in its BLE advertisement is Zebra's 16-bit
// assigned UUID 0xFE79 (verified on the ZQ620 Plus); the 128-bit printing
// service above only shows up after connecting, so the chooser must filter on
// the short one and ask for the long one as an optional service.
const ZEBRA_ADVERTISED = 0xfe79;
const CHUNK = 240;
// Set once this device has picked the printer, so later loads reconnect
// silently and show the header chip.
const REMEMBER_KEY = 'zc-station-device';
// On the static site the tablet *is* the backend: it never polls a server
// queue, and the header chip is always shown so Connect is one tap away.
export const isLocal = globalThis.ZC_BACKEND === 'local';

let device = null;
let writeChar = null;
let running = false;
let wakeLock = null;
// 'off' (never connected here) | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
let status = 'off';
const logLines = [];
const listeners = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const remembered = () => { try { return Boolean(localStorage.getItem(REMEMBER_KEY)); } catch { return false; } };

export function stationState() {
  return { status, name: device?.name || '', log: logLines, remembered: remembered() };
}

export function onStationChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  const state = stationState();
  for (const fn of listeners) { try { fn(state); } catch { /* one bad listener must not stop the rest */ } }
}

function log(msg) {
  logLines.unshift(`${new Date().toLocaleTimeString()}  ${msg}`);
  if (logLines.length > 30) logLines.length = 30;
  notify();
}

function setStatus(next) {
  status = next;
  notify();
}

async function keepAwake() {
  if (status !== 'connected') return;
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not fatal */ }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
  });
}

async function connectGatt() {
  const server = await device.gatt.connect();
  const svc = await server.getPrimaryService(ZEBRA_SERVICE);
  writeChar = await svc.getCharacteristic(ZEBRA_WRITE);
  setStatus('connected');
  log(`Connected to ${device.name || 'printer'}`);
  keepAwake();
  if (!isLocal) pump();
}

function attach(dev) {
  device = dev;
  device.addEventListener('gattserverdisconnected', async () => {
    writeChar = null;
    setStatus('reconnecting');
    log('Disconnected — retrying');
    for (let attempt = 0; attempt < 5 && !writeChar; attempt++) {
      await sleep(2000 * (attempt + 1));
      try { await connectGatt(); return; } catch { /* retry */ }
    }
    setStatus('disconnected');
    log('Could not reconnect — tap Connect printer');
  });
}

// interactive: show Chrome's device chooser. Otherwise try the printer this
// device picked before (Chrome remembers it) without any UI; resolves false
// when there is nothing remembered or it is out of reach.
export async function connectStation({ interactive = true } = {}) {
  if (!('bluetooth' in navigator)) throw new Error('Bluetooth is not enabled for this site');
  setStatus('connecting');
  try {
    let dev = null;
    if (interactive) {
      dev = await navigator.bluetooth.requestDevice({
        filters: [{ services: [ZEBRA_ADVERTISED] }, { services: [ZEBRA_SERVICE] }],
        optionalServices: [ZEBRA_SERVICE],
      });
    } else {
      const known = await navigator.bluetooth.getDevices?.().catch(() => []);
      dev = known?.[0] ?? null;
      if (!dev) { setStatus('disconnected'); return false; }
    }
    if (device && device !== dev) { try { device.gatt.disconnect(); } catch { /* replacing it anyway */ } }
    attach(dev);
    try { localStorage.setItem(REMEMBER_KEY, '1'); } catch { /* chip just won't persist */ }
    await connectGatt();
    return true;
  } catch (err) {
    setStatus('disconnected');
    log(`Connect failed: ${err.message}`);
    if (interactive) throw err;
    return false;
  }
}

// Called once at app start on every device: only devices that have connected
// before do anything, and they reconnect quietly.
export function initStation() {
  if (remembered() && 'bluetooth' in navigator) connectStation({ interactive: false }).catch(() => {});
}

async function sendBytes(bytes) {
  const noResp = writeChar.properties.writeWithoutResponse;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.slice(i, i + CHUNK);
    if (noResp) await writeChar.writeValueWithoutResponse(slice);
    else await writeChar.writeValueWithResponse(slice);
  }
}

// Used by the local backend: one job, straight down the link.
export async function sendToPrinter(bytes) {
  if (!writeChar) throw new Error('printer not connected — tap the printer chip');
  await sendBytes(bytes);
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

const STATUS_TEXT = {
  off: 'not connected',
  connecting: 'connecting…',
  connected: 'connected',
  reconnecting: 'reconnecting…',
  disconnected: 'disconnected — tap Connect printer',
};

export function renderStation(container) {
  container._stationUnsub?.();
  if (!('bluetooth' in navigator)) {
    if (location.protocol === 'https:') {
      container.innerHTML = `<div class="deck" style="padding:16px"><p style="color:#e8e6df">This browser has no Web Bluetooth. Use Chrome on Android.</p></div>`;
      return;
    }
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
      <p class="deck-bar" style="padding:0 0 10px">${isLocal ? 'Printer' : 'Print station'}</p>
      <div class="row" style="margin:0 0 10px">
        <button id="st-connect" class="accent">Connect printer</button>
      </div>
      <div id="st-state" style="font-family:var(--mono);font-size:13px;color:#e8e6df;margin-bottom:8px"></div>
      <div id="st-log" style="font-family:var(--mono);font-size:12px;line-height:1.8;color:#9a9ca6;min-height:180px"></div>
    </div>
    <p class="hint">${isLocal
      ? 'This tablet prints straight to the printer over Bluetooth. The chip in the header shows the link; tap it any time to come back here.'
      : 'This tablet keeps the printer link while you use the rest of the app — the chip in the header shows it. Labels printed from any phone, or from here, print automatically.'}</p>`;

  const stateEl = container.querySelector('#st-state');
  const logEl = container.querySelector('#st-log');
  const paint = (state) => {
    const name = state.name && state.status === 'connected' ? ` to ${state.name}` : '';
    stateEl.textContent = `Printer: ${STATUS_TEXT[state.status] ?? state.status}${name}`;
    logEl.textContent = '';
    for (const line of state.log) {
      const div = document.createElement('div');
      div.textContent = line;
      logEl.appendChild(div);
    }
  };
  paint(stationState());
  container._stationUnsub = onStationChange(paint);

  container.querySelector('#st-connect').onclick = async () => {
    try { await connectStation({ interactive: true }); } catch { /* already logged */ }
  };

  if (!logLines.length) log('Ready. Tap "Connect printer" and pick the Zebra from the list.');
}
