# Convert Printer Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn imported printer files into native app labels (same editor, same behaviour), one at a time or all at once, removing the file entries on bulk conversion.

**Architecture:** `parseFields` gains font orientation and `^FB` block info. A pure converter module maps the parsed fields into a label draft (name, barcode, extras with boxes) using the coordinate rules in the spec. Two routes wrap it (single with optional remove, bulk with remove) and reuse the existing draft normalisation so converted labels are validated exactly like new ones. The UI adds a Convert button to the print sheet and the file editor.

**Tech Stack:** Node 22 ESM, Express 5, `node --test`, vanilla browser JS.

**Spec:** `docs/superpowers/specs/2026-09-07-convert-printer-files-design.md`

## Global Constraints

- Never create files named `prn.*`, `con.*`, `aux.*`, `nul.*`, `com1.*`, `lpt1.*` (Windows reserved device names).
- `public/zpl-fields.js` must stay a verbatim copy of `src/zpl-fields.js` (a test enforces it).
- Converted drafts go through `normalizeDraft` so every box has finite numbers and a rotation in {0, 90, 180, 270}.
- Do not commit unless the user asks.

---

### Task 1: Orientation and block info in `parseFields`

**Files:**
- Modify: `src/zpl-fields.js` (segments/parseFields), copy to `public/zpl-fields.js`
- Test: `test/zpl-fields.test.js`

**Interfaces:**
- Produces: each parsed field additionally has `orient: 'N'|'R'|'I'|'B'` (default `'N'`) and `block: { w:number, align:string } | null` from `^FBw,lines,spacing,align`.

- [ ] **Step 1: Add the failing test** to `test/zpl-fields.test.js`:

```js
test('parseFields reports font orientation and ^FB blocks', () => {
  const zpl = '^XA^FT76,1015^A0B,72,43^FB1014,1,18,C^FH\\^FDFULLY COOKED\\5C&^FS^FT10,10^A0N,20,20^FDplain^FS^XZ';
  const [a, b] = parseFields(zpl);
  assert.equal(a.orient, 'B');
  assert.deepEqual(a.block, { w: 1014, align: 'C' });
  assert.equal(b.orient, 'N');
  assert.equal(b.block, null);
});
```

- [ ] **Step 2: Run** `node --test test/zpl-fields.test.js` — expect the new test to fail on `orient` being undefined.

- [ ] **Step 3: Implement** in `segments()`: capture the block with `const block = /\^FB(\d+),(\d*),(\d*),([LCRJ]?)/.exec(body);` and push `orient: font ? (font[2] ?? 'N') : 'N'` and `block: block ? { w: Number(block[1]), align: block[4] || 'L' } : null`; in `parseFields` pass `orient: s.orient, block: s.block` through. Keep `rotated` as is. Then `cp src/zpl-fields.js public/zpl-fields.js`.

- [ ] **Step 4: Run** `node --test test/zpl-fields.test.js` — all pass, including the verbatim-copy test.

### Task 2: Converter module

**Files:**
- Create: `src/convert-file.js`
- Test: `test/convert-file.test.js`

**Interfaces:**
- Consumes: `parseFields` (Task 1), `SIZES`, `defaultLayout` from `src/layout.js`, `validateUpcA`, `upcCheckDigit` from `src/barcode.js`.
- Produces: `convertFileLabel(fileLabel, { generateBarcode }) → { draft, warnings }` where `draft` is a label body acceptable to `POST /api/labels` (`size`, `fields`, `options`, `layout`, `extras`).

- [ ] **Step 1: Write the failing tests**

