import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { SIZES } from '../public/shared/sizes.js';
import { drawLabel, setFont, fontFamily } from '../public/shared/render-core.js';
import { bitmapFromContext, rotateBitmap90CW } from '../public/shared/bitmap.js';

export { rotateBitmap90CW };

// The phone previews in the same Arimo files (served from public/fonts), so
// preview and print agree. Missing files fall back to Arial with a warning.
const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_FILES = ['Arimo-Regular.ttf', 'Arimo-Bold.ttf'].map((f) => path.join(here, '..', 'public', 'fonts', f));
if (FONT_FILES.every((f) => fs.existsSync(f)) && FONT_FILES.every((f) => GlobalFonts.registerFromPath(f, 'Arimo'))) {
  setFont('Arimo');
} else {
  console.warn('Arimo font files missing from public/fonts — drawing in Arial; phone previews may differ from prints');
  setFont('Arial');
}
export { fontFamily };

async function renderCanvas(label, { includeBarcode }) {
  const { width, height } = SIZES[label.size];
  const canvas = createCanvas(width, height);
  await drawLabel(canvas.getContext('2d'), label, { includeBarcode, loadImage });
  return canvas;
}

export async function renderPreview(label) {
  return (await renderCanvas(label, { includeBarcode: true })).toBuffer('image/png');
}

export async function renderPrintBitmap(label, { includeBarcode = false } = {}) {
  const canvas = await renderCanvas(label, { includeBarcode });
  return bitmapFromContext(canvas.getContext('2d'), canvas.width, canvas.height);
}
