# Zebra Label App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally hosted Node.js web app that designs, stores, previews, and prints labels (with AI photo extraction and unique UPC-A barcodes) on a Zebra ZQ620 Plus over WiFi, operated from a phone browser.

**Architecture:** Single Express server serves a no-build vanilla-JS mobile web UI and a REST API. Labels are stored in a JSON file. The server renders label text as a bitmap with `@napi-rs/canvas` (hybrid printing: `^GFA` bitmap for text + native ZPL `^BU` for the barcode), sends raw ZPL over TCP port 9100, and calls the Claude API for photo field extraction.

**Tech Stack:** Node.js 20+ (ESM), Express, @napi-rs/canvas, @anthropic-ai/sdk, built-in `node --test` runner. No frontend build tooling.

**Spec:** `docs/superpowers/specs/2026-09-05-zebra-label-app-design.md`

## Global Constraints

- Node.js >= 20, `"type": "module"` (ESM) everywhere.
- Runtime dependencies limited to exactly: `express`, `@napi-rs/canvas`, `@anthropic-ai/sdk`. No dev dependencies (tests use `node --test` + `node:assert`).
- Printer: Zebra ZQ620 Plus, 203 dpi, **printable width 576 dots** (72 mm) on 3-inch media.
- Label canvas sizes in dots (width × height): `3x5` = 576×1015, `3x2` = 576×406, `2x1.25` = 406×253.
- Barcodes are 12-digit UPC-A (11 random digits + check digit), unique across the store.
- Claude model for photo extraction: `claude-opus-5` exactly (with server-side refusal fallbacks enabled).
- All persistent data (labels, config) lives in `data/` at the repo root; `data/` and `node_modules/` are gitignored.
- Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (blank line before it).
- Tests must not touch `data/` — they write under Node's `os.tmpdir()` via `fs.mkdtempSync`.

---

### Task 1: Project scaffold + UPC-A barcode module

**Files:**
- Create: `package.json`, `.gitignore`
- Create: `src/barcode.js`
- Test: `test/barcode.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `upcCheckDigit(d11: string) => string` (single digit), `validateUpcA(code: string) => boolean`, `generateUpcA(isTaken: (code: string) => boolean) => string` (12-digit unique code), `encodeUpcAModules(code12: string) => string` (95 chars of `'0'`/`'1'`, bar = `'1'`).

- [ ] **Step 1: Create package.json and .gitignore**

`package.json`:

```json
{
  "name": "zebra-connect",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.65.0",
    "@napi-rs/canvas": "^0.1.65",
    "express": "^4.21.0"
  }
}
```

`.gitignore`:

```
node_modules/
data/
```

Run: `npm install`
Expected: installs without errors (`@napi-rs/canvas` ships prebuilt Windows binaries — no compiler needed).

- [ ] **Step 2: Write the failing tests**

`test/barcode.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { upcCheckDigit, validateUpcA, generateUpcA, encodeUpcAModules } from '../src/barcode.js';

test('upcCheckDigit computes the standard UPC-A check digit', () => {
  // Known example: 03600029145 -> check digit 2
  assert.equal(upcCheckDigit('03600029145'), '2');
  // Known example: 01234567890 -> check digit 5
  assert.equal(upcCheckDigit('01234567890'), '5');
});

test('validateUpcA accepts valid codes and rejects bad ones', () => {
  assert.equal(validateUpcA('036000291452'), true);
  assert.equal(validateUpcA('036000291453'), false); // wrong check digit
  assert.equal(validateUpcA('03600029145'), false);  // 11 digits
  assert.equal(validateUpcA('03600029145a'), false); // non-digit
});

test('generateUpcA returns a valid 12-digit code', () => {
  const code = generateUpcA(() => false);
  assert.match(code, /^\d{12}$/);
  assert.equal(validateUpcA(code), true);
});

test('generateUpcA retries until the code is not taken', () => {
  const seen = [];
  let rejects = 3;
  const code = generateUpcA((c) => {
    seen.push(c);
    return rejects-- > 0;
  });
  assert.equal(seen.length, 4);
  assert.equal(code, seen[3]);
});

test('encodeUpcAModules produces the 95-module pattern', () => {
  const m = encodeUpcAModules('036000291452');
  assert.equal(m.length, 95);
  assert.match(m, /^[01]{95}$/);
  assert.equal(m.slice(0, 3), '101');            // start guard
  assert.equal(m.slice(45, 50), '01010');        // center guard
  assert.equal(m.slice(92), '101');              // end guard
  // First digit 0 -> L-code 0001101
  assert.equal(m.slice(3, 10), '0001101');
  // Last digit (check digit 2) -> R-code = complement of L-code 0010011 = 1101100
  assert.equal(m.slice(85, 92), '1101100');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/barcode.test.js`
Expected: FAIL — cannot find module `../src/barcode.js`.

- [ ] **Step 4: Implement src/barcode.js**

```js
import crypto from 'node:crypto';

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

export function generateUpcA(isTaken) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let d11 = '';
    for (let i = 0; i < 11; i++) d11 += crypto.randomInt(10);
    const code = d11 + upcCheckDigit(d11);
    if (!isTaken(code)) return code;
  }
  throw new Error('could not generate a unique barcode');
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/barcode.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore src/barcode.js test/barcode.test.js
git commit -m "feat: scaffold project and add UPC-A barcode module"
```

---

### Task 2: Label store (JSON file CRUD)

**Files:**
- Create: `src/store.js`
- Test: `test/store.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createStore(filePath) => store` with methods `list() => Label[]` (newest first), `get(id) => Label | undefined`, `create({size, fields, options, layout}) => Label`, `update(id, patch) => Label` (throws `Error('not found')`), `remove(id) => void`, `barcodeExists(code, exceptId?) => boolean`. A `Label` is `{id, size, fields: {name, description, barcode}, options: {showDescription}, layout, createdAt, updatedAt}` (ISO date strings). `create`/`update` throw `Error('duplicate barcode')` when the barcode belongs to a different stored label.

- [ ] **Step 1: Write the failing tests**

`test/store.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-store-'));
  return { store: createStore(path.join(dir, 'labels.json')), dir };
}

const sample = (barcode = '036000291452') => ({
  size: '3x5',
  fields: { name: 'Flour', description: 'All purpose', barcode },
  options: { showDescription: true },
  layout: { name: { x: 20, y: 20, w: 536, h: 120 } },
});

test('create assigns id and timestamps, get and list retrieve it', () => {
  const { store } = tmpStore();
  const label = store.create(sample());
  assert.ok(label.id);
  assert.ok(label.createdAt);
  assert.equal(store.get(label.id).fields.name, 'Flour');
  assert.equal(store.list().length, 1);
});

test('data persists across store instances', () => {
  const { store, dir } = tmpStore();
  const label = store.create(sample());
  const store2 = createStore(path.join(dir, 'labels.json'));
  assert.equal(store2.get(label.id).fields.barcode, '036000291452');
});

test('update merges patch and bumps updatedAt; remove deletes', () => {
  const { store } = tmpStore();
  const label = store.create(sample());
  const updated = store.update(label.id, { fields: { ...label.fields, name: 'Sugar' } });
  assert.equal(updated.fields.name, 'Sugar');
  assert.equal(updated.fields.barcode, '036000291452');
  store.remove(label.id);
  assert.equal(store.get(label.id), undefined);
  assert.throws(() => store.update('nope', {}), /not found/);
});

