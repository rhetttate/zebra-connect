import { createCanvas } from '@napi-rs/canvas';
import { SIZES, barcodeGeometry } from './layout.js';
import { encodeUpcAModules, validateUpcA } from './barcode.js';

const FONT = 'Arial';

function fitSingleLine(ctx, text, box) {
  let size = Math.min(box.h, 200);
  while (size > 10) {
    ctx.font = `bold ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= box.w) break;
    size -= 2;
  }
  return size;
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawName(ctx, text, box) {
  if (!text) return;
  const size = fitSingleLine(ctx, text, box);
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2);
}

function drawDescription(ctx, text, box) {
  if (!text) return;
  for (let size = 40; size >= 12; size -= 2) {
    ctx.font = `${size}px ${FONT}`;
    const lines = wrapLines(ctx, text, box.w);
    const lineHeight = Math.round(size * 1.25);
    if (lines.length * lineHeight <= box.h) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((line, i) => ctx.fillText(line, box.x, box.y + i * lineHeight));
      return;
    }
  }
  // Even at 12px it overflows: draw clipped at 12px.
  ctx.font = `12px ${FONT}`;
  const lines = wrapLines(ctx, text, box.w);
  const maxLines = Math.max(1, Math.floor(box.h / 15));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.slice(0, maxLines).forEach((line, i) => ctx.fillText(line, box.x, box.y + i * 15));
}

function drawBarcode(ctx, code, box) {
  if (!validateUpcA(code)) return;
  const g = barcodeGeometry(box);
  const modules = encodeUpcAModules(code);
  ctx.fillStyle = '#000';
  for (let i = 0; i < modules.length; i++) {
    if (modules[i] === '1') {
      ctx.fillRect(g.x + i * g.moduleWidth, g.y, g.moduleWidth, g.barHeight);
    }
  }
  ctx.font = `24px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(code, g.x + g.width / 2, g.y + g.barHeight + 4);
}

function renderCanvas(label, { includeBarcode }) {
  const { width, height } = SIZES[label.size];
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  drawName(ctx, label.fields.name, label.layout.name);
  if (label.options.showDescription) {
    drawDescription(ctx, label.fields.description, label.layout.description);
  }
  if (includeBarcode) drawBarcode(ctx, label.fields.barcode, label.layout.barcode);
  return canvas;
}

export async function renderPreview(label) {
  return renderCanvas(label, { includeBarcode: true }).toBuffer('image/png');
}

export async function renderPrintBitmap(label) {
  const canvas = renderCanvas(label, { includeBarcode: false });
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
