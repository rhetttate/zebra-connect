import { drawLabel, setFont } from '/shared/render-core.js';
import { SIZES } from '/shared/sizes.js';

// Waits for the Arimo web fonts so the first draw already uses them; on a
// browser without the Font Loading API it just proceeds.
export async function ensureFonts() {
  setFont('Arimo');
  try {
    await Promise.all([document.fonts.load('16px Arimo'), document.fonts.load('bold 16px Arimo')]);
  } catch { /* fall back to whatever the browser substitutes */ }
}

const imageCache = new Map();
function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image failed to load'));
      img.src = src;
    }));
  }
  return imageCache.get(src);
}

// A label preview on a <canvas> sized in dots and scaled by CSS. schedule()
// coalesces any number of changes into one draw per animation frame.
export function createPreview(canvas) {
  let pending = false;
  let lastSizes = {};
  async function draw(label) {
    if (!label?.layout || !SIZES[label.size]) return;
    const { width, height } = SIZES[label.size];
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const { sizes } = await drawLabel(canvas.getContext('2d'), label, { includeBarcode: true, loadImage });
    lastSizes = sizes;
  }
  return {
    get sizes() { return lastSizes; },
    draw,
    schedule(getLabel) {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        draw(getLabel()).catch(() => {});
      });
    },
  };
}
