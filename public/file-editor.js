// Editor for imported printer files. The ZebraDesigner ZPL stays the source
// of truth: the user edits its positioned fields on top of a Labelary
// preview, and the same parser/applier the server uses rewrites them in
// place (public/zpl-fields.js is a verbatim copy of src/zpl-fields.js).
import { api } from './api.js';
import { showToast, navigate, openFilePrint, SIZE_LABELS } from './app.js';
import { parseFields, applyFields } from './zpl-fields.js';

export async function renderFileEditor(container, label) {
  if (api.mode === 'local') {
    container.innerHTML = '<p class="hint">Printer files are edited on the laptop, not on this tablet.</p>';
    return;
  }
  let base = label.zpl;            // the ZPL all field edits are applied to
  let fields = parseFields(base);
  let zpl = base;                  // working copy = base + current fields
  let name = label.fields.name;
  let dirty = false;
  let selected = fields.find((f) => f.kind === 'text')?.id ?? fields[0]?.id ?? null;

  const sizeText = label.size ? `${SIZE_LABELS[label.size] ?? label.size}"` : 'size from file';
  container.innerHTML = `
    <div class="deck">
      <div class="deck-bar"><span>Printer file · ${sizeText}</span><span id="fe-status"></span></div>
      <div id="fe-preview-wrap"><img id="fe-preview" alt=""><div id="fe-boxes"></div></div>
    </div>
    <p class="hint">Tap a field on the preview to select it, drag to move it. Rotated fields can be retyped but not moved.</p>
    <label class="field" for="fe-name">Name</label>
    <input id="fe-name" type="text">
    <div id="fe-fields"></div>
    <div class="row">
      <button id="fe-smaller" class="quiet tight" title="Smaller text">A−</button>
      <button id="fe-bigger" class="quiet tight" title="Bigger text">A+</button>
      <span class="hint" id="fe-selected" style="margin:0"></span>
    </div>
    <div class="row">
      <button id="fe-save" class="accent">Save</button>
      <button id="fe-print" class="quiet">Print</button>
    </div>
    <button id="fe-advanced" class="quiet" style="width:100%">Advanced: edit raw ZPL</button>
    <button id="fe-convert" class="quiet" style="width:100%;margin-top:8px">Convert to app label</button>
    <textarea id="fe-zpl" rows="12" hidden spellcheck="false"
      style="font-family:var(--mono);font-size:12px;margin-top:8px;white-space:pre"></textarea>
    ${fields.length ? '' : '<p class="empty">This file has no editable text fields. Use Advanced to change the ZPL.</p>'}`;

  const $ = (sel) => container.querySelector(sel);
  const img = $('#fe-preview');
  const boxes = $('#fe-boxes');
  const status = $('#fe-status');
  const list = $('#fe-fields');
  const ta = $('#fe-zpl');
  $('#fe-name').value = name;
  $('#fe-name').oninput = (e) => { name = e.target.value; dirty = true; };

  // ---- preview (Labelary via the server; 1 px = 1 printer dot) ----
  let previewTimer = null;
  let previewUrl = null;
  async function refreshPreview() {
    status.textContent = 'rendering…';
    try {
      const blob = await api.previewZplBlob(zpl);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      img.src = previewUrl;
      status.textContent = '';
    } catch (err) {
      status.textContent = 'preview unavailable';
      showToast(err.message, true);
    }
  }
  const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, 400); };
  img.onload = layoutBoxes;
  window.addEventListener('resize', layoutBoxes);

  function syncZpl() {
    try {
      zpl = applyFields(base, fields);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // ---- field boxes over the preview ----
  function boxRect(f) {
    const h = f.font?.h ?? (f.kind === 'barcode' ? 150 : 30);
    const w = f.kind === 'barcode' ? 220 : Math.max(40, Math.round(f.text.length * (f.font?.w ?? 30) * 0.6));
    const top = f.origin === 'FT' ? f.y - h : f.y;
    return { x: f.x, y: Math.max(0, top), w, h };
  }
  function layoutBoxes() {
    if (!img.naturalWidth) return;
    const scale = img.clientWidth / img.naturalWidth;
    boxes.innerHTML = '';
    for (const f of fields) {
      const r = boxRect(f);
      const el = document.createElement('div');
      el.className = `fe-box${f.id === selected ? ' selected' : ''}${f.rotated ? ' rotated' : ''}`;
      el.style.left = `${r.x * scale}px`;
      el.style.top = `${r.y * scale}px`;
      el.style.width = `${r.w * scale}px`;
      el.style.height = `${r.h * scale}px`;
      el.dataset.id = f.id;
      el.onpointerdown = (e) => startDrag(e, f, el, scale);
      boxes.appendChild(el);
    }
  }
  function startDrag(e, f, el, scale) {
    e.preventDefault();
    select(f.id);
    if (f.rotated || !(scale > 0)) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = f.x;
    const origY = f.y;
    let moved = false;
    try { el.setPointerCapture(e.pointerId); } catch { /* capture is a nicety, not a requirement */ }
    el.onpointermove = (ev) => {
      const dx = (ev.clientX - startX) / scale;
      const dy = (ev.clientY - startY) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      f.x = Math.max(0, Math.round(origX + dx));
      f.y = Math.max(0, Math.round(origY + dy));
      layoutBoxes();
    };
    el.onpointerup = el.onpointercancel = () => {
      el.onpointermove = null;
      if (moved) { dirty = true; syncZpl(); schedulePreview(); }
    };
  }

  // ---- inputs ----
  function renderInputs() {
    list.innerHTML = '';
    for (const f of fields) {
      const lab = document.createElement('label');
      lab.className = 'field';
      lab.textContent = f.kind === 'barcode' ? 'Barcode' : `Text ${f.id + 1}${f.rotated ? ' (rotated)' : ''}`;
      const input = document.createElement('input');
      input.type = 'text';
      if (f.kind === 'barcode') input.inputMode = 'numeric';
      input.value = f.text;
      input.dataset.id = f.id;
      input.onfocus = () => select(f.id, false);
      input.oninput = () => { f.text = input.value; dirty = true; syncZpl(); layoutBoxes(); schedulePreview(); };
      list.appendChild(lab);
      list.appendChild(input);
    }
  }
  function select(id, focus = true) {
    selected = id;
    layoutBoxes();
    const f = fields.find((x) => x.id === id);
    $('#fe-selected').textContent = !f ? '' : f.kind === 'barcode' ? 'Barcode selected' : `Text ${f.id + 1} selected`;
    if (focus) list.querySelector(`input[data-id="${id}"]`)?.focus({ preventScroll: true });
  }
  function resize(factor) {
    const f = fields.find((x) => x.id === selected);
    if (!f || !f.font) { showToast('Select a text field first', true); return; }
    f.font = { h: Math.max(8, Math.round(f.font.h * factor)), w: Math.max(8, Math.round(f.font.w * factor)) };
    dirty = true; syncZpl(); layoutBoxes(); schedulePreview();
  }
  $('#fe-smaller').onclick = () => resize(0.9);
  $('#fe-bigger').onclick = () => resize(1.1);

  // ---- advanced: raw ZPL becomes the new base ----
  $('#fe-advanced').onclick = () => {
    ta.hidden = !ta.hidden;
    if (!ta.hidden) { ta.value = zpl; ta.focus(); }
  };
  ta.onchange = () => {
    base = ta.value;
    zpl = base;
    dirty = true;
    fields = parseFields(base);
    selected = fields.find((f) => f.kind === 'text')?.id ?? fields[0]?.id ?? null;
    renderInputs();
    select(selected, false);
    schedulePreview();
  };

  // ---- save / print ----
  $('#fe-save').onclick = async () => {
    const btn = $('#fe-save');
    btn.disabled = true;
    try {
      label = await api.saveFileZpl(label.id, zpl, name);
      base = label.zpl;
      zpl = base;
      dirty = false;
      showToast('Saved');
    } catch (err) {
      showToast(err.message, true);
    }
    btn.disabled = false;
  };
  $('#fe-print').onclick = () => {
    if (dirty) { showToast('Save first, then print', true); return; }
    openFilePrint(label, () => navigate('#/'));
  };

  $('#fe-convert').onclick = async () => {
    if (dirty) { showToast('Save first, then convert', true); return; }
    if (!confirm('Turn this file into a regular app label? The file entry is replaced by the new label.')) return;
    try {
      const { label: created, warnings } = await api.convertFile(label.id);
      container._leaveGuard = null;
      if (warnings.length) showToast(warnings.join(' · '), true);
      navigate(`#/edit/${created.id}`);
    } catch (err) {
      showToast(err.message, true);
    }
  };

  container._leaveGuard = () => !dirty || confirm('Discard unsaved changes to this file?');

  renderInputs();
  select(selected, false);
  refreshPreview();
}
