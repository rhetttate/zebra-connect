# Standalone Tablet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Android tablet by the printer runs the whole label app by itself: labels in IndexedDB, drawing and ZPL in the browser, printing straight over Web Bluetooth, AI drafts straight from the Anthropic API, hosted as a static site on GitHub Pages.

**Architecture:** The client's API module becomes a switch over two backends with identical method names: the existing fetch backend (Node server present) and a new local backend (static site). Server logic with no Node dependency moves under `public/shared/` so both sides import one copy; the `src/` files keep their names and re-export. A build script assembles `site/` from `public/`, injects the local-mode flag and a service worker, and a GitHub Actions workflow publishes it.

**Tech Stack:** Vanilla ES modules in the browser (no bundler), Node 24 + Express on the server, `node --test` for tests, `@napi-rs/canvas` in Node tests, Web Bluetooth, IndexedDB, service worker, GitHub Pages via Actions.

**Spec:** `docs/superpowers/specs/2026-09-12-standalone-tablet-design.md`

## Global Constraints

- Node 24 (`globalThis.crypto.randomUUID` and `getRandomValues` are available in Node and browsers; never import `node:crypto` in `public/`).
- Nothing under `public/` may import a Node builtin or anything from `src/`. `public/shared/` modules may only import each other.
- Client-side imports use relative paths (`./shared/x.js`), never `/shared/x.js`, so the site works under `/<repo>/` on GitHub Pages.
- Never name a file `prn.*`, `con.*`, `aux.*`, `nul.*`, `com1.*`, `lpt1.*` (Windows reserved names).
- Every existing test must keep passing after every task (`npm test`). The `src/` module names and exports used by existing tests stay valid via re-exports.
- Commit after every task with the message shown; end each commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Model id for the AI maker stays `claude-opus-5`; the browser call keeps `fallbacks: 'default'` with beta header `server-side-fallback-2026-07-01` and structured output via `output_config.format`.
- Working directory: `C:\Users\rober\zebra connect` (has a space; quote it in shell commands). Run tests with `npm test` from the repo root.

---

## File structure after this plan

```
public/
  shared/              moved from ./shared, plus new pure modules
    sizes.js barcode.js render-core.js snap.js     (existing, moved)
    draft.js           normalizeDraft, clampQuantity          (Task 2)
    layout.js          printRotation, defaultLayout, ...      (Task 3)
    zpl.js             ZPL builders                           (Task 3)
    printer-file.js    withQuantity                           (Task 3)
    bitmap.js          bitmapFromContext, rotateBitmap90CW    (Task 4)
    print-job.js       labelJobZpl(canvas, label, opts)       (Task 4)
    upc.js             generateUpcA                           (Task 5)
    ai-prompt.js       prompt, schema, parser, contentFromResponse (Task 6)
    ai-layout.js       layoutDraft, ROLE_ORDER                (Task 6)
    import.js          validateImport                         (Task 7)
  api.js               backend switch + `mode`                (Task 8)
  backend-remote.js    today's fetch calls                    (Task 8)
  local-store.js       IndexedDB label store                  (Task 9)
  local-config.js      localStorage settings                  (Task 9)
  station.js           Bluetooth link (+ sendToPrinter)       (Task 10)
  local-ai.js          direct Anthropic call                  (Task 11)
  backend-local.js     the tablet backend                     (Task 12)
  app.js settings.js editor.js file-editor.js  (local-mode guards, Task 13)
  sw.js sw-register.js                          (Task 15)
tools/build-site.mjs                            (Task 15)
.github/workflows/pages.yml                     (Task 16)
src/                 unchanged names; several files become re-exports
test/                one new test file per new module
```

---

### Task 1: Move `shared/` under `public/`

The client, the server and the tests all need to import the shared modules by a path that exists on disk and on the static site. Putting them under `public/shared/` makes `./shared/x.js` resolve everywhere and means the static site is simply `public/`. Side effect: `portable/make-portable.ps1` (which copies `src`, `public`, `node_modules`) starts shipping the shared modules it currently misses.

**Files:**
- Move: `shared/*.js` → `public/shared/*.js` (git mv)
- Modify: `src/layout.js`, `src/barcode.js`, `src/render.js`, `src/app.js:46`, `public/preview.js`, `public/editor.js`, `public/fullscreen.js`, `public/overlay.js`, `test/shared-modules.test.js`, `test/render.test.js`, `test/snap.test.js`, any other test importing `../shared/`

**Interfaces:**
- Produces: `public/shared/{sizes,barcode,render-core,snap}.js` at their new path; the `/shared/...` URL keeps working on the Node server because `express.static(public)` now serves it.

- [ ] **Step 1: Move the folder and find every import**

```bash
cd "C:/Users/rober/zebra connect"
git mv shared public/shared
grep -rn "shared/" src test public --include=*.js -l
```

- [ ] **Step 2: Repoint imports**

In every `src/*.js` and `test/*.js` file listed, replace `'../shared/` with `'../public/shared/`. In `src/render.js` the font path already points at `public/fonts`; leave it.

In `public/preview.js`, `public/editor.js`, `public/fullscreen.js`, `public/overlay.js` replace `'/shared/` with `'./shared/`.

In `src/app.js` delete the two lines:

```js
  // The phone draws its preview with the same modules the print path uses.
  app.use('/shared', express.static(path.join(here, '..', 'shared')));
```

(`express.static(public)` on the line above now serves `/shared/...`.)

- [ ] **Step 3: Verify nothing still points at the old path**

```bash
grep -rn "'\.\./shared/\|'/shared/" src test public --include=*.js
```

Expected: no output.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass (same count as before the move).

- [ ] **Step 5: Start the server and load the editor once**

Run: `npm start` in the background, open `http://localhost:3000/#/new` in the Browser pane, pick "3 × 2". Expected: the preview canvas draws (no 404 for `shared/sizes.js` in the console). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: shared modules live under public/ so the static site and the server serve one copy

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `public/shared/draft.js` — draft validation shared by server and tablet

**Files:**
- Create: `public/shared/draft.js`
- Modify: `src/app.js:48-101` (delete `ROTATIONS`, `EXTRA_ROLES`, `validateBox`, `validateRotation`, `normalizeDraft`; import instead)
- Test: `test/shared-draft.test.js`

**Interfaces:**
- Produces: `normalizeDraft(draft) → label` (throws `Error` with `.status = 400` on bad input, same messages as today), `clampQuantity(q) → 1..100`.
- Consumes: `defaultLayout`, `defaultShowDescription` — until Task 3 lands these come from `./layout.js` which does not exist yet under `public/shared`. **Do Task 3 first, or create `public/shared/layout.js` in this task by following Task 3 Step 2.** (Recommended order: Task 3, then Task 2.)

- [ ] **Step 1: Write the failing test**

```js
// test/shared-draft.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraft, clampQuantity } from '../public/shared/draft.js';
import { defaultLayout } from '../public/shared/layout.js';

test('normalizeDraft fills defaults for a bare draft', () => {
  const label = normalizeDraft({ size: '3x2', fields: { name: 'Flour' } });
  assert.equal(label.fields.name, 'Flour');
  assert.equal(label.fields.description, '');
  assert.equal(label.fields.barcode, '');
  assert.equal(label.options.showDescription, false);
  assert.deepEqual(label.layout.name, defaultLayout('3x2').name);
  assert.deepEqual(label.extras, []);
});

test('normalizeDraft rejects unknown sizes, bad barcodes, bad boxes and bad rotations', () => {
  assert.throws(() => normalizeDraft({ size: '9x9' }), /unknown size/);
  assert.throws(() => normalizeDraft({ size: '3x2', fields: { barcode: '123' } }), /valid 12-digit UPC-A/);
  const bad = { size: '3x2', layout: { ...defaultLayout('3x2'), name: { x: 1, y: 'no', w: 3, h: 4 } } };
  assert.throws(() => normalizeDraft(bad), /invalid layout box for name/);
  const rot = { size: '3x2', layout: { ...defaultLayout('3x2'), name: { x: 1, y: 2, w: 3, h: 4, rotation: 45 } } };
  assert.throws(() => normalizeDraft(rot), /invalid rotation for name/);
  try { normalizeDraft({ size: '9x9' }); } catch (err) { assert.equal(err.status, 400); }
});

test('normalizeDraft keeps extra ids, clips extras to 20, validates images', () => {
  const extras = Array.from({ length: 25 }, (_, i) => ({ id: `e${i}`, text: `t${i}`, box: { x: 0, y: 0, w: 10, h: 10 } }));
  const label = normalizeDraft({ size: '3x5', extras });
  assert.equal(label.extras.length, 20);
  assert.equal(label.extras[0].id, 'e0');
  const noId = normalizeDraft({ size: '3x5', extras: [{ text: 'x', box: { x: 0, y: 0, w: 1, h: 1 } }] });
  assert.match(noId.extras[0].id, /^[0-9a-f-]{36}$/);
  assert.throws(() => normalizeDraft({ size: '3x5', extras: [{ kind: 'image', image: 'nope', box: { x: 0, y: 0, w: 1, h: 1 } }] }), /invalid image field/);
});

test('clampQuantity clamps to 1..100 and defaults to 1', () => {
  assert.equal(clampQuantity('7'), 7);
  assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(500), 100);
  assert.equal(clampQuantity('x'), 1);
  assert.equal(clampQuantity(undefined), 1);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/shared-draft.test.js`
Expected: FAIL — cannot find module `public/shared/draft.js`.

- [ ] **Step 3: Create the module** (the body is `normalizeDraft` from `src/app.js` verbatim, minus the `express`/`crypto` dependencies)