test('duplicate barcodes are rejected, except on the same label', () => {
  const { store } = tmpStore();
  const a = store.create(sample());
  assert.throws(() => store.create(sample()), /duplicate barcode/);
  assert.equal(store.barcodeExists('036000291452'), true);
  assert.equal(store.barcodeExists('036000291452', a.id), false);
  // updating the same label keeping its own barcode is fine
  store.update(a.id, { options: { showDescription: false } });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/store.test.js`
Expected: FAIL — cannot find module `../src/store.js`.

- [ ] **Step 3: Implement src/store.js**

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createStore(filePath) {
  let labels = [];
  if (fs.existsSync(filePath)) {
    labels = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(labels, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function barcodeExists(code, exceptId) {
    return labels.some((l) => l.fields.barcode === code && l.id !== exceptId);
  }

  function assertBarcodeFree(label, exceptId) {
    if (label.fields?.barcode && barcodeExists(label.fields.barcode, exceptId)) {
      throw new Error('duplicate barcode');
    }
  }

  return {
    list: () => [...labels].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => labels.find((l) => l.id === id),
    barcodeExists,
    create(data) {
      assertBarcodeFree(data);
      const now = new Date().toISOString();
      const label = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now };
      labels.push(label);
      save();
      return label;
    },
    update(id, patch) {
      const i = labels.findIndex((l) => l.id === id);
      if (i === -1) throw new Error('not found');
      const merged = { ...labels[i], ...patch, id, createdAt: labels[i].createdAt };
      assertBarcodeFree(merged, id);
      merged.updatedAt = new Date().toISOString();
      labels[i] = merged;
      save();
      return merged;
    },
    remove(id) {
      labels = labels.filter((l) => l.id !== id);
      save();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/store.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.js
git commit -m "feat: add JSON-file label store with barcode uniqueness"
```

---

### Task 3: Label sizes, default layouts, barcode geometry

**Files:**
- Create: `src/layout.js`
- Test: `test/layout.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SIZES` — `{'3x5': {width: 576, height: 1015}, '3x2': {width: 576, height: 406}, '2x1.25': {width: 406, height: 253}}`.
  - `defaultLayout(size) => {name: Box, description: Box, barcode: Box}` where `Box = {x, y, w, h}` in dots (fresh object each call).
  - `defaultShowDescription(size) => boolean` — `true` only for `'3x5'`.
  - `barcodeGeometry(box) => {moduleWidth, x, y, width, barHeight}` — `moduleWidth = max(2, floor(box.w / 95))`, `width = moduleWidth * 95`, `x = box.x + floor((box.w - width) / 2)`, `y = box.y`, `barHeight = max(20, box.h - 30)` (30 dots reserved for the human-readable digits). Shared by the preview renderer and the ZPL generator so preview and print match.

- [ ] **Step 1: Write the failing tests**

`test/layout.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZES, defaultLayout, defaultShowDescription, barcodeGeometry } from '../src/layout.js';

test('SIZES match the 203dpi dot dimensions', () => {
  assert.deepEqual(SIZES['3x5'], { width: 576, height: 1015 });
  assert.deepEqual(SIZES['3x2'], { width: 576, height: 406 });
  assert.deepEqual(SIZES['2x1.25'], { width: 406, height: 253 });
});

test('defaultLayout returns boxes inside the label for every size', () => {
  for (const size of Object.keys(SIZES)) {
    const { width, height } = SIZES[size];
    const layout = defaultLayout(size);
    for (const key of ['name', 'description', 'barcode']) {
      const b = layout[key];
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= width && b.y + b.h <= height,
        `${size}.${key} box out of bounds`);
    }
  }
});

test('defaultLayout returns a fresh object each call', () => {
  const a = defaultLayout('3x5');
  a.name.x = 999;
  assert.notEqual(defaultLayout('3x5').name.x, 999);
});

test('defaultShowDescription is on only for 3x5', () => {
  assert.equal(defaultShowDescription('3x5'), true);
  assert.equal(defaultShowDescription('3x2'), false);
  assert.equal(defaultShowDescription('2x1.25'), false);
});

test('barcodeGeometry centers a whole-module barcode in the box', () => {
  const g = barcodeGeometry({ x: 98, y: 760, w: 380, h: 220 });
  assert.equal(g.moduleWidth, 4);            // floor(380/95)
  assert.equal(g.width, 380);                // 4*95
  assert.equal(g.x, 98);
  assert.equal(g.y, 760);
  assert.equal(g.barHeight, 190);            // 220-30
  const small = barcodeGeometry({ x: 0, y: 0, w: 100, h: 40 });
  assert.equal(small.moduleWidth, 2);        // clamped minimum
  assert.equal(small.barHeight, 20);         // clamped minimum
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/layout.test.js`
Expected: FAIL — cannot find module `../src/layout.js`.

- [ ] **Step 3: Implement src/layout.js**

```js
export const SIZES = {
  '3x5': { width: 576, height: 1015 },
  '3x2': { width: 576, height: 406 },
  '2x1.25': { width: 406, height: 253 },
};

const DEFAULT_LAYOUTS = {
  '3x5': {
    name: { x: 20, y: 20, w: 536, h: 120 },
    description: { x: 20, y: 170, w: 536, h: 540 },
    barcode: { x: 98, y: 760, w: 380, h: 220 },
  },
  '3x2': {
    name: { x: 20, y: 20, w: 536, h: 110 },
    description: { x: 20, y: 140, w: 536, h: 80 },
    barcode: { x: 98, y: 160, w: 380, h: 220 },
  },
  '2x1.25': {
    name: { x: 10, y: 8, w: 386, h: 70 },
    description: { x: 10, y: 82, w: 386, h: 40 },
    barcode: { x: 58, y: 92, w: 290, h: 150 },
  },
};

export function defaultLayout(size) {
  return structuredClone(DEFAULT_LAYOUTS[size]);
}

export function defaultShowDescription(size) {
  return size === '3x5';
}

export function barcodeGeometry(box) {
  const moduleWidth = Math.max(2, Math.floor(box.w / 95));
  const width = moduleWidth * 95;
  return {
    moduleWidth,
    width,
    x: box.x + Math.floor((box.w - width) / 2),
    y: box.y,
    barHeight: Math.max(20, box.h - 30),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/layout.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/layout.js test/layout.test.js
git commit -m "feat: add label sizes, default layouts, and barcode geometry"
```

---

### Task 4: Label renderer (preview PNG + print bitmap)

**Files:**
- Create: `src/render.js`
- Test: `test/render.test.js`

**Interfaces:**
- Consumes: `SIZES`, `barcodeGeometry` from `src/layout.js`; `encodeUpcAModules`, `validateUpcA` from `src/barcode.js`.
- Produces:
  - `renderPreview(label) => Buffer` — PNG of the full label (text + simulated barcode bars + digits) at exact dot dimensions.
  - `renderPrintBitmap(label) => {data: Uint8Array, bytesPerRow: number, width: number, height: number}` — 1-bit-per-pixel packed rows (MSB first, `1` = black) of **text only** (barcode omitted; printer draws it natively).
  - `label` argument shape: `{size, fields: {name, description, barcode}, options: {showDescription}, layout: {name, description, barcode}}` — layout boxes always present.

- [ ] **Step 1: Write the failing tests**

`test/render.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPreview, renderPrintBitmap } from '../src/render.js';
import { defaultLayout } from '../src/layout.js';

const label = {
  size: '3x2',
  fields: { name: 'Sugar', description: 'Granulated', barcode: '036000291452' },
  options: { showDescription: false },
  layout: defaultLayout('3x2'),
};

test('renderPreview returns a PNG with correct dimensions', async () => {
  const buf = await renderPreview(label);
  // PNG magic bytes
  assert.deepEqual([...buf.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR width/height are big-endian uint32 at offsets 16 and 20
  assert.equal(buf.readUInt32BE(16), 576);
  assert.equal(buf.readUInt32BE(20), 406);
});

test('renderPrintBitmap returns packed 1bpp rows with black pixels for text', async () => {
  const bmp = await renderPrintBitmap(label);
  assert.equal(bmp.width, 576);
  assert.equal(bmp.height, 406);
  assert.equal(bmp.bytesPerRow, 72); // 576/8
  assert.equal(bmp.data.length, 72 * 406);
  const blackBits = [...bmp.data].reduce((n, byte) => {
    while (byte) { n += byte & 1; byte >>= 1; }
    return n;
  }, 0);
  assert.ok(blackBits > 100, 'expected the name text to produce black pixels');
});

test('renderPrintBitmap omits the barcode region', async () => {
  const bmp = await renderPrintBitmap(label);
  // Barcode box for 3x2 default layout starts at y=160; name box ends by y=130.
  // With description hidden, everything below y=250 must be white.
  for (let y = 250; y < bmp.height; y++) {
    for (let b = 0; b < bmp.bytesPerRow; b++) {
      assert.equal(bmp.data[y * bmp.bytesPerRow + b], 0,
        `unexpected black pixel at row ${y}`);
    }
  }
});

test('renderPreview draws barcode bars (preview differs from text-only render)', async () => {
  const withBars = await renderPreview(label);
  const noBarcode = await renderPreview({
    ...label,
    fields: { ...label.fields, barcode: '' },
  });
  assert.notDeepEqual(withBars, noBarcode);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/render.test.js`
Expected: FAIL — cannot find module `../src/render.js`.

- [ ] **Step 3: Implement src/render.js**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/render.test.js`
Expected: PASS (4 tests). If the bitmap black-pixel test fails with 0 black bits, the likely cause is a missing system font — change `FONT` to `'sans-serif'` and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: add canvas label renderer for preview PNG and 1bpp print bitmap"
```

---

### Task 5: ZPL generator

**Files:**
- Create: `src/zpl.js`
- Test: `test/zpl.test.js`

**Interfaces:**
- Consumes: `barcodeGeometry` from `src/layout.js`; bitmap shape `{data, bytesPerRow, width, height}` from Task 4.
- Produces:
  - `encodeGfa(bitmap) => string` — `^GFA,<total>,<total>,<bytesPerRow>,<HEX>` (uppercase hex, no separators).
  - `buildLabelZpl({width, height, bitmap, barcode, barcodeBox, quantity = 1, darkness = null}) => string` — complete `^XA...^XZ` job: optional `~SD` darkness prefix, `^PW`, `^LL`, the GFA at `^FO0,0`, and when `barcode` is a valid 12-digit code a native `^BY<moduleWidth>` + `^BUN,<barHeight>,Y,N,Y` field at the geometry position carrying the **first 11 digits** (the printer prints the check digit itself).
  - `buildTestZpl() => string` — small fixed test label.
  - `setZplModeCommand() => string` — SGD command putting the printer in ZPL-compatible mode: `! U1 setvar "device.languages" "hybrid_xml_zpl"\r\n`.

- [ ] **Step 1: Write the failing tests**

`test/zpl.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGfa, buildLabelZpl, buildTestZpl, setZplModeCommand } from '../src/zpl.js';

const bitmap = {
  width: 16,
  height: 2,
  bytesPerRow: 2,
  data: new Uint8Array([0xff, 0x00, 0x0f, 0xf0]),
};

test('encodeGfa emits totals, bytes-per-row, and uppercase hex', () => {
  assert.equal(encodeGfa(bitmap), '^GFA,4,4,2,FF000FF0');
});

test('buildLabelZpl composes a complete hybrid job', () => {
  const zpl = buildLabelZpl({
    width: 576,
    height: 406,
    bitmap,
    barcode: '036000291452',
    barcodeBox: { x: 98, y: 160, w: 380, h: 220 },
    quantity: 3,
    darkness: 20,
  });
  assert.ok(zpl.startsWith('~SD20\n^XA'));
  assert.ok(zpl.includes('^PW576'));
  assert.ok(zpl.includes('^LL406'));
  assert.ok(zpl.includes('^FO0,0^GFA,4,4,2,FF000FF0^FS'));
  // geometry: moduleWidth 4, x 98, barHeight 190; 11 data digits only
  assert.ok(zpl.includes('^FO98,160^BY4^BUN,190,Y,N,Y^FD03600029145^FS'));
  assert.ok(zpl.includes('^PQ3'));
  assert.ok(zpl.trimEnd().endsWith('^XZ'));
});

test('buildLabelZpl omits barcode field and darkness when absent', () => {
  const zpl = buildLabelZpl({ width: 576, height: 406, bitmap, barcode: '', barcodeBox: null });
  assert.ok(zpl.startsWith('^XA'));
  assert.ok(!zpl.includes('^BU'));
  assert.ok(!zpl.includes('~SD'));
  assert.ok(zpl.includes('^PQ1'));
});

test('buildTestZpl and setZplModeCommand return fixed commands', () => {
  assert.ok(buildTestZpl().startsWith('^XA'));
  assert.ok(buildTestZpl().includes('Zebra Connect'));
  assert.equal(setZplModeCommand(), '! U1 setvar "device.languages" "hybrid_xml_zpl"\r\n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/zpl.test.js`
Expected: FAIL — cannot find module `../src/zpl.js`.

- [ ] **Step 3: Implement src/zpl.js**

```js
import { barcodeGeometry } from './layout.js';
import { validateUpcA } from './barcode.js';

export function encodeGfa(bitmap) {
  const total = bitmap.data.length;
  let hex = '';
  for (const byte of bitmap.data) hex += byte.toString(16).padStart(2, '0');
  return `^GFA,${total},${total},${bitmap.bytesPerRow},${hex.toUpperCase()}`;
}

export function buildLabelZpl({ width, height, bitmap, barcode, barcodeBox, quantity = 1, darkness = null }) {
  const parts = [];
  if (darkness !== null && darkness !== undefined && darkness !== '') {
    parts.push(`~SD${String(darkness).padStart(2, '0')}\n`);
  }
  parts.push('^XA\n');
  parts.push(`^PW${width}\n^LL${height}\n^LH0,0\n`);
  parts.push(`^FO0,0${encodeGfa(bitmap)}^FS\n`);
  if (barcode && barcodeBox && validateUpcA(barcode)) {
    const g = barcodeGeometry(barcodeBox);
    parts.push(`^FO${g.x},${g.y}^BY${g.moduleWidth}^BUN,${g.barHeight},Y,N,Y^FD${barcode.slice(0, 11)}^FS\n`);
  }
  parts.push(`^PQ${quantity}\n^XZ\n`);
  return parts.join('');
}

export function buildTestZpl() {
  return '^XA\n^PW576\n^LL200\n^FO40,40^A0N,50,50^FDZebra Connect^FS\n^FO40,110^A0N,30,30^FDTest print OK^FS\n^XZ\n';
}

export function setZplModeCommand() {
  return '! U1 setvar "device.languages" "hybrid_xml_zpl"\r\n';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/zpl.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/zpl.js test/zpl.test.js
git commit -m "feat: add ZPL generator with GFA bitmap and native UPC-A field"
```

---

### Task 6: Printer communication (send, probe, discover)

**Files:**
- Create: `src/printer.js`
- Test: `test/printer.test.js`

**Interfaces:**
- Consumes: nothing (uses `node:net`, `node:os`).
- Produces:
  - `sendToPrinter(ip, data, {port = 9100, timeoutMs = 10000} = {}) => Promise<void>` — opens TCP, writes `data` (string or Buffer), closes. Rejects with `Error` whose message contains the ip on connect failure/timeout.
  - `probe(ip, {port = 9100, timeoutMs = 500} = {}) => Promise<boolean>` — true if a TCP connection opens.
  - `discoverPrinters({port = 9100} = {}) => Promise<string[]>` — scans the /24 of every non-internal IPv4 interface (hosts .1–.254, concurrency-limited), returns IPs with the port open.

- [ ] **Step 1: Write the failing tests**

`test/printer.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { sendToPrinter, probe } from '../src/printer.js';

function fakePrinter() {
  return new Promise((resolve) => {
    const received = [];
    const server = net.createServer((sock) => {
      sock.on('data', (d) => received.push(d));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, received, close: () => server.close() });
    });
  });
}

test('sendToPrinter delivers the exact bytes', async () => {
  const p = await fakePrinter();
  await sendToPrinter('127.0.0.1', '^XA^XZ', { port: p.port });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(Buffer.concat(p.received).toString(), '^XA^XZ');
  p.close();
});

test('sendToPrinter rejects with the ip in the message when unreachable', async () => {
  await assert.rejects(
    () => sendToPrinter('127.0.0.1', 'x', { port: 1, timeoutMs: 500 }),
    /127\.0\.0\.1/,
  );
});

test('probe reports open and closed ports', async () => {
  const p = await fakePrinter();
  assert.equal(await probe('127.0.0.1', { port: p.port }), true);
  p.close();
  assert.equal(await probe('127.0.0.1', { port: 1, timeoutMs: 300 }), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/printer.test.js`
Expected: FAIL — cannot find module `../src/printer.js`.

- [ ] **Step 3: Implement src/printer.js**

```js
import net from 'node:net';
import os from 'node:os';

export function sendToPrinter(ip, data, { port = 9100, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: ip, port });
    const fail = (why) => {
      sock.destroy();
      reject(new Error(`Can't reach printer at ${ip}:${port} (${why})`));
    };
    sock.setTimeout(timeoutMs, () => fail('timeout'));
    sock.on('error', (err) => fail(err.code ?? err.message));
    sock.on('connect', () => sock.end(data));
    sock.on('close', (hadError) => { if (!hadError) resolve(); });
  });
}

