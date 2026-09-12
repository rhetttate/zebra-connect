import { api } from './api.js';
import { showToast, navigate, SIZE_LABELS } from './app.js';
import { icon } from './icons.js';
import { SIZES } from './shared/sizes.js';
import { createPreview, ensureFonts } from './preview.js';
import { attachOverlay } from './overlay.js';
import { renderToolbar, sizeTarget } from './toolbar.js';
import { alignBox, frameFor } from './shared/snap.js';
import { createHistory } from './history.js';
import { createFullscreen } from './fullscreen.js';

const ROLE_TAGS = {
  lot: 'LOT', best_by: 'BEST BY', packed_on: 'PACKED', allergens: 'ALLERGENS',
  net: 'NET', note: 'NOTE', ingredients: 'INGREDIENTS',
};

function newExtraId() {
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
        <span class="deck-actions">
          <button id="undo" class="deck-btn" title="Undo" disabled>${icon('undo')}</button>
          <button id="redo" class="deck-btn" title="Redo" disabled>${icon('redo')}</button>
          <button id="fs-enter" class="deck-btn" title="Edit full screen">${icon('expand')}</button>
        </span>
      </div>
      <div class="fs-bar">
        <button id="fs-done" class="tb-text">Done</button>
        <span class="fs-title">${SIZE_LABELS[draft.size] ?? draft.size} in</span>
        <span class="fs-actions">
          <button id="fs-undo" class="deck-btn" title="Undo" disabled>${icon('undo')}</button>
          <button id="fs-redo" class="deck-btn" title="Redo" disabled>${icon('redo')}</button>
        </span>
      </div>
      <div id="preview-wrap"><canvas id="preview"></canvas></div>
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
    deck: container.querySelector('.deck'),
    actions: container.querySelector('.deck-actions'),
    canvas: container.querySelector('#preview'),
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

  const preview = createPreview(els.canvas);
  function refreshPreview() { preview.schedule(() => draft); }

  let textTimer;
  const undoable = () => structuredClone({ fields: draft.fields, options: draft.options, layout: draft.layout, extras: draft.extras });
  const history = createHistory(undoable, (state) => {
    Object.assign(draft, state);
    syncInputs();
    syncExtrasList();
    overlay.refresh();
    refreshPreview();
  }, { onChange: updateHistoryButtons });
  function updateHistoryButtons() {
    for (const id of ['#undo', '#fs-undo']) container.querySelector(id).disabled = !history.canUndo;
    for (const id of ['#redo', '#fs-redo']) container.querySelector(id).disabled = !history.canRedo;
  }
  // A completed change: one undo step, then a redraw.
  function commit() {
    clearTimeout(textTimer);
    history.commit();
    refreshPreview();
  }
  function textCommit() {
    clearTimeout(textTimer);
    textTimer = setTimeout(commit, 600);
  }

  const overlay = attachOverlay(els.wrap, {
    getDraft: () => draft,
    onChange: refreshPreview,
    onCommit: commit,
    onSelect: (item, toolbarEl) => { if (item) renderToolbar(toolbarEl, item, toolbarActions(item)); },
    isRotated: () => fullscreen.isRotated(),
  });
  const fullscreen = createFullscreen(els.deck, els.wrap, () => draft.size, {
    onChange: () => overlay.refresh(),
  });

  function toolbarActions(item) {
    const target = () => sizeTarget(item, draft);
    const rerender = () => { overlay.refresh(); commit(); };
    const current = () => target()?.textSize ?? preview.sizes[item.key] ?? 30;
    const setSize = (value) => {
      const t = target();
      if (!t) return;
      if (value === null) delete t.textSize;
      else t.textSize = Math.min(400, Math.max(8, Math.round(value)));
      rerender();
    };
    return {
      sizeTarget: target,
      currentSize: current,
      rotate() {
        const t = item.extra ?? item.box;
        t.rotation = ((t.rotation ?? 0) + 90) % 360;
        rerender();
      },
      align(how) {
        Object.assign(item.box, alignBox(item.box, how, frameFor(draft.size)));
        rerender();
      },
      remove() { overlay.deselect(); removeExtra(item.extra); },
      auto() { setSize(null); },
      smaller() { setSize(current() - 4); },
      bigger() { setSize(current() + 4); },
      all() {
        const value = target()?.textSize ?? current();
        for (const extra of draft.extras) if (extra.kind !== 'image') extra.textSize = value;
        if (target()) target().textSize = value;
        rerender();
      },
    };
  }

  function removeExtra(extra) {
    draft.extras = draft.extras.filter((e) => e.id !== extra.id);
    syncExtrasList();
    overlay.refresh();
    commit();
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
        row.innerHTML = `<span class="hint" style="flex:1;margin:0">Image (from the imported file)</span><button class="danger" title="Remove image">${icon('trash')}</button>`;
      } else {
        row.innerHTML = `<input autocomplete="off"><button class="danger" title="Remove field">${icon('trash')}</button>`;
        const input = row.querySelector('input');
        input.value = extra.text;
        if (ROLE_TAGS[extra.role]) input.placeholder = ROLE_TAGS[extra.role].toLowerCase();
        if (extra.role === 'ingredients') input.title = 'Ingredients';
        input.oninput = () => { extra.text = input.value; refreshPreview(); textCommit(); };
        input.onblur = commit;
      }
      row.querySelector('button').onclick = () => removeExtra(extra);
      els.extrasList.appendChild(row);
    }
  }

  function syncInputs() {
    els.name.value = draft.fields.name;
    els.desc.value = draft.fields.description;
    els.barcode.value = draft.fields.barcode;
    els.showDesc.checked = Boolean(draft.options?.showDescription);
  }

  // The server fills defaults for options/layout/extras; a draft without an
  // id is created now so the overlay has concrete boxes and Save works.
  async function ensureNormalized() {
    if (!draft.id || !draft.layout || !draft.options || !draft.fields.barcode) {
      const normalized = draft.id ? draft : await api.createLabel(draft);
      if (!draft.id) {
        draft.id = normalized.id;
        window.history.replaceState(null, '', `#/edit/${draft.id}`);
      }
      draft.fields = normalized.fields;
      draft.options = normalized.options;
      draft.layout = normalized.layout;
      draft.extras = normalized.extras ?? [];
    }
    draft.extras = draft.extras ?? [];
    syncInputs();
    const { width: dotsW, height: dotsH } = SIZES[draft.size];
    const boxes = [draft.layout.name, draft.layout.description, draft.layout.barcode];
    if (boxes.some((b) => b.x + b.w > dotsW || b.y + b.h > dotsH)) {
      showToast('This label predates the 5 × 3 layout — tap Reset layout to fix it', true);
    }
    syncExtrasList();
    overlay.refresh();
    history.reset();
  }

  container.querySelector('#undo').onclick = () => history.undo();
  container.querySelector('#redo').onclick = () => history.redo();
  container.querySelector('#fs-undo').onclick = () => history.undo();
  container.querySelector('#fs-redo').onclick = () => history.redo();
  container.querySelector('#fs-enter').onclick = () => fullscreen.enter();
  container.querySelector('#fs-done').onclick = () => fullscreen.exit();
  els.name.oninput = () => { draft.fields.name = els.name.value; refreshPreview(); textCommit(); };
  els.desc.oninput = () => { draft.fields.description = els.desc.value; refreshPreview(); textCommit(); };
  els.barcode.oninput = () => { draft.fields.barcode = els.barcode.value; refreshPreview(); textCommit(); };
  for (const input of [els.name, els.desc, els.barcode]) input.onblur = commit;
  els.showDesc.onchange = () => {
    if (!draft.options) return;
    draft.options.showDescription = els.showDesc.checked;
    overlay.refresh();
    commit();
  };
  container.querySelector('#regen').onclick = async () => {
    try {
      const { barcode } = await api.newBarcode();
      draft.fields.barcode = barcode;
      els.barcode.value = barcode;
      commit();
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#add-field').onclick = () => {
    if (!draft.options) { showToast('Label is still loading — try again in a second', true); return; }
    const { width: dotsW, height: dotsH } = SIZES[draft.size];
    const id = newExtraId();
    draft.extras.push({
      id,
      text: 'New field',
      box: { x: Math.round(dotsW / 2 - 150), y: Math.round(dotsH / 2 - 40), w: 300, h: 80 },
      rotation: 0,
    });
    syncExtrasList();
    overlay.refresh();
    overlay.select(`extra:${id}`);
    commit();
  };
  container.querySelector('#reset-layout').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    try {
      draft.layout = undefined;
      const saved = await api.updateLabel(draft.id, draft);
      draft.layout = saved.layout;
      overlay.refresh();
      commit();
      showToast('Layout reset');
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#save').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    try {
      const saved = await api.updateLabel(draft.id, draft);
      Object.assign(draft, saved);
      syncExtrasList();
      overlay.refresh();
      refreshPreview();
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
    } catch (err) {
      showToast(err.message, true, { actionLabel: 'Retry', onAction: () => btn.click() });
    }
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

  ensureNormalized()
    .then(async () => { await ensureFonts(); refreshPreview(); })
    .catch((err) => showToast(err.message, true));
}
