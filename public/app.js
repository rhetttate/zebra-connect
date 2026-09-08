import { api } from './api.js';
import { icon } from './icons.js';
import { renderEditor } from './editor.js';
import { renderSettings } from './settings.js';
import { renderStation, initStation, onStationChange, stationState } from './station.js';
import { renderFileEditor } from './file-editor.js';

export const SIZE_LABELS = {
  '3x5': '5 × 3',
  '3x2': '3 × 2',
  '2x1.25': '2 × 1.25',
};

const view = document.getElementById('view');
const title = document.getElementById('title');

document.getElementById('nav').innerHTML = `
  <button id="station-chip" class="navlink chip" title="Print station — tap for details" hidden></button>
  <button id="loaded-chip" class="navlink chip" title="Loaded labels — tap to change or calibrate"></button>
  <a href="#/" title="Labels">${icon('labels')}</a>
  <a href="#/new" title="New label">${icon('plus')}</a>
  <button id="nav-cal" class="navlink" title="Calibrate printer">${icon('target')}</button>
  <a href="#/settings" title="Settings">${icon('gear')}</a>`;

const MEDIA_SHORT = { gap: 'GAP', mark: 'MARK', continuous: 'CONT' };

export async function refreshLoadedChip() {
  const chip = document.getElementById('loaded-chip');
  try {
    const s = await api.getSettings();
    chip.textContent = `${SIZE_LABELS[s.loadedSize] ?? s.loadedSize}″ ${MEDIA_SHORT[s.mediaType] ?? ''}`.trim();
    chip.hidden = false;
  } catch {
    chip.hidden = true;
  }
}

const MEDIA_TYPES = [
  { value: 'gap', label: 'Gap labels', hint: 'a see-through gap between labels' },
  { value: 'mark', label: 'Black mark labels', hint: 'a black bar printed on the back' },
  { value: 'continuous', label: 'Continuous paper', hint: 'no gaps or marks — sets the mode only' },
];

async function openCalibrate() {
  document.querySelector('.modal-overlay')?.remove();
  let mediaType = 'gap';
  let loadedSize = '3x5';
  try {
    const s = await api.getSettings();
    mediaType = s.mediaType || 'gap';
    loadedSize = s.loadedSize || '3x5';
  } catch { /* defaults stand */ }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Loaded labels and calibration">
      <h2>Loaded labels</h2>
      <p class="eyebrow" style="margin-top:12px">What size is loaded?</p>
      <div class="size-chips">
        ${Object.entries(SIZE_LABELS).map(([value, text]) => `
          <button class="quiet size-chip" data-size="${value}">${text}″</button>`).join('')}
      </div>
      <p class="eyebrow">What kind of labels?</p>
      ${MEDIA_TYPES.map((t) => `
        <div class="choice" data-type="${t.value}" role="button" tabindex="0">
          <strong>${t.label}</strong><span>${t.hint}</span>
        </div>`).join('')}
      <p class="hint">Calibrate after loading a different roll — the printer
        feeds a few labels while it measures them.</p>
      <div class="row">
        <button id="cal-close" class="quiet">Close</button>
        <button id="cal-go" class="accent">Calibrate</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const persist = async (patch) => {
    try {
      await api.putSettings(patch);
      refreshLoadedChip();
    } catch (err) { showToast(err.message, true); }
  };
  const selectSize = (size, save = true) => {
    loadedSize = size;
    overlay.querySelectorAll('.size-chip').forEach((c) =>
      c.classList.toggle('selected', c.dataset.size === size));
    if (save) persist({ loadedSize: size });
  };
  const select = (type, save = true) => {
    mediaType = type;
    overlay.querySelectorAll('.choice').forEach((c) =>
      c.classList.toggle('selected', c.dataset.type === type));
    if (save) persist({ mediaType: type });
  };
  selectSize(loadedSize, false);
  select(mediaType, false);
  overlay.querySelectorAll('.size-chip').forEach((c) => {
    c.onclick = () => selectSize(c.dataset.size);
  });
  overlay.querySelectorAll('.choice').forEach((c) => {
    c.onclick = () => select(c.dataset.type);
    c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') select(c.dataset.type); };
  });
  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.querySelector('#cal-close').onclick = close;
  overlay.querySelector('#cal-go').onclick = async () => {
    const btn = overlay.querySelector('#cal-go');
    btn.disabled = true;
    try {
      const result = await api.calibrate(mediaType);
      close();
      showToast(mediaType === 'continuous'
        ? 'Media type set to continuous'
        : result.queued
          ? 'Calibration queued — it runs at the print station'
          : 'Calibrating — the printer will feed a few labels');
    } catch (err) {
      showToast(err.message, true);
      btn.disabled = false;
    }
  };
}

document.getElementById('nav-cal').onclick = openCalibrate;
document.getElementById('loaded-chip').onclick = openCalibrate;
refreshLoadedChip();