```js
// test/convert-file.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { convertFileLabel } from '../src/convert-file.js';

const gen = () => '036000291452';
const file = (zpl, size = null, name = 'bacon') => ({ id: 'f1', kind: 'prn', size, fields: { name, barcode: '' }, zpl });

test('a 2x1.25 price tag becomes name + barcode with boxes in place', () => {
  const zpl = '^XA^PW406^LL254^FT43,50^A0N,48,48^FH\\^FDBACON        $69^FS^BY3,2,144^FT63,220^BUN,,Y,N,Y^FH\\^FD209990069008^FS^XZ';
  const { draft, warnings } = convertFileLabel(file(zpl, '2x1.25'), { generateBarcode: gen });
  assert.deepEqual(warnings, []);
  assert.equal(draft.size, '2x1.25');
  assert.equal(draft.fields.name, 'BACON        $69');
  assert.equal(draft.fields.barcode, '209990069008');
  assert.equal(draft.options.showDescription, false);
  assert.deepEqual(draft.layout.name, { x: 43, y: 2, w: 461, h: 48, rotation: 0 });
  assert.deepEqual(draft.layout.barcode, { x: 63, y: 76, w: 285, h: 174, rotation: 0 });
  assert.deepEqual(draft.extras, []);
});

test('a 5x3 file is flipped and un-rotated into the landscape canvas', () => {
  const zpl = '^XA^PW575^LL1015^FT76,1015^A0B,72,43^FB1014,1,18,C^FH\\^CI28^FDFULLY COOKED\\5C&^FS^FT333,747^A0B,175,175^FH\\^FD$12.00^FS^BY3,2,98^FT337,48^BUI,,Y,N,Y^FH\\^FD893463827495^FS^XZ';
  const { draft, warnings } = convertFileLabel(file(zpl, '3x5'), { generateBarcode: gen });
  assert.deepEqual(warnings, []);
  assert.equal(draft.fields.name, '$12.00');
  assert.deepEqual(draft.layout.name, { x: 268, y: 159, w: 630, h: 175, rotation: 0 });
  assert.equal(draft.extras.length, 1);
  assert.equal(draft.extras[0].text, 'FULLY COOKED');
  // centred ^FB block of 1014: est = 12 chars * 43 * 0.6 = 310, x = 0 + (1014 - 310) / 2 = 352
  assert.deepEqual(draft.extras[0].box, { x: 352, y: 5, w: 310, h: 72 });
  assert.equal(draft.extras[0].rotation, 0);
  assert.equal(draft.layout.barcode.rotation, 270);
});

test('non-UPC barcodes become text, graphics warn, missing barcode is generated', () => {
  const zpl = '^XA^PW406^LL254^FO20,120^GFA,8,8,1,::::::::^FS^FT43,50^A0N,48,48^FDHOOPS^FS^BY2,3,60^FT60,200^BCN,60,Y,N,N^FD12345678^FS^XZ';
  const { draft, warnings } = convertFileLabel(file(zpl, '2x1.25'), { generateBarcode: gen });
  assert.equal(draft.fields.barcode, '036000291452');
  assert.equal(draft.extras[0].text, '12345678');
  assert.match(warnings.join(' '), /graphic/i);
  assert.match(warnings.join(' '), /Code 128|barcode/i);
});

test('an 11-digit UPC gets its check digit; a bad one is replaced with a warning', () => {
  const ok = convertFileLabel(file('^XA^PW406^LL254^FT10,50^A0N,40,40^FDX^FS^FT63,220^BUN,,Y,N,Y^FD03600029145^FS^XZ', '2x1.25'), { generateBarcode: gen });
  assert.equal(ok.draft.fields.barcode, '036000291452');
  const bad = convertFileLabel(file('^XA^PW406^LL254^FT10,50^A0N,40,40^FDX^FS^FT63,220^BUN,,Y,N,Y^FD999999999999^FS^XZ', '2x1.25'), { generateBarcode: gen });
  assert.equal(bad.draft.fields.barcode, '036000291452');
  assert.match(bad.warnings.join(' '), /barcode/i);
});

test('size falls back from ^PW and warns when nothing is declared; extras are capped at 20', () => {
  const lines = Array.from({ length: 23 }, (_, i) => `^FT10,${30 + i * 20}^A0N,18,18^FDline ${i}^FS`).join('');
  const { draft, warnings } = convertFileLabel(file(`^XA${lines}^XZ`, null), { generateBarcode: gen });
  assert.equal(draft.size, '2x1.25');
  assert.equal(draft.extras.length, 20);
  assert.match(warnings.join(' '), /size/i);
  assert.match(warnings.join(' '), /20/);
});
```

- [ ] **Step 2: Run** `node --test test/convert-file.test.js` — fails: module not found.

