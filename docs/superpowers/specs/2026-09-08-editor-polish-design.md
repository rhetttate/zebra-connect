# Label editor polish — design

Date: 2026-09-08. Status: approved in chat (approach A: shared renderer drawn
on the phone; sticky selection, snapping, alignment, text size, undo,
rotated full-screen mode).

## Goal

Make the label editor feel like a professional tool on a phone: the preview
moves with the finger, a selected box stays selected while it is resized,
fields snap and align without fiddling, text size is a deliberate choice,
mistakes can be undone, and the label can be edited full-screen at twice the
size. What the preview shows is exactly what prints, barcode included.

## Non-goals

- The printer-file editor (`public/file-editor.js`, Labelary previews) is
  unchanged.
- Multi-select, pinch zoom, and any change to how labels are stored beyond
  the two additions in "Data and API".
- The AI label maker's layout engine is untouched; it already emits the
  fields this editor learns to control.

## 1. Shared renderer

`shared/render-core.js` holds every drawing routine that today lives in
`src/render.js`: `fitSingleLine`, `drawFitted`, `wrapLines`, `drawRotated`,
`drawName`, `drawWrappedText`, `drawBarcode`, and `drawLabel(ctx, label,
{ includeBarcode })`, which paints a whole label onto any canvas 2D context
whose size matches `SIZES[label.size]`. It imports nothing from Node. The
barcode bit pattern moves with it: `shared/barcode.js` holds
`upcCheckDigit`, `validateUpcA`, `encodeUpcAModules`, and
`barcodeGeometry`; `src/barcode.js` keeps `generateUpcA` (it needs
`node:crypto`) and re-exports the rest so existing imports keep working.
`src/layout.js` re-exports `barcodeGeometry` for the same reason.

`src/render.js` becomes the Node wrapper: create a canvas, `drawLabel`,
return PNG or 1-bpp bitmap. `renderPreview`, `renderPrintBitmap` and
`rotateBitmap90CW` keep their signatures. Image extras (`kind: 'image'`,
PNG data URLs from converted printer files) are drawn by the core through a
`loadImage` function the caller supplies: the server passes
`@napi-rs/canvas`'s `loadImage`, the browser passes a promise around
`new Image()`.

The server serves `shared/` at `/shared/` (`express.static`). The browser
imports `/shared/render-core.js` and `/shared/barcode.js` as ES modules.

## 2. Font

Arimo (Apache 2.0, metrically identical to Arial) ships as
`public/fonts/Arimo-Regular.ttf` and `public/fonts/Arimo-Bold.ttf`.

- Server: `src/render.js` registers both with `GlobalFonts.registerFromPath`
  at import time under the family name `Arimo` and sets the core's font
  family to `Arimo`. If a file is missing it logs one warning and the
  family stays `Arial`, so nothing breaks on a machine without the files.
- Browser: `style.css` declares two `@font-face` rules for `Arimo`; the
  editor awaits `document.fonts.load('16px Arimo')` and the bold variant
  before its first draw.
- The core takes the family name as a parameter (`setFont(family)`) rather
  than reading a constant, so both sides pick `Arimo`.

Existing labels re-render in Arimo instead of Arial. The metrics match, so
fitted sizes and line breaks come out the same; glyph shapes differ
imperceptibly.

## 3. Instant preview

The editor replaces the `<img>` preview with a `<canvas>` sized in dots
(`SIZES[size]`) and scaled by CSS to the wrapper width. Every change (drag,
resize, keystroke, toolbar action, undo) schedules one redraw via
`requestAnimationFrame`; redundant requests in the same frame collapse.
There is no network call in the preview path. `POST /api/preview` remains
for the tuning tool and tests.

## 4. Barcode

`buildLabelZpl` no longer emits `^BU`; the `barcode`/`barcodeBox` parameters
are dropped, and `POST /api/print` always renders with
`includeBarcode: true`. Every label prints the drawn bars, as 5x3 labels do
today.

`drawBarcode` gains UPC-A styling. With module width `m` and geometry from
`barcodeGeometry` (unchanged: `m = max(2, floor(box.w / 95))`, symbol width
`95m`, centred in the box):

- Data bars are `barHeight` tall. The bars that real UPC-A prints tall —
  the left guard plus the first digit's bars (modules 0–9), the centre
  guard (45–49), and the last digit's bars plus the right guard (85–94) —
  extend `digitH` further down, where `digitH = round(m * 8)`.
- Digits are drawn in the shared font at `digitH` px, baseline at
  `barHeight + digitH`: the first digit right-aligned just left of module
  0, digits 2–6 spread evenly under modules 10–44, digits 7–11 under
  modules 50–84, the check digit left-aligned just right of module 94. The
  outer digits sit outside the 95-module symbol when the box is only that
  wide; that is how UPC looks and it costs at most `7m` dots each side.
- `drawLabel` returns `{ sizes }`, a map of the font size each text element
  was drawn at, keyed `name`, `description`, and `extra:<id>` — the editor's
  text-size controls read it (see section 8).

`renderPrintBitmap` output for a label without a barcode is unchanged (the
existing render tests still hold).

## 5. Selection that stays put

In `public/editor.js` (`attachLayoutEditing`):

- The selected box gets `z-index: 5` so it sits above neighbours.
- A `::before` pseudo-element extends the selected box's hit area 14 CSS px
  outward on all sides; the corner handle's hit area is 44 × 44 CSS px
  (visual size unchanged at 26). Pointer events on either target the
  selected box.
