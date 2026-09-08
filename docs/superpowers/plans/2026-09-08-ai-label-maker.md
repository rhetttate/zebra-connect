# AI Label Maker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a complete label draft (name, description, ingredients, typed extras, layout) from typed text and/or a product photo in one Claude call, opening it in the existing editor.

**Architecture:** `src/ai-label.js` builds the prompt and turns Claude's structured JSON reply into a validated content object. `src/ai-layout.js` is a pure layout engine that turns that content into a label draft with boxes per size. A new route `POST /api/ai-label` chains the two and hands the phone a normalized draft; the phone's new-label screen posts text and a downscaled photo and opens the editor with the result. The old photo-only `/api/extract` flow is removed.

**Tech Stack:** Node 24 ESM, Express 4, `@anthropic-ai/sdk` (upgraded to 0.124.x), `@napi-rs/canvas`, `node --test`. Plain browser JS, no bundler.

**Spec:** `docs/superpowers/specs/2026-09-08-ai-label-maker-design.md`

**Deviations from the spec (decided while planning, from reading the code):**

1. The editor has no size switcher, so the spec's "re-layout on size change" route (`POST /api/ai-label/layout`) and the stored `fields.ingredients` are dropped as YAGNI. On the small sizes ingredients are simply not placed.
2. The editor creates every new label on the server the moment it opens (`ensureNormalized` in `public/editor.js`), so the AI draft is persisted on open exactly like a blank label, not held unsaved. Nothing to change; just know it.
3. The small sizes (3x2, 2x1.25) use a shorter name box and a shorter barcode than the hand-editing defaults, otherwise no extras row fits above the barcode. The 5x3 keeps its default barcode box.
4. The model's reply carries a `warning` string (normally empty) so "couldn't read the photo" can reach the phone as a toast; the spec left the source of warnings unspecified.

## Global Constraints

- Model id is exactly `claude-opus-5`; request goes through `client.beta.messages.create` with `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`.
- All geometry is in printer dots at 203 dpi. Label sizes: `3x5` 1015×576, `3x2` 576×406, `2x1.25` 406×253 (from `src/layout.js`).
- Extra roles are the closed set `lot, best_by, packed_on, allergens, net, note`, plus `ingredients` for the placed ingredients box only.
- Existing labels must render identically: any renderer change defaults to today's behaviour.
- Tests: `npm test` runs `node --test` over `test/*.test.js`. Run a single file with `node --test test/<file>.test.js`.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never commit `data/` (gitignored: it holds the API key and the label library).

---

## File structure

| File | Responsibility |
|---|---|
| `src/ai-layout.js` (new) | `layoutDraft({ size, content })` → label draft with boxes. Pure. |
| `src/ai-label.js` (new) | Schema, prompt builder, reply parser, the model call, `makeClient`. |
| `src/render.js` (modify) | `drawWrappedText` gains `align`; wrapped extras honour `extra.align`. |
| `src/app.js` (modify) | Keep `extra.role` in `normalizeDraft`; add `/api/ai-label`; remove `/api/extract`; per-route body limit. |
| `src/extract.js`, `test/extract.test.js` (delete) | Replaced by `src/ai-label.js`. |
| `public/api.js` (modify) | `makeLabel` replaces `extract`. |
| `public/app.js` (modify) | "Make it for me" panel on the new-label screen; photo downscale. |
| `public/editor.js` (modify) | Role tags on extras; create-on-open for any draft without an id. |
| `tools/ai-label-try.mjs` (new) | Command-line tuning tool: real model → JSON + PNG. |
| `README.md` (modify) | Describe the maker instead of photo extraction. |
| `test/ai-layout.test.js`, `test/ai-label.test.js` (new), `test/app.test.js`, `test/render.test.js` (modify) | Tests. |

---

### Task 1: Upgrade the Anthropic SDK

The installed SDK (0.65.0) predates structured outputs. The route code passes `output_config` through, so the upgrade is what makes it a typed, supported parameter.

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Upgrade**

```bash
npm install @anthropic-ai/sdk@0.124.0
```

- [ ] **Step 2: Confirm the beta messages surface still exists**

```bash
node -e "import('@anthropic-ai/sdk').then(m => { const c = new m.default({ apiKey: 'x' }); console.log(typeof c.beta.messages.create); })"
```

Expected: `function`

- [ ] **Step 3: Run the whole suite**

```bash
npm test
```

Expected: all pass (the existing `test/extract.test.js` uses a stub client, so it is unaffected).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: upgrade @anthropic-ai/sdk to 0.124.0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Layout engine

**Files:**
- Create: `src/ai-layout.js`
- Test: `test/ai-layout.test.js`

**Interfaces:**
- Consumes: `SIZES`, `defaultLayout(size)` from `src/layout.js`.
- Produces: `ROLE_ORDER` (array of role strings) and `layoutDraft({ size, content })` where `content = { name, description, ingredients, extras: [{ role, text }] }` and the return value is `{ size, fields: { name, description, barcode: '' }, options: { showDescription }, layout: { name, description, barcode }, extras: [{ id, role, text, box, rotation, fit?, align }] }`. Boxes are `{ x, y, w, h }` with no rotation key (`normalizeDraft` fills it).

Layout rules (dots):

| size | margin | gap | name h | extra row h | cols | body |
|---|---|---|---|---|---|---|
| 3x5 | 20 | 10 | 100 | 70 | 2 | left of the default barcode box (x 650): width 610, down to y 556 |
| 3x2 | 20 | 8 | 80 | 50 | 1 | full width, down to a 130-tall barcode at the bottom |
| 2x1.25 | 10 | 6 | 60 | 36 | 1 | full width, down to a 100-tall barcode at the bottom |

Order under the name: optional one-line description (5x3 with ingredients only, 60 tall), extras band in role order, then the body. The body holds the ingredients box on 5x3 (text prefixed `Ingredients: `, wrapped, left aligned) or the description otherwise. If the body is shorter than 60 (5x3) / 40 dots, the description is hidden (and on 5x3 the one-line description is dropped first to make room for ingredients). Small sizes keep only as many extras as fit above the barcode.

- [ ] **Step 1: Write the failing tests**