- [ ] **Step 3: Implement `src/convert-file.js`**

```js
// Turn an imported printer file (ZebraDesigner ZPL) into a native label
// draft: same words in the same places, drawn by the app from then on.
import { parseFields } from './zpl-fields.js';
import { SIZES, defaultLayout } from './layout.js';
import { validateUpcA, upcCheckDigit } from './barcode.js';

const MAX_EXTRAS = 20;
const ROTATION_UPRIGHT = { N: 0, R: 90, I: 180, B: 270 };
const ROTATION_5X3 = { B: 0, N: 90, I: 270, R: 180 };

function decodeText(raw) {
  return raw
    .replace(/\\([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\&/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessSize(label, zpl, fields) {
  if (label.size && SIZES[label.size]) return { size: label.size, warning: null };
  const pw = Number(/\^PW(\d+)/.exec(zpl)?.[1]);
  if (pw === 406) return { size: '2x1.25', warning: null };
  if (pw === 575) return { size: fields.some((f) => f.kind === 'text' && f.orient === 'N') ? '3x2' : '3x5', warning: null };
  return { size: '2x1.25', warning: 'file declares no size — assumed 2 × 1.25' };
}

const estWidth = (text, w) => Math.max(40, Math.round(text.length * w * 0.6));

// Box for a text field in design space (see the spec for the 5x3 flip).
function textBox(f, size, text) {
  const h = f.font?.h ?? 30;
  const w = estWidth(text, f.font?.w ?? h);
  const shift = f.block?.align === 'C' ? Math.round((f.block.w - w) / 2) : 0;
  if (size === '3x5') {
    return { box: { x: 1015 - f.y + shift, y: f.x + 1 - h, w, h }, rotation: ROTATION_5X3[f.orient] ?? 0 };
  }
  const top = f.origin === 'FT' ? f.y - h : f.y;
  return { box: { x: f.x + shift, y: top, w, h }, rotation: ROTATION_UPRIGHT[f.orient] ?? 0 };
}

function barcodeBox(f, size, zpl) {
  const barHeight = Number(/\^BY\d+,[\d.]*,(\d+)/.exec(zpl.slice(0, zpl.indexOf(`^FD${f.text}`)))?.[1]) || 100;
  const w = 285; const h = barHeight + 30;
  if (size === '3x5') {
    const rotated = f.orient === 'N' || f.orient === 'I';
    return { x: 1015 - f.y, y: Math.max(0, f.x + 1 - (rotated ? w : h)), w: rotated ? h : w, h: rotated ? w : h, rotation: rotated ? 270 : 0 };
  }
  const top = f.origin === 'FT' ? f.y - barHeight : f.y;
  return { x: f.x, y: Math.max(0, top), w, h, rotation: ROTATION_UPRIGHT[f.orient] ?? 0 };
}

export function convertFileLabel(label, { generateBarcode }) {
  const warnings = [];
  const zpl = label.zpl;
  const fields = parseFields(zpl);
  const { size, warning } = guessSize(label, zpl, fields);
  if (warning) warnings.push(warning);
  if (/\^GF/.test(zpl)) warnings.push('embedded graphic dropped — the app cannot hold images');

  const texts = fields.filter((f) => f.kind === 'text').map((f) => ({ ...f, decoded: decodeText(f.text) })).filter((f) => f.decoded);
  const barcodes = fields.filter((f) => f.kind === 'barcode');
  const layout = defaultLayout(size);
  for (const key of Object.keys(layout)) layout[key].rotation = 0;

  // Name = biggest text; the rest become extras in place.
  texts.sort((a, b) => (b.font?.h ?? 0) - (a.font?.h ?? 0));
  const [nameField, ...rest] = texts;
  const name = nameField?.decoded ?? label.fields.name;
  if (nameField) {
    const { box, rotation } = textBox(nameField, size, nameField.decoded);
    layout.name = { ...box, rotation };
  }
  const extras = [];
  for (const f of rest) {
    const { box, rotation } = textBox(f, size, f.decoded);
    extras.push({ text: f.decoded, box, rotation });
  }

  // Barcode: UPC-A only; anything else is kept as text.
  let barcode = '';
  for (const b of barcodes) {
    const isUpc = /\^BU/.test(zpl.slice(0, zpl.indexOf(`^FD${b.text}`)).slice(-60));
    let digits = b.text.replace(/\D/g, '');
    if (isUpc && digits.length === 11) digits += upcCheckDigit(digits);
    if (isUpc && validateUpcA(digits) && !barcode) {
      barcode = digits;
      layout.barcode = barcodeBox(b, size, zpl);
    } else {
      warnings.push(isUpc ? `barcode ${b.text} is not a valid UPC-A — replaced with a new one` : `${/\^BC/.test(zpl) ? 'Code 128' : 'non-UPC'} barcode kept as text, not as a barcode`);
      const { box, rotation } = textBox({ ...b, font: { h: 30, w: 30 } }, size, b.text);
      extras.push({ text: b.text, box, rotation });
    }
  }
  if (!barcode) {
    barcode = generateBarcode();
    if (!barcodes.length) warnings.push('file had no barcode — a new UPC-A was generated');
  }

  if (extras.length > MAX_EXTRAS) {
    warnings.push(`${extras.length - MAX_EXTRAS} text lines dropped — the app allows 20 extra fields`);
    extras.length = MAX_EXTRAS;
  }

  return {
    draft: {
      size,
      fields: { name, description: '', barcode },
      options: { showDescription: false },
      layout,
      extras,
    },
    warnings,
  };
}
```