```js
// public/shared/draft.js
// Turns whatever a client sends into a label the drawing code can trust.
// Runs on the server (every write route) and on the tablet (local backend),
// so the two can never accept different shapes. No Node imports.
import { SIZES } from './sizes.js';
import { defaultLayout, defaultShowDescription } from './layout.js';
import { validateUpcA } from './barcode.js';

const ROTATIONS = [0, 90, 180, 270];
const EXTRA_ROLES = ['lot', 'best_by', 'packed_on', 'allergens', 'net', 'note', 'ingredients'];

const bad = (message) => Object.assign(new Error(message), { status: 400 });

function validateBox(box, what) {
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) {
    throw bad(`invalid layout box for ${what}`);
  }
}

function validateRotation(rotation, what) {
  if (!ROTATIONS.includes(rotation)) {
    throw bad(`invalid rotation for ${what} — use 0, 90, 180, or 270`);
  }
}

export function clampQuantity(quantity) {
  return Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 100);
}

export function normalizeDraft(draft) {
  if (!draft || !SIZES[draft.size]) throw bad('unknown size');
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
    extras: (Array.isArray(draft.extras) ? draft.extras : []).slice(0, 20).map((extra) => {
      const isImage = extra.kind === 'image';
      const out = {
        id: typeof extra.id === 'string' && extra.id ? extra.id : globalThis.crypto.randomUUID(),
        text: isImage ? '' : String(extra.text ?? ''),
        box: extra.box,
        rotation: extra.rotation ?? 0,
      };
      if (isImage) {
        // Only a PNG data URL of sane size may be stored; nothing else is drawn.
        if (typeof extra.image !== 'string' || extra.image.length > 400_000
          || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(extra.image)) {
          throw bad('invalid image field');
        }
        out.kind = 'image';
        out.image = extra.image;
      }
      if (extra.fit) out.fit = true;
      if (EXTRA_ROLES.includes(extra.role)) out.role = extra.role;
      if (extra.bold) out.bold = true;
      if (['L', 'C', 'R'].includes(extra.align)) out.align = extra.align;
      const stretch = Number(extra.stretch);
      if (Number.isFinite(stretch) && stretch >= 0.2 && stretch <= 3) out.stretch = stretch;
      const textSize = Number(extra.textSize);
      if (Number.isFinite(textSize) && textSize >= 8 && textSize <= 400) out.textSize = Math.round(textSize);
      return out;
    }),
  };
  if (label.fields.barcode && !validateUpcA(label.fields.barcode)) {
    throw bad('barcode must be a valid 12-digit UPC-A');
  }
  for (const key of ['name', 'description', 'barcode']) {
    const b = label.layout?.[key];
    validateBox(b, key);
    b.rotation = b.rotation ?? 0;
    validateRotation(b.rotation, key);
    const textSize = Number(b.textSize);
    if (key !== 'barcode' && Number.isFinite(textSize) && textSize >= 8 && textSize <= 400) b.textSize = Math.round(textSize);
    else delete b.textSize;
  }
  for (const extra of label.extras) {
    validateBox(extra.box, 'extra field');
    validateRotation(extra.rotation, 'extra field');
  }
  return label;
}
```

Compare line by line against `src/app.js` `normalizeDraft` before deleting the original: the only intended differences are `globalThis.crypto.randomUUID()` instead of `crypto.randomUUID()` and the `bad()` helper.

- [ ] **Step 4: Point the server at it**

In `src/app.js`: delete `ROTATIONS`, `EXTRA_ROLES`, `validateBox`, `validateRotation` and `normalizeDraft` (lines 48–101), delete `import crypto from 'node:crypto';` if nothing else in the file uses it (grep `crypto.` first), and add:

```js
import { normalizeDraft, clampQuantity } from '../public/shared/draft.js';
```

In `/api/print` replace `const quantity = Math.min(Math.max(parseInt(req.body.quantity, 10) || 1, 1), 100);` with `const quantity = clampQuantity(req.body.quantity);`.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS, including the new file and `test/app.test.js`.

- [ ] **Step 6: Commit**

```bash
git add public/shared/draft.js src/app.js test/shared-draft.test.js
git commit -m "refactor: draft validation moves to public/shared so the tablet can run it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Move layout, ZPL and `withQuantity` to `public/shared/`

**Files:**
- Create: `public/shared/layout.js`, `public/shared/zpl.js`, `public/shared/printer-file.js`
- Modify: `src/layout.js`, `src/zpl.js`, `src/printer-file.js` (become re-exports / thin wrappers)
- Test: `test/shared-modules.test.js` (add assertions)

**Interfaces:**
- Produces: `public/shared/layout.js` exports `SIZES`, `barcodeGeometry`, `printRotation(size)`, `defaultLayout(size)`, `defaultShowDescription(size)`; `public/shared/zpl.js` exports `encodeGfa`, `buildLabelZpl`, `buildTestZpl`, `setZplModeCommand`, `buildCalibrationZpl`; `public/shared/printer-file.js` exports `withQuantity(zpl, quantity)`.

- [ ] **Step 1: Add failing assertions to `test/shared-modules.test.js`**

```js
import * as sharedLayout from '../public/shared/layout.js';
import * as sharedZpl from '../public/shared/zpl.js';
import { withQuantity } from '../public/shared/printer-file.js';
import * as srcZpl from '../src/zpl.js';
import * as srcPrinterFile from '../src/printer-file.js';

test('src layout, zpl and printer-file re-export the shared implementations', () => {
  assert.equal(srcLayout.printRotation, sharedLayout.printRotation);
  assert.equal(srcLayout.defaultLayout, sharedLayout.defaultLayout);
  assert.equal(srcZpl.buildLabelZpl, sharedZpl.buildLabelZpl);
  assert.equal(srcZpl.buildCalibrationZpl, sharedZpl.buildCalibrationZpl);
  assert.equal(srcPrinterFile.withQuantity, withQuantity);
  assert.equal(withQuantity('^XA^XZ', 3), '^XA^PQ3^XZ');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/shared-modules.test.js`
Expected: FAIL — cannot find `public/shared/layout.js`.

- [ ] **Step 3: Create the shared modules**

`public/shared/layout.js`: the whole of today's `src/layout.js` with the first three lines replaced by:

```js
import { SIZES } from './sizes.js';
export { SIZES };
export { barcodeGeometry } from './barcode.js';
```

`public/shared/zpl.js`: the whole of today's `src/zpl.js`, unchanged (it has no imports).

`public/shared/printer-file.js`:

```js
// Quantity handling for finished printer files (.prn). The file is a complete
// ZPL job; only ^PQ is touched. Shared by the server and the tablet.
export function withQuantity(zpl, quantity) {
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 100);
  if (qty === 1) return zpl;
  if (/\^PQ\d+/.test(zpl)) return zpl.replace(/\^PQ\d+/, `^PQ${qty}`);
  const end = zpl.lastIndexOf('^XZ');
  return end === -1 ? `${zpl}^PQ${qty}` : `${zpl.slice(0, end)}^PQ${qty}${zpl.slice(end)}`;
}
```

- [ ] **Step 4: Turn the src files into re-exports**

`src/layout.js` becomes exactly:

```js
export * from '../public/shared/layout.js';
```

`src/zpl.js` becomes exactly:

```js
export * from '../public/shared/zpl.js';
```

`src/printer-file.js`: delete its `withQuantity` function and add at the top:

```js
export { withQuantity } from '../public/shared/printer-file.js';
```

Keep `parsePrn`, `textOf`, `sizeFor` as they are (they need `node:path` / `Buffer`). Its `import { SIZES } from './layout.js';` keeps working.

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS (`test/layout.test.js`, `test/zpl.test.js`, `test/printer-file.test.js` exercise the re-exports).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: layout, ZPL builders and withQuantity move to public/shared

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `public/shared/bitmap.js` and `public/shared/print-job.js` — the print path in the browser

**Files:**
- Create: `public/shared/bitmap.js`, `public/shared/print-job.js`
- Modify: `src/render.js` (use `bitmapFromContext`, re-export `rotateBitmap90CW`)
- Test: `test/shared-print-job.test.js`

**Interfaces:**
- Produces: `bitmapFromContext(ctx, width, height) → { data: Uint8Array, bytesPerRow, width, height }`; `rotateBitmap90CW(bitmap)`; `labelJobZpl(canvas, label, { quantity, darkness, loadImage }) → Promise<string>` (draws the label on `canvas`, sized to the label, and returns the complete ZPL job, rotated for 5×3).
- Consumes: `drawLabel` from `render-core.js`, `printRotation` from `layout.js`, `buildLabelZpl` from `zpl.js`, `SIZES`.

- [ ] **Step 1: Write the failing test**

```js
// test/shared-print-job.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { labelJobZpl } from '../public/shared/print-job.js';
import { bitmapFromContext, rotateBitmap90CW } from '../public/shared/bitmap.js';
import { renderPrintBitmap, rotateBitmap90CW as srcRotate } from '../src/render.js';
import { buildLabelZpl } from '../src/zpl.js';
import { defaultLayout, printRotation } from '../src/layout.js';

const label = (size) => ({
  size,
  fields: { name: 'Sugar', description: 'Granulated', barcode: '036000291452' },
  options: { showDescription: true },
  layout: defaultLayout(size),
  extras: [{ id: 'e1', text: 'Lot 42', box: { x: 30, y: 300, w: 200, h: 60 }, rotation: 0 }],
});

// The server route composes renderPrintBitmap + rotate + buildLabelZpl; the
// tablet calls labelJobZpl. Both must produce the same bytes.
async function serverZpl(l, quantity, darkness) {
  let bitmap = await renderPrintBitmap(l, { includeBarcode: true });
  if (printRotation(l.size) === 90) bitmap = srcRotate(bitmap);
  return buildLabelZpl({ width: bitmap.width, height: bitmap.height, bitmap, quantity, darkness });
}

for (const size of ['3x2', '3x5']) {
  test(`labelJobZpl matches the server print path for ${size}`, async () => {
    const l = label(size);
    const expected = await serverZpl(l, 2, 12);
    const actual = await labelJobZpl(createCanvas(1, 1), l, { quantity: 2, darkness: 12, loadImage });
    assert.equal(actual, expected);
    assert.ok(actual.includes('^PQ2'));
    assert.ok(actual.startsWith('~SD12'));
  });
}

test('rotateBitmap90CW is the same function the server uses and bitmapFromContext packs 1bpp', () => {
  assert.equal(rotateBitmap90CW, srcRotate);
  const canvas = createCanvas(16, 1);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 16, 1);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 1);
  const bmp = bitmapFromContext(ctx, 16, 1);
  assert.deepEqual([...bmp.data], [0xff, 0x00]);
  assert.equal(bmp.bytesPerRow, 2);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/shared-print-job.test.js`
Expected: FAIL — cannot find `public/shared/print-job.js`.

- [ ] **Step 3: Create `public/shared/bitmap.js`** (pixel loop and rotation lifted from `src/render.js`)

```js
// public/shared/bitmap.js
// 1-bit-per-pixel packing of a drawn label, as the printer wants it. Works on
// any canvas 2D context (browser or @napi-rs/canvas). No Node imports.

// Luminance under 128 is a black dot; bit 7 of each byte is the leftmost pixel.
export function bitmapFromContext(ctx, width, height) {
  const rgba = ctx.getImageData(0, 0, width, height).data;
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

- [ ] **Step 4: Create `public/shared/print-job.js`**

```js
// public/shared/print-job.js
// Everything between "a label" and "the bytes the printer receives": draw at
// dot resolution, pack to 1bpp, rotate the landscape 5x3 onto the 3-inch
// head, wrap in ZPL. The server and the tablet both call this.
import { SIZES } from './sizes.js';
import { drawLabel } from './render-core.js';
import { bitmapFromContext, rotateBitmap90CW } from './bitmap.js';
import { printRotation } from './layout.js';
import { buildLabelZpl } from './zpl.js';

export async function labelJobZpl(canvas, label, { quantity = 1, darkness = null, loadImage } = {}) {
  const dims = SIZES[label.size];
  if (!dims) throw new Error('unknown size');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  // Everything, barcode included, is drawn into one bitmap so the print is
  // exactly what the preview showed.
  await drawLabel(ctx, label, { includeBarcode: true, loadImage });
  let bitmap = bitmapFromContext(ctx, dims.width, dims.height);
  if (printRotation(label.size) === 90) bitmap = rotateBitmap90CW(bitmap);
  return buildLabelZpl({ width: bitmap.width, height: bitmap.height, bitmap, quantity, darkness });
}
```

- [ ] **Step 5: Make `src/render.js` use the shared bitmap code**

Replace the body of `renderPrintBitmap` and delete its local `rotateBitmap90CW`:

```js
import { bitmapFromContext, rotateBitmap90CW } from '../public/shared/bitmap.js';
export { rotateBitmap90CW };

export async function renderPrintBitmap(label, { includeBarcode = false } = {}) {
  const canvas = await renderCanvas(label, { includeBarcode });
  return bitmapFromContext(canvas.getContext('2d'), canvas.width, canvas.height);
}
```

(Keep `renderCanvas`, `renderPreview`, the font registration and `fontFamily` as they are; drop the now-unused imports if any.)

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS, including `test/render.test.js` and the new parity test for both sizes.

- [ ] **Step 7: Commit**

```bash
git add public/shared/bitmap.js public/shared/print-job.js src/render.js test/shared-print-job.test.js
git commit -m "feat: shared print job builder — bitmap packing and ZPL usable in the browser

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `public/shared/upc.js` — barcode generation without `node:crypto`

**Files:**
- Create: `public/shared/upc.js`
- Modify: `src/barcode.js` (re-export)
- Test: `test/shared-upc.test.js`

**Interfaces:**
- Produces: `generateUpcA(isTaken: (code) => boolean) → string` (12 digits, valid check digit, retries up to 1000 times).

- [ ] **Step 1: Write the failing test**

```js
// test/shared-upc.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateUpcA } from '../public/shared/upc.js';
import { validateUpcA } from '../public/shared/barcode.js';
import * as srcBarcode from '../src/barcode.js';

test('generateUpcA returns a valid 12-digit code that is not taken', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const code = generateUpcA((c) => seen.has(c));
    assert.match(code, /^\d{12}$/);
    assert.ok(validateUpcA(code));
    seen.add(code);
  }
  assert.equal(seen.size, 50);
});

