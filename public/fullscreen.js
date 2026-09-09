import { SIZES } from '/shared/sizes.js';

const EDGE = 16;      // breathing room around the label
const TOP_BAR = 56;   // the Done / Undo / Redo bar

// Full-screen editing. Labels are all wider than tall, so on a portrait
// phone the surface rotates 90° to use the long axis; when the phone itself
// is landscape no extra rotation is needed.
export function createFullscreen(deck, wrap, getSize, { onChange = () => {} } = {}) {
  let active = false;
  let rotated = false;

  function fit() {
    if (!active) return;
    const { width, height } = SIZES[getSize()];
    const aspect = width / height;
    const availW = window.innerWidth - 2 * EDGE;
    const availH = window.innerHeight - TOP_BAR - 2 * EDGE;
    rotated = window.innerHeight > window.innerWidth;
    // Layout width of the wrap (its long side); rotation happens visually.
    const w = rotated ? Math.min(availH, availW * aspect) : Math.min(availW, availH * aspect);
    wrap.style.width = `${Math.floor(w)}px`;
    wrap.style.transform = rotated ? 'rotate(90deg)' : '';
    onChange();
  }

  function enter() {
    if (active) return;
    active = true;
    deck.classList.add('fs');
    document.body.classList.add('fs-open');
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    window.addEventListener('resize', fit);
    fit();
  }

  function exit() {
    if (!active) return;
    active = false;
    rotated = false;
    deck.classList.remove('fs');
    document.body.classList.remove('fs-open');
    wrap.style.width = '';
    wrap.style.transform = '';
    window.removeEventListener('resize', fit);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onChange();
  }

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && active) exit();
  });

  return { enter, exit, fit, get active() { return active; }, isRotated: () => active && rotated };
}
