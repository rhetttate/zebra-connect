# Printer-File Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let imported `.prn` printer files be edited in the app — text, barcode, field position, text size — with a live preview, while printing the original ZebraDesigner ZPL with the edits applied.

**Architecture:** A pure server module parses the file's positioned `^FD` fields out of the ZPL and applies edits back in place (byte-exact elsewhere). Three small routes expose fields/raw ZPL and proxy ZPL previews through Labelary with an injectable renderer. A new client screen overlays tappable, draggable boxes on the preview image and edits the fields as inputs.

**Tech Stack:** Node 22 ESM, Express 5, `node --test`, vanilla browser JS (no bundler), Labelary HTTP API for previews.

**Spec:** `docs/superpowers/specs/2026-09-07-printer-file-editor-design.md`

## Global Constraints

- Never create files named `prn.*`, `con.*`, `aux.*`, `nul.*`, `com1.*`, `lpt1.*` (Windows reserved device names; FAT32/robocopy refuse them).
- Printer files must print byte-identical to the original outside the edited fields.
- Text edits may not contain `^` or `~` (ZPL command prefixes).
- Preview coordinates: Labelary at 8 dpmm renders 1 PNG pixel per printer dot.
- Tests use `node --test`; app routes are tested through a real listening server as in `test/app.test.js`.
- Do not commit unless the user asks; the working tree is the deliverable.

---

### Task 1: ZPL field parser and applier

**Files:**
- Create: `src/zpl-fields.js`
- Test: `test/zpl-fields.test.js`

**Interfaces:**
- Produces: `parseFields(zpl) → Array<{ id:number, kind:'text'|'barcode', text:string, x:number, y:number, origin:'FT'|'FO', font:{h:number,w:number}|null, rotated:boolean }>`
- Produces: `applyFields(zpl, fields) → string` (throws `Error` with `status: 400` on bad text)
- Produces: `labelInches(zpl) → { w:number, h:number } | null`

- [ ] **Step 1: Write the failing tests**

```js
// test/zpl-fields.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFields, applyFields, labelInches } from '../src/zpl-fields.js';

const SAMPLE = [
  'CT~~CD,~CC^~CT~', '^XA', '~TA000', '~JSN', '^XZ',
  '^XA', '^MMT', '^PW406', '^LL254', '^LS0',
  '^FT43,50^A0N,48,48^FH\\^CI28^FDBACON        $69^FS^CI27',
  '^FO20,120^GFA,8,8,1,::::::::^FS',
  '^BY3,2,144^FT63,220^BUN,,Y,N,Y', '^FH\\^FD209990069008^FS',
  '^FT300,200^A0R,30,30^FH\\^FDSIDEWAYS^FS',
  '^PQ1,0,1,Y', '^XZ',
].join('\r\n');

test('parseFields finds positioned text and barcode fields and skips graphics', () => {
  const fields = parseFields(SAMPLE);
  assert.deepEqual(fields.map((f) => [f.id, f.kind, f.text]), [
    [0, 'text', 'BACON        $69'],
    [1, 'barcode', '209990069008'],
    [2, 'text', 'SIDEWAYS'],
  ]);
  assert.deepEqual(fields[0], { id: 0, kind: 'text', text: 'BACON        $69', x: 43, y: 50, origin: 'FT', font: { h: 48, w: 48 }, rotated: false });
  assert.equal(fields[1].font, null);
  assert.equal(fields[2].rotated, true);
});

test('applyFields with unchanged fields returns the identical ZPL', () => {
  assert.equal(applyFields(SAMPLE, parseFields(SAMPLE)), SAMPLE);
});

test('applyFields changes only the edited field text, position and font', () => {
  const fields = parseFields(SAMPLE);
  const out = applyFields(SAMPLE, [{ ...fields[0], text: 'BACON $79', x: 50, y: 60, font: { h: 52, w: 52 } }]);
  assert.ok(out.includes('^FT50,60^A0N,52,52^FH\\^CI28^FDBACON $79^FS^CI27'));
  assert.ok(out.includes('^FD209990069008^FS'));
  assert.ok(out.includes('^FT300,200^A0R,30,30^FH\\^FDSIDEWAYS^FS'));
  assert.equal(out.split('\r\n').length, SAMPLE.split('\r\n').length);
});

test('applyFields rejects text containing ZPL control characters', () => {
  const fields = parseFields(SAMPLE);
  assert.throws(() => applyFields(SAMPLE, [{ ...fields[0], text: 'bad^XZ' }]), /\^ or ~/);
  assert.throws(() => applyFields(SAMPLE, [{ ...fields[1], text: '12~34' }]), /\^ or ~/);
});

test('applyFields ignores unknown ids and keeps numbers sane', () => {
  const fields = parseFields(SAMPLE);
  const out = applyFields(SAMPLE, [{ ...fields[1], id: 99 }, { ...fields[0], x: -5.7, y: 12.4 }]);
  assert.ok(out.includes('^FT0,12^A0N,48,48'));
});

test('labelInches reads ^PW/^LL at 203 dpi', () => {
  assert.deepEqual(labelInches(SAMPLE), { w: 2, h: 1.25 });
  assert.equal(labelInches('^XA^FDx^FS^XZ'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/zpl-fields.test.js`