Create `test/ai-layout.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutDraft, ROLE_ORDER } from '../src/ai-layout.js';
import { SIZES, defaultLayout } from '../src/layout.js';

const content = (over = {}) => ({
  name: 'Almond Flour',
  description: 'Blanched, finely ground.',
  ingredients: '',
  extras: [],
  ...over,
});

const sixExtras = [
  { role: 'lot', text: 'Lot 42' },
  { role: 'best_by', text: 'Best by Oct 15, 2026' },
  { role: 'packed_on', text: 'Packed Sep 8, 2026' },
  { role: 'allergens', text: 'Contains: tree nuts' },
  { role: 'net', text: 'Net wt 2 lb (907 g)' },
  { role: 'note', text: 'Keep refrigerated' },
];

function inside(box, size) {
  const { width, height } = SIZES[size];
  return box.x >= 0 && box.y >= 0 && box.w > 0 && box.h >= 0
    && box.x + box.w <= width && box.y + box.h <= height;
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

// Every box that prints: name, barcode, extras, and the description when shown.
function visibleBoxes(draft) {
  const boxes = [
    { key: 'name', ...draft.layout.name },
    { key: 'barcode', ...draft.layout.barcode },
    ...draft.extras.map((e) => ({ key: e.role, ...e.box })),
  ];
  if (draft.options.showDescription) boxes.push({ key: 'description', ...draft.layout.description });
  return boxes;
}

function assertClean(draft) {
  const boxes = visibleBoxes(draft);
  for (const b of boxes) assert.ok(inside(b, draft.size), `${b.key} outside ${draft.size}: ${JSON.stringify(b)}`);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      assert.ok(!overlaps(boxes[i], boxes[j]), `${boxes[i].key} overlaps ${boxes[j].key} on ${draft.size}`);
    }
  }
}

test('5x3 without ingredients: description takes the body, no extras', () => {
  const draft = layoutDraft({ size: '3x5', content: content() });
  assert.equal(draft.size, '3x5');
  assert.equal(draft.fields.name, 'Almond Flour');
  assert.equal(draft.fields.barcode, '');
  assert.equal(draft.options.showDescription, true);
  assert.deepEqual(draft.extras, []);
  assert.deepEqual(draft.layout.barcode, { ...defaultLayout('3x5').barcode });
  assert.equal(draft.layout.name.h, 100);
  assert.ok(draft.layout.description.h > 300, 'description fills the body');
  assertClean(draft);
});

test('5x3 with ingredients: one-line description, extras band, ingredients body', () => {
  const draft = layoutDraft({ size: '3x5', content: content({
    ingredients: 'Blanched almonds.',
    extras: sixExtras.slice(0, 3),
  }) });
  assert.equal(draft.options.showDescription, true);
  assert.equal(draft.layout.description.h, 60);
  assert.equal(draft.layout.description.y, 130);
  const band = draft.extras.filter((e) => e.role !== 'ingredients');
  assert.deepEqual(band.map((e) => e.role), ['lot', 'best_by', 'packed_on']);
  assert.equal(band[0].box.y, band[1].box.y, 'two per row');
  assert.ok(band[2].box.y > band[0].box.y, 'third wraps to a new row');
  for (const e of band) {
    assert.equal(e.fit, true);
    assert.equal(e.align, 'L');
    assert.equal(e.rotation, 0);
    assert.match(e.id, /^[0-9a-f-]{36}$/);
  }
  const ing = draft.extras.find((e) => e.role === 'ingredients');
  assert.equal(ing.text, 'Ingredients: Blanched almonds.');
  assert.equal(ing.align, 'L');
  assert.equal(ing.fit, undefined, 'ingredients wrap rather than fit one line');
  assert.ok(ing.box.h >= 60);
  assert.equal(ing.box.x + ing.box.w <= draft.layout.barcode.x, true);
  assertClean(draft);
});

test('5x3 drops the description line before squeezing ingredients', () => {
  const draft = layoutDraft({ size: '3x5', content: content({
    ingredients: 'Blanched almonds.',
    extras: [...sixExtras, { role: 'note', text: 'Organic' }],
  }) });
  assert.equal(draft.options.showDescription, false);
  const ing = draft.extras.find((e) => e.role === 'ingredients');
  assert.ok(ing, 'ingredients still placed');
  assert.ok(ing.box.h >= 60);
  assertClean(draft);
});

test('extras are sorted by role, unknown roles and blank text dropped', () => {
  const draft = layoutDraft({ size: '3x5', content: content({ extras: [
    { role: 'note', text: 'Keep cold' },
    { role: 'bogus', text: 'x' },
    { role: 'lot', text: '   ' },
    { role: 'best_by', text: 'Best by Oct 15, 2026' },
    { role: 'lot', text: 'Lot 7' },
  ] }) });
  assert.deepEqual(draft.extras.map((e) => e.role), ['lot', 'best_by', 'note']);
  assert.equal(draft.extras[0].text, 'Lot 7');
});

test('3x2 keeps only the extras that fit and hides the description when squeezed', () => {
  const draft = layoutDraft({ size: '3x2', content: content({ extras: sixExtras.slice(0, 3) }) });
  assert.equal(draft.extras.length, 2);
  assert.deepEqual(draft.extras.map((e) => e.role), ['lot', 'best_by']);
  assert.equal(draft.options.showDescription, false);
  assert.equal(draft.layout.barcode.h, 130);
  assert.equal(draft.layout.barcode.y + draft.layout.barcode.h, 406 - 20);
  assertClean(draft);

  const roomy = layoutDraft({ size: '3x2', content: content({ extras: sixExtras.slice(0, 1) }) });
  assert.equal(roomy.options.showDescription, true);
  assertClean(roomy);
});

test('2x1.25 fits one extra and ignores ingredients', () => {
  const draft = layoutDraft({ size: '2x1.25', content: content({
    ingredients: 'Almonds.',
    extras: sixExtras.slice(0, 2),
  }) });
  assert.equal(draft.extras.length, 1);
  assert.equal(draft.extras[0].role, 'lot');
  assert.ok(!draft.extras.some((e) => e.role === 'ingredients'));
  assert.equal(draft.options.showDescription, false);
  assert.equal(draft.layout.barcode.h, 100);
  assertClean(draft);

  const plain = layoutDraft({ size: '2x1.25', content: content() });
  assert.equal(plain.options.showDescription, true);
  assertClean(plain);
});

test('description is hidden when empty even with room', () => {
  const draft = layoutDraft({ size: '3x5', content: content({ description: '' }) });
  assert.equal(draft.options.showDescription, false);
  assert.ok(draft.layout.description, 'a box still exists so the editor can turn it on');
});

test('every size × extra count × ingredients × description lays out clean', () => {
  for (const size of Object.keys(SIZES)) {
    for (const n of [0, 1, 3, 6]) {
      for (const ingredients of ['', 'Sugar, cocoa butter, whole milk powder, soy lecithin.']) {
        for (const description of ['', 'Dark chocolate bar.']) {
          const draft = layoutDraft({ size, content: content({ ingredients, description, extras: sixExtras.slice(0, n) }) });
          assertClean(draft);
          const roles = draft.extras.filter((e) => e.role !== 'ingredients').map((e) => ROLE_ORDER.indexOf(e.role));
          assert.deepEqual(roles, [...roles].sort((a, b) => a - b), `role order on ${size}`);
        }
      }
    }
  }
});

test('unknown size throws', () => {
  assert.throws(() => layoutDraft({ size: '9x9', content: content() }), /unknown size/);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/ai-layout.test.js
```

Expected: FAIL — cannot find module `../src/ai-layout.js`.

- [ ] **Step 3: Implement**

Create `src/ai-layout.js`:

```js
import crypto from 'node:crypto';
import { SIZES, defaultLayout } from './layout.js';

// Extras print in this order; anything with another role is not an extra.
export const ROLE_ORDER = ['lot', 'best_by', 'packed_on', 'allergens', 'net', 'note'];

// Geometry per size, in dots at 203 dpi. The small sizes use a shorter name
// and barcode than the hand-editing defaults so a band of extras fits.
const PARAMS = {
  '3x5': { margin: 20, gap: 10, nameH: 100, rowH: 70, cols: 2, descLineH: 60, minBody: 60 },
  '3x2': { margin: 20, gap: 8, nameH: 80, rowH: 50, cols: 1, minBody: 40, barcodeH: 130 },
  '2x1.25': { margin: 10, gap: 6, nameH: 60, rowH: 36, cols: 1, minBody: 40, barcodeH: 100 },
};

const box = (x, y, w, h) => ({ x, y, w, h });

function orderedExtras(extras) {
  return (Array.isArray(extras) ? extras : [])
    .map((e) => ({ role: e?.role, text: String(e?.text ?? '').trim() }))
    .filter((e) => ROLE_ORDER.includes(e.role) && e.text)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

export function layoutDraft({ size, content }) {
  const dims = SIZES[size];
  const P = PARAMS[size];
  if (!dims || !P) throw new Error('unknown size');
  const { width, height } = dims;
  const def = defaultLayout(size);

  const name = box(P.margin, P.margin, width - 2 * P.margin, P.nameH);
  let barcode;
  let bodyW;
  let bodyBottom;
  if (size === '3x5') {
    barcode = box(def.barcode.x, def.barcode.y, def.barcode.w, def.barcode.h);
    bodyW = def.barcode.x - 2 * P.gap - P.margin;
    bodyBottom = height - P.margin;
  } else {
    barcode = box(def.barcode.x, height - P.margin - P.barcodeH, def.barcode.w, P.barcodeH);
    bodyW = width - 2 * P.margin;
    bodyBottom = barcode.y - P.gap;
  }

  const description = String(content.description ?? '').trim();
  const ingredients = size === '3x5' ? String(content.ingredients ?? '').trim() : '';
  const bandTop = name.y + name.h + P.gap;

  // Small labels: keep only as many extras as fit above the barcode.
  let extras = orderedExtras(content.extras);
  if (size !== '3x5') {
    const maxRows = Math.max(0, Math.floor((bodyBottom - bandTop + P.gap) / (P.rowH + P.gap)));
    extras = extras.slice(0, maxRows * P.cols);
  }

  // Stack: [one-line description] → extras band → body. Returns what is left.
  function place(withDescLine) {
    let y = bandTop;
    const layout = { name, barcode };
    if (withDescLine) {
      layout.description = box(P.margin, y, bodyW, P.descLineH);
      y += P.descLineH + P.gap;
    }
    const colW = Math.floor((bodyW - (P.cols - 1) * P.gap) / P.cols);
    const placed = extras.map((e, i) => ({
      id: crypto.randomUUID(),
      role: e.role,
      text: e.text,
      box: box(
        P.margin + (i % P.cols) * (colW + P.gap),
        y + Math.floor(i / P.cols) * (P.rowH + P.gap),
        colW,
        P.rowH,
      ),
      rotation: 0,
      fit: true,
      align: 'L',
    }));
    if (extras.length) y += Math.ceil(extras.length / P.cols) * (P.rowH + P.gap);
    return { layout, placed, bodyY: y, bodyH: bodyBottom - y };
  }

  let result = place(Boolean(ingredients && description));
  if (ingredients && result.layout.description && result.bodyH < P.minBody) result = place(false);
  const { layout, placed, bodyY, bodyH } = result;

  let showDescription = Boolean(layout.description);
  if (ingredients && bodyH >= P.minBody) {
    placed.push({
      id: crypto.randomUUID(),
      role: 'ingredients',
      text: `Ingredients: ${ingredients}`,
      box: box(P.margin, bodyY, bodyW, bodyH),
      rotation: 0,
      align: 'L',
    });
  }
  if (!layout.description) {
    // The body box is the description's home whether or not it is shown, so
    // the editor's checkbox has somewhere sensible to reveal it.
    const h = Math.max(bodyH, P.minBody);
    layout.description = box(P.margin, Math.min(bodyY, bodyBottom - h), bodyW, h);
    showDescription = !ingredients && Boolean(description) && bodyH >= P.minBody;
  }

  return {
    size,
    fields: { name: String(content.name ?? '').trim(), description, barcode: '' },
    options: { showDescription },
    layout,
    extras: placed,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node --test test/ai-layout.test.js
```

Expected: all pass. If the "drops the description line" test fails on `bodyH`, recheck the arithmetic: 5x3 band top is 130; seven extras in two columns are four rows of 80 = 320, so the body starts at 450 and is 106 tall, above the 60 minimum only when the description line is gone.

- [ ] **Step 5: Commit**

```bash
git add src/ai-layout.js test/ai-layout.test.js
git commit -m "feat: deterministic layout engine for AI-made labels

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Left-aligned wrapped text in the renderer

**Files:**
- Modify: `src/render.js` (`drawWrappedText` at line 90; the extras loop at line 148)
- Test: `test/render.test.js`

**Interfaces:**
- Produces: `drawWrappedText(ctx, text, box, { align = 'C' } = {})`. For `'L'` and `'R'` the lines are anchored to the top of the box and to that edge; `'C'` is today's centred-both-ways behaviour. `renderCanvas` passes `extra.align` for wrapped (non-`fit`) extras.

- [ ] **Step 1: Write the failing test**

Append to `test/render.test.js`:

```js
function blackIn(bmp, x0, x1, y0, y1) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (bmp.data[y * bmp.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) return true;
    }
  }
  return false;
}

