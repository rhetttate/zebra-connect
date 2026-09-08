# Printer-file editor — design

Date: 2026-09-07. Status: approved in chat (option 2 with an editable preview).

## Goal

Imported `.prn` files (ZebraDesigner ZPL exports, stored as "printer file"
labels with `kind: 'prn'`) become editable in the app the way native labels
are: change the text and barcode, move fields on a preview, adjust text size,
save, print. The printed result must stay the ZebraDesigner original with the
edits applied — the app never redraws these files in its own fonts.

## Non-goals

- Converting printer files into native app labels.
- Editing embedded graphics (`^GFA`), or adding/removing fields. Files keep
  exactly the fields they came with.
- Rotated fields: they are shown and their text is editable, but dragging is
  only offered for unrotated fields.

## Model

Server module `src/zpl-fields.js` (pure functions, unit-tested):

- `parseFields(zpl)` → `[{ id, kind, text, x, y, origin, font, rotated }]`
  - One entry per `^FD…^FS` that follows a `^FT`/`^FO` position command in the
    same field. `kind` is `'barcode'` when a `^B?` command sits between the
    position and the `^FD`, otherwise `'text'`.
  - `origin` is `'FT'` (baseline-left) or `'FO'` (top-left) with the parsed
    `x, y` in dots. `font` is `{ h, w }` from `^A0N,h,w` (or `^A@…`) when
    present, else `null`. `rotated` is true when the font orientation is not
    `N`.
  - `id` is the ordinal index of the field in the file, stable for a given ZPL.
- `applyFields(zpl, fields)` → new ZPL string. For every field id present in
  `fields`, replaces the `^FD` payload, the position numbers, and the font
  `h,w` numbers in place. Everything else in the file is untouched byte for
  byte. Text may not contain `^` or `~` (rejected with a 400-style error);
  ZPL escape sequences from `^FH` are passed through as typed.
- `labelInches(zpl)` → `{ w, h }` from `^PW`/`^LL` at 203 dpi, or `null`.

## API

- `GET /api/labels/:id/fields` → `{ fields, inches }` for a `prn` label.
- `PUT /api/labels/:id/fields` body `{ fields, name? }` → applies the edits to
  the stored ZPL, updates `updatedAt`, returns the label. 400 for non-`prn`
  labels or invalid text.
- `PUT /api/labels/:id/zpl` body `{ zpl, name? }` → raw replacement for the
  Advanced tab; validated with the same `^XA…^XZ` check as import.
- `POST /api/preview-zpl` body `{ zpl }` → PNG. The server proxies to Labelary
  (`http://api.labelary.com/v1/printers/8dpmm/labels/{w}x{h}/0/`) using the
  file's declared size, falling back to the loaded roll size when the file has
  none. The renderer is injectable (`createApp({ zplRenderer })`) so tests do
  not touch the network. Failures return 502 with a plain message; the editor
  then shows "preview unavailable" and still allows saving/printing.

Labelary renders at 8 dots/mm = 203 dpi, so one PNG pixel is one printer dot;
overlay coordinates need no conversion beyond the on-screen scale factor.

## Client

- Library: a horizontal swipe on a file card (pointer events, ≥ 40 px mostly
  horizontal) opens `#/file/:id`. Tap still opens the print sheet, which also
  gains an **Edit** button so the editor is discoverable without the gesture.
- `public/file-editor.js` renders `#/file/:id`:
  - Deck with the preview image. Field boxes are overlaid using the field's
    dots: `FT` boxes span `y - h … y`, `FO` boxes `y … y + h`; width is
    estimated from text length × `w` × 0.6 (or 200 dots for barcodes). Tapping
    a box selects the field and focuses its input; dragging an unrotated box
    updates `x, y` and re-renders the preview (debounced ~400 ms).
  - Below the deck: name input, one input per field (barcode fields use
    `inputmode="numeric"`), a text-size stepper (`−`/`+` change `h` and `w`
    together by 10 %) for the selected text field.
  - Buttons: Save, Print (quantity prompt as in the print sheet), and an
    **Advanced** toggle revealing a textarea with the raw ZPL. Editing the raw
    ZPL replaces the working copy and re-parses fields on blur.
  - Unsaved changes prompt before leaving, matching the native editor.
- No new server state beyond the label's `zpl`.

## Testing

- `test/zpl-fields.test.js`: parsing a ZebraDesigner sample (text + barcode,
  `^FH` escapes, a rotated field, a `^GFA` block), round-trip
  `applyFields(parse)` is byte-identical, edits land only in their field,
  invalid text rejected, `labelInches` mapping.
- `test/printer-file-editor.test.js` (app routes): fields round trip through
  the API, raw ZPL save validation, preview proxy uses the injected renderer
  and reports 502 on failure.
- Client behaviour is verified in the browser pane against a real file, then
  on the tablet with the printer.
