# Zebra Label App — Design Spec

**Date:** 2026-09-05
**Status:** Approved design, pending implementation plan

## Purpose

A locally hosted web app for designing, storing, and printing labels on a
Zebra ZQ620 Plus over WiFi. The user designs and prints labels from their
phone's browser; a Node.js server on the PC does the rendering, storage,
printing, and AI photo extraction.

## Goals

- Print to a ZQ620 Plus on the local network (TCP port 9100).
- Three label sizes: 3×5 in, 3×2 in, 2×1.25 in (printer is 203 dpi).
- 3×5 labels: ingredient name, UPC-A barcode, description.
- 3×2 and 2×1.25 labels: name + barcode by default; description toggleable.
- Photo → Claude vision API extracts name/description → pre-fills the editor.
- Auto-generate random, unique UPC-A barcodes for new labels.
- Store every label; edit and reprint any of them later.
- Live, faithful label preview on the phone.
- Edit the layout from the phone: touch-drag and resize the name,
  description, and barcode anywhere on the label; positions save with
  the label.
- Upload raw .prn files and send them to the printer byte-for-byte.

## Non-goals

- BLE printing (may be revisited later).
- Native mobile app.
- Multi-user access control (single user on a trusted home LAN).
- Arbitrary extra elements (images, extra text boxes, shapes) — the
  three standard elements only, freely positionable.

## Architecture

Single Node.js + Express server on the PC:

- Serves the mobile-first web UI (phone opens `http://<pc-ip>:3000`).
- Stores labels in a local database file inside the project folder.
- Prints via raw TCP to `<printer-ip>:9100`.
- Calls the Anthropic API (Claude vision) for photo extraction; API key
  read from local config, never sent to the browser.

Printer language: ZPL by default. The ZQ620 Plus ships in various language
modes; Settings exposes a ZPL/CPCL mode switch, and the test print helps
verify the right one.

## Screens

1. **Library (home):** saved labels as cards — thumbnail, name, size,
   barcode number. Search box. Tap to open in the editor. "New label"
   button.
2. **New label:** choose size, then "Start from photo" or "Start blank."
3. **Editor:** live preview at top (true aspect ratio, server-rendered
   PNG). Tapping an element on the preview selects it; drag to move,
   corner handle (or pinch) to resize. Element boxes are overlaid on the
   client atop the preview image, so dragging is smooth and the server
   re-renders on release. Fields below: name, description (default on
   for 3×5, off for smaller sizes, toggleable everywhere), barcode
   (auto-generated UPC-A, with regenerate button and manual override),
   quantity, "Reset layout" (back to the size's default), Print button,
   Save.
4. **Photo flow:** camera/gallery picker → upload → Claude extracts
   fields → editor opens pre-filled for review. Available for all sizes,
   default entry for 3×5.
5. **Print .prn:** file picker → server streams the file unmodified to
   the printer.
6. **Settings:** printer IP + "find my printer" subnet scan (probes port
   9100), darkness setting, ZPL/CPCL mode, test print button, API key
   status indicator.

## Data model

Label record:

- `id` — internal unique id
- `size` — `3x5` | `3x2` | `2x1.25`
- `fields` — `{ name, description, barcode }`
- `options` — `{ showDescription }`
- `layout` — per-element boxes in printer dots:
  `{ name: {x, y, w, h}, description: {x, y, w, h}, barcode: {x, y, w, h} }`.
  Text auto-fits its box; the barcode fills its box. Each size has a
  built-in default layout used until the user moves something.
- `createdAt`, `updatedAt`

Barcode generation: 11 random digits + computed UPC-A check digit;
regenerate until unique across all stored labels.

## Rendering & printing (hybrid)

One layout engine per label size, rendering at 203 dpi
(3×5 → 609×1015 dots, 3×2 → 609×406, 2×1.25 → 406×253).

- **Preview:** server renders the full label — text and a simulated
  barcode — as a PNG the phone displays live.
- **Print:** server renders text/layout only as a ZPL `^GFA` bitmap and
  emits a native ZPL UPC-A command (`^BU`) at the barcode's stored box
  coordinates, so the printed barcode is printer-crisp and scannable
  while text matches the preview exactly.
- Both paths read element positions from the label's `layout`, so a
  dragged layout previews and prints identically.
- **.prn uploads:** bypass rendering entirely; raw bytes to port 9100.

## Photo extraction

Server endpoint accepts an image, sends it to the Claude API with a
structured-extraction prompt (product/ingredient name, description),
returns the extracted fields. Model and key configured server-side.

## Error handling

- Printer unreachable → explicit "can't reach printer at <ip>" with
  retry; no silent failures.
- Missing API key → photo button disabled with "add your API key in
  Settings" hint; all other features work.
- Photo extraction failure → editor opens blank with an error notice.
- Duplicate barcode on save → rejected with regenerate suggestion.

## Testing

- Unit tests: UPC-A check digit, barcode uniqueness, ZPL generation
  (bitmap dimensions, barcode placement), label CRUD.
- Manual acceptance: real test print of all three sizes from a phone,
  photo-extraction round trip, raw .prn print.
