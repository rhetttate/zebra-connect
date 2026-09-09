import { SIZES } from '/shared/sizes.js';
import { snapBox, snapTargets } from '/shared/snap.js';

const MIN_DOTS = 60;
const DRAG_START_PX = 4;
const ROLE_TAGS = {
  lot: 'LOT', best_by: 'BEST BY', packed_on: 'PACKED', allergens: 'ALLERGENS',
  net: 'NET', note: 'NOTE', ingredients: 'INGREDIENTS',
};

// One descriptor per visible element so built-ins and extras share the same
// drag/resize/toolbar machinery. `box` is the live object inside the draft.
export function elementList(draft) {
  const items = [
    { key: 'name', tag: 'NAME', box: draft.layout.name, removable: false },
  ];
  if (draft.options?.showDescription) {
    items.push({ key: 'description', tag: 'DESC', box: draft.layout.description, removable: false });
  }
  items.push({ key: 'barcode', tag: 'BARCODE', box: draft.layout.barcode, removable: false });
  for (const extra of draft.extras ?? []) {
    const tag = extra.kind === 'image' ? 'IMAGE' : (ROLE_TAGS[extra.role] ?? 'FIELD');
    items.push({ key: `extra:${extra.id}`, tag, box: extra.box, extra, removable: true });
  }
  return items;
}

// Draggable boxes over the preview. The selected box sits on top with a
// generous grab margin, drags start after a small movement so taps never
// nudge anything, and edges snap to the frame and to other boxes.
export function attachOverlay(wrap, { getDraft, onChange, onCommit, onSelect, isRotated = () => false }) {
  let selectedKey = null;
  let items = [];

  let guides = wrap.querySelector('#guides');
  if (!guides) {
    guides = document.createElement('canvas');
    guides.id = 'guides';
    wrap.appendChild(guides);
  }
  const toolbar = document.createElement('div');
  toolbar.className = 'box-toolbar';
  toolbar.hidden = true;
  wrap.appendChild(toolbar);
  toolbar.addEventListener('pointerdown', (e) => e.stopPropagation());

  wrap.addEventListener('pointerdown', (e) => {
    if (e.target === wrap || e.target.id === 'preview' || e.target.id === 'guides') deselect();
  });

  const clearGuides = () => guides.getContext('2d').clearRect(0, 0, guides.width, guides.height);
  function drawGuides(lines) {
    const ctx = guides.getContext('2d');
    clearGuides();
    ctx.strokeStyle = 'rgba(196, 58, 28, 0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const g of lines) {
      if ('x' in g) { ctx.moveTo(g.x, 0); ctx.lineTo(g.x, guides.height); }
      else { ctx.moveTo(0, g.y); ctx.lineTo(guides.width, g.y); }
    }
    ctx.stroke();
  }

  function placeToolbar(el) {
    toolbar.hidden = false;
    const above = el.offsetTop - toolbar.offsetHeight - 8;
    toolbar.style.top = `${above >= 0 ? above : el.offsetTop + el.offsetHeight + 8}px`;
    toolbar.style.left = `${Math.max(0, Math.min(el.offsetLeft, wrap.clientWidth - toolbar.offsetWidth))}px`;
  }

  function deselect() {
    selectedKey = null;
    wrap.querySelectorAll('.el-box').forEach((b) => b.classList.remove('selected'));
    toolbar.hidden = true;
    onSelect?.(null, toolbar);
  }

  function select(key) {
    selectedKey = key;
    let selectedEl = null;
    for (const b of wrap.querySelectorAll('.el-box')) {
      const on = b.dataset.el === key;
      b.classList.toggle('selected', on);
      if (on) selectedEl = b;
    }
    const item = items.find((i) => i.key === key);
    if (!item || !selectedEl) { toolbar.hidden = true; return; }
    onSelect?.(item, toolbar);
    placeToolbar(selectedEl);
  }

  function refresh() {
    wrap.querySelectorAll('.el-box').forEach((el) => el.remove());
    clearGuides();
    const draft = getDraft();
    if (!draft.layout) return;
    const { width: dotsW, height: dotsH } = SIZES[draft.size];
    wrap.style.aspectRatio = `${dotsW} / ${dotsH}`;
    if (guides.width !== dotsW || guides.height !== dotsH) { guides.width = dotsW; guides.height = dotsH; }
    items = elementList(draft);
    for (const item of items) buildBox(item, draft, dotsW, dotsH);
    if (selectedKey && items.some((i) => i.key === selectedKey)) select(selectedKey);
    else deselect();
  }

  function buildBox(item, draft, dotsW, dotsH) {
    const { box } = item;
    const el = document.createElement('div');
    el.className = 'el-box';
    el.dataset.el = item.key;
    el.innerHTML = `<span class="tag">${item.tag}</span><div class="handle"></div>`;
    wrap.insertBefore(el, toolbar); // the toolbar stays last so it paints above every box

    const sync = () => {
      el.style.left = `${(box.x / dotsW) * 100}%`;
      el.style.top = `${(box.y / dotsH) * 100}%`;
      el.style.width = `${(box.w / dotsW) * 100}%`;
      el.style.height = `${(box.h / dotsH) * 100}%`;
    };
    sync();

    const toDots = (px) => px * (dotsW / wrap.clientWidth);
    let drag = null; // { mode, startX, startY, orig, active }

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selectedKey !== item.key) select(item.key);
      const mode = e.target.classList.contains('handle') ? 'resize' : 'move';
      drag = { mode, startX: e.clientX, startY: e.clientY, orig: { ...box }, active: false };
      try { el.setPointerCapture(e.pointerId); } catch { /* no live pointer (synthetic event) */ }
    });

    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const px = e.clientX - drag.startX;
      const py = e.clientY - drag.startY;
      if (!drag.active) {
        if (Math.hypot(px, py) < DRAG_START_PX) return;
        drag.active = true;
      }
      // In the rotated full-screen view the label's x axis runs down the screen.
      const [dxPx, dyPx] = isRotated() ? [py, -px] : [px, py];
      const dx = toDots(dxPx);
      const dy = toDots(dyPx);
      const wanted = drag.mode === 'move'
        ? { ...box, x: drag.orig.x + dx, y: drag.orig.y + dy }
        : { ...box, w: Math.max(drag.orig.w + dx, MIN_DOTS), h: Math.max(drag.orig.h + dy, MIN_DOTS) };
      const others = items.filter((i) => i.key !== item.key).map((i) => i.box);
      const snapped = snapBox(wanted, { mode: drag.mode, targets: snapTargets(draft.size, others) });
      const s = snapped.box;
      if (drag.mode === 'move') {
        box.x = Math.round(Math.min(Math.max(s.x, 0), dotsW - box.w));
        box.y = Math.round(Math.min(Math.max(s.y, 0), dotsH - box.h));
      } else {
        box.w = Math.round(Math.min(Math.max(s.w, MIN_DOTS), dotsW - box.x));
        box.h = Math.round(Math.min(Math.max(s.h, MIN_DOTS), dotsH - box.y));
      }
      drawGuides(snapped.guides);
      sync();
      if (!toolbar.hidden) placeToolbar(el);
      onChange?.();
    });

    const finish = (e) => {
      if (!drag) return;
      const wasActive = drag.active;
      drag = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      clearGuides();
      if (wasActive) onCommit?.();
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
  }

  refresh();
  return {
    refresh,
    select,
    deselect,
    selected: () => items.find((i) => i.key === selectedKey) ?? null,
    toolbar,
  };
}