Expected: the file fails to load with `Cannot find module '../src/zpl-fields.js'`.

- [ ] **Step 3: Write the implementation**

```js
// src/zpl-fields.js
// Positioned ^FD fields inside a finished ZPL job (ZebraDesigner exports).
// parseFields reads them; applyFields writes edits back in place so the
// rest of the file stays byte-identical.

const POS = /\^(FT|FO)(\d+),(\d+)/g;
const FONT = /\^A([0-9A-Z@])([NRIB])?,(\d+),(\d+)/;
const BARCODE = /\^B[A-Z0-9]/;
const PAYLOAD = /\^FD([\s\S]*?)\^FS/;

function segments(zpl) {
  // Each segment: from a ^FT/^FO to the ^FS that closes its field.
  const out = [];
  for (const m of zpl.matchAll(POS)) {
    const end = zpl.indexOf('^FS', m.index);
    if (end === -1) continue;
    const next = POS.lastIndex; // eslint-disable-line no-unused-vars
    const body = zpl.slice(m.index, end + 3);
    const payload = PAYLOAD.exec(body);
    if (!payload || body.includes('^GF')) continue; // graphics and empty fields are not editable
    const font = FONT.exec(body);
    out.push({
      start: m.index,
      origin: m[1], x: Number(m[2]), y: Number(m[3]),
      posNumStart: m.index + 3, posNumEnd: m.index + m[0].length,
      font: font ? { h: Number(font[3]), w: Number(font[4]), rotated: (font[2] ?? 'N') !== 'N',
        numStart: m.index + font.index + font[0].length - `${font[3]},${font[4]}`.length,
        numEnd: m.index + font.index + font[0].length } : null,
      kind: BARCODE.test(body.slice(0, payload.index)) ? 'barcode' : 'text',
      text: payload[1],
      textStart: m.index + payload.index + 3,
      textEnd: m.index + payload.index + 3 + payload[1].length,
    });
  }
  return out;
}

export function parseFields(zpl) {
  return segments(zpl).map((s, id) => ({
    id, kind: s.kind, text: s.text, x: s.x, y: s.y, origin: s.origin,
    font: s.font ? { h: s.font.h, w: s.font.w } : null,
    rotated: Boolean(s.font?.rotated),
  }));
}

const clampDots = (n) => Math.max(0, Math.round(Number(n) || 0));

export function applyFields(zpl, fields) {
  const segs = segments(zpl);
  const edits = [];
  for (const f of fields ?? []) {
    const s = segs[f.id];
    if (!s) continue;
    const text = String(f.text ?? s.text);
    if (/[\^~]/.test(text)) throw Object.assign(new Error('text may not contain ^ or ~'), { status: 400 });
    edits.push({ start: s.textStart, end: s.textEnd, value: text });
    edits.push({ start: s.posNumStart, end: s.posNumEnd, value: `${clampDots(f.x ?? s.x)},${clampDots(f.y ?? s.y)}` });
    if (s.font && f.font) {
      edits.push({ start: s.font.numStart, end: s.font.numEnd,
        value: `${Math.max(1, clampDots(f.font.h ?? s.font.h))},${Math.max(1, clampDots(f.font.w ?? s.font.w))}` });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let out = zpl;
  for (const e of edits) out = out.slice(0, e.start) + e.value + out.slice(e.end);
  return out;
}

export function labelInches(zpl) {
  const pw = Number(/\^PW(\d+)/.exec(zpl)?.[1]);
  const ll = Number(/\^LL(\d+)/.exec(zpl)?.[1]);
  if (!pw || !ll) return null;
  const inches = (dots) => Math.round((dots / 203) * 100) / 100;
  return { w: inches(pw), h: inches(ll) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/zpl-fields.test.js`