test('generateUpcA gives up when everything is taken; src re-exports it', () => {
  assert.throws(() => generateUpcA(() => true), /could not generate/);
  assert.equal(srcBarcode.generateUpcA, generateUpcA);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/shared-upc.test.js`
Expected: FAIL — cannot find `public/shared/upc.js`.

- [ ] **Step 3: Create the module**

```js
// public/shared/upc.js
// Random UPC-A codes for new labels. globalThis.crypto exists in Node 19+ and
// every browser, so this runs unchanged on the server and the tablet.
import { upcCheckDigit } from './barcode.js';

function randomDigit() {
  const buf = new Uint8Array(1);
  // Reject values that would bias the digit (250..255).
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < 250) return buf[0] % 10;
  }
}

export function generateUpcA(isTaken) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let d11 = '';
    for (let i = 0; i < 11; i++) d11 += randomDigit();
    const code = d11 + upcCheckDigit(d11);
    if (!isTaken(code)) return code;
  }
  throw new Error('could not generate a unique barcode');
}
```

- [ ] **Step 4: Make `src/barcode.js` a re-export**

```js
// src/barcode.js
export { upcCheckDigit, validateUpcA, encodeUpcAModules, barcodeGeometry } from '../public/shared/barcode.js';
export { generateUpcA } from '../public/shared/upc.js';
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/shared/upc.js src/barcode.js test/shared-upc.test.js
git commit -m "refactor: UPC generation moves to public/shared using WebCrypto

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `public/shared/ai-prompt.js` and `public/shared/ai-layout.js`

**Files:**
- Create: `public/shared/ai-prompt.js`, `public/shared/ai-layout.js`
- Modify: `src/ai-label.js` (keeps only the SDK transport), `src/ai-layout.js` (re-export)
- Test: `test/shared-ai-prompt.test.js`; existing `test/ai-label.test.js` and `test/ai-layout.test.js` keep passing

**Interfaces:**
- Produces from `ai-prompt.js`: `MODEL`, `CONTENT_SCHEMA`, `buildPrompt({ size, text, image, today, examples })`, `parseContent(raw)`, `houseExamples(labels, limit)`, and new `contentFromResponse(response)` — takes a Messages API response object (`stop_reason`, `content[]`) and returns parsed content or throws `label maker refused this input` / `could not parse label content`.
- Produces from `ai-layout.js`: `ROLE_ORDER`, `layoutDraft({ size, content })`.
- `src/ai-label.js` keeps exporting everything it exports today (tests import `buildPrompt, parseContent, makeLabelContent, houseExamples, CONTENT_SCHEMA, MODEL` from it).

- [ ] **Step 1: Write the failing test**

```js
// test/shared-ai-prompt.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { contentFromResponse, buildPrompt, MODEL } from '../public/shared/ai-prompt.js';
import { layoutDraft, ROLE_ORDER } from '../public/shared/ai-layout.js';
import * as srcAi from '../src/ai-label.js';
import * as srcLayout from '../src/ai-layout.js';

const good = { name: 'Almond Flour', description: 'Blanched.', ingredients: 'Almonds.', extras: [{ role: 'lot', text: 'Lot 42' }], warning: '' };

test('contentFromResponse parses bare JSON and JSON wrapped in prose', () => {
  const bare = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(good) }] };
  assert.equal(contentFromResponse(bare).name, 'Almond Flour');
  const wrapped = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here you go:\n```json\n' + JSON.stringify(good) + '\n```' }] };
  assert.deepEqual(contentFromResponse(wrapped).extras, [{ role: 'lot', text: 'Lot 42' }]);
});

test('contentFromResponse surfaces refusals and garbage', () => {
  assert.throws(() => contentFromResponse({ stop_reason: 'refusal', content: [] }), /refused/);
  assert.throws(() => contentFromResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'no json here' }] }), /could not parse/);
});

test('src modules re-export the shared AI pieces', () => {
  assert.equal(srcAi.buildPrompt, buildPrompt);
  assert.equal(srcAi.MODEL, MODEL);
  assert.equal(srcLayout.layoutDraft, layoutDraft);
  assert.deepEqual(ROLE_ORDER, ['lot', 'best_by', 'packed_on', 'allergens', 'net', 'note']);
  const draft = layoutDraft({ size: '3x2', content: good });
  assert.match(draft.extras[0].id, /^[0-9a-f-]{36}$/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/shared-ai-prompt.test.js`
Expected: FAIL — cannot find `public/shared/ai-prompt.js`.

- [ ] **Step 3: Create `public/shared/ai-layout.js`**

Copy today's `src/ai-layout.js` in full, then change the first two lines to:

```js
import { SIZES, defaultLayout } from './layout.js';
```

and replace both occurrences of `crypto.randomUUID()` with `globalThis.crypto.randomUUID()`. Replace `src/ai-layout.js` with:

```js
export * from '../public/shared/ai-layout.js';
```

- [ ] **Step 4: Create `public/shared/ai-prompt.js`**

Copy from `src/ai-label.js`: `MODEL`, `CONTENT_SCHEMA`, `SIZE_WORDS`, `RULES`, `buildPrompt`, `NOTE_LIMIT`, `clip`, `parseContent`, `houseExamples` — unchanged — with the import line `import { ROLE_ORDER } from './ai-layout.js';`. Then add the response handling that today sits inside `makeLabelContent`:

```js
// The API's structured output normally gives bare JSON; the regex is only a
// net for a reply wrapped in prose or a code fence.
export function contentFromResponse(response) {
  if (response?.stop_reason === 'refusal') throw new Error('label maker refused this input');
  const textOut = (response?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    const match = textOut.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('could not parse label content');
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error('could not parse label content');
    }
  }
  return parseContent(parsed);
}
```

- [ ] **Step 5: Slim `src/ai-label.js` to the SDK transport**

```js
// src/ai-label.js
import Anthropic from '@anthropic-ai/sdk';
import { MODEL, CONTENT_SCHEMA, buildPrompt, contentFromResponse } from '../public/shared/ai-prompt.js';

export { MODEL, CONTENT_SCHEMA, buildPrompt, parseContent, houseExamples, contentFromResponse } from '../public/shared/ai-prompt.js';

export function makeClient(apiKey) {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

export async function makeLabelContent({ size, text, image }, client, { today = new Date(), examples = [] } = {}) {
  const { system, messages } = buildPrompt({ size, text, image, today, examples });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
    output_config: { format: { type: 'json_schema', schema: CONTENT_SCHEMA } },
  });
  return contentFromResponse(response);
}
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS (`test/ai-label.test.js` and `test/ai-layout.test.js` unchanged and green).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: AI prompt, parser and layout engine move to public/shared

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Export and import labels (server + remote API + Settings UI)

**Files:**
- Create: `public/shared/import.js`
- Modify: `src/store.js` (add `importLabels`), `src/app.js` (routes + body-limit bypass), `public/api.js` (two methods; still the flat object until Task 8), `public/settings.js` (two buttons)
- Test: `test/shared-import.test.js`, `test/store.test.js` (add), `test/app.test.js` (add)

**Interfaces:**
- Produces: `validateImport(json) → label[]` (throws with a plain message on bad shape); `store.importLabels(labels) → { added, skipped }`; `GET /api/labels/export` → `label[]`; `POST /api/labels/import` body `label[]` → `{ added, skipped }`; `api.exportLabels()`, `api.importLabels(labels)`.

- [ ] **Step 1: Write the failing tests**

```js
// test/shared-import.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImport } from '../public/shared/import.js';

const ok = { id: 'a1', size: '3x2', fields: { name: 'X', barcode: '036000291452' }, layout: {}, createdAt: 't', updatedAt: 't' };