export function probe(ip, { port = 9100, timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.on('error', () => done(false));
    sock.on('connect', () => done(true));
  });
}

export async function discoverPrinters({ port = 9100 } = {}) {
  const prefixes = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        prefixes.add(a.address.split('.').slice(0, 3).join('.'));
      }
    }
  }
  const targets = [...prefixes].flatMap((p) =>
    Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`));
  const found = [];
  const CONCURRENCY = 64;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((ip) => probe(ip, { port })));
    results.forEach((ok, j) => { if (ok) found.push(batch[j]); });
  }
  return found;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/printer.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/printer.js test/printer.test.js
git commit -m "feat: add TCP printer transport with probe and subnet discovery"
```

---

### Task 7: Settings/config store

**Files:**
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `createConfig(filePath) => config` with `get() => {printerIp, darkness, apiKey}` (defaults `{printerIp: '', darkness: 15, apiKey: ''}`) and `update(patch) => settings` (merges known keys only, persists to disk). `get()` never returns extra keys.

- [ ] **Step 1: Write the failing tests**

`test/config.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConfig } from '../src/config.js';

function tmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-config-'));
  const file = path.join(dir, 'config.json');
  return { config: createConfig(file), file };
}

test('get returns defaults when no file exists', () => {
  const { config } = tmpConfig();
  assert.deepEqual(config.get(), { printerIp: '', darkness: 15, apiKey: '' });
});

test('update merges, persists, and ignores unknown keys', () => {
  const { config, file } = tmpConfig();
  const out = config.update({ printerIp: '192.168.1.50', bogus: 'x' });
  assert.equal(out.printerIp, '192.168.1.50');
  assert.equal(out.darkness, 15);
  assert.equal('bogus' in out, false);
  const reloaded = createConfig(file);
  assert.equal(reloaded.get().printerIp, '192.168.1.50');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/config.test.js`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 3: Implement src/config.js**

```js
import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = { printerIp: '', darkness: 15, apiKey: '' };

export function createConfig(filePath) {
  let settings = { ...DEFAULTS };
  if (fs.existsSync(filePath)) {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const key of Object.keys(DEFAULTS)) {
      if (key in saved) settings[key] = saved[key];
    }
  }
  return {
    get: () => ({ ...settings }),
    update(patch) {
      for (const key of Object.keys(DEFAULTS)) {
        if (key in patch) settings[key] = patch[key];
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
      fs.renameSync(tmp, filePath);
      return { ...settings };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/config.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: add persisted settings store"
```

---

### Task 8: Express server + REST API

**Files:**
- Create: `src/app.js` (app factory), `src/server.js` (entry point)
- Test: `test/app.test.js`

**Interfaces:**
- Consumes: everything from Tasks 1–7 (`createStore`, `createConfig`, `SIZES`, `defaultLayout`, `defaultShowDescription`, `generateUpcA`, `validateUpcA`, `renderPreview`, `renderPrintBitmap`, `buildLabelZpl`, `buildTestZpl`, `setZplModeCommand`, `sendToPrinter`, `probe`, `discoverPrinters`).
- Produces: `createApp({dataDir, printerOverrides?}) => express.Application`. `printerOverrides` lets tests inject `{sendToPrinter, discoverPrinters, probe}`. Endpoints:
  - `GET /api/labels` → `Label[]`; `POST /api/labels` (body: label draft, missing barcode/layout/options auto-filled) → `Label` (400 on duplicate/invalid barcode); `GET/PUT/DELETE /api/labels/:id` (404 when absent).
  - `GET /api/barcode/new` → `{barcode}` unique against store.
  - `POST /api/preview` (body: label draft) → `image/png`.
  - `POST /api/print` (body: `{label, quantity}`) → `{ok: true}` or 502 `{error}` when printer unreachable.
  - `POST /api/print-raw` (raw body, any content type, 20 MB limit) → `{ok: true}` / 502.
  - `GET /api/settings` → settings with `apiKey` masked as `{apiKeySet: boolean}` (raw key never sent to browser); `PUT /api/settings` accepts `{printerIp, darkness, apiKey}`.
  - `POST /api/settings/discover` → `{printers: string[]}`.
  - `POST /api/settings/test-print` → `{ok: true}` / 502.
  - `POST /api/settings/zpl-mode` → sends `setZplModeCommand()` to the printer → `{ok: true}` / 502.
  - Static files served from `public/`.
  - Later (Task 9) adds `POST /api/extract`.
- `src/server.js` binds `createApp({dataDir: 'data'})` to `0.0.0.0:3000` and logs every LAN URL (e.g. `http://192.168.1.10:3000`).

- [ ] **Step 1: Write the failing tests**

`test/app.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

function startApp(printerOverrides) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-app-'));
  const app = createApp({ dataDir, printerOverrides });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, close: () => server.close() });
    });
  });
}

test('label CRUD round trip with auto-filled barcode and layout', async () => {
  const { base, close } = await startApp();
  const created = await (await fetch(`${base}/api/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: '3x5', fields: { name: 'Flour', description: 'AP' } }),
  })).json();
  assert.match(created.fields.barcode, /^\d{12}$/);
  assert.ok(created.layout.name);
  assert.equal(created.options.showDescription, true);

  const list = await (await fetch(`${base}/api/labels`)).json();
  assert.equal(list.length, 1);

  const updated = await (await fetch(`${base}/api/labels/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...created, fields: { ...created.fields, name: 'Sugar' } }),
  })).json();
  assert.equal(updated.fields.name, 'Sugar');

  const del = await fetch(`${base}/api/labels/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await fetch(`${base}/api/labels/${created.id}`)).status, 404);
  close();
});