Expected: 6 passing. If the font `numStart` arithmetic is off, the byte-identical round-trip test fails first — fix the offsets, not the test.

- [ ] **Step 5: Run the whole suite**

Run: `node --test`
Expected: all green (78 tests).

### Task 2: Fields, raw-ZPL and preview routes

**Files:**
- Modify: `src/app.js` (imports at top; new routes after `POST /api/labels/:id/print`; `createApp` options)
- Test: `test/printer-file-editor.test.js`

**Interfaces:**
- Consumes: `parseFields`, `applyFields`, `labelInches` from Task 1; `parsePrn` from `src/printer-file.js`; `SIZES` from `src/layout.js`.
- Produces: `createApp({ dataDir, printerOverrides, extractOverride, zplRenderer })` where `zplRenderer({ zpl, w, h }) → Promise<Buffer>` (PNG). Default renderer posts to Labelary.
- Produces routes: `GET /api/labels/:id/fields → { fields, inches }`, `PUT /api/labels/:id/fields { fields, name? } → label`, `PUT /api/labels/:id/zpl { zpl, name? } → label`, `POST /api/preview-zpl { zpl } → image/png`.

- [ ] **Step 1: Write the failing tests**

```js
// test/printer-file-editor.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

function startApp(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-fe-'));
  const app = createApp({ dataDir, ...opts });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
}
const PRN = '^XA^MMT^PW406^LL254^FT43,50^A0N,48,48^FDBACON $69^FS^BY3,2,144^FT63,220^BUN,,Y,N,Y^FD209990069008^FS^PQ1,0,1,Y^XZ';
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function upload(base) {
  return (await fetch(`${base}/api/labels/prn?name=bacon.prn`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: PRN })).json();
}

test('fields round trip: read, edit, save, read back', async () => {
  const { base, close } = await startApp();
  const label = await upload(base);
  const got = await (await fetch(`${base}/api/labels/${label.id}/fields`)).json();
  assert.deepEqual(got.inches, { w: 2, h: 1.25 });
  assert.equal(got.fields.length, 2);
  got.fields[0].text = 'BACON $79';
  const saved = await (await fetch(`${base}/api/labels/${label.id}/fields`, json('PUT', { fields: got.fields, name: 'bacon 79' }))).json();
  assert.equal(saved.fields.name, 'bacon 79');
  assert.ok(saved.zpl.includes('^FDBACON $79^FS'));
  const again = await (await fetch(`${base}/api/labels/${label.id}/fields`)).json();
  assert.equal(again.fields[0].text, 'BACON $79');
  close();
});

test('bad field text and non-file labels are refused', async () => {
  const { base, close } = await startApp();
  const label = await upload(base);
  const bad = await fetch(`${base}/api/labels/${label.id}/fields`, json('PUT', { fields: [{ id: 0, text: 'x^XZ' }] }));
  assert.equal(bad.status, 400);
  const normal = await (await fetch(`${base}/api/labels`, json('POST', { size: '3x5', fields: { name: 'Flour' } }))).json();
  assert.equal((await fetch(`${base}/api/labels/${normal.id}/fields`)).status, 400);
  close();
});

test('raw ZPL save validates and replaces the job', async () => {
  const { base, close } = await startApp();
  const label = await upload(base);
  const bad = await fetch(`${base}/api/labels/${label.id}/zpl`, json('PUT', { zpl: 'nope' }));
  assert.equal(bad.status, 400);
  const ok = await (await fetch(`${base}/api/labels/${label.id}/zpl`, json('PUT', { zpl: '^XA^FDhi^FS^XZ' }))).json();
  assert.equal(ok.zpl, '^XA^FDhi^FS^XZ');
  close();
});

test('preview proxies through the injected renderer with the file size', async () => {
  const calls = [];
  const { base, close } = await startApp({ zplRenderer: async (args) => { calls.push(args); return Buffer.from('PNG!'); } });
  const res = await fetch(`${base}/api/preview-zpl`, json('POST', { zpl: PRN }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'PNG!');
  assert.deepEqual(calls[0], { zpl: PRN, w: 2, h: 1.25 });
  close();
});

test('preview falls back to the loaded roll size and reports renderer failures as 502', async () => {
  const calls = [];
  let fail = false;
  const { base, close } = await startApp({ zplRenderer: async (args) => { calls.push(args); if (fail) throw new Error('labelary down'); return Buffer.alloc(1); } });
  await fetch(`${base}/api/preview-zpl`, json('POST', { zpl: '^XA^FDx^FS^XZ' }));
  assert.deepEqual(calls[0], { zpl: '^XA^FDx^FS^XZ', w: 2.84, h: 5 });
  fail = true;
  const res = await fetch(`${base}/api/preview-zpl`, json('POST', { zpl: '^XA^FDx^FS^XZ' }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /labelary down/);
  close();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/printer-file-editor.test.js`
