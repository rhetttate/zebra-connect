# Convert printer files into app labels — design

Date: 2026-09-07. Status: approved in chat (option 3: bulk convert removes the
original file entries; the .prn files on disk are untouched).

## Goal

An imported printer file (`kind: 'prn'`) can be turned into a native app label
that opens in the normal editor and behaves exactly like a label made in the
app: name, barcode, movable/rotatable text boxes, photo tools. Text lands in
the same place and at the same size as in the ZebraDesigner original; the app
draws it in its own font, so letterforms differ slightly on paper.

## Inputs and what maps to what

- Fields come from `parseFields` (`src/zpl-fields.js`), extended to report the
  font orientation (`orient: 'N'|'R'|'I'|'B'`) and any `^FB` block
  (`block: { w, align }`) so centred headings can be centred.
- `^FH` hex escapes (`\XX`) are decoded; `\&` becomes a space; leading and
  trailing whitespace is trimmed.
- Size: the file's declared size, else `^PW406` → `2x1.25`, `^PW575` → `3x2`
  when any text is upright else `3x5`, else `2x1.25` with a warning.
- Name: the text field with the largest font height. Description: empty,
  `showDescription: false`. Every other text field: an extra with its own box.
  Extras beyond the app's limit of 20 are dropped with a warning.
- Barcode: a `^BU` (UPC-A) payload that passes `validateUpcA` becomes the
  barcode field with a box sized for module width 3 (`w: 285`,
  `h: barHeight + 30`). Any other barcode (Code 128 etc.) becomes an extra
  text box holding its digits, with a warning. No barcode → a fresh UPC-A is
  generated, as for new labels, with a warning.
- Graphics (`^GFA`) cannot be represented: dropped with a warning.

## Coordinate mapping (dots)

Small sizes (`3x2`, `2x1.25`) print unrotated: design space = print space.
- `^FT x,y` is baseline-left: box `{ x, y: y - h, w: est, h }`.
- `^FO x,y` is top-left: box `{ x, y, w: est, h }`.
- Orientation → app rotation: `N:0, R:90, I:180, B:270`.
- Estimated text width `est = max(40, round(chars × w × 0.6))`; a centred
  `^FB` block of width `bw` shifts `x` by `(bw − est) / 2`.

`3x5` labels are designed landscape (1015 × 576) and printed rotated 90° CW
(576 × 1015). ZebraDesigner's 5x3 files are drawn the other way round (text
orientation `B`, reading bottom-to-top), so the file is first flipped 180°
(`px' = 575 − px`, `py' = 1015 − py`), which turns `B` into `R`, and then
un-rotated into design space (`dx = py'`, `dy = 576 − px'`). Net effect for a
`^FT x,y` text of height `h`: box `{ x: 1015 − y, y: x + 1 − h, w: est, h }`.
Orientation → app rotation for `3x5`: `B:0, N:90, I:270, R:180`. Barcodes in
`3x5` files use rotation 270 when their orientation is `N`/`I`, else 0, with
box width/height swapped accordingly. Rotated boxes are approximate; the user
drags them if needed.

## API and UI

- `POST /api/labels/:id/convert` body `{ remove?: boolean }` → creates the
  app label, optionally deletes the file entry, returns
  `{ label, warnings: string[] }`. 400 for non-file labels.
- `POST /api/labels/convert-all` → converts every file label, deletes each
  original, returns `{ converted: [{ name, id, warnings }], failed: [...] }`.
  Run once from the command line for the current library; kept for the
  store PC.
- Print sheet and file editor get a **Convert to app label** button that
  calls the single route with `remove: true`, shows the warnings as a toast
  if any, and opens the new label in the editor.

## Testing

- `test/convert-file.test.js`: text → name/extras with expected boxes for a
  2x1.25 file and a 3x5 file (hand-computed coordinates), rotation table,
  `^FH`/`\&` decoding, centred block shift, UPC-A kept vs Code 128 demoted,
  graphic warning, size fallback, extras cap.
- `test/convert-file-routes.test.js`: single convert with/without remove,
  convert-all removes originals and reports warnings, 400 on normal labels.
- Browser: convert bacon, confirm it opens in the native editor with the price
  and barcode in place; then convert all and spot-check drumsticks (5x3).
