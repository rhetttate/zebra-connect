import { api } from './api.js';
import { icon } from './icons.js';
import { renderEditor } from './editor.js';
import { renderSettings } from './settings.js';

export const SIZE_LABELS = {
  '3x5': '5 × 3',
  '3x2': '3 × 2',
  '2x1.25': '2 × 1.25',
};

const view = document.getElementById('view');
const title = document.getElementById('title');

document.getElementById('nav').innerHTML = `
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
      await api.calibrate(mediaType);
      close();
      showToast(mediaType === 'continuous'
        ? 'Media type set to continuous'
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
      card.innerHTML = `
        <img alt="" loading="lazy">
        <div class="meta">
          <div class="name"></div>
          <div class="sub"></div>
        </div>`;
      card.querySelector('.name').textContent = label.fields.name || '(unnamed)';
      card.querySelector('.sub').textContent =
        `${SIZE_LABELS[label.size] ?? label.size}"  ·  ${label.fields.barcode}`;
      api.previewBlob(label).then((blob) => {
        const img = card.querySelector('img');
        img.onload = () => URL.revokeObjectURL(img.src);
        img.src = URL.createObjectURL(blob);
      }).catch(() => {});
      card.onclick = () => navigate(`#/edit/${label.id}`);
      cards.appendChild(card);
    }
  }
  draw();
  view.querySelector('#search').oninput = (e) => draw(e.target.value);
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
      <button id="print-prn" class="quiet">${icon('file')} Print a .prn file</button>
    </div>
    <input id="photo-input" type="file" accept="image/*" capture="environment" hidden>
    <input id="prn-input" type="file" accept=".prn" hidden>`;

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
      await api.printRaw(file);
      showToast('Sent to printer');
    } catch (err) {
      showToast(err.message, true);
    }
  };
}

async function route() {
  const hash = location.hash || '#/';
  try {
    if (hash === '#/' || hash === '') await renderLibrary();
    else if (hash === '#/new') renderNew();
    else if (hash.startsWith('#/edit/')) {
      setTitle('Edit label');
      renderEditor(view, await api.getLabel(hash.slice(7)));
    } else if (hash === '#/settings') {
      setTitle('Settings');
      await renderSettings(view);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

window.addEventListener('hashchange', route);
route();