test('validateImport accepts an array of labels and printer files', () => {
  const prn = { id: 'p1', kind: 'prn', size: null, fields: { name: 'F', barcode: '' }, zpl: '^XA^XZ' };
  assert.deepEqual(validateImport([ok, prn]), [ok, prn]);
});

test('validateImport rejects non-arrays and malformed items with a reason', () => {
  assert.throws(() => validateImport({ labels: [] }), /list of labels/);
  assert.throws(() => validateImport([{ ...ok, id: 7 }]), /id/);
  assert.throws(() => validateImport([{ ...ok, size: '9x9' }]), /size/);
  assert.throws(() => validateImport([{ ...ok, fields: null }]), /fields/);
  assert.throws(() => validateImport([{ ...ok, layout: undefined }]), /layout/);
  assert.throws(() => validateImport('[]'), /list of labels/);
});
```

Add to `test/store.test.js`:

```js
test('importLabels adds labels whose id is new and skips the rest', () => {
  const { store } = tmpStore();
  const a = store.create(sample());
  const incoming = [
    { ...a, fields: { ...a.fields, name: 'Changed' } },
    { id: 'imported-1', size: '3x2', fields: { name: 'B', description: '', barcode: '036000291452' }, options: {}, layout: {}, extras: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  assert.deepEqual(store.importLabels(incoming), { added: 1, skipped: 1 });
  assert.equal(store.get(a.id).fields.name, 'Flour', 'existing label untouched');
  assert.equal(store.get('imported-1').fields.barcode, '036000291452', 'shared barcodes allowed on import');
  assert.equal(store.list().length, 2);
});
```

Add to `test/app.test.js`:

```js
test('labels export and import round trip', async () => {
  const { base, close } = await startApp();
  await fetch(`${base}/api/labels`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: '3x2', fields: { name: 'Flour' } }),
  });
  const exported = await (await fetch(`${base}/api/labels/export`)).json();
  assert.equal(exported.length, 1);
  const again = await (await fetch(`${base}/api/labels/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(exported),
  })).json();
  assert.deepEqual(again, { added: 0, skipped: 1 });
  const bad = await fetch(`${base}/api/labels/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nope: true }),
  });
  assert.equal(bad.status, 400);
  close();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/shared-import.test.js test/store.test.js test/app.test.js`
Expected: FAIL (missing module; `importLabels` not a function; 404 on export).

- [ ] **Step 3: Create `public/shared/import.js`**

```js
// public/shared/import.js
// Shape check for a labels backup file before it is merged into a store.
// Returns the same array; throws a plain-English reason otherwise.
import { SIZES } from './sizes.js';

export function validateImport(json) {
  if (!Array.isArray(json)) throw new Error('this file is not a list of labels');
  json.forEach((l, i) => {
    const at = `label ${i + 1}`;
    if (!l || typeof l !== 'object') throw new Error(`${at} is not an object`);
    if (typeof l.id !== 'string' || !l.id) throw new Error(`${at} has no id`);
    if (!l.fields || typeof l.fields !== 'object') throw new Error(`${at} has no fields`);
    if (l.kind === 'prn') {
      if (typeof l.zpl !== 'string') throw new Error(`${at} is a printer file without ZPL`);
      if (l.size !== null && l.size !== undefined && !SIZES[l.size]) throw new Error(`${at} has an unknown size`);
      return;
    }
    if (!SIZES[l.size]) throw new Error(`${at} has an unknown size`);
    if (!l.layout || typeof l.layout !== 'object') throw new Error(`${at} has no layout`);
  });
  return json;
}
```

- [ ] **Step 4: Add `importLabels` to `src/store.js`**

Inside the returned object, after `remove`:

```js
    // Backup restore / carrying labels to another device: labels whose id is
    // already here are left alone (no merge), everything else is added as-is,
    // barcodes included — a backup may legitimately share codes.
    importLabels(incoming) {
      let added = 0;
      let skipped = 0;
      for (const label of incoming) {
        if (labels.some((l) => l.id === label.id)) { skipped++; continue; }
        labels.push(structuredClone(label));
        added++;
      }
      if (added) save();
      return { added, skipped };
    },
```

- [ ] **Step 5: Routes in `src/app.js`**

Change the body-parser bypass so the import route parses its own (larger) body:

```js
  // The AI label maker posts a base64 photo and a backup import posts the
  // whole library — far over 1 MB; those routes parse their own bodies.
  const AI_LABEL_PATH = '/api/ai-label';
  const IMPORT_PATH = '/api/labels/import';
  const jsonBody = express.json({ limit: '1mb' });
  app.use((req, res, next) => ([AI_LABEL_PATH, IMPORT_PATH].includes(req.path) ? next() : jsonBody(req, res, next)));
```

Add the import at the top: `import { validateImport } from '../public/shared/import.js';`

Add the routes **before** `app.get('/api/labels/:id', ...)` (otherwise `export` would be read as an id):

```js
  app.get('/api/labels/export', wrap((req, res) => res.json(store.list())));

  app.post(IMPORT_PATH, express.json({ limit: '30mb' }), wrap((req, res) => {
    let labels;
    try {
      labels = validateImport(req.body);
    } catch (err) {
      throw Object.assign(err, { status: 400 });
    }
    res.json(store.importLabels(labels));
  }));
```

- [ ] **Step 6: Client API methods and Settings buttons**

In `public/api.js` add to the `api` object:

```js
  exportLabels: async () => (await call('/api/labels/export')).json(),
  importLabels: async (labels) => (await call('/api/labels/import', json('POST', labels))).json(),
```

In `public/settings.js`, after the "Fix printer language" hint paragraph inside the template, add:

```html
    <label class="field">Backup</label>
    <div class="row">
      <button id="s-export" class="quiet">${icon('file')} Export labels</button>
      <button id="s-import" class="quiet">${icon('file')} Import labels</button>
    </div>
    <p class="hint" id="s-backup-hint">Export downloads every label as one file. Import adds the labels from such a file that are not already here.</p>
    <input id="s-import-input" type="file" accept=".json,application/json" hidden>
```

and after the `#s-zpl` handler:

```js
  container.querySelector('#s-export').onclick = async () => {
    try {
      const labels = await api.exportLabels();
      const blob = new Blob([JSON.stringify(labels, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `labels-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      showToast(`Exported ${labels.length} labels`);
    } catch (err) { showToast(err.message, true); }
  };
  const importInput = container.querySelector('#s-import-input');
  container.querySelector('#s-import').onclick = () => { importInput.value = ''; importInput.click(); };
  importInput.onchange = async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const result = await api.importLabels(json);
      let msg = `Imported ${result.added} labels (${result.skipped} already here)`;
      if (result.skippedFiles) msg += ` · ${result.skippedFiles} printer files can't be used on this device`;
      showToast(msg);
    } catch (err) { showToast(`Import failed: ${err.message}`, true); }
  };
```

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Try it in the browser**

Run `npm start`, open `http://localhost:3000/#/settings` in the Browser pane, click **Export labels** — a `labels-2026-09-12.json` download starts. Stop the server.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: export and import the label library as a JSON backup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Backend switch — `public/api.js` chooses remote or local

**Files:**
- Create: `public/backend-remote.js`
- Modify: `public/api.js`
- Test: `test/backend-select.test.js`

**Interfaces:**
- Produces: `api` with `.mode` (`'remote'` | `'local'`) and `.init() → Promise<void>`; the selection reads `globalThis.ZC_BACKEND === 'local'` at module load.
- Consumes: `public/backend-local.js` exporting `local` (Task 12). Until Task 12 exists, `api.js` imports a stub file created here.

- [ ] **Step 1: Write the failing test**

```js
// test/backend-select.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

// Fresh module instances per case: the choice is made once at import time.
async function load(flag) {
  if (flag) globalThis.ZC_BACKEND = flag; else delete globalThis.ZC_BACKEND;
  const { api } = await import(`../public/api.js?case=${flag ?? 'none'}`);
  return api;
}

test('api is the remote backend unless the page declares local', async () => {
  const remote = await load(undefined);
  assert.equal(remote.mode, 'remote');
  assert.equal(typeof remote.listLabels, 'function');
  assert.equal(typeof remote.exportLabels, 'function');
  await remote.init();
});

test('api is the local backend when the page declares local', async () => {
  const local = await load('local');
  assert.equal(local.mode, 'local');
  assert.equal(typeof local.listLabels, 'function');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/backend-select.test.js`
Expected: FAIL — `api.mode` is undefined.

- [ ] **Step 3: Move today's fetch code into `public/backend-remote.js`**

The whole current content of `public/api.js` (the `call` helper, `json` helper and the object) goes into `public/backend-remote.js`, with the object renamed and two fields added:

```js
export const remote = {
  mode: 'remote',
  init: async () => {},
  listLabels: ...   // every method exactly as today, including exportLabels / importLabels
};
```

- [ ] **Step 4: Stub `public/backend-local.js`** (replaced in Task 12)

```js
// public/backend-local.js — filled in by the local backend task.
export const local = { mode: 'local', init: async () => {}, listLabels: async () => [] };
```

- [ ] **Step 5: Rewrite `public/api.js`**

```js
// public/api.js
// One name for "whatever does the work". The static site sets
// window.ZC_BACKEND = 'local' before this module loads (see tools/build-site.mjs);
// the Node server serves the untouched index.html, so there it is undefined.
import { remote } from './backend-remote.js';
import { local } from './backend-local.js';

export const api = globalThis.ZC_BACKEND === 'local' ? local : remote;
```

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/api.js public/backend-remote.js public/backend-local.js test/backend-select.test.js
git commit -m "refactor: api.js becomes a switch between the remote and local backends

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `public/local-store.js` and `public/local-config.js`

**Files:**
- Create: `public/local-store.js`, `public/local-config.js`
- Test: `test/local-store.test.js`, `test/local-config.test.js`

**Interfaces:**
- Produces: `createLocalStore(adapter) → Promise<store>` where `adapter = { getAll(): Promise<label[]>, put(label): Promise<void>, delete(id): Promise<void> }`; `indexedDbAdapter()` (browser only, opens lazily). Store methods: `list()`, `get(id)`, `barcodeExists(code, exceptId)` (sync, from an in-memory copy), `create(data, { allowDuplicateBarcode }) → Promise<label>`, `update(id, patch) → Promise<label>`, `remove(id) → Promise<void>`, `importLabels(labels) → Promise<{ added, skipped }>`. Same rules as `src/store.js`.
- Produces: `createLocalConfig(storage) → { get(), update(patch) }` with the same keys/defaults as `src/config.js` minus `printerIp`/`connection`; `storage` is any object with `getItem(key)`/`setItem(key, value)` (localStorage in the browser).

- [ ] **Step 1: Write the failing tests**

