import { createCanvas, loadImage } from '@napi-rs/canvas';
import { SIZES } from '../shared/sizes.js';
import { drawLabel, setFont, fontFamily } from '../shared/render-core.js';

// Task 3 registers the Arimo files here; until then the server draws in Arial.
setFont('Arial');
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
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = (y * width + x) * 4;
      const lum = 0.299 * rgba[px] + 0.587 * rgba[px + 1] + 0.114 * rgba[px + 2];
      if (lum < 128) {
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { data, bytesPerRow, width, height };
}

// Rotates a 1bpp bitmap 90° clockwise: design pixel (x, y) lands at
// printed (height - 1 - y, x).
export function rotateBitmap90CW(bitmap) {
  const { width, height, bytesPerRow, data } = bitmap;
  const outWidth = height;
  const outHeight = width;
  const outBytesPerRow = Math.ceil(outWidth / 8);
  const out = new Uint8Array(outBytesPerRow * outHeight);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) {
        const ox = height - 1 - y;
        const oy = x;
        out[oy * outBytesPerRow + (ox >> 3)] |= 0x80 >> (ox & 7);
      }
    }
  }
  return { data: out, bytesPerRow: outBytesPerRow, width: outWidth, height: outHeight };
}