test('barcode/new returns a fresh valid code and preview returns a PNG', async () => {
  const { base, close } = await startApp();
  const { barcode } = await (await fetch(`${base}/api/barcode/new`)).json();
  assert.match(barcode, /^\d{12}$/);

  const res = await fetch(`${base}/api/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: '3x2', fields: { name: 'X', description: '', barcode } }),
  });
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.slice(0, 4)], [137, 80, 78, 71]);
  close();
});

test('print builds ZPL and sends it to the configured printer', async () => {
  const sent = [];
  const { base, close } = await startApp({
    sendToPrinter: async (ip, data) => { sent.push({ ip, data: data.toString() }); },
  });
  await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ printerIp: '10.0.0.9' }),
  });
  const res = await fetch(`${base}/api/print`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: { size: '3x2', fields: { name: 'X', description: '', barcode: '036000291452' } },
      quantity: 2,
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(sent[0].ip, '10.0.0.9');
  assert.ok(sent[0].data.includes('^GFA'));
  assert.ok(sent[0].data.includes('^BUN'));
  assert.ok(sent[0].data.includes('^PQ2'));
  close();
});

test('print without a configured printer or with a failing printer errors clearly', async () => {
  const { base, close } = await startApp({
    sendToPrinter: async () => { throw new Error("Can't reach printer at 10.0.0.9:9100"); },
  });
  const body = JSON.stringify({ label: { size: '3x2', fields: { name: 'X', description: '', barcode: '' } } });
  const noIp = await fetch(`${base}/api/print`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  assert.equal(noIp.status, 400);

  await fetch(`${base}/api/settings`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ printerIp: '10.0.0.9' }),
  });
  const fail = await fetch(`${base}/api/print`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  assert.equal(fail.status, 502);
  assert.match((await fail.json()).error, /10\.0\.0\.9/);
  close();
});

test('print-raw forwards bytes untouched; settings masks apiKey', async () => {
  const sent = [];
  const { base, close } = await startApp({
    sendToPrinter: async (ip, data) => { sent.push(data); },
  });
  await fetch(`${base}/api/settings`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ printerIp: '10.0.0.9', apiKey: 'sk-test' }),
  });
  await fetch(`${base}/api/print-raw`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from('RAW PRN \x01\x02'),
  });
  assert.equal(Buffer.from(sent[0]).toString('latin1'), 'RAW PRN \x01\x02');

  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.apiKeySet, true);
  assert.equal('apiKey' in settings, false);
  close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/app.test.js`
Expected: FAIL — cannot find module `../src/app.js`.

- [ ] **Step 3: Implement src/app.js**

```js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createConfig } from './config.js';
import { SIZES, defaultLayout, defaultShowDescription } from './layout.js';
import { generateUpcA, validateUpcA } from './barcode.js';
import { renderPreview, renderPrintBitmap } from './render.js';
import { buildLabelZpl, buildTestZpl, setZplModeCommand } from './zpl.js';
import * as printerLib from './printer.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ dataDir, printerOverrides = {} }) {
  const store = createStore(path.join(dataDir, 'labels.json'));
  const config = createConfig(path.join(dataDir, 'config.json'));
  const printer = { ...printerLib, ...printerOverrides };
  const app = express();
  app.locals.store = store;
  app.locals.config = config;

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(here, '..', 'public')));

  function normalizeDraft(draft) {
    if (!SIZES[draft.size]) throw Object.assign(new Error('unknown size'), { status: 400 });
    const label = {
      size: draft.size,
      fields: {
        name: draft.fields?.name ?? '',
        description: draft.fields?.description ?? '',
        barcode: draft.fields?.barcode ?? '',
      },
      options: {
        showDescription: draft.options?.showDescription ?? defaultShowDescription(draft.size),
      },
      layout: draft.layout ?? defaultLayout(draft.size),
    };
    if (label.fields.barcode && !validateUpcA(label.fields.barcode)) {
      throw Object.assign(new Error('barcode must be a valid 12-digit UPC-A'), { status: 400 });
    }
    return label;
  }

  function requirePrinterIp() {
    const ip = config.get().printerIp;
    if (!ip) throw Object.assign(new Error('no printer IP configured — set it in Settings'), { status: 400 });
    return ip;
  }

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      const status = err.status ?? (/reach printer/i.test(err.message) ? 502 : 500);
      res.status(status).json({ error: err.message });
    });
  };

  // --- labels ---
  app.get('/api/labels', wrap((req, res) => res.json(store.list())));

  app.post('/api/labels', wrap((req, res) => {
    const label = normalizeDraft(req.body);
    if (!label.fields.barcode) {
      label.fields.barcode = generateUpcA((c) => store.barcodeExists(c));
    }
    try {
      res.json(store.create(label));
    } catch (err) {
      throw Object.assign(err, { status: 400 });
    }
  }));

  app.get('/api/labels/:id', wrap((req, res) => {
    const label = store.get(req.params.id);
    if (!label) return res.status(404).json({ error: 'not found' });
    res.json(label);
  }));

  app.put('/api/labels/:id', wrap((req, res) => {
    if (!store.get(req.params.id)) return res.status(404).json({ error: 'not found' });
    const label = normalizeDraft(req.body);
    try {
      res.json(store.update(req.params.id, label));
    } catch (err) {
      throw Object.assign(err, { status: 400 });
    }
  }));

  app.delete('/api/labels/:id', wrap((req, res) => {
    store.remove(req.params.id);
    res.json({ ok: true });
  }));

  // --- barcode / preview / print ---
  app.get('/api/barcode/new', wrap((req, res) => {
    res.json({ barcode: generateUpcA((c) => store.barcodeExists(c)) });
  }));

  app.post('/api/preview', wrap(async (req, res) => {
    const label = normalizeDraft(req.body);
    res.type('image/png').send(await renderPreview(label));
  }));

  app.post('/api/print', wrap(async (req, res) => {
    const ip = requirePrinterIp();
    const label = normalizeDraft(req.body.label ?? {});
    const quantity = Math.min(Math.max(parseInt(req.body.quantity, 10) || 1, 1), 100);
    const bitmap = await renderPrintBitmap(label);
    const zpl = buildLabelZpl({
      width: bitmap.width,
      height: bitmap.height,
      bitmap,
      barcode: label.fields.barcode,
      barcodeBox: label.layout.barcode,
      quantity,
      darkness: config.get().darkness,
    });
    await printer.sendToPrinter(ip, zpl);
    res.json({ ok: true });
  }));

  app.post('/api/print-raw', express.raw({ type: () => true, limit: '20mb' }), wrap(async (req, res) => {
    const ip = requirePrinterIp();
    await printer.sendToPrinter(ip, req.body);
    res.json({ ok: true });
  }));

  // --- settings ---
  app.get('/api/settings', wrap((req, res) => {
    const { apiKey, ...rest } = config.get();
    res.json({ ...rest, apiKeySet: Boolean(apiKey || process.env.ANTHROPIC_API_KEY) });
  }));

  app.put('/api/settings', wrap((req, res) => {
    const { apiKey, ...rest } = config.update(req.body ?? {});
    res.json({ ...rest, apiKeySet: Boolean(apiKey || process.env.ANTHROPIC_API_KEY) });
  }));

  app.post('/api/settings/discover', wrap(async (req, res) => {
    res.json({ printers: await printer.discoverPrinters() });
  }));

  app.post('/api/settings/test-print', wrap(async (req, res) => {
    await printer.sendToPrinter(requirePrinterIp(), buildTestZpl());
    res.json({ ok: true });
  }));

  app.post('/api/settings/zpl-mode', wrap(async (req, res) => {
    await printer.sendToPrinter(requirePrinterIp(), setZplModeCommand());
    res.json({ ok: true });
  }));

  return app;
}
```

- [ ] **Step 4: Implement src/server.js**

```js
import os from 'node:os';
import { createApp } from './app.js';

const PORT = 3000;
const app = createApp({ dataDir: 'data' });

app.listen(PORT, '0.0.0.0', () => {
  console.log('Zebra Connect is running. Open on your phone:');
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  http://${a.address}:${PORT}`);
      }
    }
  }
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/app.test.js`
Expected: PASS (5 tests). Then run the whole suite: `node --test` — all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app.js src/server.js test/app.test.js
git commit -m "feat: add Express app with label, print, and settings API"
```