Expected: 404s from the missing routes (JSON parse errors on HTML bodies count as failures).

- [ ] **Step 3: Implement the routes**

In `src/app.js`, add after the `printer-file.js` import:

```js
import { parseFields, applyFields, labelInches } from './zpl-fields.js';
```

Change the signature and add the default renderer near the top of `createApp`:

```js
export function createApp({ dataDir, printerOverrides = {}, extractOverride, zplRenderer = renderWithLabelary }) {
```

and above `createApp`:

```js
// Labelary draws ZPL at 8 dots/mm (203 dpi): one PNG pixel per printer dot.
async function renderWithLabelary({ zpl, w, h }) {
  const res = await fetch(`http://api.labelary.com/v1/printers/8dpmm/labels/${w}x${h}/0/`, {
    method: 'POST',
    headers: { accept: 'image/png', 'content-type': 'application/x-www-form-urlencoded' },
    body: zpl,
  });
  if (!res.ok) throw new Error(`Labelary ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}
```

Add the routes right after `app.post('/api/labels/:id/print', …)`:

```js
  function requireFileLabel(id) {
    const label = store.get(id);
    if (!label) throw Object.assign(new Error('not found'), { status: 404 });
    if (label.kind !== 'prn') throw Object.assign(new Error('not a printer-file label'), { status: 400 });
    return label;
  }

  app.get('/api/labels/:id/fields', wrap((req, res) => {
    const label = requireFileLabel(req.params.id);
    res.json({ fields: parseFields(label.zpl), inches: labelInches(label.zpl) });
  }));

  app.put('/api/labels/:id/fields', wrap((req, res) => {
    const label = requireFileLabel(req.params.id);
    const zpl = applyFields(label.zpl, Array.isArray(req.body?.fields) ? req.body.fields : []);
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : label.fields.name;
    res.json(store.update(label.id, { zpl, fields: { ...label.fields, name } }));
  }));

  app.put('/api/labels/:id/zpl', wrap((req, res) => {
    const label = requireFileLabel(req.params.id);
    const { zpl, size } = parsePrn(String(req.body?.zpl ?? ''), label.fields.name);
    const name = typeof req.body?.name === 'string' && req.body.name.trim() ? req.body.name.trim() : label.fields.name;
    res.json(store.update(label.id, { zpl, size, fields: { ...label.fields, name } }));
  }));

  // Preview of a raw ZPL job, sized from the file itself or the loaded roll.
  app.post('/api/preview-zpl', wrap(async (req, res) => {
    const zpl = String(req.body?.zpl ?? '');
    let inches = labelInches(zpl);
    if (!inches) {
      const dims = SIZES[config.get().loadedSize] ?? SIZES['3x5'];
      const inch = (d) => Math.round((d / 203) * 100) / 100;
      inches = { w: inch(Math.min(dims.width, dims.height)), h: inch(Math.max(dims.width, dims.height)) };
    }
    try {
      res.type('image/png').send(await zplRenderer({ zpl, w: inches.w, h: inches.h }));
    } catch (err) {
      throw Object.assign(new Error(`preview unavailable: ${err.message}`), { status: 502 });
    }
  }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/printer-file-editor.test.js`
Expected: 5 passing. Then `node --test` — everything green (83 tests).

### Task 3: Client — swipe to edit, Edit button, file editor screen

**Files:**
- Create: `public/file-editor.js`
- Modify: `public/api.js` (add four calls)
- Modify: `public/app.js` (library card swipe, print-sheet Edit button, `#/file/:id` route)
- Modify: `public/style.css` (editor overlay styles)

**Interfaces:**
- Consumes Task 2 routes via `api.getFileFields(id)`, `api.saveFileFields(id, fields, name)`, `api.saveFileZpl(id, zpl, name)`, `api.previewZplBlob(zpl)`.
- Produces: `renderFileEditor(container, label)` exported from `public/file-editor.js`.

- [ ] **Step 1: Add the API calls** to `public/api.js` after `printFileLabel`:

```js
  getFileFields: async (id) => (await call(`/api/labels/${id}/fields`)).json(),
  saveFileFields: async (id, fields, name) => (await call(`/api/labels/${id}/fields`, json('PUT', { fields, name }))).json(),
  saveFileZpl: async (id, zpl, name) => (await call(`/api/labels/${id}/zpl`, json('PUT', { zpl, name }))).json(),
  previewZplBlob: async (zpl) => (await call('/api/preview-zpl', json('POST', { zpl }))).blob(),
```

- [ ] **Step 2: Write `public/file-editor.js`** (full file):

```js
// Editor for imported printer files: the ZebraDesigner ZPL stays the source
// of truth; the user edits its positioned fields on top of a Labelary preview.
import { api } from './api.js';
import { showToast, navigate, SIZE_LABELS } from './app.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function renderFileEditor(container, label) {
  let { fields } = await api.getFileFields(label.id);
  let name = label.fields.name;
  let zpl = label.zpl;
  let dirty = false;
  let selected = fields.find((f) => f.kind === 'text')?.id ?? fields[0]?.id ?? null;

  container.innerHTML = `
    <div class="deck">
      <div class="deck-bar"><span>Printer file · ${label.size ? `${SIZE_LABELS[label.size] ?? label.size}"` : 'size from file'}</span><span id="fe-status"></span></div>
      <div id="fe-preview-wrap"><img id="fe-preview" alt=""><div id="fe-boxes"></div></div>
    </div>
    <label class="field" for="fe-name">Name</label>
    <input id="fe-name" type="text">
    <div id="fe-fields"></div>
    <div class="row">
      <button id="fe-smaller" class="quiet tight" title="Smaller text">A−</button>
      <button id="fe-bigger" class="quiet tight" title="Bigger text">A+</button>
      <span class="hint tight" id="fe-selected"></span>
    </div>
    <div class="row">
      <button id="fe-save" class="accent">Save</button>
      <button id="fe-print" class="quiet">Print</button>
    </div>
    <button id="fe-advanced" class="quiet" style="width:100%">Advanced: edit raw ZPL</button>
    <textarea id="fe-zpl" rows="10" hidden style="font-family:var(--mono);font-size:12px;margin-top:8px"></textarea>`;

  const $ = (sel) => container.querySelector(sel);
  const img = $('#fe-preview');
  const boxes = $('#fe-boxes');
  const status = $('#fe-status');
  $('#fe-name').value = name;
  $('#fe-name').oninput = (e) => { name = e.target.value; dirty = true; };

  // ---- preview ----
  let previewTimer = null;
  let previewUrl = null;
  async function refreshPreview() {
    status.textContent = 'rendering…';
    try {
      const blob = await api.previewZplBlob(currentZpl());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      img.src = previewUrl;
      status.textContent = '';
    } catch (err) {
      status.textContent = 'preview unavailable';
      showToast(err.message, true);
    }
  }
  const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, 400); };
  img.onload = layoutBoxes;
  window.addEventListener('resize', layoutBoxes);

  // The working copy: the stored ZPL with the current field values applied.
  // Done client-side only for the preview; the server applies the real save.
  function currentZpl() { return zpl; }

  // ---- field boxes on the preview ----
  function boxRect(f) {
    const h = f.font?.h ?? (f.kind === 'barcode' ? 150 : 30);
    const w = f.kind === 'barcode' ? 220 : Math.max(40, Math.round(f.text.length * (f.font?.w ?? 30) * 0.6));
    const top = f.origin === 'FT' ? f.y - h : f.y;
    return { x: f.x, y: top, w, h };
  }
  function layoutBoxes() {
    if (!img.naturalWidth) return;
    const scale = img.clientWidth / img.naturalWidth;
    boxes.innerHTML = '';
    for (const f of fields) {
      const r = boxRect(f);
      const el = document.createElement('div');
      el.className = `fe-box${f.id === selected ? ' selected' : ''}${f.rotated ? ' rotated' : ''}`;
      el.style.left = `${r.x * scale}px`; el.style.top = `${r.y * scale}px`;
      el.style.width = `${r.w * scale}px`; el.style.height = `${r.h * scale}px`;
      el.dataset.id = f.id;
      el.onpointerdown = (e) => startDrag(e, f, el, scale);
      boxes.appendChild(el);
    }
  }
  function startDrag(e, f, el, scale) {
    e.preventDefault();
    select(f.id);
    if (f.rotated) return;
    const startX = e.clientX; const startY = e.clientY;
    const origX = f.x; const origY = f.y;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = (ev) => {
      const dx = (ev.clientX - startX) / scale; const dy = (ev.clientY - startY) / scale;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      f.x = Math.max(0, Math.round(origX + dx)); f.y = Math.max(0, Math.round(origY + dy));
      layoutBoxes();
    };
    el.onpointerup = el.onpointercancel = () => {
      el.onpointermove = null;
      if (moved) { dirty = true; syncZplFromFields(); schedulePreview(); }
    };
  }

  // ---- inputs ----
  const list = $('#fe-fields');
  function renderInputs() {
    list.innerHTML = '';
    for (const f of fields) {
      const lab = document.createElement('label');
      lab.className = 'field';
      lab.textContent = f.kind === 'barcode' ? 'Barcode' : `Text ${f.id + 1}${f.rotated ? ' (rotated)' : ''}`;
      const input = document.createElement('input');
      input.type = 'text';
      if (f.kind === 'barcode') input.inputMode = 'numeric';
      input.value = f.text;
      input.dataset.id = f.id;
      input.onfocus = () => select(f.id, false);
      input.oninput = () => { f.text = input.value; dirty = true; syncZplFromFields(); layoutBoxes(); schedulePreview(); };
      list.appendChild(lab); list.appendChild(input);
    }
  }
  function select(id, focus = true) {
    selected = id;
    layoutBoxes();
    const f = fields.find((x) => x.id === id);
    $('#fe-selected').textContent = f ? (f.kind === 'barcode' ? 'Barcode selected' : `Text ${f.id + 1} selected`) : '';
    if (focus) list.querySelector(`input[data-id="${id}"]`)?.focus({ preventScroll: true });
  }
  function resize(factor) {
    const f = fields.find((x) => x.id === selected);
    if (!f || !f.font) return;
    f.font = { h: Math.max(8, Math.round(f.font.h * factor)), w: Math.max(8, Math.round(f.font.w * factor)) };
    dirty = true; syncZplFromFields(); layoutBoxes(); schedulePreview();
  }
  $('#fe-smaller').onclick = () => resize(0.9);
  $('#fe-bigger').onclick = () => resize(1.1);

  // Keep the working ZPL in step with the fields by asking the server to
  // apply them without saving? No such route — instead the save route is the
  // only applier; for preview we apply the same edits locally with a small
  // mirror of the server logic.
  function syncZplFromFields() { zpl = applyLocally(label.zpl, fields); }

  // ---- advanced ----
  const ta = $('#fe-zpl');
  $('#fe-advanced').onclick = () => { ta.hidden = !ta.hidden; if (!ta.hidden) { ta.value = zpl; ta.focus(); } };
  ta.onchange = async () => {
    zpl = ta.value; dirty = true;
    try {
      // Re-read fields from the edited text via the server parser: save is the
      // only parser entry point, so parse client-side with the same rules.
      fields = parseLocally(zpl); selected = fields[0]?.id ?? null;
      renderInputs(); layoutBoxes(); schedulePreview();
    } catch (err) { showToast(err.message, true); }
  };

  // ---- save / print ----
  $('#fe-save').onclick = async () => {
    const btn = $('#fe-save'); btn.disabled = true;
    try {
      const saved = ta.hidden
        ? await api.saveFileFields(label.id, fields, name)
        : await api.saveFileZpl(label.id, zpl, name);
      label = saved; zpl = saved.zpl; dirty = false;
      showToast('Saved');
    } catch (err) { showToast(err.message, true); }
    btn.disabled = false;
  };
  $('#fe-print').onclick = async () => {
    if (dirty) { showToast('Save first, then print', true); return; }
    const qty = parseInt(prompt('How many?', '1'), 10) || 1;
    try {
      const result = await api.printFileLabel(label.id, qty);
      showToast(result.queued ? 'Queued — printing at the station' : 'Sent to printer');
    } catch (err) { showToast(err.message, true); }
  };

  window.onbeforeunload = () => (dirty ? '' : undefined);
  container._leaveGuard = () => !dirty || confirm('Discard unsaved changes to this file?');

  renderInputs();
  select(selected, false);
  refreshPreview();
}
```

**Note for the implementer:** the two placeholders `applyLocally` and `parseLocally` are *not* allowed to be separate logic. Make `src/zpl-fields.js` browser-safe (it has no Node imports) and serve it to the client too: add `app.use('/lib', express.static(path.join(here)))` is **not** acceptable (it would expose all server code). Instead copy the module verbatim into `public/zpl-fields.js` as part of this task and import `parseFields as parseLocally, applyFields as applyLocally` from `'./zpl-fields.js'` in `file-editor.js`. Add a test in `test/zpl-fields.test.js`:

```js
test('the browser copy of zpl-fields is identical to the server module', () => {
  const a = fs.readFileSync(new URL('../src/zpl-fields.js', import.meta.url), 'utf8');
  const b = fs.readFileSync(new URL('../public/zpl-fields.js', import.meta.url), 'utf8');
  assert.equal(a, b);
});
```

(add `import fs from 'node:fs';` at the top of that test file). Replace the "No such route" comment block in the editor with a one-line comment: `// Same parser/applier the server uses (public/zpl-fields.js is a verbatim copy).`

- [ ] **Step 3: Wire the library and route in `public/app.js`**

Imports at the top:

```js
import { renderFileEditor } from './file-editor.js';
```

In `renderLibrary`'s `draw()` file-card branch, replace `card.onclick = () => openFilePrint(...)` with tap-vs-swipe handling:

```js
        attachTapOrSwipe(card,
          () => openFilePrint(label, () => {
            labels.splice(labels.indexOf(label), 1);
            draw(view.querySelector('#search').value);
          }),
          () => navigate(`#/file/${label.id}`));
```

Add the helper above `renderLibrary`:

```js
// Tap = primary action, mostly-horizontal swipe of 40px+ = secondary.
function attachTapOrSwipe(el, onTap, onSwipe) {
  let start = null;
  el.onpointerdown = (e) => { start = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  el.onpointerup = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x; const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.5) onSwipe();
    else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) onTap();
  };
  el.onpointercancel = () => { start = null; };
}
```

In `openFilePrint`, add an Edit button to the modal's last `.row` before Delete:

```html
        <button id="file-edit" class="quiet">Edit</button>