// The station chip only appears on a device that has connected to the
// printer (the tablet), and follows the link wherever the user navigates.
const STATION_CHIP = {
  connected: ['PRINTER ✓', 'ok'],
  connecting: ['PRINTER …', ''],
  reconnecting: ['PRINTER …', ''],
  disconnected: ['PRINTER ✗', 'bad'],
};
function refreshStationChip(state) {
  const chip = document.getElementById('station-chip');
  const entry = STATION_CHIP[state.status];
  chip.hidden = !(entry && (state.remembered || state.status !== 'off'));
  if (!entry) return;
  chip.textContent = entry[0];
  chip.classList.toggle('ok', entry[1] === 'ok');
  chip.classList.toggle('bad', entry[1] === 'bad');
}
document.getElementById('station-chip').onclick = () => navigate('#/station');
onStationChange(refreshStationChip);
refreshStationChip(stationState());
initStation();

function setTitle(text) {
  if (text) {
    title.textContent = text;
    title.classList.remove('wordmark');
  } else {
    title.innerHTML = 'Zebra<span class="dot">.</span>Connect';
  }
}

export function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = isError ? 'error' : '';
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3500);
}

export function navigate(hash) { location.hash = hash; }

async function renderLibrary() {
  setTitle('');
  const labels = await api.listLabels();
  view.innerHTML = `
    <input id="search" type="search" placeholder="Search labels">
    <div id="cards" style="margin-top:12px"></div>
    ${labels.length ? '' : '<p class="empty">No labels yet. Tap + to make your first one.</p>'}`;
  const cards = view.querySelector('#cards');

  function draw(filter = '') {
    const q = filter.toLowerCase();
    cards.innerHTML = '';
    for (const label of labels) {
      const hay = `${label.fields.name} ${label.fields.barcode}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      const card = document.createElement('div');
      card.className = 'card';
      const isFile = label.kind === 'prn';
      card.innerHTML = `
        ${isFile ? `<div class="file-thumb">${icon('file')}</div>` : '<img alt="" loading="lazy">'}
        <div class="meta">
          <div class="name"></div>
          <div class="sub"></div>
        </div>`;
      card.querySelector('.name').textContent = label.fields.name || '(unnamed)';
      if (isFile) {
        card.querySelector('.sub').textContent =
          `${label.size ? `${SIZE_LABELS[label.size] ?? label.size}"` : 'size unknown'}  ·  printer file`;
        attachTapOrSwipe(card,
          () => openFilePrint(label, () => {
            labels.splice(labels.indexOf(label), 1);
            draw(view.querySelector('#search').value);
          }),
          () => navigate(`#/file/${label.id}`));
      } else {
        card.querySelector('.sub').textContent =
          `${SIZE_LABELS[label.size] ?? label.size}"  ·  ${label.fields.barcode}`;
        api.previewBlob(label).then((blob) => {
          const img = card.querySelector('img');
          img.onload = () => URL.revokeObjectURL(img.src);
          img.src = URL.createObjectURL(blob);
        }).catch(() => {});
        card.onclick = () => navigate(`#/edit/${label.id}`);
      }
      cards.appendChild(card);
    }
  }
  draw();
  view.querySelector('#search').oninput = (e) => draw(e.target.value);
}

// Tap = primary action; a mostly-horizontal swipe of 40px+ = secondary.
function attachTapOrSwipe(el, onTap, onSwipe) {
  let start = null;
  el.onpointerdown = (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  el.onpointerup = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe();
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) onTap();
  };
  el.onpointercancel = () => { start = null; };
}

