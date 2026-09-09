import { icon } from './icons.js';

const PT_PER_DOT = 72 / 203;

// The object that carries a text size for this element, or null for the
// barcode and images.
export function sizeTarget(item, draft) {
  if (item.key === 'name') return draft.layout.name;
  if (item.key === 'description') return draft.layout.description;
  if (item.extra && item.extra.kind !== 'image') return item.extra;
  return null;
}

const ALIGNS = [
  ['left', 'alignLeft', 'Align left'], ['center', 'alignCenter', 'Centre'], ['right', 'alignRight', 'Align right'],
  ['top', 'alignTop', 'Align top'], ['middle', 'alignMiddle', 'Middle'], ['bottom', 'alignBottom', 'Align bottom'],
];

// Row one: rotate, alignment, remove. Row two (text only): Auto / − / size / + / All.
export function renderToolbar(el, item, actions) {
  const target = actions.sizeTarget();
  const fixed = target?.textSize;
  const dots = fixed ?? actions.currentSize();
  const pt = dots ? `${Math.round(dots * PT_PER_DOT)} pt` : '–';
  el.innerHTML = `
    <div class="tb-row">
      <button data-act="rotate" title="Rotate 90°">${icon('rotate')}</button>
      ${ALIGNS.map(([how, ic, title]) => `<button data-act="align:${how}" title="${title}">${icon(ic)}</button>`).join('')}
      ${item.removable ? `<button data-act="remove" title="Remove field">${icon('trash')}</button>` : ''}
    </div>
    ${target ? `<div class="tb-row">
      <button data-act="auto" class="tb-text ${fixed ? '' : 'on'}" title="Fit the text to its box">Auto</button>
      <button data-act="smaller" title="Smaller text">${icon('minus')}</button>
      <span class="tb-pt">${pt}</span>
      <button data-act="bigger" title="Bigger text">${icon('plus')}</button>
      ${item.extra ? `<button data-act="all" class="tb-text" title="Same size for all extra fields">All</button>` : ''}
    </div>` : ''}`;
  for (const btn of el.querySelectorAll('button')) {
    btn.onclick = () => {
      const [act, arg] = btn.dataset.act.split(':');
      actions[act](arg);
    };
  }
}