```js
// test/local-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../public/local-store.js';

function memoryAdapter(seed = []) {
  const rows = new Map(seed.map((l) => [l.id, structuredClone(l)]));
  return {
    rows,
    getAll: async () => [...rows.values()].map((l) => structuredClone(l)),
    put: async (l) => { rows.set(l.id, structuredClone(l)); },
    delete: async (id) => { rows.delete(id); },
  };
}

const sample = (barcode = '036000291452') => ({
  size: '3x5',
  fields: { name: 'Flour', description: 'All purpose', barcode },
  options: { showDescription: true },
  layout: { name: { x: 20, y: 20, w: 536, h: 120 } },
});

test('create assigns id and timestamps and writes through to the adapter', async () => {
  const adapter = memoryAdapter();
  const store = await createLocalStore(adapter);
  const label = await store.create(sample());
  assert.match(label.id, /^[0-9a-f-]{36}$/);
  assert.ok(label.createdAt);
  assert.equal(store.get(label.id).fields.name, 'Flour');
  assert.equal(store.list().length, 1);
  assert.equal(adapter.rows.get(label.id).fields.name, 'Flour');
});

test('loads what the adapter already holds, sorted newest first', async () => {
  const older = { ...sample('111111111117'), id: 'a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const newer = { ...sample('222222222224'), id: 'b', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' };
  const store = await createLocalStore(memoryAdapter([older, newer]));
  assert.deepEqual(store.list().map((l) => l.id), ['b', 'a']);
});

test('update merges and bumps updatedAt; remove deletes; unknown id throws', async () => {
  const adapter = memoryAdapter();
  const store = await createLocalStore(adapter);
  const label = await store.create(sample());
  const updated = await store.update(label.id, { fields: { ...label.fields, name: 'Sugar' } });
  assert.equal(updated.fields.name, 'Sugar');
  assert.equal(updated.fields.barcode, '036000291452');
  assert.equal(adapter.rows.get(label.id).fields.name, 'Sugar');
  await store.remove(label.id);
  assert.equal(store.get(label.id), undefined);
  assert.equal(adapter.rows.size, 0);
  await assert.rejects(store.update('nope', {}), /not found/);
});

test('duplicate barcodes are refused except on the same label or when allowed', async () => {
  const store = await createLocalStore(memoryAdapter());
  const a = await store.create(sample());
  await assert.rejects(store.create(sample()), /duplicate barcode/);
  assert.equal(store.barcodeExists('036000291452'), true);
  assert.equal(store.barcodeExists('036000291452', a.id), false);
  const b = await store.create(sample(), { allowDuplicateBarcode: true });
  await store.update(b.id, { fields: { ...b.fields, name: 'Sugar' } });
  const c = await store.create(sample('123456789012'));
  await assert.rejects(store.update(c.id, { fields: { ...c.fields, barcode: a.fields.barcode } }), /duplicate barcode/);
});

test('importLabels adds new ids as-is and skips existing ones', async () => {
  const adapter = memoryAdapter();
  const store = await createLocalStore(adapter);
  const a = await store.create(sample());
  const result = await store.importLabels([
    { ...a, fields: { ...a.fields, name: 'Changed' } },
    { ...sample('036000291452'), id: 'imp', createdAt: 'x', updatedAt: 'x' },
  ]);
  assert.deepEqual(result, { added: 1, skipped: 1 });
  assert.equal(store.get(a.id).fields.name, 'Flour');
  assert.equal(adapter.rows.get('imp').fields.name, 'Flour');
});
```

```js
// test/local-config.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalConfig, DEFAULTS } from '../public/local-config.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test('defaults match the server minus printerIp and connection', () => {
  const cfg = createLocalConfig(memoryStorage());
  assert.deepEqual(cfg.get(), { darkness: 15, apiKey: '', mediaType: 'gap', loadedSize: '3x5' });
  assert.deepEqual(Object.keys(DEFAULTS).sort(), ['apiKey', 'darkness', 'loadedSize', 'mediaType']);
});

test('update persists only known keys and survives a reload', () => {
  const storage = memoryStorage();
  const cfg = createLocalConfig(storage);
  cfg.update({ darkness: 22, printerIp: '1.2.3.4', apiKey: 'sk-x' });
  assert.equal(cfg.get().darkness, 22);
  assert.equal(cfg.get().printerIp, undefined);
  const again = createLocalConfig(storage);
  assert.equal(again.get().apiKey, 'sk-x');
});

test('a corrupt stored value falls back to defaults', () => {
  const storage = memoryStorage();
  storage.setItem('zc-settings', '{not json');
  assert.equal(createLocalConfig(storage).get().darkness, 15);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/local-store.test.js test/local-config.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `public/local-store.js`**

```js
// public/local-store.js
// The tablet's label library. Records are the exact JSON shape of
// data/labels.json, kept in IndexedDB and mirrored in memory so lookups are
// synchronous like the server store. The adapter is swappable so the logic
// runs in Node tests over a Map.

const DB_NAME = 'zebra-connect';
const STORE = 'labels';

export function indexedDbAdapter() {
  let dbPromise = null;
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) { reject(new Error('this browser cannot keep labels (no IndexedDB)')); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('could not open the label database'));
      });
    }
    return dbPromise;
  }
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error ?? new Error('label database error'));
      tx.onabort = () => reject(tx.error ?? new Error('label database error'));
    });
  };
  return {
    getAll: () => run('readonly', (s) => s.getAll()),
    put: (label) => run('readwrite', (s) => s.put(label)),
    delete: (id) => run('readwrite', (s) => s.delete(id)),
  };
}

export async function createLocalStore(adapter) {
  let labels = await adapter.getAll();

  function barcodeExists(code, exceptId) {
    return labels.some((l) => l.fields?.barcode === code && l.id !== exceptId);
  }

  function assertBarcodeFree(label, exceptId) {
    if (label.fields?.barcode && barcodeExists(label.fields.barcode, exceptId)) {
      throw new Error('duplicate barcode — tap ↻ New to regenerate');
    }
  }

  return {
    list: () => [...labels].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    get: (id) => labels.find((l) => l.id === id),
    barcodeExists,
    async create(data, { allowDuplicateBarcode = false } = {}) {
      if (!allowDuplicateBarcode) assertBarcodeFree(data);
      const now = new Date().toISOString();
      const label = { id: globalThis.crypto.randomUUID(), ...data, createdAt: now, updatedAt: now };
      await adapter.put(label);
      labels.push(label);
      return label;
    },
    async update(id, patch) {
      const i = labels.findIndex((l) => l.id === id);
      if (i === -1) throw new Error('not found');
      const merged = { ...labels[i], ...patch, id, createdAt: labels[i].createdAt };
      if (merged.fields?.barcode !== labels[i].fields?.barcode) assertBarcodeFree(merged, id);
      merged.updatedAt = new Date().toISOString();
      await adapter.put(merged);
      labels[i] = merged;
      return merged;
    },
    async remove(id) {
      await adapter.delete(id);
      labels = labels.filter((l) => l.id !== id);
    },
    async importLabels(incoming) {
      let added = 0;
      let skipped = 0;
      for (const label of incoming) {
        if (labels.some((l) => l.id === label.id)) { skipped++; continue; }
        const copy = structuredClone(label);
        await adapter.put(copy);
        labels.push(copy);
        added++;
      }
      return { added, skipped };
    },
  };
}
```

- [ ] **Step 4: Create `public/local-config.js`**

```js
// public/local-config.js
// Tablet settings in localStorage. Same keys and defaults as src/config.js,
// except that the printer is always the Bluetooth link, so there is no
// printerIp and no connection mode.
export const DEFAULTS = { darkness: 15, apiKey: '', mediaType: 'gap', loadedSize: '3x5' };
const KEY = 'zc-settings';

export function createLocalConfig(storage) {
  let settings = { ...DEFAULTS };
  try {
    const saved = JSON.parse(storage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(DEFAULTS)) {
        if (key in saved) settings[key] = saved[key];
      }
    }
  } catch { /* unreadable — defaults stand */ }
  return {
    get: () => ({ ...settings }),
    update(patch) {
      for (const key of Object.keys(DEFAULTS)) {
        if (key in patch) settings[key] = patch[key];
      }
      try { storage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage full or blocked */ }
      return { ...settings };
    },
  };
}
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add public/local-store.js public/local-config.js test/local-store.test.js test/local-config.test.js
git commit -m "feat: IndexedDB label store and localStorage settings for the tablet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: `public/station.js` — a send function, local mode, Node-safe import

**Files:**
- Modify: `public/station.js`

**Interfaces:**
- Produces: `sendToPrinter(bytes: Uint8Array) → Promise<void>` (rejects `Error('printer not connected — tap the printer chip')` when there is no link); `isLocal` constant exported; `pump()` runs only when not local; module can be imported in Node (no `document` access at top level).
- Everything already exported (`stationState`, `onStationChange`, `connectStation`, `initStation`, `renderStation`) keeps its signature.

- [ ] **Step 1: Write a tiny failing import test** (append to `test/backend-select.test.js`)

```js
test('station.js can be imported without a DOM and refuses to send when not connected', async () => {
  const station = await import('../public/station.js');
  assert.equal(typeof station.sendToPrinter, 'function');
  await assert.rejects(station.sendToPrinter(new Uint8Array([1])), /printer not connected/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/backend-select.test.js`
Expected: FAIL — `document is not defined` at import.

- [ ] **Step 3: Edit `public/station.js`**

At the top, after `REMEMBER_KEY`:

```js
// On the static site the tablet *is* the backend: it never polls a server
// queue, and the header chip is always shown so Connect is one tap away.
export const isLocal = globalThis.ZC_BACKEND === 'local';
```

Guard the DOM listener:

```js
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') keepAwake();
  });
}
```

In `connectGatt()` replace `pump();` with `if (!isLocal) pump();`.

Add after `sendBytes`:

```js
// Used by the local backend: one job, straight down the link.
export async function sendToPrinter(bytes) {
  if (!writeChar) throw new Error('printer not connected — tap the printer chip');
  await sendBytes(bytes);
}
```

In `renderStation`, change the copy for local mode. Replace the `<p class="deck-bar" ...>Print station</p>` line and the trailing hint with:

```js
      <p class="deck-bar" style="padding:0 0 10px">${isLocal ? 'Printer' : 'Print station'}</p>
```

```js
    <p class="hint">${isLocal
      ? 'This tablet prints straight to the printer over Bluetooth. The chip in the header shows the link; tap it any time to come back here.'
      : 'This tablet keeps the printer link while you use the rest of the app — the chip in the header shows it. Labels printed from any phone, or from here, print automatically.'}</p>`;
