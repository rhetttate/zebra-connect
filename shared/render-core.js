// Everything that paints a label onto a canvas 2D context. Runs unchanged in
// the browser (preview) and in Node via @napi-rs/canvas (print), so the two
// can never disagree. No Node imports here.
import { barcodeGeometry, encodeUpcAModules, validateUpcA } from './barcode.js';

let FONT = 'Arial';

export function setFont(family) { FONT = family; }
export function fontFamily() { return FONT; }

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
// a horizontal stretch (below 1 = condensed, as Zebra's built-in font is).
// Returns the font size used, or 0 when there was nothing to draw.
function drawFitted(ctx, text, box, { bold = false, align = 'L', stretch = 1, maxSize = 400 } = {}) {
  if (!text) return 0;
  const sx = Number.isFinite(stretch) && stretch > 0 ? stretch : 1;
  let used = 0;
  drawRotated(ctx, box, (b) => {
    const virtual = { ...b, w: b.w / sx };
    const size = fitSingleLine(ctx, text, virtual, { bold, maxSize });
    used = size;
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
  return used;
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

// Rotates the drawing context around the box's centre so `draw` can work in
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
  const cap = Math.min(200, box.textSize ?? 200);
  return drawFitted(ctx, text, box, { bold: true, align: 'C', stretch: box.stretch ?? 1, maxSize: cap });
}

// Description and plain extra fields: the biggest text that fits the box
// once wrapped. Centred both ways by default; 'L'/'R' hug that edge and the
// top of the box. Returns the font size used (12 when even that overflowed).
function drawWrappedText(ctx, text, box, { align = 'C', maxSize = 400 } = {}) {
  if (!text) return 0;
  const horizontal = align === 'L' || align === 'R' ? align : 'C';
  let used = 12;
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
    for (let size = Math.min(Math.floor(b.h / 1.15), maxSize); size >= 12; size -= 2) {
      ctx.font = `${size}px ${FONT}`;
      const lines = wrapLines(ctx, text, b.w);
      const lineHeight = Math.round(size * 1.15);
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (lines.length * lineHeight <= b.h && widest <= b.w) {
        paint(lines, size, lineHeight);
        used = size;
        return;
      }
    }
    // Even at 12px it overflows: draw what fits, clipped to the box height.
    ctx.font = `12px ${FONT}`;
    const lines = wrapLines(ctx, text, b.w);
    const maxLines = Math.max(1, Math.floor(b.h / 14));
    paint(lines.slice(0, maxLines), 12, 14);
  });
  return used;
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

async function drawImageExtra(ctx, extra, loadImage) {
  if (!loadImage) return;
  let img;
  try { img = await loadImage(extra.image); } catch { return; }
  drawRotated(ctx, { ...extra.box, rotation: extra.rotation }, (b) => ctx.drawImage(img, b.x, b.y, b.w, b.h));
}

// Paints a whole label onto `ctx`, whose canvas must already be the label's
// size in dots. `loadImage(src)` resolves a data URL to something drawImage
// accepts; omit it and image extras are skipped.
export async function drawLabel(ctx, label, { includeBarcode = true, loadImage } = {}) {
  const { width, height } = ctx.canvas;
  const sizes = {};
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  sizes.name = drawName(ctx, label.fields.name, label.layout.name);
  if (label.options.showDescription) {
    const box = label.layout.description;
    sizes.description = drawWrappedText(ctx, label.fields.description, box, { maxSize: box.textSize ?? 400 });
  }
  for (const extra of label.extras ?? []) {
    const box = { ...extra.box, rotation: extra.rotation };
    if (extra.kind === 'image') await drawImageExtra(ctx, extra, loadImage);
    else if (extra.fit) sizes[`extra:${extra.id}`] = drawFitted(ctx, extra.text, box, { bold: extra.bold, align: extra.align, stretch: extra.stretch, maxSize: extra.textSize ?? 400 });
    else sizes[`extra:${extra.id}`] = drawWrappedText(ctx, extra.text, box, { align: extra.align, maxSize: extra.textSize ?? 400 });
  }
  if (includeBarcode) drawBarcode(ctx, label.fields.barcode, label.layout.barcode);
  return { sizes };
}
