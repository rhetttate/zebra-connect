import { icon } from './icons.js';

// Fills the floating toolbar for the selected element. Task 9 adds the
// alignment and text-size rows; the `actions` object supplies the handlers.
export function renderToolbar(el, item, actions) {
  el.innerHTML = `
    <div class="tb-row">
      <button data-act="rotate" title="Rotate 90°">${icon('rotate')}</button>
      ${item.removable ? `<button data-act="remove" title="Remove field">${icon('trash')}</button>` : ''}
    </div>`;
  for (const btn of el.querySelectorAll('button')) {
    btn.onclick = () => {
      const [act, arg] = btn.dataset.act.split(':');
      actions[act](arg);
    };
  }
}