```

Also change the flag-instructions branch so it only shows when Bluetooth is missing **and** the page is not https:

```js
  if (!('bluetooth' in navigator)) {
    if (location.protocol === 'https:') {
      container.innerHTML = `<div class="deck" style="padding:16px"><p style="color:#e8e6df">This browser has no Web Bluetooth. Use Chrome on Android.</p></div>`;
      return;
    }
    // ... existing flag instructions unchanged ...
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/station.js test/backend-select.test.js
git commit -m "feat: station module exposes sendToPrinter and knows when the tablet is the backend

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `public/local-ai.js` — the AI maker straight from the browser

**Files:**
- Create: `public/local-ai.js`
- Test: `test/local-ai.test.js`

**Interfaces:**
- Produces: `buildRequest({ size, text, image, today, examples }, apiKey) → { url, headers, body }` (pure); `requestContent(input, apiKey, { fetchImpl, today, examples }) → Promise<content>` (content as `parseContent` returns it).
- Consumes: `buildPrompt`, `MODEL`, `CONTENT_SCHEMA`, `contentFromResponse` from `./shared/ai-prompt.js`.

Header note: the API accepts calls from a browser page only when the request carries `anthropic-dangerous-direct-browser-access: true` (what the SDK sends under `dangerouslyAllowBrowser`). If a real call from the tablet fails with a CORS error, that header is the first thing to check.

- [ ] **Step 1: Write the failing test**

```js
// test/local-ai.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, requestContent, API_URL } from '../public/local-ai.js';

const today = new Date(2026, 8, 12);
const good = JSON.stringify({ name: 'Almond Flour', description: 'Blanched.', ingredients: '', extras: [], warning: '' });

test('buildRequest carries the key, version, fallback beta, browser header and structured output', () => {
  const req = buildRequest({ size: '3x2', text: 'almond flour', image: null, today, examples: [] }, 'sk-test');
  assert.equal(req.url, API_URL);
  assert.equal(req.headers['x-api-key'], 'sk-test');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(req.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(req.headers['content-type'], 'application/json');
  assert.equal(req.body.model, 'claude-opus-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.body.max_tokens, 4000);
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.match(req.body.system, /Today is Sep 12, 2026/);
  assert.equal(req.body.messages[0].content.at(-1).text.includes('almond flour'), true);
});

test('requestContent posts the request and parses the reply', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: good }] }) };
  };
  const content = await requestContent({ size: '3x2', text: 'almond flour', image: null }, 'sk-test', { fetchImpl, today });
  assert.equal(content.name, 'Almond Flour');
  assert.equal(calls[0].url, API_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(calls[0].init.body).model, 'claude-opus-5');
});

test('requestContent turns HTTP errors, network failures and refusals into plain messages', async () => {
  const http = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });
  await assert.rejects(requestContent({ size: '3x2', text: 'x', image: null }, 'k', { fetchImpl: http }), /invalid x-api-key/);
  const down = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(requestContent({ size: '3x2', text: 'x', image: null }, 'k', { fetchImpl: down }), /could not reach/);
  const refused = async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(requestContent({ size: '3x2', text: 'x', image: null }, 'k', { fetchImpl: refused }), /refused/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/local-ai.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

```js
// public/local-ai.js
// "Make it for me" without a server: the tablet calls the Messages API
// itself with the key from its settings. Same prompt, schema, fallback and
// parsing as src/ai-label.js; only the transport differs (fetch, not the SDK).
import { MODEL, CONTENT_SCHEMA, buildPrompt, contentFromResponse } from './shared/ai-prompt.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';

export function buildRequest({ size, text, image, today = new Date(), examples = [] }, apiKey) {
  const { system, messages } = buildPrompt({ size, text, image, today, examples });
  return {
    url: API_URL,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      // Required for calls made from a web page; the key lives only on this tablet.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: {
      model: MODEL,
      max_tokens: 4000,
      fallbacks: 'default',
      system,
      messages,
      output_config: { format: { type: 'json_schema', schema: CONTENT_SCHEMA } },
    },
  };
}

export async function requestContent(input, apiKey, { fetchImpl = globalThis.fetch, today, examples } = {}) {
  const req = buildRequest({ ...input, today, examples }, apiKey);
  let res;
  try {
    res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
  } catch {
    throw new Error('could not reach the label maker — is the tablet online?');
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = (await res.json()).error?.message ?? message; } catch { /* keep status */ }
    throw new Error(`label maker error: ${message}`);
  }
  return contentFromResponse(await res.json());
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/local-ai.js test/local-ai.test.js
git commit -m "feat: the AI label maker can call the Messages API straight from the tablet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: `public/backend-local.js` — the tablet backend

**Files:**
- Modify: `public/backend-local.js` (replace the stub), `public/preview.js` (export `loadImage`)
- Test: `test/backend-select.test.js` already imports it; add a method-surface assertion.

**Interfaces:**
- Produces: `local` with every method of `remote` (same names, same return shapes) plus `mode: 'local'` and `init()`. Methods the tablet cannot do throw `Error('not available on this device')`.
- Consumes: `createLocalStore`, `indexedDbAdapter` (Task 9), `createLocalConfig` (Task 9), `sendToPrinter` (Task 10), `requestContent` (Task 11), `labelJobZpl` (Task 4), `normalizeDraft`/`clampQuantity` (Task 2), `generateUpcA` (Task 5), `buildTestZpl`/`buildCalibrationZpl`/`setZplModeCommand` (Task 3), `withQuantity` is not needed (no printer-file labels locally), `layoutDraft`/`houseExamples` (Task 6), `validateImport` (Task 7), `drawLabel`, `SIZES`, `ensureFonts`/`loadImage` from `./preview.js`.

- [ ] **Step 1: Add the failing assertion** (append to `test/backend-select.test.js`)

```js
test('local backend has every method the remote backend has', async () => {
  const { remote } = await import('../public/backend-remote.js');
  const { local } = await import('../public/backend-local.js');
  for (const name of Object.keys(remote)) {
    assert.equal(typeof local[name], typeof remote[name], `local.${name}`);
  }
  await assert.rejects(local.discover(), /not available on this device/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/backend-select.test.js`
Expected: FAIL — `local.getLabel` is undefined.

- [ ] **Step 3: Export `loadImage` from `public/preview.js`**

Change `function loadImage(src) {` to `export function loadImage(src) {`.

- [ ] **Step 4: Write `public/backend-local.js`**

```js
// public/backend-local.js
// The tablet as the whole system: labels in IndexedDB, drawing and ZPL in
// this browser, bytes straight down the Bluetooth link, AI drafts straight
// from the Messages API. Same method names and return shapes as
// backend-remote.js so nothing else in the app knows the difference.
import { createLocalStore, indexedDbAdapter } from './local-store.js';
import { createLocalConfig } from './local-config.js';
import { sendToPrinter } from './station.js';
import { requestContent } from './local-ai.js';
import { labelJobZpl } from './shared/print-job.js';
import { normalizeDraft, clampQuantity } from './shared/draft.js';
import { generateUpcA } from './shared/upc.js';
import { buildTestZpl, buildCalibrationZpl, setZplModeCommand } from './shared/zpl.js';
import { layoutDraft } from './shared/ai-layout.js';
import { houseExamples } from './shared/ai-prompt.js';
import { validateImport } from './shared/import.js';
import { drawLabel } from './shared/render-core.js';
import { SIZES } from './shared/sizes.js';
import { ensureFonts, loadImage } from './preview.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const encoder = new TextEncoder();
const unavailable = async () => { throw new Error('not available on this device'); };
const notFound = () => Object.assign(new Error('not found'), { status: 404 });

let storePromise = null;
function store() {
  if (!storePromise) storePromise = createLocalStore(indexedDbAdapter());
  return storePromise;
}
const config = createLocalConfig(globalThis.localStorage ?? { getItem: () => null, setItem: () => {} });

async function send(zpl) {
  const bytes = typeof zpl === 'string' ? encoder.encode(zpl) : zpl;
  await sendToPrinter(bytes);
  return { ok: true, queued: false };
}

async function drawToCanvas(draft) {
  const label = normalizeDraft(draft);
  await ensureFonts();
  const canvas = document.createElement('canvas');
  const { width, height } = SIZES[label.size];
  canvas.width = width;
  canvas.height = height;
  await drawLabel(canvas.getContext('2d'), label, { includeBarcode: true, loadImage });
  return canvas;
}

function publicSettings() {
  const { apiKey, ...rest } = config.get();
  return { ...rest, apiKeySet: Boolean(apiKey), connection: 'bluetooth' };
}

export const local = {
  mode: 'local',
  // Opens the database up front so a broken browser fails at startup, not on
  // the first tap.
  init: async () => { await store(); },

  listLabels: async () => (await store()).list(),
  getLabel: async (id) => {
    const label = (await store()).get(id);
    if (!label) throw notFound();
    return label;
  },
  createLabel: async (draft) => {
    const s = await store();
    const label = normalizeDraft(draft);
    if (!label.fields.barcode) label.fields.barcode = generateUpcA((c) => s.barcodeExists(c));
    return s.create(label);
  },
  updateLabel: async (id, draft) => {
    const s = await store();
    if (!s.get(id)) throw notFound();
    return s.update(id, normalizeDraft(draft));
  },
  deleteLabel: async (id) => {
    const s = await store();
    if (!s.get(id)) throw notFound();
    await s.remove(id);
    return { ok: true };
  },
  newBarcode: async () => {
    const s = await store();
    return { barcode: generateUpcA((c) => s.barcodeExists(c)) };
  },
  previewBlob: async (draft) => {
    const canvas = await drawToCanvas(draft);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('preview failed'))), 'image/png'));
  },
  printLabel: async (draft, quantity) => {
    const label = normalizeDraft(draft);
    await ensureFonts();
    const zpl = await labelJobZpl(document.createElement('canvas'), label, {
      quantity: clampQuantity(quantity),
      darkness: config.get().darkness,
      loadImage,
    });
    return send(zpl);
  },
  printRaw: async (file) => send(new Uint8Array(await file.arrayBuffer())),

  addPrn: unavailable,
  printFileLabel: unavailable,
  getFileFields: unavailable,
  saveFileFields: unavailable,
  saveFileZpl: unavailable,
  previewZplBlob: unavailable,
  convertFile: unavailable,
  discover: unavailable,

  makeLabel: async ({ size, text, image }) => {
    const { apiKey } = config.get();
    if (!apiKey) throw new Error('no API key configured — add one in Settings');
    text = String(text ?? '').trim();
    if (!SIZES[size]) throw new Error('unknown size');
    if (!text && !image) throw new Error('describe the product or add a photo first');
    if (image && (!IMAGE_TYPES.includes(image.mediaType) || typeof image.data !== 'string' || !image.data)) {
      throw new Error('unsupported image type — use a JPEG or PNG photo');
    }
    const s = await store();
    const content = await requestContent({ size, text, image: image ?? null }, apiKey, { examples: houseExamples(s.list()) });
    const draft = normalizeDraft(layoutDraft({ size, content }));
    draft.fields.barcode = generateUpcA((c) => s.barcodeExists(c));
    return { ...draft, warnings: content.warning ? [content.warning] : [] };
  },

  getSettings: async () => publicSettings(),
  putSettings: async (patch) => { config.update(patch ?? {}); return publicSettings(); },
  testPrint: async () => send(buildTestZpl()),
  zplMode: async () => send(setZplModeCommand()),
  calibrate: async (mediaType) => {
    const zpl = buildCalibrationZpl(mediaType); // throws on an unknown type
    config.update({ mediaType });
    return send(zpl);
  },

  exportLabels: async () => (await store()).list(),
  // Printer-file entries need the server (Labelary preview, ZPL field editor),
  // so they are counted and left out here.
  importLabels: async (json) => {
    const labels = validateImport(json);
    const files = labels.filter((l) => l.kind === 'prn').length;
    const result = await (await store()).importLabels(labels.filter((l) => l.kind !== 'prn'));
    return { ...result, skippedFiles: files };
  },
};
```

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: PASS. (Importing this module in Node must not touch `document`, `indexedDB` or `localStorage` at load time; if the test fails with `document is not defined`, something runs at module level that should be inside a method.)