---

### Task 9: Claude photo extraction

**Files:**
- Create: `src/extract.js`
- Modify: `src/app.js` (add `POST /api/extract` route; add `extractOverride` to factory options)
- Test: `test/extract.test.js`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk`.
- Produces:
  - `extractLabelFields(imageBuffer, mediaType, client) => Promise<{name, description}>` — `client` is an injectable Anthropic-SDK-compatible object (tests pass a stub). Throws `Error('extraction refused')` on `stop_reason === 'refusal'`, `Error('could not parse extraction result')` on non-JSON output.
  - `makeClient(apiKey) => client` — `new Anthropic({apiKey})` when a key string is given, else `new Anthropic()` (env/`ant auth` resolution).
  - New route in `src/app.js`: `POST /api/extract` — raw image body (`image/jpeg`, `image/png`, `image/webp`; 20 MB limit) → `{name, description}`; 400 when no API key is configured (config `apiKey` or `ANTHROPIC_API_KEY`); 502 with the error message on API failure.
  - `createApp` gains optional `extractOverride` (same signature as a bound `extractLabelFields(imageBuffer, mediaType)`).

- [ ] **Step 1: Write the failing tests**

`test/extract.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLabelFields } from '../src/extract.js';

function stubClient(response) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => { calls.push(params); return response; },
      },
    },
  };
}

test('extractLabelFields sends the image and parses the JSON reply', async () => {
  const client = stubClient({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"name":"Olive Oil","description":"Extra virgin, cold pressed"}' }],
  });
  const out = await extractLabelFields(Buffer.from('fakeimg'), 'image/jpeg', client);
  assert.deepEqual(out, { name: 'Olive Oil', description: 'Extra virgin, cold pressed' });

  const params = client.calls[0];
  assert.equal(params.model, 'claude-opus-5');
  const image = params.messages[0].content.find((b) => b.type === 'image');
  assert.equal(image.source.media_type, 'image/jpeg');
  assert.equal(image.source.data, Buffer.from('fakeimg').toString('base64'));
});

test('extractLabelFields tolerates code fences around the JSON', async () => {
  const client = stubClient({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '```json\n{"name":"Salt","description":""}\n```' }],
  });
  const out = await extractLabelFields(Buffer.from('x'), 'image/png', client);
  assert.equal(out.name, 'Salt');
});

test('extractLabelFields surfaces refusals and unparseable output', async () => {
  await assert.rejects(
    () => extractLabelFields(Buffer.from('x'), 'image/png',
      stubClient({ stop_reason: 'refusal', content: [] })),
    /refused/,
  );
  await assert.rejects(
    () => extractLabelFields(Buffer.from('x'), 'image/png',
      stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] })),
    /could not parse/,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/extract.test.js`
Expected: FAIL — cannot find module `../src/extract.js`.

- [ ] **Step 3: Implement src/extract.js**

```js
import Anthropic from '@anthropic-ai/sdk';

const PROMPT = `This photo shows a food product, ingredient, or its packaging/label.
Extract the fields for an inventory label and reply with ONLY a JSON object,
no other text:
{"name": "<short product/ingredient name>", "description": "<one or two sentences: what it is, plus any useful details visible such as brand, variety, or size>"}
If you cannot tell what the product is, use your best guess for name and an empty description.`;

export function makeClient(apiKey) {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

export async function extractLabelFields(imageBuffer, mediaType, client) {
  const response = await client.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('extraction refused');
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('could not parse extraction result');
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('could not parse extraction result');
  }
  return {
    name: String(parsed.name ?? ''),
    description: String(parsed.description ?? ''),
  };
}
```

- [ ] **Step 4: Add the route to src/app.js**

In the factory signature, change `{ dataDir, printerOverrides = {} }` to `{ dataDir, printerOverrides = {}, extractOverride }`. Add imports at the top:

```js
import { extractLabelFields, makeClient } from './extract.js';
```

Add after the `/api/print-raw` route:

```js
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  app.post('/api/extract', express.raw({ type: IMAGE_TYPES, limit: '20mb' }), wrap(async (req, res) => {
    const apiKey = config.get().apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error('no API key configured — add one in Settings'), { status: 400 });
    }
    const mediaType = req.headers['content-type'];
    const extract = extractOverride
      ?? ((buf, type) => extractLabelFields(buf, type, makeClient(config.get().apiKey)));
    try {
      res.json(await extract(req.body, mediaType));
    } catch (err) {
      throw Object.assign(err, { status: 502 });
    }
  }));
```

- [ ] **Step 5: Add an app-level test for the route**

Append to `test/app.test.js`:

```js
test('extract requires an API key, then returns extracted fields', async () => {
  const { base, close } = await startApp();
  const noKey = await fetch(`${base}/api/extract`, {
    method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('img'),
  });
  assert.equal(noKey.status, 400);
  close();

  const dataDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-app-'));
  const app2 = createApp({
    dataDir: dataDir2,
    extractOverride: async () => ({ name: 'Beans', description: 'Black beans' }),
  });
  await new Promise((resolve) => {
    const server = app2.listen(0, '127.0.0.1', async () => {
      const base2 = `http://127.0.0.1:${server.address().port}`;
      await fetch(`${base2}/api/settings`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-test' }),
      });
      const out = await (await fetch(`${base2}/api/extract`, {
        method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('img'),
      })).json();
      assert.equal(out.name, 'Beans');
      server.close();
      resolve();
    });
  });
});
```

- [ ] **Step 6: Run all tests to verify they pass**

Run: `node --test`
Expected: PASS — every suite green.

- [ ] **Step 7: Commit**

```bash
git add src/extract.js src/app.js test/extract.test.js test/app.test.js
git commit -m "feat: add Claude photo extraction endpoint"
```

---

### Task 10: Frontend shell, library view, API helpers

**Files:**
- Create: `public/index.html`, `public/style.css`, `public/api.js`, `public/app.js`

**Interfaces:**
- Consumes: the REST API from Tasks 8–9.
- Produces: hash-routed SPA shell. `public/api.js` exports `api` (fetch helpers: `listLabels`, `getLabel`, `createLabel`, `updateLabel`, `deleteLabel`, `newBarcode`, `previewBlob`, `printLabel`, `printRaw`, `extract`, `getSettings`, `putSettings`, `discover`, `testPrint`, `zplMode`) — all throwing `Error(json.error)` on non-OK. `public/app.js` exports `navigate(hash)`, `showToast(message, isError)`, and owns routing; it renders the library view and dispatches `#/edit/:id`, `#/new`, `#/settings` to view modules. Later tasks add `public/editor.js` (must export `renderEditor(container, labelOrDraft)`) and `public/settings.js` (`renderSettings(container)`) — `app.js` imports both.