// Print sheet for a stored printer file: quantity, print, edit, delete.
export function openFilePrint(label, onDeleted) {
  document.querySelector('.modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Print printer file">
      <h2>Printer file</h2>
      <p class="file-name"></p>
      <p class="hint"></p>
      <div class="row">
        <label class="tight" for="file-qty">Quantity</label>
        <input id="file-qty" type="number" min="1" max="100" value="1" inputmode="numeric">
      </div>
      <div class="row">
        <button id="file-edit" class="quiet">Edit</button>
        <button id="file-delete" class="quiet">Delete</button>
        <button id="file-close" class="quiet">Close</button>
        <button id="file-print" class="accent">Print</button>
      </div>
    </div>`;
  overlay.querySelector('.file-name').textContent = label.fields.name;
  overlay.querySelector('.hint').textContent = label.size
    ? `${SIZE_LABELS[label.size] ?? label.size}" label, printed exactly as the file was designed.`
    : 'This file does not say what size it is, so it prints on whatever is loaded.';
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  overlay.querySelector('#file-close').onclick = close;
  overlay.querySelector('#file-edit').onclick = () => { close(); navigate(`#/file/${label.id}`); };
  overlay.querySelector('#file-print').onclick = async () => {
    const btn = overlay.querySelector('#file-print');
    const quantity = Math.min(Math.max(parseInt(overlay.querySelector('#file-qty').value, 10) || 1, 1), 100);
    btn.disabled = true;
    try {
      if (label.size) {
        const { loadedSize } = await api.getSettings();
        if (loadedSize && loadedSize !== label.size && !confirm(
          `This is a ${SIZE_LABELS[label.size]}" label but ${SIZE_LABELS[loadedSize]}" stock is loaded. Print anyway?`)) {
          btn.disabled = false;
          return;
        }
      }
      const result = await api.printFileLabel(label.id, quantity);
      close();
      showToast(result.queued ? 'Queued — printing at the station' : 'Sent to printer');
    } catch (err) {
      showToast(err.message, true);
      btn.disabled = false;
    }
  };
  overlay.querySelector('#file-delete').onclick = async () => {
    if (!confirm(`Delete "${label.fields.name}" from the library?`)) return;
    try {
      await api.deleteLabel(label.id);
      close();
      onDeleted?.();
    } catch (err) {
      showToast(err.message, true);
    }
  };
}

function renderNew() {
  setTitle('New label');
  view.innerHTML = `
    <p class="eyebrow">Start blank</p>
    <div class="size-grid">
      <button class="quiet" data-size="3x5">5 × 3<span class="in">inches</span></button>
      <button class="quiet" data-size="3x2">3 × 2<span class="in">inches</span></button>
      <button class="quiet" data-size="2x1.25">2 × 1.25<span class="in">inches</span></button>
    </div>
    <p class="eyebrow">Start from a photo</p>
    <div class="row">
      <button id="from-photo" class="quiet">${icon('camera')} Read a photo</button>
      <select id="photo-size" class="tight" style="width:110px">
        <option value="3x5" selected>5 × 3</option>
        <option value="3x2">3 × 2</option>
        <option value="2x1.25">2 × 1.25</option>
      </select>
    </div>
    <p class="hint">Snap the product or its packaging. The name and description fill in for you.</p>
    <p class="eyebrow">Printer file</p>
    <div class="row">
      <button id="add-prn" class="quiet">${icon('file')} Add a .prn to the library</button>
      <button id="print-prn" class="quiet">${icon('file')} Print a .prn once</button>
    </div>
    <p class="hint">Files in the library print from any phone; "print once" sends a file without keeping it.</p>
    <input id="photo-input" type="file" accept="image/*" capture="environment" hidden>
    <input id="prn-input" type="file" accept=".prn" hidden>
    <input id="add-prn-input" type="file" accept=".prn" multiple hidden>`;

  const addInput = view.querySelector('#add-prn-input');
  view.querySelector('#add-prn').onclick = () => { addInput.value = ''; addInput.click(); };
  addInput.onchange = async () => {
    const files = [...addInput.files];
    if (!files.length) return;
    let added = 0;
    for (const file of files) {
      try {
        await api.addPrn(file);
        added++;
      } catch (err) {
        showToast(`${file.name}: ${err.message}`, true);
      }
    }
    if (added) {
      showToast(added === 1 ? `Added ${files[0].name} to the library` : `Added ${added} files to the library`);
      navigate('#/');
    }
  };

  for (const btn of view.querySelectorAll('[data-size]')) {
    btn.onclick = () => renderEditor(view, { size: btn.dataset.size });
  }

  const photoInput = view.querySelector('#photo-input');
  view.querySelector('#from-photo').onclick = () => { photoInput.value = ''; photoInput.click(); };
  photoInput.onchange = async () => {
    const file = photoInput.files[0];
    if (!file) return;
    const size = view.querySelector('#photo-size').value;
    showToast('Reading photo…');
    try {
      const fields = await api.extract(file);
      renderEditor(view, { size, fields });
    } catch (err) {
      showToast(`Photo reading failed: ${err.message}`, true);
      renderEditor(view, { size });
    }
  };

  const prnInput = view.querySelector('#prn-input');
  view.querySelector('#print-prn').onclick = () => { prnInput.value = ''; prnInput.click(); };
  prnInput.onchange = async () => {
    const file = prnInput.files[0];
    if (!file) return;
    try {
      const result = await api.printRaw(file);
      showToast(result.queued ? 'Queued — printing at the station' : 'Sent to printer');
    } catch (err) {
      showToast(err.message, true);
    }
  };
}

async function route() {
  const hash = location.hash || '#/';
  // A screen with unsaved work can veto navigation away from itself.
  if (view._leaveGuard && !view._leaveGuard()) { history.back(); return; }
  view._leaveGuard = null;
  try {
    if (hash === '#/' || hash === '') await renderLibrary();
    else if (hash.startsWith('#/file/')) {
      setTitle('Edit printer file');
      await renderFileEditor(view, await api.getLabel(hash.slice(7)));
    }
    else if (hash === '#/new') renderNew();
    else if (hash.startsWith('#/edit/')) {
      setTitle('Edit label');
      renderEditor(view, await api.getLabel(hash.slice(7)));
    } else if (hash === '#/settings') {
      setTitle('Settings');
      await renderSettings(view);
    } else if (hash === '#/station') {
      setTitle('Print station');
      renderStation(view);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

window.addEventListener('hashchange', route);
route();