test('wrapped extras honour align L (left, top anchored) and default to centred', async () => {
  const base = {
    size: '3x2',
    fields: { name: '', description: '', barcode: '' },
    options: { showDescription: false },
    layout: defaultLayout('3x2'),
  };
  const extra = { id: 'e1', text: 'Hi', box: { x: 20, y: 150, w: 500, h: 60 }, rotation: 0 };

  const left = await renderPrintBitmap({ ...base, extras: [{ ...extra, align: 'L' }] });
  assert.ok(blackIn(left, 20, 80, 150, 210), 'left-aligned text starts at the left edge');
  assert.ok(!blackIn(left, 300, 520, 150, 210), 'nothing in the right half');

  const centred = await renderPrintBitmap({ ...base, extras: [extra] });
  assert.ok(!blackIn(centred, 20, 80, 150, 210), 'centred text leaves the left edge blank');
  assert.ok(blackIn(centred, 200, 340, 150, 210), 'centred text sits in the middle');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/render.test.js
```

Expected: FAIL on "left-aligned text starts at the left edge" (today everything is centred).

- [ ] **Step 3: Implement**

In `src/render.js`, replace the `drawWrappedText` function with:

```js
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
```

And in `renderCanvas`, change the wrapped-extra branch:

```js
    else drawWrappedText(ctx, extra.text, box, { align: extra.align });
```

- [ ] **Step 4: Run to verify it passes**

```bash
node --test test/render.test.js
```

Expected: all pass, including the pre-existing render tests (they use the centred default).

- [ ] **Step 5: Commit**

```bash
git add src/render.js test/render.test.js
git commit -m "feat: wrapped text fields can align left or right

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Prompt, schema, parser, and model call

**Files:**
- Create: `src/ai-label.js`
- Test: `test/ai-label.test.js`

**Interfaces:**
- Consumes: `ROLE_ORDER` from `src/ai-layout.js`.
- Produces:
  - `MODEL = 'claude-opus-5'`, `CONTENT_SCHEMA` (JSON schema object).
  - `buildPrompt({ size, text, image, today, examples })` → `{ system, messages }`. `image` is `{ mediaType, data }` (base64) or `null`; `today` is a `Date`; `examples` is `[{ name, description }]`.
  - `parseContent(raw)` → `{ name, description, ingredients, extras: [{ role, text }], warning }` with unknown roles dropped, one per role (two for `note`), blank text dropped.
  - `makeLabelContent({ size, text, image }, client, { today, examples })` → the parsed content. Throws `Error('label maker refused')` on `stop_reason === 'refusal'`, `Error('could not parse label content')` on a bad reply.
  - `makeClient(apiKey)` → an `Anthropic` client (moved from `src/extract.js`).

- [ ] **Step 1: Write the failing tests**

Create `test/ai-label.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseContent, makeLabelContent, CONTENT_SCHEMA, MODEL } from '../src/ai-label.js';

const today = new Date(2026, 8, 8); // Sep 8, 2026 (local time)

function stubClient(response) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params) => { calls.push(params); return response; } } },
  };
}

const good = JSON.stringify({
  name: 'Almond Flour',
  description: 'Blanched, finely ground.',
  ingredients: 'Blanched almonds.',
  extras: [{ role: 'lot', text: 'Lot 42' }, { role: 'best_by', text: 'Best by Oct 15, 2026' }],
  warning: '',
});

test('buildPrompt puts the rules, today, the size, and examples in the system prompt', () => {
  const { system, messages } = buildPrompt({
    size: '3x5', text: 'almond flour lot 42', image: null, today,
    examples: [{ name: 'Olive Oil', description: 'Extra virgin, cold pressed' }],
  });
  assert.match(system, /Today is Sep 8, 2026/);
  assert.match(system, /5 × 3 inch/);
  assert.match(system, /"lot"|lot:/);
  assert.match(system, /Olive Oil — Extra virgin, cold pressed/);
  assert.ok(system.indexOf('Olive Oil') > system.indexOf('Today is'), 'examples come last so the fixed prefix caches');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.deepEqual(messages[0].content.map((b) => b.type), ['text']);
  assert.match(messages[0].content[0].text, /almond flour lot 42/);
});

test('buildPrompt sends the photo before the text, and works with a photo alone', () => {
  const image = { mediaType: 'image/jpeg', data: 'AAAA' };
  const both = buildPrompt({ size: '3x2', text: 'lot 9', image, today, examples: [] });
  assert.deepEqual(both.messages[0].content.map((b) => b.type), ['image', 'text']);
  assert.deepEqual(both.messages[0].content[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' });
  assert.match(both.messages[0].content[1].text, /lot 9/);
  assert.match(both.messages[0].content[1].text, /photo/i);

  const alone = buildPrompt({ size: '3x2', text: '', image, today, examples: [] });
  assert.deepEqual(alone.messages[0].content.map((b) => b.type), ['image', 'text']);
  assert.match(alone.messages[0].content[1].text, /photo/i);
});

test('parseContent validates roles, dedupes, caps notes, and fills gaps', () => {
  const out = parseContent({
    name: '  Salt ',
    extras: [
      { role: 'note', text: 'A' }, { role: 'note', text: 'B' }, { role: 'note', text: 'C' },
      { role: 'lot', text: 'Lot 1' }, { role: 'lot', text: 'Lot 2' },
      { role: 'bogus', text: 'x' }, { role: 'net', text: '   ' }, 'junk',
    ],
  });
  assert.equal(out.name, 'Salt');
  assert.equal(out.description, '');
  assert.equal(out.ingredients, '');
  assert.equal(out.warning, '');
  assert.deepEqual(out.extras, [
    { role: 'note', text: 'A' }, { role: 'note', text: 'B' }, { role: 'lot', text: 'Lot 1' },
  ]);
});

test('parseContent rejects a reply without a name', () => {
  assert.throws(() => parseContent({ name: '', extras: [] }), /could not parse/);
  assert.throws(() => parseContent(null), /could not parse/);
});

test('makeLabelContent calls the model with structured output and parses the reply', async () => {
  const client = stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: good }] });
  const out = await makeLabelContent(
    { size: '3x5', text: 'almond flour lot 42', image: { mediaType: 'image/png', data: 'BBBB' } },
    client, { today, examples: [] },
  );
  assert.equal(out.name, 'Almond Flour');
  assert.equal(out.ingredients, 'Blanched almonds.');
  assert.deepEqual(out.extras.map((e) => e.role), ['lot', 'best_by']);

  const params = client.calls[0];
  assert.equal(params.model, MODEL);
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.output_config.format, { type: 'json_schema', schema: CONTENT_SCHEMA });
  assert.equal(params.messages[0].content[0].type, 'image');
  assert.equal(params.messages[0].content[0].source.media_type, 'image/png');
});

test('makeLabelContent tolerates prose or fences around the JSON', async () => {
  const client = stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n' + good + '\n```' }] });
  const out = await makeLabelContent({ size: '3x5', text: 'x', image: null }, client, { today });
  assert.equal(out.name, 'Almond Flour');
});

test('makeLabelContent throws on refusal and on garbage', async () => {
  await assert.rejects(
    makeLabelContent({ size: '3x5', text: 'x', image: null },
      stubClient({ stop_reason: 'refusal', content: [] }), { today }),
    /refused/,
  );
  await assert.rejects(
    makeLabelContent({ size: '3x5', text: 'x', image: null },
      stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'no json here' }] }), { today }),
    /could not parse/,
  );
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/ai-label.test.js
```

Expected: FAIL — cannot find module `../src/ai-label.js`.

- [ ] **Step 3: Implement**

Create `src/ai-label.js`:

```js
import Anthropic from '@anthropic-ai/sdk';
import { ROLE_ORDER } from './ai-layout.js';

export const MODEL = 'claude-opus-5';

export const CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    ingredients: { type: 'string' },
    extras: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ROLE_ORDER },
          text: { type: 'string' },
        },
        required: ['role', 'text'],
        additionalProperties: false,
      },
    },
    warning: { type: 'string' },
  },
  required: ['name', 'description', 'ingredients', 'extras', 'warning'],
  additionalProperties: false,
};

const SIZE_WORDS = {
  '3x5': '5 × 3 inch, landscape — room for a description line, several extras, and the full ingredient list',
  '3x2': '3 × 2 inch — room for the name, one or two short extras, and a barcode',
  '2x1.25': '2 × 1.25 inch — room for the name, one short extra, and a barcode',
};