- [ ] **Step 1: Write public/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Zebra Connect</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <h1 id="title">Labels</h1>
  <nav>
    <a href="#/" title="Library">📋</a>
    <a href="#/new" title="New label">➕</a>
    <a href="#/settings" title="Settings">⚙️</a>
  </nav>
</header>
<main id="view"></main>
<div id="toast" hidden></div>
<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write public/style.css**

```css
* { box-sizing: border-box; margin: 0; }
body { font-family: system-ui, sans-serif; background: #f2f2f5; color: #111; }
header { display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; background: #1a1a2e; color: #fff; position: sticky; top: 0; z-index: 5; }
header h1 { font-size: 18px; }
header nav a { font-size: 22px; text-decoration: none; margin-left: 14px; }
main { padding: 12px; max-width: 640px; margin: 0 auto; }
button { font-size: 16px; padding: 10px 16px; border: 0; border-radius: 8px;
  background: #3b5bdb; color: #fff; }
button.secondary { background: #dee2e6; color: #111; }
button.danger { background: #c92a2a; }
button:disabled { opacity: .5; }
input, select, textarea { font-size: 16px; padding: 9px; width: 100%;
  border: 1px solid #ccc; border-radius: 8px; background: #fff; }
label.field { display: block; margin: 10px 0 4px; font-weight: 600; font-size: 14px; }
.card { background: #fff; border-radius: 10px; padding: 12px; margin-bottom: 10px;
  display: flex; gap: 12px; align-items: center; }
.card img { width: 84px; border: 1px solid #ddd; border-radius: 4px; }
.card .meta { flex: 1; min-width: 0; }
.card .meta .name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; }
.card .meta .sub { color: #666; font-size: 13px; }
.row { display: flex; gap: 10px; margin: 12px 0; align-items: center; }
.row > * { flex: 1; }
.size-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.size-grid button { padding: 22px 0; font-size: 18px; }
#toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
  background: #333; color: #fff; padding: 10px 18px; border-radius: 8px; z-index: 10; }
#toast.error { background: #c92a2a; }
/* editor preview + drag overlay (used by Task 11/12) */
#preview-wrap { position: relative; margin: 0 auto; border: 1px solid #bbb;
  background: #fff; touch-action: none; }
#preview-wrap img { display: block; width: 100%; }
.el-box { position: absolute; border: 1px dashed rgba(59,91,219,.7); }
.el-box.selected { border: 2px solid #3b5bdb; background: rgba(59,91,219,.08); }
.el-box .handle { position: absolute; right: -12px; bottom: -12px; width: 24px;
  height: 24px; background: #3b5bdb; border-radius: 50%; display: none; }
.el-box.selected .handle { display: block; }
```

- [ ] **Step 3: Write public/api.js**

```js
async function call(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).error ?? message; } catch { /* keep statusText */ }
    throw new Error(message);
  }
  return res;
}
const json = (method, body) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

export const api = {
  listLabels: async () => (await call('/api/labels')).json(),
  getLabel: async (id) => (await call(`/api/labels/${id}`)).json(),
  createLabel: async (draft) => (await call('/api/labels', json('POST', draft))).json(),
  updateLabel: async (id, draft) => (await call(`/api/labels/${id}`, json('PUT', draft))).json(),
  deleteLabel: async (id) => (await call(`/api/labels/${id}`, { method: 'DELETE' })).json(),
  newBarcode: async () => (await call('/api/barcode/new')).json(),
  previewBlob: async (draft) => (await call('/api/preview', json('POST', draft))).blob(),
  printLabel: async (label, quantity) => (await call('/api/print', json('POST', { label, quantity }))).json(),
  printRaw: async (file) => (await call('/api/print-raw', {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
  })).json(),
  extract: async (file) => (await call('/api/extract', {
    method: 'POST', headers: { 'content-type': file.type }, body: file,
  })).json(),
  getSettings: async () => (await call('/api/settings')).json(),
  putSettings: async (patch) => (await call('/api/settings', json('PUT', patch))).json(),
  discover: async () => (await call('/api/settings/discover', { method: 'POST' })).json(),
  testPrint: async () => (await call('/api/settings/test-print', { method: 'POST' })).json(),
  zplMode: async () => (await call('/api/settings/zpl-mode', { method: 'POST' })).json(),
};
```

- [ ] **Step 4: Write public/app.js**

```js
import { api } from './api.js';
import { renderEditor } from './editor.js';
import { renderSettings } from './settings.js';

const view = document.getElementById('view');
const title = document.getElementById('title');

export function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = isError ? 'error' : '';
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 3500);
}

export function navigate(hash) { location.hash = hash; }

async function renderLibrary() {
  title.textContent = 'Labels';
  const labels = await api.listLabels();
  view.innerHTML = `
    <input id="search" placeholder="Search labels…">
    <div id="cards" style="margin-top:12px"></div>
    ${labels.length ? '' : '<p style="color:#666;margin-top:16px">No labels yet — tap ➕ to make one.</p>'}`;
  const cards = view.querySelector('#cards');

  function draw(filter = '') {
    const q = filter.toLowerCase();
    cards.innerHTML = '';
    for (const label of labels) {
      const hay = `${label.fields.name} ${label.fields.barcode}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <img alt="" loading="lazy">
        <div class="meta">
          <div class="name"></div>
          <div class="sub"></div>
        </div>`;
      card.querySelector('.name').textContent = label.fields.name || '(unnamed)';
      card.querySelector('.sub').textContent = `${label.size} in · ${label.fields.barcode}`;
      api.previewBlob(label).then((blob) => {
        card.querySelector('img').src = URL.createObjectURL(blob);
      }).catch(() => {});
      card.onclick = () => navigate(`#/edit/${label.id}`);
      cards.appendChild(card);
    }
  }
  draw();
  view.querySelector('#search').oninput = (e) => draw(e.target.value);
}

function renderNew() {
  title.textContent = 'New label';
  view.innerHTML = `
    <p>Pick a size:</p>
    <div class="size-grid">
      <button data-size="3x5">3" × 5"</button>
      <button data-size="3x2">3" × 2"</button>
      <button data-size="2x1.25">2" × 1.25"</button>
    </div>`;
  for (const btn of view.querySelectorAll('[data-size]')) {
    btn.onclick = () => renderEditor(view, { size: btn.dataset.size });
  }
}