- A drag starts only after the pointer moves more than 4 CSS px from
  pointerdown; before that, pointerup counts as a tap. Tapping inside a
  different box selects it; tapping the empty label deselects.
- Pointer coordinates are mapped through the current preview transform
  (see full-screen), so dragging works identically rotated or not.

## 6. Snapping with guides

`shared/snap.js` exports `snapBox(box, { mode, targets, threshold })`:

- `mode` is `'move'` or `'resize'`. In move mode the box's left, centre and
  right (and top, middle, bottom) are candidates and the whole box shifts;
  in resize mode only the right and bottom edges are candidates and only
  `w`/`h` change.
- `targets` is a list of `{ x }` and `{ y }` lines: the label margin lines
  (inset 20 dots, 10 on 2x1.25), the label centre lines, and every other
  visible box's left, centre, right, top, middle, bottom.
- `threshold` is 12 dots. The nearest candidate within the threshold wins
  per axis; ties keep the earlier target.
- Returns `{ box, guides: [{ x } | { y }] }` — the snapped box and the
  lines that engaged.

The editor calls it on every pointermove during a drag and draws the
guides as 1-dot accent lines on a second, transparent canvas layered over
the preview, cleared on pointerup.

## 7. Alignment buttons

The floating toolbar becomes two rows.

Row one: rotate 90°, align left, centre, right, top, middle, bottom, and
remove (extras only). Alignment is relative to the label margin box (the
same inset as snapping): left sets `x` to the margin, centre centres on the
label, and so on. Alignment is one undo step.

## 8. Text size

Row two of the toolbar, shown for text elements (name, description, text
extras; not barcode or images): **Auto** toggle, **−**, size readout in
points, **+**, **All**.

- Auto means no `textSize`: text fills its box as today.
- Stepping − or + sets `textSize` to the current rendered size ± 4 dots,
  clamped to 8..400, and turns Auto off. The current rendered size for an
  Auto field is what the fit produced on the last draw; the core exposes it
  by recording `lastSizes[key]` while drawing.
- The readout shows points: `Math.round(dots * 72 / 203)`.
- **All** copies this field's fixed size to every other text extra (not
  name or description) — one undo step.
- A fixed size is a ceiling: the renderer still shrinks text that would not
  fit the box, so nothing overflows. Resizing a box keeps the fixed size
  (the current behaviour of clearing it on resize is removed).
- Name and description carry `textSize` on their layout boxes
  (`layout.name.textSize`, `layout.description.textSize`); `drawName` and
  the description draw pass it as `maxSize`.

## 9. Undo and redo

The editor keeps a history of draft snapshots (`structuredClone`, capped at
50). A step is recorded on: pointerup after a drag or resize, each toolbar
action, adding or removing an extra, reset layout, and a text change once
the field has been idle for 600 ms or loses focus. Undo and Redo buttons
sit in the bar above the preview, disabled when nothing is available.
Undo restores the previous snapshot, redraws, and re-syncs the inputs and
extras list; a new step clears the redo stack. History is per editor
session and is not saved.

## 10. Full-screen, rotated

A **Full screen** button in the bar above the preview enters a mode where
the editing surface (canvas, guide layer, boxes, toolbar) covers the whole
viewport via a fixed-position wrapper; the form fields are hidden behind
it. `document.documentElement.requestFullscreen()` is called where
available (Android) and ignored where not (iOS), since the fixed wrapper
already covers the page. A **Done** button (top corner of the surface)
exits.

Rotation rule: when the viewport is portrait (`innerHeight > innerWidth`),
the surface is rotated 90° clockwise with a CSS transform so the label's
long side runs along the phone's long side; the user turns the phone to
read it. When the viewport is landscape (the phone rotated itself), no
extra transform is applied. The rule re-evaluates on `resize` and
`orientationchange`. The toolbar is part of the surface, so it rotates with
it. Pointer deltas are mapped through the active transform (rotated:
`dxDots = dyPx * scale`, `dyDots = -dxPx * scale`).

The surface fits the label to the available area with a small margin,
preserving aspect ratio, so a 5x3 label roughly doubles in size compared to
the inline preview on a typical phone.

## 11. Data and API

- `normalizeDraft` keeps `textSize` (integer 8..400) on `layout.name` and
  `layout.description`, using the same check extras already have.
- `POST /api/print` always renders the barcode into the bitmap;
  `buildLabelZpl` loses its barcode parameters.
- Nothing else changes. Stored labels without `textSize` stay Auto.

## 12. Testing

- `test/render.test.js` keeps its pixel tests (via `src/render.js`), plus:
  guard bars are taller than data bars (black rows in a guard column
  exceed those in a data column); the first and check digits are painted
  outside the 95-module symbol; `textSize` on `layout.name` caps the name.
- `test/barcode.test.js` imports from `src/barcode.js` unchanged (the
  re-export keeps it green).
- `test/snap.test.js`: move and resize snapping per axis, threshold
  boundary, tie-breaking, guide output, no snap when nothing is near.
- `test/zpl.test.js`: `buildLabelZpl` output has no `^BU`.
- `test/app.test.js`: `textSize` on `layout.name` round-trips; the print
  route's ZPL contains no `^BU` for a small-size label.
- Editor behaviour (selection, drag threshold, toolbar, undo, full-screen
  rotation) is verified by hand in the in-app browser and on the phone;
  there is no DOM test harness in this project.

## 13. README

The Labels section's barcode sentence changes to say barcodes are always
drawn at exact dot resolution and print identically to the preview; a new
paragraph describes full-screen editing, snapping, text size, and undo.