- [ ] **Step 6: Commit**

```bash
git add public/backend-local.js public/preview.js test/backend-select.test.js
git commit -m "feat: local backend — the tablet stores, draws, prints and makes labels by itself

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Local-mode UI — settings, new-label page, chip, fatal screen, retry

**Files:**
- Modify: `public/app.js`, `public/settings.js`, `public/editor.js`, `public/file-editor.js`, `public/style.css`

**Interfaces:**
- Consumes: `api.mode`, `api.init()`, `connectStation` from `./station.js`.
- Produces: `showToast(message, isError, { actionLabel, onAction })` — third argument optional; `window` event `zc-update-ready` handled by an update bar (used by Task 15).

- [ ] **Step 1: `public/app.js` — startup, chip, toast action, update bar**

Replace the last two lines (`window.addEventListener('hashchange', route); route();`) with:

```js
function showFatal(message) {
  document.getElementById('nav').hidden = true;
  view.innerHTML = `<div class="deck" style="padding:16px"><p style="color:#e8e6df">${message}</p>
    <p class="hint">Labels cannot be kept in this browser. Use Chrome on Android with site data allowed (not a private tab).</p></div>`;
}

window.addEventListener('hashchange', route);
api.init().then(route).catch((err) => showFatal(err.message));

// A new version of the site was fetched in the background (see sw-register.js).
window.addEventListener('zc-update-ready', () => {
  if (document.getElementById('update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.innerHTML = '<span>Update ready</span><button class="accent tight">Reload</button>';
  bar.querySelector('button').onclick = () => window.dispatchEvent(new CustomEvent('zc-update-apply'));
  document.body.appendChild(bar);
});
```

Change `refreshStationChip` so the chip is always visible on the tablet:

```js
const STATION_CHIP = {
  off: ['PRINTER ✗', 'bad'],
  connected: ['PRINTER ✓', 'ok'],
  connecting: ['PRINTER …', ''],
  reconnecting: ['PRINTER …', ''],
  disconnected: ['PRINTER ✗', 'bad'],
};
function refreshStationChip(state) {
  const chip = document.getElementById('station-chip');
  const entry = STATION_CHIP[state.status];
  chip.hidden = !(entry && (api.mode === 'local' || state.remembered || state.status !== 'off'));
  if (!entry) return;
  chip.textContent = entry[0];
  chip.classList.toggle('ok', entry[1] === 'ok');
  chip.classList.toggle('bad', entry[1] === 'bad');
}
```

Extend `showToast`:

```js
export function showToast(message, isError = false, { actionLabel, onAction } = {}) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  if (actionLabel) {
    const btn = document.createElement('button');
    btn.className = 'quiet tight';
    btn.textContent = actionLabel;
    btn.onclick = () => { toast.hidden = true; onAction?.(); };
    toast.appendChild(btn);
  }
  toast.className = isError ? 'error' : '';
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, actionLabel ? 8000 : 3500);
}
```

In `renderNew`, hide the library import on the tablet: after the template is set, add

```js
  if (api.mode === 'local') {
    view.querySelector('#add-prn').hidden = true;
    view.querySelector('.row:has(#add-prn) + .hint').textContent = '"Print once" sends a finished .prn file to the printer without keeping it.';
  }
```

In `route()`, guard the file editor:

```js
    else if (hash.startsWith('#/file/')) {
      if (api.mode === 'local') { showToast('Printer files are edited on the laptop', true); navigate('#/'); return; }
      setTitle('Edit printer file');
      await renderFileEditor(view, await api.getLabel(hash.slice(7)));
    }
```

Change the two `'Queued — printing at the station' : 'Sent to printer'` toasts in this file to stay as they are (local returns `queued: false`, so they already read "Sent to printer").

- [ ] **Step 2: `public/style.css` — update bar and toast button**

Append:

```css
#update-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 30;
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 10px 14px; background: var(--ink); color: var(--paper);
  font-family: var(--mono); font-size: 13px;
}
#toast button { margin-left: 12px; }
```

- [ ] **Step 3: `public/settings.js` — the tablet layout**

Wrap today's connection/IP block in a remote-only branch. The template's first part becomes:

```js
  const local = api.mode === 'local';
  container.innerHTML = `
    ${local ? `
    <label class="field">Printer</label>
    <p class="hint" style="margin-top:0">Prints go over Bluetooth to the connected printer.</p>
    <div class="row" style="margin-bottom:12px">
      <button id="s-connect" class="quiet">Connect printer</button>
    </div>` : `
    <label class="field">How prints reach the printer</label>
    <div class="choice" data-conn="network">
      <strong>WiFi network</strong>
      <span>the printer is on the same network — prints go straight to its IP</span>
    </div>
    <div class="choice" data-conn="station">
      <strong>Bluetooth print station</strong>
      <span>a tablet near the printer relays prints over Bluetooth</span>
    </div>
    <p class="hint" id="station-hint" hidden>
      On the tablet, open <strong>${location.origin}/#/station</strong> in Chrome
      and tap "Connect printer". Keep that page open.
    </p>
    <label class="field">Printer IP address</label>
    <div class="row">
      <input id="s-ip" placeholder="e.g. 192.168.1.50" autocomplete="off">
      <button id="s-discover" class="quiet tight">${icon('search')} Find</button>
    </div>
    <div id="s-found" class="hint"></div>`}
    <label class="field">Darkness · 0–30</label>
    ... (rest unchanged: darkness, API key, save, test print, fix language, backup)
```

Then guard the handlers that reference remote-only elements:

```js
  const ip = container.querySelector('#s-ip');           // null in local mode
  ...
  if (ip) ip.value = settings.printerIp;
  if (!local) {
    // selectConnection + [data-conn] handlers + #s-discover handler exactly as today
  } else {
    container.querySelector('#s-connect').onclick = async () => {
      try { await connectStation({ interactive: true }); showToast('Printer connected'); }
      catch (err) { showToast(err.message, true); }
    };
  }
```

and in the save handler build the patch without the IP when there is no field:

```js
      const patch = { darkness: Number(darkness.value) };
      if (ip) patch.printerIp = ip.value.trim();
```

Add `import { connectStation } from './station.js';` at the top.

- [ ] **Step 4: `public/editor.js` — retry after a failed send**

In the `#print` handler, replace the outer `catch (err) { showToast(err.message, true); }` with:

```js
    } catch (err) {
      showToast(err.message, true, { actionLabel: 'Retry', onAction: () => btn.click() });
    }
```

- [ ] **Step 5: `public/file-editor.js` — refuse in local mode**

At the top of `renderFileEditor`:

```js
  if (api.mode === 'local') {
    container.innerHTML = '<p class="hint">Printer files are edited on the laptop, not on this tablet.</p>';
    return;
  }
```

- [ ] **Step 6: Run tests and check the remote mode still looks right**

Run: `npm test` → PASS. Then `npm start`, open `http://localhost:3000/#/settings` in the Browser pane: the connection choice, IP field, Backup section all present; `#/` lists labels with previews; no console errors. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add public/app.js public/settings.js public/editor.js public/file-editor.js public/style.css
git commit -m "feat: tablet-mode UI — printer settings, always-on printer chip, retry, update bar

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: Relative paths for GitHub Pages

**Files:**
- Modify: `public/manifest.webmanifest`, any remaining absolute asset path in `public/` (grep)

- [ ] **Step 1: Find absolute paths**

```bash
grep -rn "\"/\|'/\|url(/" public --include=*.js --include=*.css --include=*.html --include=*.webmanifest | grep -v "^public/shared" | grep -v "'/api/" | grep -v "#/"
```

Expected hits: `manifest.webmanifest` (`start_url`, two icon `src`). Anything else found must also be made relative.

- [ ] **Step 2: Fix the manifest**

```json
{
  "name": "Zebra Connect",
  "short_name": "Labels",
  "description": "Design and print labels on the Zebra ZQ620 Plus",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#f4f3ef",
  "theme_color": "#191a1c",
  "icons": [
    { "src": "./icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 3: Verify on the Node server**

`npm start`, open `http://localhost:3000/#/new`, pick 3 × 2, confirm the preview draws and `http://localhost:3000/manifest.webmanifest` loads. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add public
git commit -m "chore: relative asset paths so the site works under a GitHub Pages subpath

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: Service worker, registration, build script

**Files:**
- Create: `public/sw.js`, `public/sw-register.js`, `tools/build-site.mjs`
- Modify: `.gitignore` (add `site/`)
- Test: `test/build-site.test.js`

**Interfaces:**
- Produces: `site/` folder with `index.html` carrying `<script>window.ZC_BACKEND='local'</script>` before the module script and `<script src="sw-register.js"></script>` after it; `site/sw.js` with `__VERSION__` and `__PRECACHE__` substituted; `site/version.txt`. `buildSite({ root, out, version }) → { files: string[], version }` exported from the tool for tests.
- Consumes: the `zc-update-ready` / `zc-update-apply` window events from Task 13.

- [ ] **Step 1: Write the failing test**