async function route() {
  const hash = location.hash || '#/';
  try {
    if (hash === '#/' || hash === '') await renderLibrary();
    else if (hash === '#/new') renderNew();
    else if (hash.startsWith('#/edit/')) {
      title.textContent = 'Edit label';
      renderEditor(view, await api.getLabel(hash.slice(7)));
    } else if (hash === '#/settings') {
      title.textContent = 'Settings';
      await renderSettings(view);
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

window.addEventListener('hashchange', route);
route();
```

- [ ] **Step 5: Create placeholder modules so the shell loads**

`public/editor.js` (replaced in Task 11):

```js
export function renderEditor(container) {
  container.innerHTML = '<p>Editor coming in Task 11.</p>';
}
```

`public/settings.js` (replaced in Task 13):

```js
export async function renderSettings(container) {
  container.innerHTML = '<p>Settings coming in Task 13.</p>';
}
```

- [ ] **Step 6: Verify manually**

Run: `npm start`, then open `http://localhost:3000` in a browser.
Expected: header renders; library shows the empty-state message; ➕ shows the three size buttons; ⚙️ shows the placeholder. Create a label via the API to see a card with a thumbnail:

```bash
curl -s -X POST http://localhost:3000/api/labels -H "content-type: application/json" -d "{\"size\":\"3x5\",\"fields\":{\"name\":\"Test Flour\",\"description\":\"A test\"}}"
```

Reload the library; a card with a rendered thumbnail appears. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add public/
git commit -m "feat: add mobile web shell with library view"
```

---

### Task 11: Editor view with live preview and printing

**Files:**
- Modify: `public/editor.js` (replace placeholder entirely)

**Interfaces:**
- Consumes: `api` from `public/api.js`; `showToast`, `navigate` from `public/app.js`.
- Produces: `renderEditor(container, labelOrDraft)` — full editor: live preview image (debounced server render), name/description/barcode fields, description toggle, quantity, Save, Print, Delete (saved labels only), Reset layout. Also exports `attachLayoutEditing(previewWrap, draft, onLayoutChange)` as a named function **stub in this task** (real implementation in Task 12) so Task 12 only swaps one function body. The working draft object shape matches the API label draft: `{id?, size, fields, options, layout?}`.

- [ ] **Step 1: Implement public/editor.js**

```js
import { api } from './api.js';
import { showToast, navigate } from './app.js';

export function attachLayoutEditing(previewWrap, draft, onLayoutChange) {
  // Implemented in Task 12 (drag & resize).
}

export function renderEditor(container, labelOrDraft) {
  const draft = {
    id: labelOrDraft.id,
    size: labelOrDraft.size,
    fields: { name: '', description: '', barcode: '', ...labelOrDraft.fields },
    options: labelOrDraft.options ? { ...labelOrDraft.options } : undefined,
    layout: labelOrDraft.layout ? structuredClone(labelOrDraft.layout) : undefined,
  };

  container.innerHTML = `
    <div id="preview-wrap"><img id="preview" alt="label preview"></div>
    <label class="field">Name</label>
    <input id="f-name">
    <label class="field">Description <input id="f-showdesc" type="checkbox" style="width:auto"></label>
    <textarea id="f-desc" rows="3"></textarea>
    <label class="field">Barcode (UPC-A)</label>
    <div class="row">
      <input id="f-barcode" inputmode="numeric" maxlength="12">
      <button id="regen" class="secondary" style="flex:0 0 auto">↻ New</button>
    </div>
    <div class="row">
      <label style="flex:0 0 auto">Qty</label>
      <input id="f-qty" type="number" value="1" min="1" max="100" style="width:80px;flex:0 0 auto">
      <button id="reset-layout" class="secondary">Reset layout</button>
    </div>
    <div class="row">
      <button id="save">Save</button>
      <button id="print">🖨 Print</button>
      ${draft.id ? '<button id="delete" class="danger" style="flex:0 0 auto">🗑</button>' : ''}
    </div>`;

  const els = {
    img: container.querySelector('#preview'),
    wrap: container.querySelector('#preview-wrap'),
    name: container.querySelector('#f-name'),
    desc: container.querySelector('#f-desc'),
    showDesc: container.querySelector('#f-showdesc'),
    barcode: container.querySelector('#f-barcode'),
    qty: container.querySelector('#f-qty'),
  };
  els.name.value = draft.fields.name;
  els.desc.value = draft.fields.description;
  els.barcode.value = draft.fields.barcode;

  let refreshTimer;
  let lastUrl;
  async function refreshPreview(immediate = false) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      try {
        const blob = await api.previewBlob(draft);
        if (lastUrl) URL.revokeObjectURL(lastUrl);
        lastUrl = URL.createObjectURL(blob);
        els.img.src = lastUrl;
      } catch (err) {
        showToast(err.message, true);
      }
    }, immediate ? 0 : 350);
  }

  // The server fills defaults for options/layout; fetch its normalized view once
  // so the draft has concrete layout boxes for the overlay and reset button.
  async function ensureNormalized() {
    if (!draft.layout || !draft.options || !draft.fields.barcode) {
      const normalized = draft.id ? draft : await api.createLabel(draft);
      if (!draft.id) {
        draft.id = normalized.id;
        history.replaceState(null, '', `#/edit/${draft.id}`);
      }
      draft.fields = normalized.fields;
      draft.options = normalized.options;
      draft.layout = normalized.layout;
      els.name.value = draft.fields.name;
      els.desc.value = draft.fields.description;
      els.barcode.value = draft.fields.barcode;
    }
    els.showDesc.checked = draft.options.showDescription;
    attachLayoutEditing(els.wrap, draft, () => refreshPreview());
  }

  els.name.oninput = () => { draft.fields.name = els.name.value; refreshPreview(); };
  els.desc.oninput = () => { draft.fields.description = els.desc.value; refreshPreview(); };
  els.barcode.oninput = () => { draft.fields.barcode = els.barcode.value; refreshPreview(); };
  els.showDesc.onchange = () => {
    draft.options.showDescription = els.showDesc.checked;
    refreshPreview(true);
  };
  container.querySelector('#regen').onclick = async () => {
    const { barcode } = await api.newBarcode();
    draft.fields.barcode = barcode;
    els.barcode.value = barcode;
    refreshPreview(true);
  };
  container.querySelector('#reset-layout').onclick = async () => {
    draft.layout = undefined;
    const saved = await api.updateLabel(draft.id, draft);
    draft.layout = saved.layout;
    attachLayoutEditing(els.wrap, draft, () => refreshPreview());
    refreshPreview(true);
    showToast('Layout reset');
  };
  container.querySelector('#save').onclick = async () => {
    try {
      const saved = await api.updateLabel(draft.id, draft);
      Object.assign(draft, saved);
      showToast('Saved');
    } catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#print').onclick = async () => {
    const btn = container.querySelector('#print');
    btn.disabled = true;
    try {
      await api.updateLabel(draft.id, draft);
      await api.printLabel(draft, parseInt(els.qty.value, 10) || 1);
      showToast('Sent to printer 🖨');
    } catch (err) { showToast(err.message, true); }
    btn.disabled = false;
  };
  const deleteBtn = container.querySelector('#delete');
  if (deleteBtn) deleteBtn.onclick = async () => {
    if (!confirm('Delete this label?')) return;
    await api.deleteLabel(draft.id);
    navigate('#/');
  };

  ensureNormalized().then(() => refreshPreview(true)).catch((err) => showToast(err.message, true));
}
```

- [ ] **Step 2: Verify manually**

Run: `npm start`, open `http://localhost:3000`, tap ➕ → "3 × 5".
Expected: editor opens, a barcode is auto-assigned, the preview image shows name/description/barcode as you type (updates ~a third of a second after you stop). ↻ New swaps the barcode. Save shows the toast; the label appears in the library. Print without a printer IP shows the "no printer IP configured" error toast (correct behavior). Delete removes it.

- [ ] **Step 3: Run the full test suite (regression)**

Run: `node --test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add public/editor.js
git commit -m "feat: add label editor with live preview and print"
```

---

### Task 12: Drag & resize layout editing

**Files:**
- Modify: `public/editor.js` (replace the `attachLayoutEditing` stub body only)

**Interfaces:**
- Consumes: the draft object and `#preview-wrap` DOM from Task 11; label dot sizes must match the server (`3x5` 576×1015, `3x2` 576×406, `2x1.25` 406×253).
- Produces: working `attachLayoutEditing(previewWrap, draft, onLayoutChange)` — overlays one positioned box per visible element (name, description when shown, barcode); tap selects, drag moves, the corner handle resizes; boxes are clamped inside the label; every change writes dots back into `draft.layout` and calls `onLayoutChange()`.

- [ ] **Step 1: Replace the attachLayoutEditing stub**

```js
const DOT_SIZES = { '3x5': [576, 1015], '3x2': [576, 406], '2x1.25': [406, 253] };
const MIN_DOTS = 60;

export function attachLayoutEditing(previewWrap, draft, onLayoutChange) {
  previewWrap.querySelectorAll('.el-box').forEach((el) => el.remove());
  if (!draft.layout) return;
  const [dotsW, dotsH] = DOT_SIZES[draft.size];
  // Keep the wrap's aspect ratio so overlay % positions match the image.
  previewWrap.style.aspectRatio = `${dotsW} / ${dotsH}`;

  const elements = ['name', 'barcode'];
  if (draft.options?.showDescription) elements.splice(1, 0, 'description');

  for (const key of elements) {
    const box = draft.layout[key];
    const el = document.createElement('div');
    el.className = 'el-box';
    el.dataset.el = key;
    el.innerHTML = '<div class="handle"></div>';
    previewWrap.appendChild(el);

    const sync = () => {
      el.style.left = `${(box.x / dotsW) * 100}%`;
      el.style.top = `${(box.y / dotsH) * 100}%`;
      el.style.width = `${(box.w / dotsW) * 100}%`;
      el.style.height = `${(box.h / dotsH) * 100}%`;
    };
    sync();

    let drag = null; // {mode: 'move'|'resize', startX, startY, orig}
    const toDots = (px) => px * (dotsW / previewWrap.clientWidth);

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      previewWrap.querySelectorAll('.el-box').forEach((b) => b.classList.remove('selected'));
      el.classList.add('selected');
      const mode = e.target.classList.contains('handle') ? 'resize' : 'move';
      drag = { mode, startX: e.clientX, startY: e.clientY, orig: { ...box } };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = toDots(e.clientX - drag.startX);
      const dy = toDots(e.clientY - drag.startY);
      if (drag.mode === 'move') {
        box.x = Math.round(Math.min(Math.max(drag.orig.x + dx, 0), dotsW - box.w));
        box.y = Math.round(Math.min(Math.max(drag.orig.y + dy, 0), dotsH - box.h));
      } else {
        box.w = Math.round(Math.min(Math.max(drag.orig.w + dx, MIN_DOTS), dotsW - box.x));
        box.h = Math.round(Math.min(Math.max(drag.orig.h + dy, MIN_DOTS), dotsH - box.y));
      }
      sync();
    });
    el.addEventListener('pointerup', (e) => {
      if (!drag) return;
      drag = null;
      el.releasePointerCapture(e.pointerId);
      onLayoutChange();
    });
  }
}
```

