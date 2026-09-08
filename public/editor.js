import { api } from './api.js';
import { showToast, navigate, SIZE_LABELS } from './app.js';
import { icon } from './icons.js';

const DOT_SIZES = { '3x5': [1015, 576], '3x2': [576, 406], '2x1.25': [406, 253] };
const MIN_DOTS = 60;

function newExtraId() {
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Builds one descriptor per visible element so built-ins and extras share
// the same drag/resize/rotate machinery.
function elementList(draft) {
  const items = [
    { key: 'name', tag: 'NAME', box: draft.layout.name, removable: false },
  ];
  if (draft.options?.showDescription) {
    items.push({ key: 'description', tag: 'DESC', box: draft.layout.description, removable: false });
  }
  items.push({ key: 'barcode', tag: 'BARCODE', box: draft.layout.barcode, removable: false });
  for (const extra of draft.extras ?? []) {
    items.push({ key: `extra:${extra.id}`, tag: extra.kind === 'image' ? 'IMAGE' : 'FIELD', box: extra.box, extra, removable: true });
  }
  return items;
}

export function attachLayoutEditing(previewWrap, draft, onLayoutChange, onRemoveExtra) {
  previewWrap.querySelectorAll('.el-box, .box-toolbar').forEach((el) => el.remove());
  if (!draft.layout) return;
  const [dotsW, dotsH] = DOT_SIZES[draft.size];
  previewWrap.style.aspectRatio = `${dotsW} / ${dotsH}`;

  const toolbar = document.createElement('div');
  toolbar.className = 'box-toolbar';
  toolbar.hidden = true;
  previewWrap.appendChild(toolbar);

  function deselect() {
    previewWrap.querySelectorAll('.el-box').forEach((b) => b.classList.remove('selected'));
    toolbar.hidden = true;
  }
  previewWrap.addEventListener('pointerdown', (e) => {
    if (e.target === previewWrap || e.target.id === 'preview') deselect();
  });

  for (const item of elementList(draft)) {
    const { box } = item;
    const el = document.createElement('div');
    el.className = 'el-box';
    el.dataset.el = item.key;
    el.innerHTML = `<span class="tag">${item.tag}</span><div class="handle"></div>`;
    previewWrap.appendChild(el);

    const getRotation = () => (item.extra ? item.extra.rotation ?? 0 : box.rotation ?? 0);
    const setRotation = (r) => {
      if (item.extra) item.extra.rotation = r;
      else box.rotation = r;
    };

    const sync = () => {
      el.style.left = `${(box.x / dotsW) * 100}%`;
      el.style.top = `${(box.y / dotsH) * 100}%`;
      el.style.width = `${(box.w / dotsW) * 100}%`;
      el.style.height = `${(box.h / dotsH) * 100}%`;
    };
    sync();

    function placeToolbar() {
      toolbar.hidden = false;
      toolbar.innerHTML = `
        <button data-act="rotate" title="Rotate 90°">${icon('rotate')}</button>
        ${item.removable ? `<button data-act="remove" title="Remove field">${icon('trash')}</button>` : ''}`;
      const top = el.offsetTop - 44;
      toolbar.style.top = `${top >= 0 ? top : el.offsetTop + el.offsetHeight + 8}px`;
      toolbar.style.left = `${Math.max(0, Math.min(el.offsetLeft, previewWrap.clientWidth - 90))}px`;
      toolbar.querySelector('[data-act="rotate"]').onclick = () => {
        setRotation((getRotation() + 90) % 360);
        onLayoutChange();
      };
      const removeBtn = toolbar.querySelector('[data-act="remove"]');
      if (removeBtn) removeBtn.onclick = () => {
        deselect();
        onRemoveExtra?.(item.extra);
      };
      toolbar.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    let drag = null; // {mode: 'move'|'resize', startX, startY, orig}
    const toDots = (px) => px * (dotsW / previewWrap.clientWidth);

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      previewWrap.querySelectorAll('.el-box').forEach((b) => b.classList.remove('selected'));
      el.classList.add('selected');
      placeToolbar();
      const mode = e.target.classList.contains('handle') ? 'resize' : 'move';
      drag = { mode, startX: e.clientX, startY: e.clientY, orig: { ...box } };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = toDots(e.clientX - drag.startX);
      const dy = toDots(e.clientY - drag.startY);
      if (drag.mode === 'move') {
        box.x = Math.round(Math.min(Math.max(drag.orig.x + dx, 0), dotsW - box.w));
        box.y = Math.round(Math.min(Math.max(drag.orig.y + dy, 0), dotsH - box.h));
      } else {
        box.w = Math.round(Math.min(Math.max(drag.orig.w + dx, MIN_DOTS), dotsW - box.x));
        box.h = Math.round(Math.min(Math.max(drag.orig.h + dy, MIN_DOTS), dotsH - box.y));
      }
      sync();
      if (!toolbar.hidden) placeToolbar();
    });
    el.addEventListener('pointerup', (e) => {
      if (!drag) return;
      drag = null;
      el.releasePointerCapture(e.pointerId);
      onLayoutChange();
    });
    el.addEventListener('pointercancel', () => {
      if (!drag) return;
      drag = null;
      onLayoutChange();
    });
  }
}