const RULES = `You write the content for food inventory labels at a small store. The labels print on a thermal label printer, so every value must be short, literal, and plain text.

Reply with a JSON object of exactly this shape:
{"name": string, "description": string, "ingredients": string, "extras": [{"role": string, "text": string}], "warning": string}

Field rules:
- name: the product name, 2 to 5 words, Title Case, no slogans or marketing words. Include the variety when it matters ("Almond Flour", "Whole Milk Yogurt"). Required.
- description: one short sentence about what it is (brand, variety, or form), or "" when the input gives nothing beyond the name.
- ingredients: the ingredient list exactly as the input gives it, complete and in the same order, comma separated, without the word "Ingredients" in front. "" when the input has no ingredient list. Never guess ingredients; if only part of a list is legible, include what you can read and say so in warning.
- extras: zero or more items with these roles, at most one per role except note (at most two). Skip any role the input does not support.
  - lot: "Lot 42"
  - best_by: "Best by Oct 15, 2026"
  - packed_on: "Packed Sep 8, 2026"
  - allergens: "Contains: tree nuts, wheat" — only allergens the input states; a "may contain" line becomes "May contain: ..."
  - net: "Net wt 2 lb (907 g)" or "12 ct" — units as the input gives them; add the metric value only if the input shows it
  - note: any other short instruction worth printing, such as "Keep refrigerated" or "Organic". Under 40 characters each.
- warning: "" normally. One short sentence for the user when the photo is unreadable, the input contradicts itself, or you had to leave something out.

Write dates as "Mon D, YYYY". Resolve relative dates ("packed today", "best by end of month") against today's date.

Never invent details: everything you output must come from the input. If a photo is illegible, still return the best name you can and explain in warning.`;

export function buildPrompt({ size, text = '', image = null, today, examples = [] }) {
  const date = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  let system = `${RULES}\n\nToday is ${date}.\n\nThe label is ${SIZE_WORDS[size] ?? size}. Return ingredients even for the small sizes; the app decides what fits.`;
  const lines = examples
    .filter((e) => e?.name && e?.description)
    .map((e) => `- ${e.name} — ${e.description}`);
  if (lines.length) {
    system += `\n\nExamples of how this store names and describes products:\n${lines.join('\n')}`;
  }

  const content = [];
  if (image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  }
  const trimmed = String(text ?? '').trim();
  let ask;
  if (trimmed && image) ask = `Make the label from the photo and these notes (the notes win where they disagree):\n${trimmed}`;
  else if (trimmed) ask = `Make the label from this:\n${trimmed}`;
  else ask = 'Read the photo and make the label.';
  content.push({ type: 'text', text: ask });

  return { system, messages: [{ role: 'user', content }] };
}

const NOTE_LIMIT = 2;

export function parseContent(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('could not parse label content');
  const name = String(raw.name ?? '').trim();
  if (!name) throw new Error('could not parse label content');
  const seen = {};
  const extras = [];
  for (const item of Array.isArray(raw.extras) ? raw.extras : []) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role;
    const text = String(item.text ?? '').trim();
    if (!ROLE_ORDER.includes(role) || !text) continue;
    seen[role] = (seen[role] ?? 0) + 1;
    if (seen[role] > (role === 'note' ? NOTE_LIMIT : 1)) continue;
    extras.push({ role, text });
  }
  return {
    name,
    description: String(raw.description ?? '').trim(),
    ingredients: String(raw.ingredients ?? '').trim(),
    extras,
    warning: String(raw.warning ?? '').trim(),
  };
}

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
  if (response.stop_reason === 'refusal') throw new Error('label maker refused this input');
  const textOut = (response.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const match = textOut.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('could not parse label content');
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('could not parse label content');
  }
  return parseContent(parsed);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node --test test/ai-label.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ai-label.js test/ai-label.test.js
git commit -m "feat: prompt, schema and parser for the AI label maker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Keep extra roles through the label API

**Files:**
- Modify: `src/app.js` (`normalizeDraft`, the extras `map` around lines 68-93)
- Test: `test/app.test.js`

**Interfaces:**
- Produces: saved and returned extras carry `role` when it is one of `lot, best_by, packed_on, allergens, net, note, ingredients`; any other value is dropped.

- [ ] **Step 1: Write the failing test**

Append to `test/app.test.js`:

```js
test('labels keep known extra roles and drop unknown ones', async () => {
  const { base, close } = await startApp();
  const created = await (await fetch(`${base}/api/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      size: '3x5',
      fields: { name: 'Flour' },
      extras: [
        { id: 'a', role: 'lot', text: 'Lot 1', box: { x: 0, y: 0, w: 100, h: 40 }, rotation: 0 },
        { id: 'b', role: 'ingredients', text: 'Ingredients: wheat', box: { x: 0, y: 50, w: 100, h: 40 }, rotation: 0 },
        { id: 'c', role: 'bogus', text: 'x', box: { x: 0, y: 100, w: 100, h: 40 }, rotation: 0 },
      ],
    }),
  })).json();
  assert.equal(created.extras[0].role, 'lot');
  assert.equal(created.extras[1].role, 'ingredients');
  assert.equal('role' in created.extras[2], false);
  close();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/app.test.js
```

Expected: FAIL — `created.extras[0].role` is `undefined`.

- [ ] **Step 3: Implement**

In `src/app.js`, add near the top of `createApp` (next to `const ROTATIONS = ...`):

```js
  const EXTRA_ROLES = ['lot', 'best_by', 'packed_on', 'allergens', 'net', 'note', 'ingredients'];
```

and inside the extras `map` in `normalizeDraft`, after the `if (extra.fit) out.fit = true;` line:

```js
        if (EXTRA_ROLES.includes(extra.role)) out.role = extra.role;
```

- [ ] **Step 4: Run to verify it passes**

```bash
node --test test/app.test.js
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app.js test/app.test.js
git commit -m "feat: labels keep the role of AI-made extra fields

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The `/api/ai-label` route, replacing `/api/extract`

**Files:**
- Modify: `src/app.js` (imports; `createApp` signature; the `express.json` middleware; the `/api/extract` block at lines 297-314)
- Delete: `src/extract.js`, `test/extract.test.js`
- Test: `test/app.test.js` (replace the two `extract` tests)

**Interfaces:**
- Consumes: `layoutDraft` (Task 2), `makeLabelContent`, `makeClient` (Task 4), `generateUpcA`.
- Produces: `createApp({ ..., aiLabelOverride })` where `aiLabelOverride({ size, text, image })` returns a content object like `parseContent` does. `POST /api/ai-label` with JSON `{ size, text?, image?: { mediaType, data } }` → normalized draft plus `warnings: string[]`. Errors: 400 no key / unknown size / no input, 415 bad image type, 502 model failure.

- [ ] **Step 1: Write the failing tests**

In `test/app.test.js`, delete the two tests named `extract requires an API key, then returns extracted fields` and `extract rejects unsupported image types with 415`, and add:

```js
function startAiApp(aiLabelOverride) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-app-'));
  const app = createApp({ dataDir, aiLabelOverride });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', async () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      await fetch(`${base}/api/settings`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-test' }),
      });
      resolve({ base, close: () => server.close() });
    });
  });
}

const postJson = (url, body) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('ai-label requires an API key', async () => {
  const { base, close } = await startApp();
  const res = await postJson(`${base}/api/ai-label`, { size: '3x5', text: 'flour' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /API key/);
  close();
});

test('ai-label validates its input', async () => {
  const { base, close } = await startAiApp(async () => ({ name: 'x', description: '', ingredients: '', extras: [], warning: '' }));
  assert.equal((await postJson(`${base}/api/ai-label`, { size: '9x9', text: 'flour' })).status, 400);
  const empty = await postJson(`${base}/api/ai-label`, { size: '3x5', text: '   ' });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /describe|photo/i);
  const heic = await postJson(`${base}/api/ai-label`, { size: '3x5', image: { mediaType: 'image/heic', data: 'AAAA' } });
  assert.equal(heic.status, 415);
  close();
});

test('ai-label returns a normalized draft with a fresh barcode, roles and warnings', async () => {
  const seen = [];
  const { base, close } = await startAiApp(async (input) => {
    seen.push(input);
    return {
      name: 'Almond Flour', description: 'Blanched.', ingredients: 'Blanched almonds.',
      extras: [{ role: 'lot', text: 'Lot 42' }], warning: 'Photo was blurry',
    };
  });
  const res = await postJson(`${base}/api/ai-label`, {
    size: '3x5', text: 'almond flour', image: { mediaType: 'image/jpeg', data: 'AAAA' },
  });
  assert.equal(res.status, 200);
  const draft = await res.json();
  assert.equal(draft.id, undefined, 'not saved yet');
  assert.equal(draft.size, '3x5');
  assert.equal(draft.fields.name, 'Almond Flour');
  assert.match(draft.fields.barcode, /^\d{12}$/);
  assert.equal(draft.options.showDescription, true);
  assert.equal(draft.layout.name.rotation, 0);
  assert.deepEqual(draft.extras.map((e) => e.role), ['lot', 'ingredients']);
  assert.deepEqual(draft.warnings, ['Photo was blurry']);
  assert.deepEqual(seen[0], { size: '3x5', text: 'almond flour', image: { mediaType: 'image/jpeg', data: 'AAAA' } });
  close();
});

test('ai-label reports model failures as 502 and accepts a large photo body', async () => {
  const { base, close } = await startAiApp(async () => { throw new Error('label maker refused this input'); });
  const res = await postJson(`${base}/api/ai-label`, {
    size: '3x2', text: 'x', image: { mediaType: 'image/jpeg', data: 'A'.repeat(2_000_000) },
  });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /refused/);
  close();
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test test/app.test.js
```

Expected: the four new tests FAIL with 404s (route missing).

- [ ] **Step 3: Implement**

In `src/app.js`:

Replace the import line `import { extractLabelFields, makeClient } from './extract.js';` with:

```js
import { makeLabelContent, makeClient } from './ai-label.js';
import { layoutDraft } from './ai-layout.js';
```

Change the `createApp` signature:

```js
export function createApp({ dataDir, printerOverrides = {}, aiLabelOverride, zplRenderer = renderWithLabelary }) {
```

Replace `app.use(express.json({ limit: '1mb' }));` with:

```js
  // The AI label maker posts a base64 photo, far over 1 MB; it parses its own body.
  const AI_LABEL_PATH = '/api/ai-label';
  const jsonBody = express.json({ limit: '1mb' });
  app.use((req, res, next) => (req.path === AI_LABEL_PATH ? next() : jsonBody(req, res, next)));
```

Replace the whole `/api/extract` block (from `const IMAGE_TYPES = ...` through its closing `}));`) with:

```js
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function requireApiKey() {
    const apiKey = config.get().apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw Object.assign(new Error('no API key configured — add one in Settings'), { status: 400 });
  }

  // Recent hand-written labels show the model the store's naming style.
  function houseExamples() {
    return store.list()
      .filter((l) => l.kind !== 'prn' && l.fields?.name && l.fields?.description)
      .slice(0, 5)
      .map((l) => ({ name: l.fields.name, description: l.fields.description }));
  }

  app.post(AI_LABEL_PATH, express.json({ limit: '30mb' }), wrap(async (req, res) => {
    requireApiKey();
    const { size, image } = req.body ?? {};
    const text = String(req.body?.text ?? '').trim();
    if (!SIZES[size]) throw Object.assign(new Error('unknown size'), { status: 400 });
    if (!text && !image) {
      throw Object.assign(new Error('describe the product or add a photo first'), { status: 400 });
    }
    if (image && (!IMAGE_TYPES.includes(image.mediaType) || typeof image.data !== 'string' || !image.data)) {
      throw Object.assign(new Error('unsupported image type — use a JPEG or PNG photo'), { status: 415 });
    }
    const make = aiLabelOverride
      ?? ((input) => makeLabelContent(input, makeClient(config.get().apiKey), { examples: houseExamples() }));
    let content;
    try {
      content = await make({ size, text, image: image ?? null });
    } catch (err) {
      throw Object.assign(err, { status: 502 });
    }
    const draft = normalizeDraft(layoutDraft({ size, content }));
    draft.fields.barcode = generateUpcA((c) => store.barcodeExists(c));
    res.json({ ...draft, warnings: content.warning ? [content.warning] : [] });
  }));
```

Note `image: image ?? null` — the third test's `deepEqual` expects the image object as sent; when the phone sends no image the override sees `null`.

Then delete the old module and its tests:

```bash
git rm src/extract.js test/extract.test.js
```

- [ ] **Step 4: Run the whole suite**

```bash
npm test
```

Expected: all pass. If the 2 MB body test fails with 413, the per-route parser is not being reached: confirm the `app.use` wrapper compares `req.path` (not `req.url`) and that the route is registered with `AI_LABEL_PATH`.

- [ ] **Step 5: Commit**

```bash
git add src/app.js test/app.test.js
git commit -m "feat: POST /api/ai-label makes a full label draft; drop /api/extract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Tuning tool and a real-model check

**Files:**
- Create: `tools/ai-label-try.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `makeLabelContent`, `makeClient` (Task 4), `layoutDraft` (Task 2), `renderPreview` (`src/render.js`), `generateUpcA`, `createStore`, `createConfig`.

- [ ] **Step 1: Write the tool**

Create `tools/ai-label-try.mjs`:

```js
#!/usr/bin/env node
// Run real inputs through the AI label maker and look at the result.
//   node tools/ai-label-try.mjs <size> [--text "..."] [--photo file.jpg] [--out dir]
// Writes <out>/<n>.json (the model's content + the draft) and <out>/<n>.png
// (the rendered label). Uses the API key from data/config.json or the
// ANTHROPIC_API_KEY environment variable. Default out dir: ai-label-out/.
import fs from 'node:fs';
import path from 'node:path';
import { makeLabelContent, makeClient } from '../src/ai-label.js';
import { layoutDraft } from '../src/ai-layout.js';
import { renderPreview } from '../src/render.js';
import { generateUpcA } from '../src/barcode.js';
import { createStore } from '../src/store.js';
import { createConfig } from '../src/config.js';

const args = process.argv.slice(2);
const size = args[0];
const opt = (flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
const text = opt('--text') ?? '';
const photo = opt('--photo');
const out = opt('--out') ?? 'ai-label-out';
if (!size || (!text && !photo)) {
  console.error('usage: node tools/ai-label-try.mjs <3x5|3x2|2x1.25> [--text "..."] [--photo file] [--out dir]');
  process.exit(2);
}

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
let image = null;
if (photo) {
  const mediaType = MEDIA[path.extname(photo).toLowerCase()];
  if (!mediaType) { console.error('photo must be .jpg, .png or .webp'); process.exit(2); }
  image = { mediaType, data: fs.readFileSync(photo).toString('base64') };
}

const dataDir = path.join(process.cwd(), 'data');
const config = createConfig(path.join(dataDir, 'config.json'));
const store = createStore(path.join(dataDir, 'labels.json'));
const examples = store.list()
  .filter((l) => l.kind !== 'prn' && l.fields?.name && l.fields?.description)
  .slice(0, 5)
  .map((l) => ({ name: l.fields.name, description: l.fields.description }));

const started = Date.now();
const content = await makeLabelContent({ size, text, image }, makeClient(config.get().apiKey), { examples });
const draft = layoutDraft({ size, content });
draft.fields.barcode = generateUpcA(() => false);
const png = await renderPreview({ ...draft, options: draft.options, layout: draft.layout });

fs.mkdirSync(out, { recursive: true });
const n = fs.readdirSync(out).filter((f) => f.endsWith('.png')).length + 1;
fs.writeFileSync(path.join(out, `${n}.json`), JSON.stringify({ input: { size, text, photo }, content, draft }, null, 2));
fs.writeFileSync(path.join(out, `${n}.png`), png);
console.log(JSON.stringify(content, null, 2));
console.log(`wrote ${out}/${n}.png in ${((Date.now() - started) / 1000).toFixed(1)}s`);
```

`renderPreview` expects `layout.*.rotation` to be present or absent both fine (`drawRotated` treats missing as 0), so the un-normalized draft renders as-is.

Add to `.gitignore`:

```
# AI label maker tuning output
ai-label-out/
```

- [ ] **Step 2: Run it against the real model, text only**

```bash
node tools/ai-label-try.mjs 3x5 --text "Organic almond flour, lot 42, best by Oct 15, contains tree nuts, packed today. Ingredients: blanched almonds."
```

Expected: JSON with name "Almond Flour" (or "Organic Almond Flour"), a `best_by` of `Best by Oct 15, 2026`, a `packed_on` with today's date, `allergens` "Contains: tree nuts", `ingredients` "Blanched almonds.", and a PNG at `ai-label-out/1.png`. Open the PNG (`start ai-label-out\1.png` in PowerShell) and check: name across the top, extras in two columns, ingredients paragraph left aligned above the bottom margin, barcode on the right.

If the API returns a 400 mentioning `output_config` or `format`, the structured-output parameter is not accepted on the beta path with fallbacks. In that case remove the `output_config` line from `makeLabelContent` in `src/ai-label.js` and drop the `output_config` assertion from `test/ai-label.test.js`; the prompt already spells out the JSON shape and the parser tolerates prose around it.

- [ ] **Step 3: Run it with a photo**

Take or find a photo of a packaged food product showing its ingredient panel, save it as `ai-label-out/sample.jpg`, then:

```bash
node tools/ai-label-try.mjs 3x5 --photo ai-label-out/sample.jpg
```

Expected: the ingredient list transcribed in order; allergens only if the panel states them; `warning` empty unless part of the panel was unreadable. Then:

```bash
node tools/ai-label-try.mjs 3x2 --photo ai-label-out/sample.jpg --text "lot 9"
```

Expected: a 3x2 PNG with the name, "Lot 9" and at most one more extra, barcode at the bottom, nothing overlapping.

- [ ] **Step 4: Tune if needed**

If names come back too long or descriptions too chatty, tighten the wording in `RULES` in `src/ai-label.js` (the rules text is the only thing to change; the schema and parser stay). Re-run `node --test test/ai-label.test.js` after any edit, since it pins parts of the prompt.

- [ ] **Step 5: Commit**

```bash
git add tools/ai-label-try.mjs .gitignore src/ai-label.js test/ai-label.test.js
git commit -m "chore: command-line tuning tool for the AI label maker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Phone screen — "Make it for me"

**Files:**
- Modify: `public/api.js` (the `extract` entry)
- Modify: `public/app.js` (`renderNew`, lines 317-400)
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `POST /api/ai-label` (Task 6), `renderEditor(view, draft)` from `public/editor.js`, `api.getSettings()` for `loadedSize`.
- Produces: `api.makeLabel({ size, text, image })` → draft JSON with `warnings`.

No automated browser tests exist in this repo; verification is manual in the in-app browser (see Step 5).

- [ ] **Step 1: Client API**

In `public/api.js`, replace the `extract` entry with:

```js
  makeLabel: async (body) => (await call('/api/ai-label', json('POST', body))).json(),