- [ ] **Step 4: Run** `node --test test/convert-file.test.js`. The hand-computed boxes in the tests are the contract; if one fails, re-derive from the spec's formulas before touching either side. Expected first-test numbers: name `y = 50 − 48 = 2`, `w = 16 × 48 × 0.6 = 461`; barcode `top = 220 − 144 = 76`, `h = 174`. 5x3: `$12.00` → `x = 1015 − 747 = 268`, `y = 333 + 1 − 175 = 159`, `w = 6 × 175 × 0.6 = 630`.

### Task 3: Routes

**Files:**
- Modify: `src/app.js`
- Test: `test/convert-file-routes.test.js`

**Interfaces:**
- Consumes: `convertFileLabel` (Task 2), `normalizeDraft`, `store`, `generateUpcA`.
- Produces: `POST /api/labels/:id/convert { remove? } → { label, warnings }`; `POST /api/labels/convert-all → { converted: [{ id, name, warnings }], failed: [{ id, name, error }] }`.

- [ ] **Step 1: Write the failing tests**

```js
// test/convert-file-routes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

function startApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-cv-'));
  const app = createApp({ dataDir });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}
const PRN = '^XA^PW406^LL254^FT43,50^A0N,48,48^FDBACON $69^FS^BY3,2,144^FT63,220^BUN,,Y,N,Y^FD209990069008^FS^XZ';
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const upload = async (base, name) => (await fetch(`${base}/api/labels/prn?name=${name}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: PRN })).json();

test('single convert creates an app label and can remove the file entry', async () => {
  const { base, close } = await startApp();
  try {
    const file = await upload(base, 'bacon.prn');
    const res = await fetch(`${base}/api/labels/${file.id}/convert`, json('POST', { remove: true }));
    assert.equal(res.status, 200);
    const { label, warnings } = await res.json();
    assert.deepEqual(warnings, []);
    assert.equal(label.kind, undefined);
    assert.equal(label.fields.name, 'BACON $69');
    assert.equal(label.fields.barcode, '209990069008');
    assert.equal((await fetch(`${base}/api/labels/${file.id}`)).status, 404);
    const list = await (await fetch(`${base}/api/labels`)).json();
    assert.equal(list.length, 1);
  } finally { close(); }
});

test('convert-all converts every file, removes originals, and reports', async () => {
  const { base, close } = await startApp();
  try {
    await upload(base, 'a.prn');
    await upload(base, 'b.prn');
    const normal = await (await fetch(`${base}/api/labels`, json('POST', { size: '3x5', fields: { name: 'Flour' } }))).json();
    const report = await (await fetch(`${base}/api/labels/convert-all`, { method: 'POST' })).json();
    assert.equal(report.converted.length, 2);
    assert.equal(report.failed.length, 0);
    const list = await (await fetch(`${base}/api/labels`)).json();
    assert.equal(list.length, 3);
    assert.ok(list.every((l) => l.kind !== 'prn'));
    assert.ok(list.some((l) => l.id === normal.id));
  } finally { close(); }
});