- [ ] **Step 2: Verify manually (desktop)**

Run: `npm start`, open a label in the editor.
Expected: dashed boxes overlay the name, description (when toggled on), and barcode. Dragging a box moves it; releasing re-renders the preview with the element in the new spot; the blue corner handle resizes. Boxes can't leave the label. Toggling description on/off adds/removes its box. "Reset layout" snaps everything back. Save, reload the page — the layout persists.

- [ ] **Step 3: Verify manually (phone-sized)**

In browser devtools, switch to a phone viewport (e.g. iPhone) with touch emulation.
Expected: touch-drag moves boxes without scrolling the page (the `touch-action: none` on `#preview-wrap` handles this); the handle is comfortably tappable.

- [ ] **Step 4: Commit**

```bash
git add public/editor.js
git commit -m "feat: add touch drag and resize layout editing"
```

---

### Task 13: Photo flow, .prn upload, settings page

**Files:**
- Modify: `public/app.js` (photo + .prn entry points in the New view)
- Modify: `public/settings.js` (replace placeholder entirely)

**Interfaces:**
- Consumes: `api` helpers, `renderEditor`.
- Produces: New view gains "Start from photo" and "Print a .prn file"; settings page manages printer IP (with discovery), darkness, API key, test print, and ZPL mode.

- [ ] **Step 1: Extend renderNew in public/app.js**

Replace the `renderNew` function with:

```js
function renderNew() {
  title.textContent = 'New label';
  view.innerHTML = `
    <p>Pick a size:</p>
    <div class="size-grid">
      <button data-size="3x5">3" × 5"</button>
      <button data-size="3x2">3" × 2"</button>
      <button data-size="2x1.25">2" × 1.25"</button>
    </div>
    <div class="row" style="margin-top:20px">
      <button id="from-photo" class="secondary">📷 Start from photo (3×5)</button>
    </div>
    <div class="row">
      <button id="print-prn" class="secondary">📄 Print a .prn file</button>
    </div>
    <input id="photo-input" type="file" accept="image/*" capture="environment" hidden>
    <input id="prn-input" type="file" accept=".prn" hidden>`;

  for (const btn of view.querySelectorAll('[data-size]')) {
    btn.onclick = () => renderEditor(view, { size: btn.dataset.size });
  }

  const photoInput = view.querySelector('#photo-input');
  view.querySelector('#from-photo').onclick = () => photoInput.click();
  photoInput.onchange = async () => {
    const file = photoInput.files[0];
    if (!file) return;
    showToast('Reading photo…');
    try {
      const fields = await api.extract(file);
      renderEditor(view, { size: '3x5', fields });
    } catch (err) {
      // Per spec: on extraction failure, open a blank editor with an error notice.
      showToast(`Photo reading failed: ${err.message}`, true);
      renderEditor(view, { size: '3x5' });
    }
  };

  const prnInput = view.querySelector('#prn-input');
  view.querySelector('#print-prn').onclick = () => prnInput.click();
  prnInput.onchange = async () => {
    const file = prnInput.files[0];
    if (!file) return;
    try {
      await api.printRaw(file);
      showToast('Sent to printer 🖨');
    } catch (err) {
      showToast(err.message, true);
    }
  };
}
```

- [ ] **Step 2: Implement public/settings.js**

```js
import { api } from './api.js';
import { showToast } from './app.js';

export async function renderSettings(container) {
  const settings = await api.getSettings();
  container.innerHTML = `
    <label class="field">Printer IP address</label>
    <div class="row">
      <input id="s-ip" placeholder="e.g. 192.168.1.50">
      <button id="s-discover" class="secondary" style="flex:0 0 auto">🔍 Find</button>
    </div>
    <div id="s-found"></div>
    <label class="field">Darkness (0–30)</label>
    <input id="s-darkness" type="number" min="0" max="30">
    <label class="field">Anthropic API key ${settings.apiKeySet ? '✅ set' : '❌ not set'}</label>
    <input id="s-key" type="password" placeholder="${settings.apiKeySet ? 'leave blank to keep current key' : 'sk-ant-…'}">
    <div class="row">
      <button id="s-save">Save settings</button>
    </div>
    <div class="row">
      <button id="s-test" class="secondary">🖨 Test print</button>
      <button id="s-zpl" class="secondary">Fix printer language (ZPL)</button>
    </div>
    <p style="color:#666;font-size:13px;margin-top:8px">
      If the test print comes out blank or as gibberish text, tap
      "Fix printer language" and try again — it switches the printer to
      ZPL-compatible mode.
    </p>`;

  const ip = container.querySelector('#s-ip');
  const darkness = container.querySelector('#s-darkness');
  const key = container.querySelector('#s-key');
  ip.value = settings.printerIp;
  darkness.value = settings.darkness;

  container.querySelector('#s-save').onclick = async () => {
    try {
      const patch = { printerIp: ip.value.trim(), darkness: Number(darkness.value) };
      if (key.value.trim()) patch.apiKey = key.value.trim();
      await api.putSettings(patch);
      showToast('Settings saved');
      renderSettings(container);
    } catch (err) { showToast(err.message, true); }
  };

  container.querySelector('#s-discover').onclick = async () => {
    const found = container.querySelector('#s-found');
    found.textContent = 'Scanning your network (up to ~30s)…';
    try {
      const { printers } = await api.discover();
      found.innerHTML = printers.length ? 'Tap to use: ' : 'No printers found — check the printer is on WiFi.';
      for (const p of printers) {
        const btn = document.createElement('button');
        btn.className = 'secondary';
        btn.style.margin = '4px';
        btn.textContent = p;
        btn.onclick = () => { ip.value = p; };
        found.appendChild(btn);
      }
    } catch (err) { found.textContent = err.message; }
  };

  container.querySelector('#s-test').onclick = async () => {
    try { await api.testPrint(); showToast('Test sent 🖨'); }
    catch (err) { showToast(err.message, true); }
  };
  container.querySelector('#s-zpl').onclick = async () => {
    try { await api.zplMode(); showToast('Printer set to ZPL mode — power-cycle the printer, then test print'); }
    catch (err) { showToast(err.message, true); }
  };
}
```

- [ ] **Step 3: Verify manually**

Run: `npm start`, open the app.
Expected: ⚙️ Settings shows the form; saving an IP persists after reload; API key field shows ✅ once saved; test print without a reachable printer shows the clear error toast. ➕ New shows the photo and .prn buttons; picking a .prn without a printer configured shows the "no printer IP" error; with a real API key, "Start from photo" fills the editor from a photo.

- [ ] **Step 4: Run the full test suite (regression)**

Run: `node --test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/settings.js
git commit -m "feat: add photo extraction flow, prn upload, and settings page"
```

---

### Task 14: README + real-hardware acceptance

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the finished app.
- Produces: user-facing documentation and a verified acceptance checklist.

- [ ] **Step 1: Write README.md**

```markdown
# Zebra Connect

Design, store, and print labels on a Zebra ZQ620 Plus from your phone.

## Start the app

    npm install
    npm start

The terminal prints the address to open on your phone, e.g.
`http://192.168.1.10:3000`. Your phone and the PC must be on the same
WiFi network as the printer.

## First-time setup

1. Put the printer on your WiFi (Zebra Setup Utilities or the printer's
   own menu) and note its IP — or use **Settings → 🔍 Find**.
2. In **Settings**, set the printer IP and tap **🖨 Test print**.
3. If the test print is blank or prints gibberish, tap **Fix printer
   language (ZPL)**, power-cycle the printer, and test again.
4. For photo extraction, paste an Anthropic API key
   (console.anthropic.com) into Settings. Photo extraction uses
   Claude with server-side refusal fallbacks enabled.

## Labels

- Sizes: 3×5, 3×2, and 2×1.25 inches (203 dpi, max print width 576 dots).
- Barcodes are unique random UPC-A codes; the printed barcode is drawn
  natively by the printer for reliable scanning.
- Drag elements on the preview to move them; use the corner handle to
  resize. Layouts save per label.
- **📄 Print a .prn file** sends any prepared printer file byte-for-byte.

## Where data lives

`data/labels.json` (your labels) and `data/config.json` (settings,
including the API key) — back up the `data/` folder to keep everything.
```

- [ ] **Step 2: Run the full test suite one final time**

Run: `node --test`
Expected: PASS, all suites.

- [ ] **Step 3: Real-hardware acceptance checklist (with the user)**

These need the physical printer and phone; walk the user through them and record results:

1. Printer on WiFi, IP set in Settings, test print prints correctly.
2. From the phone: create a 3×5 label from a photo — fields auto-filled, preview correct, print matches the preview, barcode scans.
3. Print a 3×2 and a 2×1.25 label (name + barcode) — both correct.
4. Drag the barcode somewhere new, print — printed position matches preview.
5. Print a raw .prn file.
6. Edit and reprint a stored label after restarting the server.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and acceptance checklist"
```