export function renderEditor(container, labelOrDraft) {
  const draft = {
    id: labelOrDraft.id,
    size: labelOrDraft.size,
    fields: { name: '', description: '', barcode: '', ...labelOrDraft.fields },
    options: labelOrDraft.options ? { ...labelOrDraft.options } : undefined,
    layout: labelOrDraft.layout ? structuredClone(labelOrDraft.layout) : undefined,
    extras: labelOrDraft.extras ? structuredClone(labelOrDraft.extras) : undefined,
  };

  container.innerHTML = `
    <div class="deck">
      <div class="deck-bar">
        <span>${SIZE_LABELS[draft.size] ?? draft.size} in · 203 dpi</span>
        <span>tap a field to move it</span>
      </div>
      <div id="preview-wrap"><img id="preview" alt="label preview"></div>
    </div>
    <label class="field">Name</label>
    <input id="f-name" autocomplete="off">
    <label class="field">Description <input id="f-showdesc" type="checkbox"></label>
    <textarea id="f-desc" rows="3"></textarea>
    <label class="field">Barcode · UPC-A</label>
    <div class="row">
      <input id="f-barcode" inputmode="numeric" maxlength="12" style="font-family:var(--mono)">
      <button id="regen" class="quiet tight">${icon('refresh')} New</button>
    </div>
    <div id="extras-list"></div>
    <div class="row">
      <button id="add-field" class="quiet">${icon('plus')} Add field</button>
      <button id="reset-layout" class="quiet">Reset layout</button>
    </div>
    <div class="row">
      <label class="field tight" style="margin:0">Qty</label>
      <input id="f-qty" type="number" value="1" min="1" max="100" class="tight" style="width:76px">
      <button id="save" class="quiet">Save</button>
      <button id="print" class="accent">${icon('print')} Print</button>
      ${draft.id ? `<button id="delete" class="danger tight" title="Delete label">${icon('trash')}</button>` : ''}
    </div>`;

  const els = {
    img: container.querySelector('#preview'),
    wrap: container.querySelector('#preview-wrap'),
    name: container.querySelector('#f-name'),
    desc: container.querySelector('#f-desc'),
    showDesc: container.querySelector('#f-showdesc'),
    barcode: container.querySelector('#f-barcode'),
    qty: container.querySelector('#f-qty'),
    extrasList: container.querySelector('#extras-list'),
  };
  els.name.value = draft.fields.name;
  els.desc.value = draft.fields.description;
  els.barcode.value = draft.fields.barcode;

  let refreshTimer;
  let lastUrl;
  async function refreshPreview(immediate = false) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      try {
        const blob = await api.previewBlob(draft);
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(blob);
        els.img.src = lastUrl;
      } catch (err) {
        showToast(err.message, true);
      }
    }, immediate ? 0 : 350);
  }

  function reattach() {
    attachLayoutEditing(els.wrap, draft, () => refreshPreview(), removeExtra);
  }

  function removeExtra(extra) {
    draft.extras = draft.extras.filter((e) => e.id !== extra.id);
    syncExtrasList();
    reattach();
    refreshPreview(true);
  }

  function syncExtrasList() {
    els.extrasList.innerHTML = '';
    if (!draft.extras?.length) return;
    const eyebrow = document.createElement('label');
    eyebrow.className = 'field';
    eyebrow.textContent = 'Extra fields';
    els.extrasList.appendChild(eyebrow);
    for (const extra of draft.extras) {
      const row = document.createElement('div');
      row.className = 'extra-row';
      if (extra.kind === 'image') {
        // A picture from an imported printer file: movable on the preview, not typed.
        row.innerHTML = `<span class="hint" style="flex:1;margin:0">Image (from the imported file)</span><button class="danger" title="Remove image">${icon('trash')}</button>`;
      } else {
        row.innerHTML = `<input autocomplete="off"><button class="danger" title="Remove field">${icon('trash')}</button>`;
        const input = row.querySelector('input');
        input.value = extra.text;
        input.oninput = () => { extra.text = input.value; refreshPreview(); };
      }
      row.querySelector('button').onclick = () => removeExtra(extra);
      els.extrasList.appendChild(row);
    }
  }

  // The server fills defaults for options/layout/extras; fetch its normalized
  // view once so the draft has concrete boxes for the overlay.
  async function ensureNormalized() {
    if (!draft.layout || !draft.options || !draft.fields.barcode) {
      const normalized = draft.id ? draft : await api.createLabel(draft);
      if (!draft.id) {
        draft.id = normalized.id;
        history.replaceState(null, '', `#/edit/${draft.id}`);
      }
      draft.fields = normalized.fields;
      draft.options = normalized.options;
      draft.layout = normalized.layout;
      draft.extras = normalized.extras ?? [];
      els.name.value = draft.fields.name;
      els.desc.value = draft.fields.description;
      els.barcode.value = draft.fields.barcode;
    }
    draft.extras = draft.extras ?? [];
    els.showDesc.checked = draft.options.showDescription;
    const [dotsW, dotsH] = DOT_SIZES[draft.size];
    const boxes = [draft.layout.name, draft.layout.description, draft.layout.barcode];
    if (boxes.some((b) => b.x + b.w > dotsW || b.y + b.h > dotsH)) {
      showToast('This label predates the 5 × 3 layout — tap Reset layout to fix it', true);
    }
    syncExtrasList();
    reattach();
  }

  els.name.oninput = () => { draft.fields.name = els.name.value; refreshPreview(); };
  els.desc.oninput = () => { draft.fields.description = els.desc.value; refreshPreview(); };
  els.barcode.oninput = () => { draft.fields.barcode = els.barcode.value; refreshPreview(); };
  els.showDesc.onchange = () => {
    if (!draft.options) return;
    draft.options.showDescription = els.showDesc.checked;
    reattach();
    refreshPreview(true);
  };
  container.querySelector('#regen').onclick = async () => {
    try {
      const { barcode } = await api.newBarcode();
      draft.fields.barcode = barcode;
      els.barcode.value = barcode;
      refreshPreview(true);
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#add-field').onclick = () => {
    if (!draft.options) { showToast('Label is still loading — try again in a second', true); return; }
    const [dotsW, dotsH] = DOT_SIZES[draft.size];
    draft.extras.push({
      id: newExtraId(),
      text: 'New field',
      box: {
        x: Math.round(dotsW / 2 - 150),
        y: Math.round(dotsH / 2 - 40),
        w: 300,
        h: 80,
      },
      rotation: 0,
    });
    syncExtrasList();
    reattach();
    refreshPreview(true);
  };
  container.querySelector('#reset-layout').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    try {
      draft.layout = undefined;
      const saved = await api.updateLabel(draft.id, draft);
      draft.layout = saved.layout;
      reattach();
      refreshPreview(true);
      showToast('Layout reset');
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#save').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    try {
      const saved = await api.updateLabel(draft.id, draft);
      Object.assign(draft, saved);
      syncExtrasList();
      reattach();
      showToast('Saved');
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#print').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    const btn = container.querySelector('#print');
    btn.disabled = true;
    try {
      // Warn before printing onto the wrong roll.
      try {
        const { loadedSize } = await api.getSettings();
        if (loadedSize && loadedSize !== draft.size) {
          const ok = confirm(
            `This is a ${SIZE_LABELS[draft.size]}" label but ${SIZE_LABELS[loadedSize]}" stock is loaded. Print anyway?`);
          if (!ok) { btn.disabled = false; return; }
        }
      } catch { /* settings unavailable — don't block printing */ }
      await api.updateLabel(draft.id, draft);
      const result = await api.printLabel(draft, parseInt(els.qty.value, 10) || 1);
      showToast(result.queued ? 'Queued — printing at the station' : 'Sent to printer');
    } catch (err) { showToast(err.message, true); }
    btn.disabled = false;
  };
  const deleteBtn = container.querySelector('#delete');
  if (deleteBtn) deleteBtn.onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    if (!confirm('Delete this label?')) return;
    try {
      await api.deleteLabel(draft.id);
      navigate('#/');
    } catch (err) { showToast(err.message, true); }
  };

  ensureNormalized().then(() => refreshPreview(true)).catch((err) => showToast(err.message, true));
}