```

and wire it after `#file-close`:

```js
  overlay.querySelector('#file-edit').onclick = () => { close(); navigate(`#/file/${label.id}`); };
```

In `route()`, before the `#/settings` branch:

```js
    } else if (hash.startsWith('#/file/')) {
      setTitle('Edit printer file');
      await renderFileEditor(view, await api.getLabel(hash.slice(7)));
```

At the top of `route()`, honour the leave guard:

```js
  if (view._leaveGuard && !view._leaveGuard()) { history.back(); return; }
  view._leaveGuard = null;
```

- [ ] **Step 4: Styles** — append to `public/style.css`:

```css
/* ---------- printer-file editor ---------- */
#fe-preview-wrap { position: relative; margin: 0 auto; background: #fff; border-radius: 2px; touch-action: none; }
#fe-preview-wrap img { display: block; width: 100%; border-radius: 2px; }
#fe-boxes { position: absolute; inset: 0; }
.fe-box { position: absolute; border: 1px dashed rgba(25, 26, 28, 0.35); cursor: move; }
.fe-box.selected { border: 2px solid var(--accent); }
.fe-box.rotated { cursor: default; border-style: dotted; }
```

- [ ] **Step 5: Verify in the browser pane**

Open `http://localhost:3000/#/` (force-reload with a `?v=` query). Swipe a file card (pointer drag ≥ 40 px horizontally) → editor opens; the preview image loads (needs internet); boxes overlay the fields; typing in "Text 1" updates the preview after ~400 ms; dragging a box moves it; Save returns "Saved"; `GET /api/labels/:id` shows the edited ZPL. Tap a card → print sheet has Edit; Edit opens the editor.

- [ ] **Step 6: Run the whole suite** — `node --test`, expect all green including the verbatim-copy test.

### Task 4: Docs

**Files:**
- Modify: `README.md` (the "Add a .prn to the library" bullet)

- [ ] **Step 1:** Extend the bullet: "Swipe a printer-file card (or tap it and choose **Edit**) to change its text, barcode, position and text size on a live preview; the preview is drawn by the Labelary web service, so it needs internet, while printing does not."

## Self-review

- Spec coverage: parser/applier (T1), routes incl. injectable renderer and 502 (T2), swipe + Edit button + editor with boxes/drag/size stepper/advanced/leave guard (T3), docs (T4). Rotated fields: shown, not draggable (T3 `startDrag` returns early). Fallback size: T2.
- Types: `fields[].font` is `{h,w}|null` everywhere; `zplRenderer({ zpl, w, h })` matches the test's `calls[0]`.
- No placeholders remain after the T3 note replaces `applyLocally`/`parseLocally` with the verbatim public copy.
