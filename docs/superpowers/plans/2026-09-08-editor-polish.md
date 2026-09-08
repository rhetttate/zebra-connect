# Label Editor Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the label editor instant and precise on a phone: preview drawn locally with the printer's exact renderer and font, sticky selection, snapping with guides, alignment and text-size controls, undo/redo, and a rotated full-screen mode; barcodes print exactly as previewed.

**Architecture:** The drawing code moves to `shared/` as browser-safe ES modules that both the Node server (`src/render.js` wrapper, `@napi-rs/canvas`) and the phone (`public/preview.js`, a `<canvas>`) import. Arimo font files ship in `public/fonts/` and are registered on both sides. The editor is split into small modules: `preview.js` (canvas + rAF), `overlay.js` (boxes, drag, snap, guides), `toolbar.js` (actions UI), `history.js` (undo), `fullscreen.js` (rotated full-screen), with `editor.js` wiring them. The native ZPL barcode is retired; every label prints the drawn UPC-A.

**Tech Stack:** Node 24 ESM, Express 4, `@napi-rs/canvas`, plain browser ES modules (no bundler), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-08-editor-polish-design.md`

## Global Constraints

- Everything under `shared/` must run unchanged in the browser and in Node: no Node imports, no bundler, relative imports only within `shared/`. The phone imports them as `/shared/<file>.js`; the server as `../shared/<file>.js`.
- Label sizes in dots at 203 dpi: `3x5` 1015×576, `3x2` 576×406, `2x1.25` 406×253. Label margin for snapping and alignment: 20 dots (10 on `2x1.25`).
- Existing labels must render the same: renderer defaults reproduce current behaviour when `textSize`/`align` are absent; only the barcode digits move (bar widths and module size unchanged).
- Font family is `Arimo` when `public/fonts/Arimo-Regular.ttf` and `Arimo-Bold.ttf` exist, else `Arial` with one console warning.
- `textSize` is an integer 8..400 (a ceiling on fitted text). Snap threshold 12 dots. Drag starts after 4 CSS px. Undo history cap 50.
- Tests: `npm test`. Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Never commit `data/` or `ai-label-out/`.
- Browser verification uses the in-app browser via the `zebra-connect` launch configuration (never start the server with Bash). The always-on background server also listens on port 3000; stop it first if `preview_start` reports the port busy, and restart it at the end with `cmd //c "start /b wscript.exe start-zebra-connect.vbs"` from the repo root.

---

## File structure

| File | Responsibility |
|---|---|
| `shared/sizes.js` (new) | `SIZES`, `MARGIN` constants |
| `shared/barcode.js` (new) | UPC-A check digit, validation, module encoding, `barcodeGeometry` (moved from `src/`) |
| `shared/render-core.js` (new) | All drawing on a canvas 2D context; `drawLabel`, `setFont`, `fontFamily` |
| `shared/snap.js` (new) | `frameFor`, `snapTargets`, `snapBox`, `alignBox` (pure) |
| `src/barcode.js`, `src/layout.js` | Keep `generateUpcA` / layout defaults; re-export moved names |
| `src/render.js` | Node wrapper: font registration, canvas creation, PNG / 1-bpp output |
| `src/zpl.js`, `src/app.js` | Drop native barcode; serve `/shared`; `textSize` on name/description boxes |
| `public/fonts/` (new) | Arimo Regular + Bold |
| `public/preview.js` (new) | Canvas preview with rAF scheduling and font loading |
| `public/overlay.js` (new) | Element boxes, sticky selection, drag with threshold, snapping, guides |
| `public/toolbar.js` (new) | Two-row toolbar: rotate / align / remove, text size |
| `public/history.js` (new) | Undo/redo stack (pure, tested) |
| `public/fullscreen.js` (new) | Full-screen mode with portrait rotation |
| `public/editor.js` | Wiring; form fields; save/print |
| `public/icons.js`, `public/style.css`, `public/api.js`, `README.md` | Icons, styles, dead `previewBlob` removed, docs |
| Tests | `test/render.test.js`, `test/zpl.test.js`, `test/app.test.js`, `test/snap.test.js` (new), `test/history.test.js` (new) |

---

### Task 1: Shared sizes and barcode modules

**Files:**
- Create: `shared/sizes.js`, `shared/barcode.js`
- Modify: `src/barcode.js`, `src/layout.js`
- Test: `test/barcode.test.js` (unchanged, must stay green), `test/layout.test.js` (unchanged)

**Interfaces:**
- Produces: `shared/sizes.js` exports `SIZES` and `MARGIN`; `shared/barcode.js` exports `upcCheckDigit`, `validateUpcA`, `encodeUpcAModules`, `barcodeGeometry(box)` → `{ moduleWidth, width, digitHeight, x, y, barHeight }`. `src/barcode.js` and `src/layout.js` keep every name they export today.

- [ ] **Step 1: Write the failing test**

Create `test/shared-modules.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZES, MARGIN } from '../shared/sizes.js';
import { barcodeGeometry, encodeUpcAModules, validateUpcA } from '../shared/barcode.js';
import * as srcBarcode from '../src/barcode.js';
import * as srcLayout from '../src/layout.js';

test('shared sizes match the layout module and carry margins', () => {
  assert.deepEqual(SIZES, srcLayout.SIZES);
  assert.deepEqual(MARGIN, { '3x5': 20, '3x2': 20, '2x1.25': 10 });
});

test('barcodeGeometry reserves room for UPC digits below the bars', () => {
  const g = barcodeGeometry({ x: 98, y: 225, w: 380, h: 175 });
  assert.equal(g.moduleWidth, 4);
  assert.equal(g.width, 380);
  assert.equal(g.digitHeight, 32);
  assert.equal(g.barHeight, 175 - 32 - 6);
  assert.equal(g.x, 98);
  const small = barcodeGeometry({ x: 0, y: 0, w: 335, h: 220 });
  assert.equal(small.moduleWidth, 3);
  assert.equal(small.digitHeight, 24);
  assert.equal(small.barHeight, 220 - 30, 'module width 3 keeps today\'s bar height');
});

test('src modules re-export the shared barcode helpers', () => {
  assert.equal(srcBarcode.validateUpcA, validateUpcA);
  assert.equal(srcBarcode.encodeUpcAModules, encodeUpcAModules);
  assert.equal(srcLayout.barcodeGeometry, barcodeGeometry);
  assert.equal(typeof srcBarcode.generateUpcA, 'function');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/shared-modules.test.js
```

Expected: FAIL — cannot find module `../shared/sizes.js`.

- [ ] **Step 3: Implement**

Create `shared/sizes.js`:

```js
// Label canvas sizes in printer dots at 203 dpi, and the margin the layout
// engine, snapping and alignment all treat as the printable frame.
export const SIZES = {
  '3x5': { width: 1015, height: 576 },
  '3x2': { width: 576, height: 406 },
  '2x1.25': { width: 406, height: 253 },
};

export const MARGIN = { '3x5': 20, '3x2': 20, '2x1.25': 10 };
```

Create `shared/barcode.js` (moved from `src/barcode.js` and `src/layout.js`, plus `digitHeight`):

```js
// UPC-A encoding shared by the server renderer and the phone preview.
const L_CODES = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

export function upcCheckDigit(d11) {
  if (!/^\d{11}$/.test(d11)) throw new Error('need 11 digits');
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const n = d11.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? n * 3 : n; // positions 1,3,5,... (1-indexed odd) weigh 3
  }
  return String((10 - (sum % 10)) % 10);
}

export function validateUpcA(code) {
  return /^\d{12}$/.test(code) && upcCheckDigit(code.slice(0, 11)) === code[11];
}

export function encodeUpcAModules(code12) {
  if (!validateUpcA(code12)) throw new Error('invalid UPC-A code');
  const rCode = (d) => L_CODES[d].replace(/[01]/g, (c) => (c === '0' ? '1' : '0'));
  let out = '101';
  for (let i = 0; i < 6; i++) out += L_CODES[code12.charCodeAt(i) - 48];
  out += '01010';
  for (let i = 6; i < 12; i++) out += rCode(code12.charCodeAt(i) - 48);
  return out + '101';
}

// Where the 95-module symbol sits in its box. Digits print below the bars at
// digitHeight; the tall guard bars extend that far too, so the bars give up
// digitHeight + 6 dots of the box height. (Module width 3 keeps the old
// 30-dot allowance exactly.)
export function barcodeGeometry(box) {
  const moduleWidth = Math.max(2, Math.floor(box.w / 95));
  const width = moduleWidth * 95;
  const digitHeight = Math.round(moduleWidth * 8);
  return {
    moduleWidth,
    width,
    digitHeight,
    x: box.x + Math.floor((box.w - width) / 2),
    y: box.y,
    barHeight: Math.max(20, box.h - digitHeight - 6),
  };
}
```