```

- [ ] **Step 2: Styles**

Append to `public/style.css`:

```css
.maker textarea { width: 100%; box-sizing: border-box; }
.maker-photo { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
.maker-photo img { width: 64px; height: 64px; object-fit: cover; border-radius: 8px; border: 1px solid var(--line, #ddd); }
.maker-photo .remove { padding: 6px 10px; }
```

- [ ] **Step 3: The panel and its logic**

In `public/app.js`, inside `renderNew`, replace the block from `<p class="eyebrow">Start from a photo</p>` through `<p class="hint">Snap the product or its packaging. The name and description fill in for you.</p>` with:

```html
    <p class="eyebrow">Make it for me</p>
    <div class="maker">
      <textarea id="maker-text" rows="3" placeholder="Almond flour, lot 42, best by Oct 15, contains tree nuts…"></textarea>
      <div class="maker-photo" id="maker-photo" hidden>
        <img id="maker-thumb" alt="chosen photo">
        <span class="hint" style="flex:1;margin:0">Photo attached</span>
        <button id="maker-remove" class="quiet remove" title="Remove photo">${icon('trash')}</button>
      </div>
      <div class="row">
        <button id="maker-camera" class="quiet">${icon('camera')} Add a photo</button>
        <select id="maker-size" class="tight" style="width:110px">
          <option value="3x5">5 × 3</option>
          <option value="3x2">3 × 2</option>
          <option value="2x1.25">2 × 1.25</option>
        </select>
        <button id="maker-go" class="accent" disabled>Make label</button>
      </div>
      <p class="hint">Type what should be on the label, snap the product or its ingredient panel, or both. Ingredients only fit on 5 × 3 labels.</p>
    </div>
```

Replace `<input id="photo-input" type="file" accept="image/*" capture="environment" hidden>` with:

```html
    <input id="maker-input" type="file" accept="image/*" capture="environment" hidden>
```

Then replace the `photoInput` handler block (from `const photoInput = view.querySelector('#photo-input');` through the end of `photoInput.onchange = ...};`) with:

```js
  const makerText = view.querySelector('#maker-text');
  const makerSize = view.querySelector('#maker-size');
  const makerGo = view.querySelector('#maker-go');
  const makerInput = view.querySelector('#maker-input');
  const makerPhoto = view.querySelector('#maker-photo');
  const makerThumb = view.querySelector('#maker-thumb');
  let photo = null; // { mediaType, data } once shrunk

  api.getSettings().then((s) => { if (s.loadedSize) makerSize.value = s.loadedSize; }).catch(() => {});

  const syncGo = () => { makerGo.disabled = !(makerText.value.trim() || photo); };
  makerText.oninput = syncGo;

  view.querySelector('#maker-camera').onclick = () => { makerInput.value = ''; makerInput.click(); };
  makerInput.onchange = async () => {
    const file = makerInput.files[0];
    if (!file) return;
    try {
      photo = await shrinkPhoto(file);
      makerThumb.src = `data:${photo.mediaType};base64,${photo.data}`;
      makerPhoto.hidden = false;
    } catch (err) {
      showToast(`Couldn't read that photo: ${err.message}`, true);
    }
    syncGo();
  };
  view.querySelector('#maker-remove').onclick = () => {
    photo = null;
    makerThumb.src = '';
    makerPhoto.hidden = true;
    syncGo();
  };

  makerGo.onclick = async () => {
    makerGo.disabled = true;
    makerGo.textContent = 'Making…';
    showToast('Making your label…');
    try {
      const { warnings = [], ...draft } = await api.makeLabel({
        size: makerSize.value, text: makerText.value.trim(), image: photo,
      });
      renderEditor(view, draft);
      for (const w of warnings) showToast(w, true);
    } catch (err) {
      showToast(`Couldn't make the label: ${err.message}`, true);
      makerGo.textContent = 'Make label';
      syncGo();
    }
  };
```

Add this helper at module level in `public/app.js` (above `function renderNew()`):

```js
// Phones take 12-megapixel photos; the model only needs enough to read a
// label. Shrink to 1600 px on the long edge and re-encode as JPEG so the
// upload over WiFi and the model call both stay small.
async function shrinkPhoto(file) {
  const MAX = 1600;
  let source;
  if (typeof createImageBitmap === 'function') {
    source = await createImageBitmap(file);
  } else {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('unsupported image'));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width ?? source.naturalWidth;
  const h = source.height ?? source.naturalHeight;
  const scale = Math.min(1, MAX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
}
```

- [ ] **Step 4: Run the server tests (nothing should break) and start the app**

```bash
npm test
```

Start the dev server through the preview tool using the existing `.claude/launch.json` configuration (do not run it with Bash), open `#/new`, and check:

1. The "Make it for me" panel shows a textarea, Add a photo, the size picker set to the loaded roll, and a disabled Make label button.
2. Typing enables the button. Clearing the text disables it again.
3. With `data/config.json` holding an API key: type `Organic almond flour, lot 42, best by Oct 15, contains tree nuts. Ingredients: blanched almonds.` and tap Make label. The toast shows, then the editor opens with the name, a one-line description (if the model gave one), extras tagged in the preview, an ingredients paragraph, and a barcode. Save works.
4. Without an API key (temporarily blank it in Settings): tapping Make label shows the red "no API key" toast and the text stays in the box.

Use the preview tool's `read_page` to verify the panel structure and `read_console_messages` for errors, then take a screenshot of the editor with the made label as proof.

- [ ] **Step 5: Commit**

```bash
git add public/api.js public/app.js public/style.css
git commit -m "feat: Make it for me panel on the new-label screen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Editor — role tags and create-on-open for AI drafts

**Files:**
- Modify: `public/editor.js` (`elementList` at line 14; `syncExtrasList` at ~line 210; `ensureNormalized` at ~line 243)

**Interfaces:**
- Consumes: extras with `role` (Task 5/6).

- [ ] **Step 1: Role tags on the preview**

At the top of `public/editor.js` after `const MIN_DOTS = 60;` add:

```js
const ROLE_TAGS = {
  lot: 'LOT', best_by: 'BEST BY', packed_on: 'PACKED', allergens: 'ALLERGENS',
  net: 'NET', note: 'NOTE', ingredients: 'INGREDIENTS',
};
```

In `elementList`, replace the extras push with:

```js
  for (const extra of draft.extras ?? []) {
    const tag = extra.kind === 'image' ? 'IMAGE' : (ROLE_TAGS[extra.role] ?? 'FIELD');
    items.push({ key: `extra:${extra.id}`, tag, box: extra.box, extra, removable: true });
  }
```

- [ ] **Step 2: Role hint in the field list**

In `syncExtrasList`, in the non-image branch, after `input.value = extra.text;` add:

```js
        if (ROLE_TAGS[extra.role]) input.placeholder = ROLE_TAGS[extra.role].toLowerCase();
        if (extra.role === 'ingredients') { input.title = 'Ingredients'; }
```

- [ ] **Step 3: Create-on-open for any draft without an id**

In `ensureNormalized`, change the condition line

```js
    if (!draft.layout || !draft.options || !draft.fields.barcode) {
```

to

```js
    if (!draft.id || !draft.layout || !draft.options || !draft.fields.barcode) {
```

Without this an AI draft (which arrives with layout, options and a barcode) would never be created, and Save would report "Label is still loading".

- [ ] **Step 4: Verify in the browser**

With the dev server from Task 8 still running, make a label again from `#/new`. Check in the preview that the extras show `LOT`, `BEST BY`, `INGREDIENTS` tags rather than `FIELD`, that the URL becomes `#/edit/<id>` right after the editor opens, and that Save and Print no longer say "still loading". Reload the labels list and confirm the new label is there. Screenshot the editor as proof.

- [ ] **Step 5: Commit**

```bash
git add public/editor.js
git commit -m "feat: editor shows extra roles and persists AI drafts on open

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: README and final check

**Files:**
- Modify: `README.md` (lines 43-45 and the Labels section)

- [ ] **Step 1: Update the README**

Replace step 5 of "First-time setup":

```
5. For the AI label maker, paste an Anthropic API key
   (console.anthropic.com) into Settings. It uses Claude with server-side
   refusal fallbacks enabled.
```

In the "Labels" section, add this bullet before the "Add a .prn to the library" bullet:

```
- **Make it for me** (on the New label screen) builds a whole label from a
  typed description, a photo of the product or its ingredient panel, or
  both: name, a short description, lot, best-by and packed-on dates,
  allergens, net weight, notes, and the full ingredient list. Ingredients
  only fit on 5×3 labels. The draft opens in the editor for any tweaks.
  To try inputs from the PC and see the result as a PNG:
  `node tools/ai-label-try.mjs 3x5 --text "..." [--photo file.jpg]`.
```

- [ ] **Step 2: Full test run**

```bash
npm test
```

Expected: all pass, no references to `extract` remain:

```bash
grep -rn "extract" src public test tools --include=*.js --include=*.mjs
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the AI label maker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