test('convert refuses normal labels', async () => {
  const { base, close } = await startApp();
  try {
    const normal = await (await fetch(`${base}/api/labels`, json('POST', { size: '3x5', fields: { name: 'Flour' } }))).json();
    assert.equal((await fetch(`${base}/api/labels/${normal.id}/convert`, json('POST', {}))).status, 400);
  } finally { close(); }
});
```

- [ ] **Step 2: Run** — expect 404s.

- [ ] **Step 3: Implement** in `src/app.js` — import `convertFileLabel` and add after the `/zpl` route:

```js
  function convertOne(label, remove) {
    const { draft, warnings } = convertFileLabel(label, {
      generateBarcode: () => generateUpcA((c) => store.barcodeExists(c, label.id)),
    });
    const normalized = normalizeDraft(draft);
    if (store.barcodeExists(normalized.fields.barcode, label.id)) {
      warnings.push(`barcode ${normalized.fields.barcode} already used by another label — replaced`);
      normalized.fields.barcode = generateUpcA((c) => store.barcodeExists(c));
    }
    const created = store.create(normalized);
    if (remove) store.remove(label.id);
    return { label: created, warnings };
  }

  app.post('/api/labels/convert-all', wrap((req, res) => {
    const converted = []; const failed = [];
    for (const label of store.list().filter((l) => l.kind === 'prn')) {
      try {
        const { label: created, warnings } = convertOne(label, true);
        converted.push({ id: created.id, name: created.fields.name, warnings });
      } catch (err) {
        failed.push({ id: label.id, name: label.fields.name, error: err.message });
      }
    }
    res.json({ converted, failed });
  }));

  app.post('/api/labels/:id/convert', wrap((req, res) => {
    const label = requireFileLabel(req.params.id);
    res.json(convertOne(label, Boolean(req.body?.remove)));
  }));
```

`store.barcodeExists(code, exceptId)` already accepts an `exceptId`. Register `convert-all` before `/:id/convert` so the literal path wins.

- [ ] **Step 4: Run** `node --test` — all green.

### Task 4: UI

**Files:**
- Modify: `public/api.js` — `convertFile: async (id) => (await call(`/api/labels/${id}/convert`, json('POST', { remove: true }))).json()`
- Modify: `public/app.js` — in `openFilePrint`, add `<button id="file-convert" class="quiet">Convert to app label</button>` as the first row above the existing buttons; handler:

```js
  overlay.querySelector('#file-convert').onclick = async () => {
    if (!confirm('Turn this file into a regular app label? The file entry is replaced by the new label.')) return;
    try {
      const { label: created, warnings } = await api.convertFile(label.id);
      close();
      if (warnings.length) showToast(warnings.join(' · '), true);
      navigate(`#/edit/${created.id}`);
    } catch (err) { showToast(err.message, true); }
  };
```

- Modify: `public/file-editor.js` — add `<button id="fe-convert" class="quiet" style="width:100%;margin-top:8px">Convert to app label</button>` after the Advanced button with the same handler (guard `dirty` → "Save first").

- [ ] **Step 1: Apply the edits, `node --check` the three files, restart the server, reload the browser with a cache-busting query.**
- [ ] **Step 2: Convert bacon from the print sheet; confirm the native editor opens with price and barcode in place; `GET /api/labels` shows no `bacon` file entry.**
- [ ] **Step 3: Run `POST /api/labels/convert-all` from the command line; report counts and warnings; spot-check drumsticks (5x3) in the browser.**

## Self-review

- Spec coverage: orientation/block (T1); mapping, name/extras/barcode/graphic/size/cap rules (T2); routes single + bulk with removal (T3); UI buttons (T4); bulk run (T4 step 3).
- Types: `convertFileLabel` returns `{ draft, warnings }` everywhere; routes return `{ label, warnings }` and `{ converted, failed }` as tested.
- Barcode uniqueness handled in `convertOne` since the file's UPC may already exist on another label.