Replace `src/barcode.js` with:

```js
import crypto from 'node:crypto';
import { upcCheckDigit } from '../shared/barcode.js';

export { upcCheckDigit, validateUpcA, encodeUpcAModules, barcodeGeometry } from '../shared/barcode.js';

export function generateUpcA(isTaken) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let d11 = '';
    for (let i = 0; i < 11; i++) d11 += crypto.randomInt(10);
    const code = d11 + upcCheckDigit(d11);
    if (!isTaken(code)) return code;
  }
  throw new Error('could not generate a unique barcode');
}
```

In `src/layout.js`: replace the `export const SIZES = { ... };` block with

```js
import { SIZES } from '../shared/sizes.js';
export { SIZES };
export { barcodeGeometry } from '../shared/barcode.js';
```

and delete the `barcodeGeometry` function at the bottom of the file.

- [ ] **Step 4: Run to verify it passes**

```bash
npm test
```

Expected: all pass (existing barcode, layout and render tests included).

- [ ] **Step 5: Commit**

```bash
git add shared/sizes.js shared/barcode.js src/barcode.js src/layout.js test/shared-modules.test.js
git commit -m "refactor: shared sizes and barcode modules for server and phone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Shared render core

**Files:**
- Create: `shared/render-core.js`
- Modify: `src/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Produces: `shared/render-core.js` exports `setFont(family)`, `fontFamily()`, and `drawLabel(ctx, label, { includeBarcode = true, loadImage } = {})` → `Promise<{ sizes }>` where `sizes` maps `name`, `description`, `extra:<id>` to the font size (px) each was drawn at. `drawLabel` paints white then the label onto `ctx.canvas`'s full area. `src/render.js` keeps `renderPreview`, `renderPrintBitmap(label, { includeBarcode = false })`, `rotateBitmap90CW`.

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.js`:

```js
import { createCanvas } from '@napi-rs/canvas';
import { drawLabel } from '../shared/render-core.js';

test('drawLabel reports the size each text element was drawn at', async () => {
  const canvas = createCanvas(576, 406);
  const { sizes } = await drawLabel(canvas.getContext('2d'), {
    size: '3x2',
    fields: { name: 'Sugar', description: 'Granulated', barcode: '' },
    options: { showDescription: true },
    layout: defaultLayout('3x2'),
    extras: [{ id: 'e1', text: 'Lot 1', box: { x: 20, y: 300, w: 200, h: 40 }, rotation: 0, fit: true, textSize: 20 }],
  }, { includeBarcode: false });
  assert.ok(sizes.name > 20, 'name fits its 110-tall box at a large size');
  assert.ok(sizes.description >= 12);
  assert.equal(sizes['extra:e1'], 20, 'a capped fitted extra reports its cap');
});
```

(Place the two `import` lines with the other imports at the top of the file.)

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/render.test.js
```

Expected: FAIL — cannot find module `../shared/render-core.js`.

- [ ] **Step 3: Implement the core**

Create `shared/render-core.js`:

```js
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
```

(The barcode still draws today's plain style here; Task 4 restyles it. `drawName` already honours `box.textSize`, which Task 5 lets through the API.)

- [ ] **Step 4: Replace `src/render.js` with the Node wrapper**

```js
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
```

- [ ] **Step 5: Run to verify it passes**

```bash
npm test
```

Expected: all pass. Every existing render test exercises the moved code through `src/render.js`.

- [ ] **Step 6: Commit**

```bash
git add shared/render-core.js src/render.js test/render.test.js
git commit -m "refactor: label drawing moves to a shared core usable in the browser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Arimo on both sides

**Files:**
- Create: `public/fonts/Arimo-Regular.ttf`, `public/fonts/Arimo-Bold.ttf`, `public/fonts/LICENSE.txt`
- Modify: `src/render.js`, `public/style.css`
- Test: `test/render.test.js`

**Interfaces:**
- Produces: `fontFamily()` from `src/render.js` returns `'Arimo'` when the files are present; CSS `@font-face` for `Arimo` at weights 400 and 700.

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.js` (add `fontFamily` to the `../src/render.js` import):

```js
test('the server draws in Arimo when the font files are present', () => {
  assert.equal(fontFamily(), 'Arimo');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/render.test.js
```

Expected: FAIL — `'Arial' !== 'Arimo'`.

- [ ] **Step 3: Fetch the fonts**

```bash
mkdir -p public/fonts
curl -sL -o public/fonts/Arimo-Regular.ttf https://raw.githubusercontent.com/googlefonts/Arimo/main/fonts/ttf/Arimo-Regular.ttf
curl -sL -o public/fonts/Arimo-Bold.ttf https://raw.githubusercontent.com/googlefonts/Arimo/main/fonts/ttf/Arimo-Bold.ttf
curl -sL -o public/fonts/LICENSE.txt https://raw.githubusercontent.com/googlefonts/Arimo/main/LICENSE.txt
ls -l public/fonts
head -c 4 public/fonts/Arimo-Regular.ttf | od -c | head -1
```

Expected: two files around 470 KB each; the first four bytes are `\0 001 \0 \0` (a TrueType header). If `LICENSE.txt` came back as an HTML 404 page, replace it with one line: `Arimo — Copyright 2013 Google LLC, licensed under the Apache License, Version 2.0 (https://github.com/googlefonts/Arimo).`

- [ ] **Step 4: Register on the server**

In `src/render.js`, replace the two lines

```js
// Task 3 registers the Arimo files here; until then the server draws in Arial.
setFont('Arial');
```

with

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalFonts } from '@napi-rs/canvas';

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
```

(Move the `import` lines up with the other imports; ESM hoists them anyway.)

- [ ] **Step 5: Web font**

At the top of `public/style.css`, before `:root`, add:

```css
@font-face {
  font-family: 'Arimo';
  src: url('fonts/Arimo-Regular.ttf') format('truetype');
  font-weight: 400;
  font-display: block;
}
@font-face {
  font-family: 'Arimo';
  src: url('fonts/Arimo-Bold.ttf') format('truetype');
  font-weight: 700;
  font-display: block;
}
```

- [ ] **Step 6: Run to verify it passes**

```bash
npm test
```

Expected: all pass. The pixel tests still hold because Arimo's metrics match Arial's; if a boundary test flips (a wrap or fit changing by one step), report it rather than loosening the test.

- [ ] **Step 7: Commit**

```bash
git add public/fonts src/render.js public/style.css test/render.test.js
git commit -m "feat: Arimo font on server and phone so previews match prints

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: UPC-A styling

**Files:**
- Modify: `shared/render-core.js` (`drawBarcode`)
- Test: `test/render.test.js`

