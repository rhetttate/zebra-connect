import { createCanvas, loadImage } from '@napi-rs/canvas';
import { SIZES, barcodeGeometry } from './layout.js';
import { encodeUpcAModules, validateUpcA } from './barcode.js';

const FONT = 'Arial';

function fitSingleLine(ctx, text, box, { bold = true, maxSize = 200 } = {}) {
  let size = Math.min(box.h, maxSize);
  const weight = bold ? 'bold ' : '';
  while (size > 10) {
    ctx.font = `${weight}${size}px ${FONT}`;
    if (ctx.measureText(text).width <= box.w) break;
    size -= 2;
  }
  return size;
}

// A single line sized to its box (like the name), with weight, alignment and
// a horizontal stretch (below 1 = condensed, as Zebra's built-in font is) —
// how converted printer-file text keeps its original size and width.
function drawFitted(ctx, text, box, { bold = false, align = 'L', stretch = 1, maxSize = 400 } = {}) {
  if (!text) return;
  const sx = Number.isFinite(stretch) && stretch > 0 ? stretch : 1;
  drawRotated(ctx, box, (b) => {
    // Fit by size against the width the stretched text will actually take.
    const virtual = { ...b, w: b.w / sx };
    const size = fitSingleLine(ctx, text, virtual, { bold, maxSize });
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`;
    ctx.textBaseline = 'middle';
    const y = b.y + b.h / 2;
    let anchorX = b.x;
    if (align === 'C') { ctx.textAlign = 'center'; anchorX = b.x + b.w / 2; }
    else if (align === 'R') { ctx.textAlign = 'right'; anchorX = b.x + b.w; }
    else ctx.textAlign = 'left';
    ctx.save();
    ctx.translate(anchorX, y);
    ctx.scale(sx, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  });
}

async function drawImageExtra(ctx, extra) {
  let img;
  try { img = await loadImage(extra.image); } catch { return; }
  drawRotated(ctx, { ...extra.box, rotation: extra.rotation }, (b) => ctx.drawImage(img, b.x, b.y, b.w, b.h));
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

// Rotates the drawing context around the box's center so `draw` can work in
// an axis-aligned box. For 90/270 the effective box swaps width and height.
function drawRotated(ctx, box, draw) {
  const rotation = box.rotation ?? 0;
  if (!rotation) {
    draw(box);
    return;
  }
  const swap = rotation === 90 || rotation === 270;
  const ew = swap ? box.h : box.w;
  const eh = swap ? box.w : box.h;
  ctx.save();
  ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  draw({ x: -ew / 2, y: -eh / 2, w: ew, h: eh });
  ctx.restore();
}

function drawName(ctx, text, box) {
  drawFitted(ctx, text, box, { bold: true, align: 'C', stretch: box.stretch ?? 1, maxSize: 200 });
}

// Description and plain extra fields: the biggest text that fits the box
// once wrapped. Centred both ways by default; 'L'/'R' hug that edge and the
// top of the box, which reads like a paragraph (used for ingredients).
function drawWrappedText(ctx, text, box, { align = 'C' } = {}) {
  if (!text) return;
  const horizontal = align === 'L' || align === 'R' ? align : 'C';
  drawRotated(ctx, box, (b) => {
    const paint = (lines, size, lineHeight) => {
      ctx.font = `${size}px ${FONT}`;
      ctx.textBaseline = 'middle';
      let x = b.x + b.w / 2;
      ctx.textAlign = 'center';
      if (horizontal === 'L') { ctx.textAlign = 'left'; x = b.x; }
      if (horizontal === 'R') { ctx.textAlign = 'right'; x = b.x + b.w; }
      const top = horizontal === 'C' ? b.y + (b.h - lines.length * lineHeight) / 2 : b.y;
      lines.forEach((line, i) => ctx.fillText(line, x, top + i * lineHeight + lineHeight / 2));
    };
    for (let size = Math.min(Math.floor(b.h / 1.15), 400); size >= 12; size -= 2) {
      ctx.font = `${size}px ${FONT}`;
      const lines = wrapLines(ctx, text, b.w);
      const lineHeight = Math.round(size * 1.15);
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (lines.length * lineHeight <= b.h && widest <= b.w) {
        paint(lines, size, lineHeight);
        return;
      }
    }
    // Even at 12px it overflows: draw what fits, clipped to the box height.
    ctx.font = `12px ${FONT}`;
    const lines = wrapLines(ctx, text, b.w);
    const maxLines = Math.max(1, Math.floor(b.h / 14));
    paint(lines.slice(0, maxLines), 12, 14);
  });
}

function drawBarcode(ctx, code, box) {
  if (!validateUpcA(code)) return;
  drawRotated(ctx, box, (b) => {
    const g = barcodeGeometry(b);
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
  });
}

async function renderCanvas(label, { includeBarcode }) {
  const { width, height } = SIZES[label.size];
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  drawName(ctx, label.fields.name, label.layout.name);
  if (label.options.showDescription) {
    drawWrappedText(ctx, label.fields.description, label.layout.description);
  }
  for (const extra of label.extras ?? []) {
    const box = { ...extra.box, rotation: extra.rotation };
    if (extra.kind === 'image') await drawImageExtra(ctx, extra);
    else if (extra.fit) drawFitted(ctx, extra.text, box, { bold: extra.bold, align: extra.align, stretch: extra.stretch });
    else drawWrappedText(ctx, extra.text, box, { align: extra.align });
  }
  if (includeBarcode) drawBarcode(ctx, label.fields.barcode, label.layout.barcode);
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
