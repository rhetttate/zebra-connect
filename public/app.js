import { api } from './api.js';
import { renderEditor } from './editor.js';
import { renderSettings } from './settings.js';

const view = document.getElementById('view');
const title = document.getElementById('title');

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
  title.textContent = 'Labels';
  const labels = await api.listLabels();
  view.innerHTML = `
    <input id="search" placeholder="Search labels…">
    <div id="cards" style="margin-top:12px"></div>
    ${labels.length ? '' : '<p style="color:#666;margin-top:16px">No labels yet — tap ➕ to make one.</p>'}`;
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
      card.querySelector('.sub').textContent = `${label.size} in · ${label.fields.barcode}`;
      api.previewBlob(label).then((blob) => {
        card.querySelector('img').src = URL.createObjectURL(blob);
      }).catch(() => {});
      card.onclick = () => navigate(`#/edit/${label.id}`);
      cards.appendChild(card);
    }
  }
  draw();
  view.querySelector('#search').oninput = (e) => draw(e.target.value);
}

function renderNew() {
  title.textContent = 'New label';
  view.innerHTML = `
    <p>Pick a size:</p>
    <div class="size-grid">
      <button data-size="3x5">3" × 5"</button>
      <button data-size="3x2">3" × 2"</button>
      <button data-size="2x1.25">2" × 1.25"</button>
    </div>
    <div class="row" style="margin-top:20px">
      <button id="from-photo" class="secondary">📷 Start from photo (3×5)</button>
    </div>
    <div class="row">
      <button id="print-prn" class="secondary">📄 Print a .prn file</button>
    </div>
    <input id="photo-input" type="file" accept="image/*" capture="environment" hidden>
    <input id="prn-input" type="file" accept=".prn" hidden>`;

  for (const btn of view.querySelectorAll('[data-size]')) {
    btn.onclick = () => renderEditor(view, { size: btn.dataset.size });
  }

  const photoInput = view.querySelector('#photo-input');
  view.querySelector('#from-photo').onclick = () => photoInput.click();
  photoInput.onchange = async () => {
    const file = photoInput.files[0];
    if (!file) return;
    showToast('Reading photo…');
    try {
      const fields = await api.extract(file);
      renderEditor(view, { size: '3x5', fields });
    } catch (err) {
      // Per spec: on extraction failure, open a blank editor with an error notice.
      showToast(`Photo reading failed: ${err.message}`, true);
      renderEditor(view, { size: '3x5' });
    }
  };

  const prnInput = view.querySelector('#prn-input');
  view.querySelector('#print-prn').onclick = () => prnInput.click();
  prnInput.onchange = async () => {
    const file = prnInput.files[0];
    if (!file) return;
    try {
      await api.printRaw(file);
      showToast('Sent to printer 🖨');
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
      title.textContent = 'Edit label';
      renderEditor(view, await api.getLabel(hash.slice(7)));
    } else if (hash === '#/settings') {
      title.textContent = 'Settings';
      await renderSettings(view);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

window.addEventListener('hashchange', route);
route();