**Interfaces:**
- Produces: the drawn barcode has tall bars for modules 0–9, 45–49, 85–94 (extended by `digitHeight`), digits at `digitHeight` px with baseline at `barHeight + digitHeight`: first digit right of nothing (right-aligned just left of module 0), digits 2–6 spread under modules 10–44, digits 7–11 under 50–84, check digit left-aligned just right of module 94.

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.js` (`blackIn` and `blackRowCount` helpers already exist in the file):

```js
test('barcode draws UPC-A style: tall guards, outer digits beside the symbol', async () => {
  // 3x2 default barcode box {98,225,380,175}: module 4, digits 32 tall, bars 137 tall.
  const bmp = await renderPrintBitmap({
    size: '3x2',
    fields: { name: '', description: '', barcode: '036000291452' },
    options: { showDescription: false },
    layout: defaultLayout('3x2'),
  }, { includeBarcode: true });
  const guardRows = blackRowCount(bmp, 98, 102, 225, 400);          // module 0 (left guard)
  const dataRows = blackRowCount(bmp, 98 + 11 * 4, 98 + 12 * 4, 225, 400); // module 11: a data bar of digit "3"
  assert.ok(dataRows >= 130 && dataRows <= 140, `data bar ~137 rows, got ${dataRows}`);
  assert.ok(guardRows >= dataRows + 25, `guard bar extends below the data bars (${guardRows} vs ${dataRows})`);
  assert.ok(blackIn(bmp, 60, 94, 362, 394), 'first digit painted left of the symbol');
  assert.ok(blackIn(bmp, 482, 520, 362, 394), 'check digit painted right of the symbol');
  assert.ok(blackIn(bmp, 98 + 10 * 4, 98 + 45 * 4, 366, 394), 'digits 2-6 sit under the left half (modules 10-44 are all short bars)');
  assert.ok(!blackIn(bmp, 98 + 10 * 4, 98 + 45 * 4, 362, 365), 'a clear gap between the short bars and the digit line');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/render.test.js
```

Expected: FAIL — guard rows equal data rows (today every bar is the same height) and nothing is painted left of the symbol.

- [ ] **Step 3: Implement**

In `shared/render-core.js`, replace `drawBarcode` with:

```js
// UPC-A the way a printer draws it: the guard bars and the outer digits' bars
// run down into the digit line, the first digit sits left of the symbol, five
// digits under each half, the check digit to the right.
function drawBarcode(ctx, code, box) {
  if (!validateUpcA(code)) return;
  drawRotated(ctx, box, (b) => {
    const g = barcodeGeometry(b);
    const m = g.moduleWidth;
    const modules = encodeUpcAModules(code);
    const tall = (i) => i <= 9 || (i >= 45 && i <= 49) || i >= 85;
    ctx.fillStyle = '#000';
    for (let i = 0; i < modules.length; i++) {
      if (modules[i] === '1') {
        ctx.fillRect(g.x + i * m, g.y, m, g.barHeight + (tall(i) ? g.digitHeight : 0));
      }
    }
    ctx.font = `${g.digitHeight}px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    const baseline = g.y + g.barHeight + g.digitHeight;
    ctx.textAlign = 'right';
    ctx.fillText(code[0], g.x - m, baseline);
    ctx.textAlign = 'left';
    ctx.fillText(code[11], g.x + 95 * m + m, baseline);
    ctx.textAlign = 'center';
    const spread = (digits, fromModule, toModule) => {
      const step = ((toModule - fromModule) * m) / digits.length;
      for (let k = 0; k < digits.length; k++) {
        ctx.fillText(digits[k], g.x + fromModule * m + step * (k + 0.5), baseline);
      }
    };
    spread(code.slice(1, 6), 10, 45);
    spread(code.slice(6, 11), 50, 85);
  });
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test
```

Expected: all pass. If the "no digit under modules 0–9" assertion fails because a glyph's descender reaches into that band, check the baseline arithmetic before touching the test: digits have no descenders, so nothing should paint below the baseline.

- [ ] **Step 5: Commit**

```bash
git add shared/render-core.js test/render.test.js
git commit -m "feat: barcodes draw in real UPC-A style with guard bars and split digits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Retire the native barcode; text size on name and description

**Files:**
- Modify: `src/zpl.js`, `src/app.js` (print route ~line 280; `normalizeDraft` layout loop ~line 96)
- Test: `test/zpl.test.js`, `test/app.test.js`, `test/render.test.js`

**Interfaces:**
- Produces: `buildLabelZpl({ width, height, bitmap, quantity = 1, darkness = null })` (no barcode parameters, never emits `^BU`); `POST /api/print` renders with `includeBarcode: true` on every size; `normalizeDraft` keeps `textSize` (8..400, rounded) on `layout.name` and `layout.description`.

- [ ] **Step 1: Update and add tests**

In `test/zpl.test.js`, replace the two `buildLabelZpl` tests with:

```js
test('buildLabelZpl composes a bitmap-only job', () => {
  const zpl = buildLabelZpl({ width: 576, height: 406, bitmap, quantity: 3, darkness: 20 });
  assert.ok(zpl.startsWith('~SD20\n^XA'));
  assert.ok(zpl.includes('^PW576'));
  assert.ok(zpl.includes('^LL406'));
  assert.ok(zpl.includes('^FO0,0^GFA,4,4,2,FF000FF0^FS'));
  assert.ok(!zpl.includes('^BU'), 'barcodes are drawn into the bitmap, never a native field');
  assert.ok(zpl.includes('^PQ3'));
  assert.ok(zpl.trimEnd().endsWith('^XZ'));
});

test('buildLabelZpl omits darkness when absent and defaults quantity to 1', () => {
  const zpl = buildLabelZpl({ width: 576, height: 406, bitmap });
  assert.ok(zpl.startsWith('^XA'));
  assert.ok(!zpl.includes('~SD'));
  assert.ok(zpl.includes('^PQ1'));
});
```

In `test/app.test.js`, in the test `print builds ZPL and sends it to the configured printer`, replace

```js
  assert.ok(sent[0].data.includes('^BUN'));
```

with

```js
  assert.ok(!sent[0].data.includes('^BUN'), 'small sizes draw the barcode into the bitmap too');
```

and append:

```js
test('labels keep a textSize on the name and description boxes', async () => {
  const { base, close } = await startApp();
  const layout = {
    name: { x: 20, y: 20, w: 536, h: 110, textSize: 60.4 },
    description: { x: 20, y: 140, w: 536, h: 80, textSize: 'big' },
    barcode: { x: 98, y: 225, w: 380, h: 175, textSize: 30 },
  };
  const created = await (await fetch(`${base}/api/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: '3x2', fields: { name: 'Flour' }, layout }),
  })).json();
  assert.equal(created.layout.name.textSize, 60);
  assert.equal('textSize' in created.layout.description, false);
  assert.equal('textSize' in created.layout.barcode, false);
  close();
});
```

Append to `test/render.test.js`:

```js
test('textSize on the name box caps the name', async () => {
  const base = {
    size: '3x2',
    fields: { name: 'Hi', description: '', barcode: '' },
    options: { showDescription: false },
  };
  const capped = await renderPrintBitmap({ ...base, layout: { ...defaultLayout('3x2'), name: { x: 20, y: 20, w: 536, h: 110, textSize: 20 } } });
  const free = await renderPrintBitmap({ ...base, layout: defaultLayout('3x2') });
  assert.ok(blackRowCount(capped, 20, 556, 20, 130) < 25, 'capped name is about 20px tall');
  assert.ok(blackRowCount(free, 20, 556, 20, 130) > 60, 'uncapped name fills its box');
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
node --test test/zpl.test.js test/app.test.js
```

Expected: in `test/app.test.js` the print test's `!includes('^BUN')` assertion FAILS (the route still emits a native barcode on 3x2) and the textSize round-trip FAILS (`normalizeDraft` drops it). The rewritten ZPL tests already pass because they pass no barcode, and the render test passes because Task 2 wired `drawName`; both stay as regression guards.

- [ ] **Step 3: Implement**

Replace `buildLabelZpl` in `src/zpl.js` with:

```js
export function buildLabelZpl({ width, height, bitmap, quantity = 1, darkness = null }) {
  const parts = [];
  if (darkness !== null && darkness !== undefined && darkness !== '') {
    parts.push(`~SD${String(darkness).padStart(2, '0')}\n`);
  }
  parts.push('^XA\n');
  parts.push(`^PW${width}\n^LL${height}\n^LH0,0\n`);
  parts.push(`^FO0,0${encodeGfa(bitmap)}^FS\n`);
  parts.push(`^PQ${quantity}\n^XZ\n`);
  return parts.join('');
}
```

and remove the now-unused imports of `barcodeGeometry` and `validateUpcA` at the top of `src/zpl.js`.

In `src/app.js`, replace the body of the print route from `// The barcode stays a native ZPL field...` through the `buildLabelZpl({...})` call with:

```js
    // Everything, barcode included, is drawn into one bitmap at dot
    // resolution, so the print is exactly what the phone previewed.
    let bitmap = await renderPrintBitmap(label, { includeBarcode: true });
    if (printRotation(label.size) === 90) bitmap = rotateBitmap90CW(bitmap);
    const zpl = buildLabelZpl({
      width: bitmap.width,
      height: bitmap.height,
      bitmap,
      quantity,
      darkness: config.get().darkness,
    });
```

In `normalizeDraft`, inside the `for (const key of ['name', 'description', 'barcode'])` loop, after `validateRotation(b.rotation, key);` add:

```js
      const textSize = Number(b.textSize);
      if (key !== 'barcode' && Number.isFinite(textSize) && textSize >= 8 && textSize <= 400) b.textSize = Math.round(textSize);
      else delete b.textSize;
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm test
```

Expected: all pass, including the two existing "no native barcode" tests, which now hold trivially.

- [ ] **Step 5: Commit**

```bash
git add src/zpl.js src/app.js test/zpl.test.js test/app.test.js test/render.test.js
git commit -m "feat: print every barcode from the bitmap; text size on name and description

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Snapping and alignment maths

**Files:**
- Create: `shared/snap.js`
- Test: `test/snap.test.js`

**Interfaces:**
- Produces: `frameFor(size)` → `{ x, y, w, h }` (the margin frame); `snapTargets(size, otherBoxes)` → `{ xs: number[], ys: number[] }`; `snapBox(box, { mode: 'move'|'resize', targets, threshold = 12 })` → `{ box, guides: [{ x } | { y }] }`; `alignBox(box, how, frame)` with `how` in `left, center, right, top, middle, bottom`.

- [ ] **Step 1: Write the failing tests**

Create `test/snap.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { frameFor, snapTargets, snapBox, alignBox, SNAP_THRESHOLD } from '../shared/snap.js';

test('frameFor is the label inset by its margin', () => {
  assert.deepEqual(frameFor('3x5'), { x: 20, y: 20, w: 975, h: 536 });
  assert.deepEqual(frameFor('2x1.25'), { x: 10, y: 10, w: 386, h: 233 });
});

test('snapTargets lists margin, centre and every other box edge and centre', () => {
  const t = snapTargets('3x2', [{ x: 100, y: 50, w: 200, h: 40 }]);
  assert.deepEqual(t.xs, [20, 288, 556, 100, 200, 300]);
  assert.deepEqual(t.ys, [20, 203, 386, 50, 70, 90]);
});

test('moving snaps the nearest edge within the threshold and reports the guide', () => {
  const targets = snapTargets('3x5', []);
  const near = snapBox({ x: 27, y: 200, w: 300, h: 60 }, { mode: 'move', targets });
  assert.equal(near.box.x, 20);
  assert.equal(near.box.y, 200);
  assert.deepEqual(near.guides, [{ x: 20 }]);

  const far = snapBox({ x: 40, y: 200, w: 300, h: 60 }, { mode: 'move', targets });
  assert.equal(far.box.x, 40);
  assert.deepEqual(far.guides, []);
});

test('moving snaps the centre to the label centre', () => {
  const targets = snapTargets('3x5', []);
  // label centre x = 507.5; box centre 357+150 = 507 → shift by 0.5, rounded
  const out = snapBox({ x: 357, y: 100, w: 300, h: 60 }, { mode: 'move', targets });
  assert.equal(out.box.x, 358);
  assert.deepEqual(out.guides, [{ x: 507.5 }]);
});

test('resizing snaps only the right and bottom edges', () => {
  const targets = snapTargets('3x5', [{ x: 600, y: 300, w: 100, h: 50 }]);
  const out = snapBox({ x: 20, y: 100, w: 675, h: 245 }, { mode: 'resize', targets });
  assert.equal(out.box.x, 20, 'origin never moves on resize');
  assert.equal(out.box.w, 680, 'right edge 695 → other box right 700');
  assert.equal(out.box.h, 250, 'bottom 345 → other box bottom 350');
  assert.deepEqual(out.guides, [{ x: 700 }, { y: 350 }]);
});

test('threshold is inclusive and ties keep the earlier target', () => {
  assert.equal(SNAP_THRESHOLD, 12);
  const targets = { xs: [100, 124], ys: [] };
  assert.equal(snapBox({ x: 112, y: 0, w: 10, h: 10 }, { mode: 'move', targets }).box.x, 100, 'equidistant → first target');
  assert.equal(snapBox({ x: 88, y: 0, w: 10, h: 10 }, { mode: 'move', targets }).box.x, 100, 'exactly 12 away snaps');
  assert.equal(snapBox({ x: 87, y: 0, w: 10, h: 10 }, { mode: 'move', targets }).box.x, 87, '13 away does not');
});

test('alignBox positions a box against the frame', () => {
  const frame = frameFor('3x5');
  const box = { x: 100, y: 100, w: 300, h: 60, rotation: 0 };
  assert.equal(alignBox(box, 'left', frame).x, 20);
  assert.equal(alignBox(box, 'center', frame).x, 358);
  assert.equal(alignBox(box, 'right', frame).x, 695);
  assert.equal(alignBox(box, 'top', frame).y, 20);
  assert.equal(alignBox(box, 'middle', frame).y, 258);
  assert.equal(alignBox(box, 'bottom', frame).y, 496);
  assert.equal(alignBox(box, 'left', frame).rotation, 0, 'other fields survive');
  assert.throws(() => alignBox(box, 'sideways', frame), /alignment/);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/snap.test.js
```

Expected: FAIL — cannot find module `../shared/snap.js`.

- [ ] **Step 3: Implement**

Create `shared/snap.js`:

```js
// Snapping and alignment in label dots. Pure functions shared with the phone.
import { SIZES, MARGIN } from './sizes.js';

export const SNAP_THRESHOLD = 12;

export function frameFor(size) {
  const { width, height } = SIZES[size];
  const m = MARGIN[size];
  return { x: m, y: m, w: width - 2 * m, h: height - 2 * m };
}

// Lines worth snapping to: the margin frame, the label centre, and the edges
// and centres of every other box.
export function snapTargets(size, otherBoxes) {
  const { width, height } = SIZES[size];
  const f = frameFor(size);
  const xs = [f.x, width / 2, f.x + f.w];
  const ys = [f.y, height / 2, f.y + f.h];
  for (const b of otherBoxes) {
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

function nearest(candidates, targets, threshold) {
  let best = null;
  for (const c of candidates) {
    for (const t of targets) {
      const d = t - c;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, t };
    }
  }
  return best;
}

// Moving considers left/centre/right and top/middle/bottom and shifts the
// box; resizing considers only the far edges and changes w/h.
export function snapBox(box, { mode, targets, threshold = SNAP_THRESHOLD }) {
  const out = { ...box };
  const guides = [];
  const xc = mode === 'move' ? [box.x, box.x + box.w / 2, box.x + box.w] : [box.x + box.w];
  const yc = mode === 'move' ? [box.y, box.y + box.h / 2, box.y + box.h] : [box.y + box.h];
  const sx = nearest(xc, targets.xs, threshold);
  const sy = nearest(yc, targets.ys, threshold);
  if (sx) {
    if (mode === 'move') out.x = Math.round(box.x + sx.d);
    else out.w = Math.round(box.w + sx.d);
    guides.push({ x: sx.t });
  }
  if (sy) {
    if (mode === 'move') out.y = Math.round(box.y + sy.d);
    else out.h = Math.round(box.h + sy.d);
    guides.push({ y: sy.t });
  }
  return { box: out, guides };
}

export function alignBox(box, how, frame) {
  const out = { ...box };
  switch (how) {
    case 'left': out.x = frame.x; break;
    case 'center': out.x = Math.round(frame.x + (frame.w - box.w) / 2); break;
    case 'right': out.x = frame.x + frame.w - box.w; break;
    case 'top': out.y = frame.y; break;
    case 'middle': out.y = Math.round(frame.y + (frame.h - box.h) / 2); break;
    case 'bottom': out.y = frame.y + frame.h - box.h; break;
    default: throw new Error(`unknown alignment: ${how}`);
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node --test test/snap.test.js
```

Expected: all pass. (`Math.round(357 + 0.5)` is 358, `Math.round(20 + (975 - 300) / 2)` is 358, `Math.round(20 + (536 - 60) / 2)` is 258.)

- [ ] **Step 5: Commit**

```bash
git add shared/snap.js test/snap.test.js
git commit -m "feat: snapping and alignment maths shared with the phone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Serve `/shared`; canvas preview module

**Files:**
- Modify: `src/app.js` (static middleware ~line 44), `public/api.js`
- Create: `public/preview.js`
- Modify: `public/style.css`
- Test: `test/app.test.js`

**Interfaces:**
- Produces: `GET /shared/<file>.js` serves the `shared/` directory. `public/preview.js` exports `ensureFonts()` → Promise, and `createPreview(canvas)` → `{ schedule(getLabel), draw(label), get sizes }`.

- [ ] **Step 1: Write the failing test**

Append to `test/app.test.js`:

```js
test('the shared drawing modules are served to the phone', async () => {
  const { base, close } = await startApp();
  const res = await fetch(`${base}/shared/render-core.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /export async function drawLabel/);
  close();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/app.test.js
```

Expected: FAIL — 404.

- [ ] **Step 3: Serve the directory**

In `src/app.js`, after `app.use(express.static(path.join(here, '..', 'public')));` add:

```js
  // The phone draws its preview with the same modules the print path uses.
  app.use('/shared', express.static(path.join(here, '..', 'shared')));
```

- [ ] **Step 4: Preview module**

Create `public/preview.js`:

```js
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
```

- [ ] **Step 5: Styles and dead code**

In `public/style.css`, replace the line `#preview-wrap img { display: block; width: 100%; border-radius: 2px; }` with:

```css
#preview-wrap canvas#preview { display: block; width: 100%; height: auto; border-radius: 2px; }
#guides { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
```

In `public/api.js`, delete the `previewBlob` entry (the editor stops using it in Task 8; nothing else does).

- [ ] **Step 6: Run the suite**

```bash
npm test
grep -rn "previewBlob" public src
```

Expected: all pass; the grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/app.js public/preview.js public/style.css public/api.js test/app.test.js
git commit -m "feat: serve shared drawing modules and add a canvas preview for the phone

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Overlay module and editor rewrite

**Files:**
- Create: `public/overlay.js`, `public/toolbar.js` (rotate/remove only; Task 9 completes it)
- Modify: `public/editor.js` (full replacement), `public/style.css`

**Interfaces:**
- Consumes: `createPreview`, `ensureFonts` (Task 7); `snapBox`, `snapTargets` (Task 6); `SIZES`.
- Produces: `attachOverlay(wrap, { getDraft, onChange, onCommit, onSelect, isRotated })` → `{ refresh(), select(key), deselect(), selected(), toolbar }`; `elementList(draft)`; `renderToolbar(el, item, actions)` where `actions` has `rotate()` and `remove()` (Task 9 adds more); editor functions `commit()` (a stub Task 10 replaces) and `toolbarActions(item)`.

- [ ] **Step 1: Overlay**

Create `public/overlay.js`:

```js
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
      el.setPointerCapture(e.pointerId);
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
```

- [ ] **Step 2: Minimal toolbar**

Create `public/toolbar.js`:

```js
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
```

- [ ] **Step 3: Editor**

Replace `public/editor.js` entirely with:

```js
import { api } from './api.js';
import { showToast, navigate, SIZE_LABELS } from './app.js';
import { icon } from './icons.js';
import { SIZES } from '/shared/sizes.js';
import { createPreview, ensureFonts } from './preview.js';
import { attachOverlay } from './overlay.js';
import { renderToolbar } from './toolbar.js';

const ROLE_TAGS = {
  lot: 'LOT', best_by: 'BEST BY', packed_on: 'PACKED', allergens: 'ALLERGENS',
  net: 'NET', note: 'NOTE', ingredients: 'INGREDIENTS',
};

function newExtraId() {
  return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function renderEditor(container, labelOrDraft) {
  const draft = {
    id: labelOrDraft.id,
    size: labelOrDraft.size,
    fields: { name: '', description: '', barcode: '', ...labelOrDraft.fields },
    options: labelOrDraft.options ? { ...labelOrDraft.options } : undefined,
    layout: labelOrDraft.layout ? structuredClone(labelOrDraft.layout) : undefined,
    extras: labelOrDraft.extras ? structuredClone(labelOrDraft.extras) : undefined,
  };

  container.innerHTML = `
    <div class="deck">
      <div class="deck-bar">
        <span>${SIZE_LABELS[draft.size] ?? draft.size} in · 203 dpi</span>
        <span class="deck-actions">tap a field to move it</span>
      </div>
      <div id="preview-wrap"><canvas id="preview"></canvas></div>
    </div>
    <label class="field">Name</label>
    <input id="f-name" autocomplete="off">
    <label class="field">Description <input id="f-showdesc" type="checkbox"></label>
    <textarea id="f-desc" rows="3"></textarea>
    <label class="field">Barcode · UPC-A</label>
    <div class="row">
      <input id="f-barcode" inputmode="numeric" maxlength="12" style="font-family:var(--mono)">
      <button id="regen" class="quiet tight">${icon('refresh')} New</button>
    </div>
    <div id="extras-list"></div>
    <div class="row">
      <button id="add-field" class="quiet">${icon('plus')} Add field</button>
      <button id="reset-layout" class="quiet">Reset layout</button>
    </div>
    <div class="row">
      <label class="field tight" style="margin:0">Qty</label>
      <input id="f-qty" type="number" value="1" min="1" max="100" class="tight" style="width:76px">
      <button id="save" class="quiet">Save</button>
      <button id="print" class="accent">${icon('print')} Print</button>
      ${draft.id ? `<button id="delete" class="danger tight" title="Delete label">${icon('trash')}</button>` : ''}
    </div>`;

  const els = {
    deck: container.querySelector('.deck'),
    actions: container.querySelector('.deck-actions'),
    canvas: container.querySelector('#preview'),
    wrap: container.querySelector('#preview-wrap'),
    name: container.querySelector('#f-name'),
    desc: container.querySelector('#f-desc'),
    showDesc: container.querySelector('#f-showdesc'),
    barcode: container.querySelector('#f-barcode'),
    qty: container.querySelector('#f-qty'),
    extrasList: container.querySelector('#extras-list'),
  };
  els.name.value = draft.fields.name;
  els.desc.value = draft.fields.description;
  els.barcode.value = draft.fields.barcode;

  const preview = createPreview(els.canvas);
  function refreshPreview() { preview.schedule(() => draft); }

  // A completed change. Undo history hooks in here (Task 10); for now it draws.
  function commit() { refreshPreview(); }
  let textTimer;
  function textCommit() {
    clearTimeout(textTimer);
    textTimer = setTimeout(commit, 600);
  }

  const overlay = attachOverlay(els.wrap, {
    getDraft: () => draft,
    onChange: refreshPreview,
    onCommit: commit,
    onSelect: (item, toolbarEl) => { if (item) renderToolbar(toolbarEl, item, toolbarActions(item)); },
    isRotated: () => false,
  });

  function toolbarActions(item) {
    const rerender = () => { overlay.refresh(); commit(); };
    return {
      rotate() {
        const target = item.extra ?? item.box;
        target.rotation = ((target.rotation ?? 0) + 90) % 360;
        rerender();
      },
      remove() { overlay.deselect(); removeExtra(item.extra); },
    };
  }

  function removeExtra(extra) {
    draft.extras = draft.extras.filter((e) => e.id !== extra.id);
    syncExtrasList();
    overlay.refresh();
    commit();
  }

  function syncExtrasList() {
    els.extrasList.innerHTML = '';
    if (!draft.extras?.length) return;
    const eyebrow = document.createElement('label');
    eyebrow.className = 'field';
    eyebrow.textContent = 'Extra fields';
    els.extrasList.appendChild(eyebrow);
    for (const extra of draft.extras) {
      const row = document.createElement('div');
      row.className = 'extra-row';
      if (extra.kind === 'image') {
        row.innerHTML = `<span class="hint" style="flex:1;margin:0">Image (from the imported file)</span><button class="danger" title="Remove image">${icon('trash')}</button>`;
      } else {
        row.innerHTML = `<input autocomplete="off"><button class="danger" title="Remove field">${icon('trash')}</button>`;
        const input = row.querySelector('input');
        input.value = extra.text;
        if (ROLE_TAGS[extra.role]) input.placeholder = ROLE_TAGS[extra.role].toLowerCase();
        if (extra.role === 'ingredients') input.title = 'Ingredients';
        input.oninput = () => { extra.text = input.value; refreshPreview(); textCommit(); };
        input.onblur = commit;
      }
      row.querySelector('button').onclick = () => removeExtra(extra);
      els.extrasList.appendChild(row);
    }
  }

  function syncInputs() {
    els.name.value = draft.fields.name;
    els.desc.value = draft.fields.description;
    els.barcode.value = draft.fields.barcode;
    els.showDesc.checked = Boolean(draft.options?.showDescription);
  }

  // The server fills defaults for options/layout/extras; a draft without an
  // id is created now so the overlay has concrete boxes and Save works.
  async function ensureNormalized() {
    if (!draft.id || !draft.layout || !draft.options || !draft.fields.barcode) {
      const normalized = draft.id ? draft : await api.createLabel(draft);
      if (!draft.id) {
        draft.id = normalized.id;
        history.replaceState(null, '', `#/edit/${draft.id}`);
      }
      draft.fields = normalized.fields;
      draft.options = normalized.options;
      draft.layout = normalized.layout;
      draft.extras = normalized.extras ?? [];
    }
    draft.extras = draft.extras ?? [];
    syncInputs();
    const { width: dotsW, height: dotsH } = SIZES[draft.size];
    const boxes = [draft.layout.name, draft.layout.description, draft.layout.barcode];
    if (boxes.some((b) => b.x + b.w > dotsW || b.y + b.h > dotsH)) {
      showToast('This label predates the 5 × 3 layout — tap Reset layout to fix it', true);
    }
    syncExtrasList();
    overlay.refresh();
  }

  els.name.oninput = () => { draft.fields.name = els.name.value; refreshPreview(); textCommit(); };
  els.desc.oninput = () => { draft.fields.description = els.desc.value; refreshPreview(); textCommit(); };
  els.barcode.oninput = () => { draft.fields.barcode = els.barcode.value; refreshPreview(); textCommit(); };
  for (const input of [els.name, els.desc, els.barcode]) input.onblur = commit;
  els.showDesc.onchange = () => {
    if (!draft.options) return;
    draft.options.showDescription = els.showDesc.checked;
    overlay.refresh();
    commit();
  };
  container.querySelector('#regen').onclick = async () => {
    try {
      const { barcode } = await api.newBarcode();
      draft.fields.barcode = barcode;
      els.barcode.value = barcode;
      commit();
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#add-field').onclick = () => {
    if (!draft.options) { showToast('Label is still loading — try again in a second', true); return; }
    const { width: dotsW, height: dotsH } = SIZES[draft.size];
    const id = newExtraId();
    draft.extras.push({
      id,
      text: 'New field',
      box: { x: Math.round(dotsW / 2 - 150), y: Math.round(dotsH / 2 - 40), w: 300, h: 80 },
      rotation: 0,
    });
    syncExtrasList();
    overlay.refresh();
    overlay.select(`extra:${id}`);
    commit();
  };
  container.querySelector('#reset-layout').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    try {
      draft.layout = undefined;
      const saved = await api.updateLabel(draft.id, draft);
      draft.layout = saved.layout;
      overlay.refresh();
      commit();
      showToast('Layout reset');
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#save').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    try {
      const saved = await api.updateLabel(draft.id, draft);
      Object.assign(draft, saved);
      syncExtrasList();
      overlay.refresh();
      refreshPreview();
      showToast('Saved');
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#print').onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    const btn = container.querySelector('#print');
    btn.disabled = true;
    try {
      // Warn before printing onto the wrong roll.
      try {
        const { loadedSize } = await api.getSettings();
        if (loadedSize && loadedSize !== draft.size) {
          const ok = confirm(
            `This is a ${SIZE_LABELS[draft.size]}" label but ${SIZE_LABELS[loadedSize]}" stock is loaded. Print anyway?`);
          if (!ok) { btn.disabled = false; return; }
        }
      } catch { /* settings unavailable — don't block printing */ }
      await api.updateLabel(draft.id, draft);
      const result = await api.printLabel(draft, parseInt(els.qty.value, 10) || 1);
      showToast(result.queued ? 'Queued — printing at the station' : 'Sent to printer');
    } catch (err) { showToast(err.message, true); }
    btn.disabled = false;
  };
  const deleteBtn = container.querySelector('#delete');
  if (deleteBtn) deleteBtn.onclick = async () => {
    if (!draft.id) { showToast('Label is still loading — try again in a second', true); return; }
    if (!confirm('Delete this label?')) return;
    try {
      await api.deleteLabel(draft.id);
      navigate('#/');
    } catch (err) { showToast(err.message, true); }
  };

  ensureNormalized()
    .then(async () => { await ensureFonts(); refreshPreview(); })
    .catch((err) => showToast(err.message, true));
}
```

- [ ] **Step 4: Styles**

In `public/style.css`, replace the block from `.el-box { position: absolute; ...` through `.box-toolbar button:active { ... }` with:

```css
.el-box { position: absolute; border: 1px dashed rgba(25, 26, 28, 0.3); touch-action: none; }
.el-box .tag {
  position: absolute; top: -1px; left: -1px;
  font-family: var(--mono); font-size: 9px; font-weight: 600;
  letter-spacing: 0.08em;
  background: rgba(25, 26, 28, 0.55); color: #fff;
  padding: 1px 4px; border-radius: 0 0 3px 0;
  pointer-events: none;
}
.el-box.selected { border: 2px solid var(--accent); z-index: 5; }
/* A generous invisible grab margin so a resize attempt never lands on a neighbour. */
.el-box.selected::before { content: ''; position: absolute; inset: -14px; }
.el-box.selected .tag { background: var(--accent); }
.el-box .handle {
  position: absolute; right: -13px; bottom: -13px;
  width: 26px; height: 26px;
  background: var(--accent); border: 2px solid #fff; border-radius: 50%;
  display: none;
}
.el-box .handle::before { content: ''; position: absolute; inset: -9px; } /* 44px touch target */
.el-box.selected .handle { display: block; }

.box-toolbar {
  position: absolute;
  display: flex; flex-direction: column; gap: 2px;
  background: var(--deck);
  border-radius: 8px;
  padding: 3px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  z-index: 6;
}
.tb-row { display: flex; gap: 2px; align-items: center; }
.box-toolbar button {
  width: 34px; height: 34px; padding: 0;
  background: transparent; border: 0; color: #fff; border-radius: 6px;
}
.box-toolbar button:active { background: rgba(255, 255, 255, 0.15); }
.box-toolbar button.tb-text { width: auto; padding: 0 8px; font-size: 12px; font-weight: 600; }
.box-toolbar button.on { background: var(--accent); }
.tb-pt { color: #fff; font-family: var(--mono); font-size: 11px; min-width: 44px; text-align: center; }
```

- [ ] **Step 5: Verify in the browser**

```bash
npm test
```

Then start the app with the preview tool (`zebra-connect` launch configuration; stop the background server first if the port is busy) and open `http://localhost:3000/#/`. Open an existing 5x3 label. Check with `read_console_messages` (no errors), `read_page`, and screenshots:

1. The preview is a canvas showing the label drawn in Arimo, with the UPC-A digits beside the bars.
2. Tap the name box: it gets the accent border and the toolbar (rotate only for name) appears above it.
3. Drag the name a little with the `computer` tool's `left_click_drag`: the canvas redraws while moving (take a screenshot mid-way if possible, or compare before/after) and, when the left edge passes x≈20 dots, an accent guide line appears and the box sticks to the margin.
4. Tap an extra field, then drag from just outside its bottom-right corner (within 14 px): it resizes instead of selecting the box beneath.
5. A tap that moves less than 4 px does not change the box position: read the selected box's `style.left` with `javascript_tool` before and after a 2 px `left_click_drag`; they must be identical.
6. Typing in the Name input updates the canvas immediately.

Fix anything broken in the editor code before committing; the server tests won't catch UI faults.

- [ ] **Step 6: Commit**

```bash
git add public/overlay.js public/toolbar.js public/editor.js public/style.css
git commit -m "feat: instant canvas preview, sticky selection and snapping in the editor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Alignment and text-size toolbar

**Files:**
- Modify: `public/toolbar.js` (full replacement), `public/editor.js` (`toolbarActions`, imports), `public/icons.js`

**Interfaces:**
- Consumes: `alignBox`, `frameFor` (Task 6); `preview.sizes` (Task 7).
- Produces: `renderToolbar(el, item, actions)` expects `actions` with `rotate()`, `align(how)`, `remove()`, `auto()`, `smaller()`, `bigger()`, `all()`, `sizeTarget()`, `currentSize()`; `sizeTarget(item, draft)` exported for reuse.

- [ ] **Step 1: Icons**

In `public/icons.js`, add these entries to the `paths` object:

```js
  alignLeft: '<path d="M4 3v14"/><rect x="6" y="6" width="9" height="3" rx="0.8"/><rect x="6" y="11" width="6" height="3" rx="0.8"/>',
  alignCenter: '<path d="M10 3v14"/><rect x="5" y="6" width="10" height="3" rx="0.8"/><rect x="7" y="11" width="6" height="3" rx="0.8"/>',
  alignRight: '<path d="M16 3v14"/><rect x="5" y="6" width="9" height="3" rx="0.8"/><rect x="8" y="11" width="6" height="3" rx="0.8"/>',
  alignTop: '<path d="M3 4h14"/><rect x="6" y="6" width="3" height="9" rx="0.8"/><rect x="11" y="6" width="3" height="6" rx="0.8"/>',
  alignMiddle: '<path d="M3 10h14"/><rect x="6" y="5" width="3" height="10" rx="0.8"/><rect x="11" y="7" width="3" height="6" rx="0.8"/>',
  alignBottom: '<path d="M3 16h14"/><rect x="6" y="5" width="3" height="9" rx="0.8"/><rect x="11" y="8" width="3" height="6" rx="0.8"/>',
  minus: '<path d="M4 10h12"/>',
```

- [ ] **Step 2: Toolbar**

Replace `public/toolbar.js` with:

```js
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
```

- [ ] **Step 3: Editor actions**

In `public/editor.js`, change the import line `import { renderToolbar } from './toolbar.js';` to

```js
import { renderToolbar, sizeTarget } from './toolbar.js';
import { alignBox, frameFor } from '/shared/snap.js';
```

and replace the whole `toolbarActions` function with:

```js
  function toolbarActions(item) {
    const target = () => sizeTarget(item, draft);
    const rerender = () => { overlay.refresh(); commit(); };
    const current = () => target()?.textSize ?? preview.sizes[item.key] ?? 30;
    const setSize = (value) => {
      const t = target();
      if (!t) return;
      if (value === null) delete t.textSize;
      else t.textSize = Math.min(400, Math.max(8, Math.round(value)));
      rerender();
    };
    return {
      sizeTarget: target,
      currentSize: current,
      rotate() {
        const t = item.extra ?? item.box;
        t.rotation = ((t.rotation ?? 0) + 90) % 360;
        rerender();
      },
      align(how) {
        Object.assign(item.box, alignBox(item.box, how, frameFor(draft.size)));
        rerender();
      },
      remove() { overlay.deselect(); removeExtra(item.extra); },
      auto() { setSize(null); },
      smaller() { setSize(current() - 4); },
      bigger() { setSize(current() + 4); },
      all() {
        const value = target()?.textSize ?? current();
        for (const extra of draft.extras) if (extra.kind !== 'image') extra.textSize = value;
        if (target()) target().textSize = value;
        rerender();
      },
    };
  }
```

- [ ] **Step 4: Verify in the browser**

```bash
npm test
```

With the preview open on a label that has extras:

1. Select an extra: the toolbar shows two rows; the second reads the current size in pt with Auto highlighted.
2. Tap +: the text grows, Auto un-highlights, the pt readout increases by about 1–2 pt. Tap Auto: text fills the box again.
3. Tap "align right": the box's right edge lands on the label margin (confirm via `javascript_tool` reading the box element's `style.left`/`style.width` sum ≈ 98%).
4. Tap All on an extra with a fixed size: every other extra's text takes that size.
5. Select the barcode: only row one appears.

- [ ] **Step 5: Commit**

```bash
git add public/toolbar.js public/editor.js public/icons.js
git commit -m "feat: alignment buttons and Auto/fixed text size in the editor toolbar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Undo and redo

**Files:**
- Create: `public/history.js`
- Test: `test/history.test.js`
- Modify: `public/editor.js`, `public/icons.js`, `public/style.css`

**Interfaces:**
- Produces: `createHistory(getState, applyState, { limit = 50, onChange })` → `{ commit(), undo(), redo(), reset(), canUndo, canRedo }`. `getState` returns a fresh clone of the undoable state; `applyState(state)` installs a clone.

- [ ] **Step 1: Write the failing tests**

Create `test/history.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../public/history.js';

function harness(limit) {
  let state = { n: 0 };
  const events = [];
  const h = createHistory(
    () => structuredClone(state),
    (s) => { state = s; },
    { limit, onChange: () => events.push([h.canUndo, h.canRedo]) },
  );
  return { h, get state() { return state; }, set(n) { state = { n }; }, events };
}

test('commit records a step; undo and redo walk the stack', () => {
  const t = harness();
  assert.equal(t.h.canUndo, false);
  t.set(1); assert.equal(t.h.commit(), true);
  t.set(2); t.h.commit();
  assert.equal(t.h.canUndo, true);
  assert.equal(t.h.undo(), true);
  assert.deepEqual(t.state, { n: 1 });
  assert.equal(t.h.canRedo, true);
  t.h.undo();
  assert.deepEqual(t.state, { n: 0 });
  assert.equal(t.h.undo(), false, 'nothing left');
  t.h.redo();
  assert.deepEqual(t.state, { n: 1 });
});

test('a new commit clears the redo stack and a no-op commit is ignored', () => {
  const t = harness();
  t.set(1); t.h.commit();
  t.h.undo();
  assert.equal(t.h.canRedo, true);
  t.set(5); t.h.commit();
  assert.equal(t.h.canRedo, false);
  assert.equal(t.h.commit(), false, 'same state twice is not a step');
  assert.equal(t.h.redo(), false);
});

test('undo restores a clone, not the live object', () => {
  const t = harness();
  t.set(1); t.h.commit();
  t.h.undo();
  t.state.n = 99; // mutate what applyState installed
  t.h.redo();
  t.h.undo();
  assert.deepEqual(t.state, { n: 0 }, 'history kept its own copy');
});

test('the stack is capped and reset clears it', () => {
  const t = harness(3);
  for (let i = 1; i <= 5; i++) { t.set(i); t.h.commit(); }
  let steps = 0;
  while (t.h.undo()) steps++;
  assert.equal(steps, 3);
  assert.deepEqual(t.state, { n: 2 });
  t.h.reset();
  assert.equal(t.h.canUndo, false);
  assert.equal(t.h.canRedo, false);
  assert.ok(t.events.length > 0, 'onChange fired');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/history.test.js
```

Expected: FAIL — cannot find module `../public/history.js`.

- [ ] **Step 3: Implement**

Create `public/history.js`:

```js
// Undo/redo over snapshots. Browser-safe and dependency-free so it can be
// unit-tested in Node. `getState` must return a fresh copy each call.
export function createHistory(getState, applyState, { limit = 50, onChange = () => {} } = {}) {
  let current = getState();
  let past = [];
  let future = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return {
    commit() {
      const next = getState();
      if (same(next, current)) return false;
      past.push(current);
      if (past.length > limit) past.shift();
      current = next;
      future = [];
      onChange();
      return true;
    },
    undo() {
      if (!past.length) return false;
      future.push(current);
      current = past.pop();
      applyState(structuredClone(current));
      onChange();
      return true;
    },
    redo() {
      if (!future.length) return false;
      past.push(current);
      current = future.pop();
      applyState(structuredClone(current));
      onChange();
      return true;
    },
    reset() {
      current = getState();
      past = [];
      future = [];
      onChange();
    },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node --test test/history.test.js
```

Expected: all pass.

- [ ] **Step 5: Wire into the editor**

In `public/icons.js` add to `paths`:

```js
  undo: '<path d="M8 4L4 8l4 4"/><path d="M4 8h7a4.5 4.5 0 0 1 0 9H9"/>',
  redo: '<path d="M12 4l4 4-4 4"/><path d="M16 8H9a4.5 4.5 0 0 0 0 9h2"/>',
```

In `public/editor.js`:

1. Add `import { createHistory } from './history.js';` with the other imports.
2. Replace the `deck-actions` span in the template with:

```html
        <span class="deck-actions">
          <button id="undo" class="deck-btn" title="Undo" disabled>${icon('undo')}</button>
          <button id="redo" class="deck-btn" title="Redo" disabled>${icon('redo')}</button>
        </span>
```

3. Replace the stub

```js
  // A completed change. Undo history hooks in here (Task 10); for now it draws.
  function commit() { refreshPreview(); }
```

with

```js
  const undoable = () => structuredClone({ fields: draft.fields, options: draft.options, layout: draft.layout, extras: draft.extras });
  const history = createHistory(undoable, (state) => {
    Object.assign(draft, state);
    syncInputs();
    syncExtrasList();
    overlay.refresh();
    refreshPreview();
  }, { onChange: updateHistoryButtons });
  function updateHistoryButtons() {
    container.querySelector('#undo').disabled = !history.canUndo;
    container.querySelector('#redo').disabled = !history.canRedo;
  }
  // A completed change: one undo step, then a redraw.
  function commit() {
    clearTimeout(textTimer);
    history.commit();
    refreshPreview();
  }
```

(`textTimer` is declared with `let` just below; hoisting of the declaration is fine because `commit` only runs after setup. To keep the linter happy, move the `let textTimer;` line above this block.)

4. Wire the buttons after the other button handlers:

```js
  container.querySelector('#undo').onclick = () => history.undo();
  container.querySelector('#redo').onclick = () => history.redo();
```

5. At the end of `ensureNormalized`, after `overlay.refresh();`, add `history.reset();` so the loaded label is the floor of the stack.

Note the editor already has a `history.replaceState(...)` call that refers to the browser's global `window.history`; with a local `history` constant now in scope, change that call to `window.history.replaceState(null, '', \`#/edit/${draft.id}\`);`.

In `public/style.css`, after the `.deck-bar` rule add:

```css
.deck-actions { display: flex; gap: 4px; }
.deck-btn { width: 30px; height: 26px; padding: 0; background: transparent; border: 0; color: #c9cbd3; border-radius: 6px; }
.deck-btn:disabled { opacity: 0.35; }
.deck-btn:active:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
```

- [ ] **Step 6: Verify in the browser**

```bash
npm test
```

In the preview: drag a box, tap Undo (it moves back), Redo (forward). Type in Name, wait a second, Undo restores the previous text in both the input and the canvas. Reload the page: both buttons start disabled.

- [ ] **Step 7: Commit**

```bash
git add public/history.js test/history.test.js public/editor.js public/icons.js public/style.css
git commit -m "feat: undo and redo in the label editor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Full-screen, rotated editing

**Files:**
- Create: `public/fullscreen.js`
- Modify: `public/editor.js`, `public/icons.js`, `public/style.css`

**Interfaces:**
- Consumes: `overlay` (its `isRotated` option), `history` buttons.
- Produces: `createFullscreen(deck, wrap, getSize, { onChange })` → `{ enter(), exit(), fit(), active, isRotated() }`.

- [ ] **Step 1: Module**

Create `public/fullscreen.js`:

```js
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
```

- [ ] **Step 2: Icons**

In `public/icons.js` add to `paths`:

```js
  expand: '<path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5"/>',
  close: '<path d="M5 5l10 10M15 5L5 15"/>',
```

- [ ] **Step 3: Editor wiring**

In `public/editor.js`:

1. Add `import { createFullscreen } from './fullscreen.js';`.
2. In the template, add a third button inside `.deck-actions` after redo:

```html
          <button id="fs-enter" class="deck-btn" title="Edit full screen">${icon('expand')}</button>
```

and, inside `<div class="deck">` right after `<div class="deck-bar">…</div>`, add the bar that only shows in full-screen mode:

```html
      <div class="fs-bar">
        <button id="fs-done" class="tb-text">Done</button>
        <span class="fs-title">${SIZE_LABELS[draft.size] ?? draft.size} in</span>
        <span class="fs-actions">
          <button id="fs-undo" class="deck-btn" title="Undo" disabled>${icon('undo')}</button>
          <button id="fs-redo" class="deck-btn" title="Redo" disabled>${icon('redo')}</button>
        </span>
      </div>
```

3. After the `overlay` is created, add:

```js
  const fullscreen = createFullscreen(els.deck, els.wrap, () => draft.size, {
    onChange: () => overlay.refresh(),
  });
```

and change the overlay option `isRotated: () => false,` to `isRotated: () => fullscreen.isRotated(),`. (`fullscreen` is declared after `overlay`; the arrow function only runs on pointer events, so the order is safe.)

4. Extend `updateHistoryButtons` so both pairs of buttons follow the stack:

```js
  function updateHistoryButtons() {
    for (const id of ['#undo', '#fs-undo']) container.querySelector(id).disabled = !history.canUndo;
    for (const id of ['#redo', '#fs-redo']) container.querySelector(id).disabled = !history.canRedo;
  }
```

5. Wire the buttons next to the undo/redo handlers:

```js
  container.querySelector('#fs-undo').onclick = () => history.undo();
  container.querySelector('#fs-redo').onclick = () => history.redo();
  container.querySelector('#fs-enter').onclick = () => fullscreen.enter();
  container.querySelector('#fs-done').onclick = () => fullscreen.exit();
```

- [ ] **Step 4: Styles**

Append to `public/style.css`:

```css
/* ---------- full-screen editing ---------- */
.fs-bar { display: none; }
.deck.fs {
  position: fixed; inset: 0; z-index: 40;
  margin: 0; border-radius: 0; padding: 0;
  background: var(--deck);
  display: flex; align-items: center; justify-content: center;
}
.deck.fs .deck-bar { display: none; }
.deck.fs .fs-bar {
  position: fixed; top: 0; left: 0; right: 0; height: 56px;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px; z-index: 41;
  color: #c9cbd3; font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;
}
.deck.fs .fs-bar .tb-text { background: rgba(255, 255, 255, 0.12); color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; font-weight: 600; font-family: var(--sans); text-transform: none; letter-spacing: 0; }
.fs-actions { display: flex; gap: 4px; }
.deck.fs #preview-wrap { margin: 0; transform-origin: center center; }
body.fs-open { overflow: hidden; }
```

- [ ] **Step 5: Verify in the browser**

```bash
npm test
```

With the preview tool, use `resize_window` with the `mobile` preset (375×812) and reload the editor:

1. Tap the expand button: the deck covers the screen, the label appears rotated 90° with its long side vertical, the top bar shows Done / size / undo / redo, console has no errors.
2. Drag a box downward on screen: in label terms it moves along +x (to the right of the label). Take a screenshot.
3. Tap a box and resize from its handle; snapping guides still appear.
4. Tap Done: the page returns to normal, nothing rotated, preview intact.
5. `resize_window` to `desktop` (landscape): enter full screen again — no rotation, the label fills the width.
6. Reset the window to `desktop` when done.

- [ ] **Step 6: Commit**

```bash
git add public/fullscreen.js public/editor.js public/icons.js public/style.css
git commit -m "feat: full-screen label editing, rotated to use the phone's long axis

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: README, server restart, final check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README**

In the "Labels" section replace the bullet beginning `- Barcodes are unique random UPC-A codes.` with:

```
- Barcodes are unique random UPC-A codes, drawn at exact dot resolution in
  real UPC-A style (tall guard bars, digits beside the symbol). The preview
  is drawn on your phone with the same code and font the printer uses, so
  what you see is what prints.
```

Replace the bullet beginning `- Tap a field on the preview to select it:` with:

```
- Tap a field on the preview to select it: drag to move (edges and centres
  snap to the margins and to other fields, with a guide line when they do),
  drag the corner handle to resize, and use the toolbar to rotate, align
  left/centre/right/top/middle/bottom, and set the text size — **Auto** fills
  the box, **−/+** step a fixed size, **All** gives every extra field the
  same size. Undo and Redo sit above the preview. The expand button opens
  the label full screen, turned sideways to use the phone's long axis; tap
  Done to come back.
```

- [ ] **Step 2: Full check**

```bash
npm test
grep -rn "attachLayoutEditing\|DOT_SIZES\|previewBlob\|\^BU" public src test
```

Expected: all pass; the grep prints only the `!includes('^BU'…)` assertions in tests.

- [ ] **Step 3: Restore the always-on server**

If the background server was stopped for the preview tool, stop the preview server (`preview_stop`) and restart the hidden one:

```bash
cmd //c "start /b wscript.exe start-zebra-connect.vbs"
```

Then confirm with `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/settings` → `200`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe the polished label editor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
