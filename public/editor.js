import { api } from './api.js';
import { showToast, navigate } from './app.js';

export function attachLayoutEditing(previewWrap, draft, onLayoutChange) {
  // Implemented in Task 12 (drag & resize).
}

export function renderEditor(container, labelOrDraft) {
  const draft = {
    id: labelOrDraft.id,
    size: labelOrDraft.size,
    fields: { name: '', description: '', barcode: '', ...labelOrDraft.fields },
    options: labelOrDraft.options ? { ...labelOrDraft.options } : undefined,
    layout: labelOrDraft.layout ? structuredClone(labelOrDraft.layout) : undefined,
  };

  container.innerHTML = `
    <div id="preview-wrap"><img id="preview" alt="label preview"></div>
    <label class="field">Name</label>
    <input id="f-name">
    <label class="field">Description <input id="f-showdesc" type="checkbox" style="width:auto"></label>
    <textarea id="f-desc" rows="3"></textarea>
    <label class="field">Barcode (UPC-A)</label>
    <div class="row">
      <input id="f-barcode" inputmode="numeric" maxlength="12">
      <button id="regen" class="secondary" style="flex:0 0 auto">↻ New</button>
    </div>
    <div class="row">
      <label style="flex:0 0 auto">Qty</label>
      <input id="f-qty" type="number" value="1" min="1" max="100" style="width:80px;flex:0 0 auto">
      <button id="reset-layout" class="secondary">Reset layout</button>
    </div>
    <div class="row">
      <button id="save">Save</button>
      <button id="print">🖨 Print</button>
      ${draft.id ? '<button id="delete" class="danger" style="flex:0 0 auto">🗑</button>' : ''}
    </div>`;

  const els = {
    img: container.querySelector('#preview'),
    wrap: container.querySelector('#preview-wrap'),
    name: container.querySelector('#f-name'),
    desc: container.querySelector('#f-desc'),
    showDesc: container.querySelector('#f-showdesc'),
    barcode: container.querySelector('#f-barcode'),
    qty: container.querySelector('#f-qty'),
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

  // The server fills defaults for options/layout; fetch its normalized view once
  // so the draft has concrete layout boxes for the overlay and reset button.
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
      els.name.value = draft.fields.name;
      els.desc.value = draft.fields.description;
      els.barcode.value = draft.fields.barcode;
    }
    els.showDesc.checked = draft.options.showDescription;
    attachLayoutEditing(els.wrap, draft, () => refreshPreview());
  }

  els.name.oninput = () => { draft.fields.name = els.name.value; refreshPreview(); };
  els.desc.oninput = () => { draft.fields.description = els.desc.value; refreshPreview(); };
  els.barcode.oninput = () => { draft.fields.barcode = els.barcode.value; refreshPreview(); };
  els.showDesc.onchange = () => {
    draft.options.showDescription = els.showDesc.checked;
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
  container.querySelector('#reset-layout').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    try {
      draft.layout = undefined;
      const saved = await api.updateLabel(draft.id, draft);
      draft.layout = saved.layout;
      attachLayoutEditing(els.wrap, draft, () => refreshPreview());
      refreshPreview(true);
      showToast('Layout reset');
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#save').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    try {
      const saved = await api.updateLabel(draft.id, draft);
      Object.assign(draft, saved);
      showToast('Saved');
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#print').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    const btn = container.querySelector('#print');
    btn.disabled = true;
    try {
      await api.updateLabel(draft.id, draft);
      await api.printLabel(draft, parseInt(els.qty.value, 10) || 1);
      showToast('Sent to printer 🖨');
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