```js
// test/build-site.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSite } from '../tools/build-site.mjs';

test('buildSite copies public, injects the local flag and worker, and fills the precache list', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-site-'));
  const { files, version } = buildSite({ out, version: 'abc1234' });
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(index.indexOf("window.ZC_BACKEND='local'") < index.indexOf('src="app.js"'), 'flag precedes the app');
  assert.ok(index.includes('<script src="sw-register.js"></script>'));
  const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
  assert.ok(!sw.includes('__VERSION__') && !sw.includes('__PRECACHE__'));
  assert.ok(sw.includes("'zc-abc1234'"));
  assert.equal(fs.readFileSync(path.join(out, 'version.txt'), 'utf8').trim(), 'abc1234');
  assert.equal(version, 'abc1234');
  for (const f of ['app.js', 'shared/render-core.js', 'fonts/Arimo-Regular.ttf', 'icon-192.png', 'style.css', 'manifest.webmanifest']) {
    assert.ok(fs.existsSync(path.join(out, f)), `${f} copied`);
    assert.ok(files.includes(`./${f}`), `${f} precached`);
  }
  assert.ok(!files.includes('./sw.js'), 'the worker never caches itself');
  const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  assert.deepEqual(precache, files);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/build-site.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `public/sw.js`**

```js
// public/sw.js — served as a template; tools/build-site.mjs fills in the
// version and the file list. On the Node server nothing registers it.
const CACHE = 'zc-__VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Same-origin GETs come from the cache first; the API host and anything else
// go straight to the network. Labels live in IndexedDB, never here.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(event.request);
    if (res.ok) (await caches.open(CACHE)).put(event.request, res.clone());
    return res;
  })());
});
```

- [ ] **Step 4: Create `public/sw-register.js`**

```js
// public/sw-register.js — only the built site includes this script.
(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const announce = () => window.dispatchEvent(new CustomEvent('zc-update-ready'));
    if (reg.waiting && navigator.serviceWorker.controller) announce();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) announce();
      });
    });
    window.addEventListener('zc-update-apply', () => {
      reg.waiting?.postMessage('skip-waiting');
    });
  }).catch(() => { /* offline use just won't be available */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
})();
```

- [ ] **Step 5: Create `tools/build-site.mjs`**

```js
#!/usr/bin/env node
// Assembles the static site (the tablet's app) from public/:
//   node tools/build-site.mjs [outDir=site]
// index.html gets the local-backend flag and the service-worker registration;
// sw.js gets the version stamp and the list of files to cache.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', 'public');

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function gitVersion() {
  try { return execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return String(Date.now()); }
}

export function buildSite({ root = ROOT, out = path.join(here, '..', 'site'), version = gitVersion() } = {}) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(root, out, { recursive: true });

  const indexPath = path.join(out, 'index.html');
  let index = fs.readFileSync(indexPath, 'utf8');
  index = index.replace(
    '<script type="module" src="app.js"></script>',
    "<script>window.ZC_BACKEND='local'</script>\n<script type=\"module\" src=\"app.js\"></script>\n<script src=\"sw-register.js\"></script>",
  );
  if (!index.includes("ZC_BACKEND='local'")) throw new Error('index.html: module script tag not found');
  fs.writeFileSync(indexPath, index);
  fs.writeFileSync(path.join(out, 'version.txt'), `${version}\n`);

  const files = walk(out).filter((f) => f !== 'sw.js').map((f) => `./${f}`);
  const swPath = path.join(out, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8')
    .replace('__VERSION__', version)
    .replace('__PRECACHE__', JSON.stringify(files, null, 2));
  fs.writeFileSync(swPath, sw);
  return { files, version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const { files, version } = buildSite({ out });
  console.log(`site built (${files.length} files, version ${version})`);
}
```

Note: `walk` runs on `out` after `index.html` and `version.txt` are written, so both are in the precache list; `sw.js` is excluded.

- [ ] **Step 6: Ignore the output**

Append `site/` to `.gitignore`.

- [ ] **Step 7: Run all tests and a real build**

Run: `npm test` → PASS. Then:

```bash
node tools/build-site.mjs
```

Expected: `site built (N files, version <hash>)` and `site/index.html` contains the flag.

- [ ] **Step 8: Commit**

```bash
git add public/sw.js public/sw-register.js tools/build-site.mjs test/build-site.test.js .gitignore
git commit -m "feat: static site build with an offline service worker and update prompt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: GitHub Pages workflow, README, memory

**Files:**
- Create: `.github/workflows/pages.yml`
- Modify: `README.md`
- Modify: `C:\Users\rober\.claude\projects\C--Users-rober-zebra-connect\memory\zebra-store-setup.md`

- [ ] **Step 1: Workflow**

```yaml
# .github/workflows/pages.yml
name: Publish site
on:
  push:
    branches: [master]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm test
      - run: node tools/build-site.mjs
      - uses: actions/configure-pages@v5
        with:
          enablement: true
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

(`npm test` in CI needs `@napi-rs/canvas` for linux, which `npm ci` installs from the lockfile's optional platform packages; if the lockfile lacks the linux package, run `npm install` once locally so it is recorded, then commit `package-lock.json`.)

- [ ] **Step 2: README**

Replace the "Bluetooth print station (printer not on WiFi)" section with:

```markdown
## Standalone tablet (printer not on WiFi)

When the printer can't join the network (e.g. WPA3-only WiFi), the tablet
docked next to it runs the whole app by itself: labels are kept on the
tablet, drawn there, and sent over Bluetooth. No PC is needed at the store.

The tablet app is the same code published as a static site by GitHub
Pages (`.github/workflows/pages.yml` runs `node tools/build-site.mjs` on
every push to `master`).

1. On the laptop app: **Settings → Export labels** and get the file onto
   the tablet (Drive, email, USB).
2. On the tablet (Android, Chrome): open the site address, menu (⋮) →
   **Add to Home screen**. It works offline from then on.
3. **Settings → Import labels**, then set darkness, the loaded size and
   media type (tap the size chip), and the Anthropic API key if you use
   **Make it for me**.
4. Tap the **PRINTER** chip → **Connect printer** → pick the Zebra. Test
   print, then Calibrate.

Printer files (`.prn` entries) are a laptop feature; the tablet only
prints regular labels and "Print a .prn once". When a new version is
published, the tablet shows **Update ready — Reload** the next time it
is online.

The printer needs Bluetooth LE enabled
(`! U1 setvar "bluetooth.le.controller_mode" "both"` — already done for
this printer). Big 5×3 labels take a few extra seconds over Bluetooth.

To keep using a PC as the server with the tablet as a relay instead, set
"How prints reach the printer" to **Bluetooth print station** in Settings
and open `/#/station` on the tablet.
```

Under "Where data lives" add:

```markdown
**Settings → Export labels** downloads the whole library as one JSON file;
**Import labels** adds the labels from such a file that are not already
present. On the tablet, labels live in the browser's IndexedDB and settings
(including the API key) in localStorage — export before clearing site data.
```

- [ ] **Step 3: Memory note**

In `zebra-store-setup.md` update the architecture bullet: the chosen store architecture is now the standalone tablet (static site on GitHub Pages, local backend, IndexedDB); the station relay remains available for PC-server setups; the USB stick is retired once the tablet is live. Keep the printer/BLE facts.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml README.md
git commit -m "docs: standalone tablet setup and GitHub Pages publishing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 5: Hand the user the publishing commands** (do not run them without the user; creating the public repository is their call)

```bash
gh repo create zebra-connect --public --source . --remote origin --push
```

Then GitHub → repository → Settings → Pages: confirm Source is **GitHub Actions** (the workflow's `configure-pages` step enables it; if the first run fails with a Pages error, set it by hand and re-run). The site address is `https://<github-user>.github.io/zebra-connect/`.

---

### Task 17: Browser verification of the built site (no server)

**Files:** none (verification only). Add `.claude/launch.json` entry if missing.

- [ ] **Step 1: Serve `site/` statically**

Add to `.claude/launch.json` (create the file if absent):

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "zebra-server", "runtimeExecutable": "npm", "runtimeArgs": ["start"], "port": 3000 },
    { "name": "site-static", "runtimeExecutable": "npx", "runtimeArgs": ["--yes", "serve", "-l", "8080", "site"], "port": 8080 }
  ]
}
```

Run `node tools/build-site.mjs`, then `preview_start` with name `site-static`.

- [ ] **Step 2: Local mode boots**

Open `http://localhost:8080/`. Expected: the library shows "No labels yet", the header shows the `PRINTER ✗` chip, no console errors except (possibly) a service-worker registration failure on `localhost` (registration works on localhost; note any other error).

- [ ] **Step 3: Import a backup**

Use the file exported in Task 7 Step 8 (or `data/labels.json`) via **Settings → Import labels**. Expected toast: `Imported 140 labels (0 already here)`. Reload the page: the library lists all labels with canvas previews (rendered by `previewBlob`).

- [ ] **Step 4: Editor works**

Open a label, drag a field, press Undo, Save. Expected: `Saved` toast, `#/` shows the change after reload (IndexedDB persisted).

- [ ] **Step 5: Print path fails cleanly with no printer**

Tap Print. Expected toast: `printer not connected — tap the printer chip` with a **Retry** button.

- [ ] **Step 6: Settings layout**

`#/settings` shows Printer / Connect printer, Darkness, API key, Backup — no IP field, no connection choice.

- [ ] **Step 7: Offline**

Stop the static server (`preview_stop`), reload the tab. Expected: the app still loads from the service worker and lists the labels.

- [ ] **Step 8: Record the results**

Screenshot the library and the settings page; note anything that failed and fix it in the task that owns the code before declaring the plan done.

---

## Self-review notes

- Spec §1 (two backends): Tasks 8, 12. §2 (moves): Tasks 1–6. §3 store: Task 9. §4 settings: Task 9. §5 printing: Tasks 4, 10, 12. §6 AI: Tasks 6, 11, 12. §7 export/import: Task 7 (+ local in 12). §8 hidden UI: Task 13. §9 build/hosting/offline: Tasks 14–16. §10 moving day: Task 16 README. §11 errors: Tasks 12, 13. §12 tests: every task. §13 README: Task 16.
- Deviation from spec §9: the Chrome-flag instructions keep `location.origin` (the flag accepts origins only); the instructions are unreachable on https anyway.
- Deviation from spec §5: a detached `<canvas>` is used instead of `OffscreenCanvas` (works on every browser that has Web Bluetooth; nothing is gained by the offscreen variant here).
- Task order: do Task 3 before Task 2 (Task 2 imports `public/shared/layout.js`).
