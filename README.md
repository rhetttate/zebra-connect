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
   own menu) and note its IP — or use **Settings → Find**.
2. In **Settings**, set the printer IP and tap **Test print**.
3. If the test print is blank or prints gibberish, tap **Fix printer
   language**, power-cycle the printer, and test again.
4. The chip in the top bar (e.g. `5 × 3″ GAP`) shows which label roll
   the app thinks is loaded. Tap it (or the crosshair) when you change
   rolls: pick the size, pick **Gap labels**, **Black mark labels**, or
   **Continuous paper**, then **Calibrate** — the printer feeds a few
   labels while it measures them. Printing a label that doesn't match
   the loaded size asks for confirmation first.
5. For photo extraction, paste an Anthropic API key
   (console.anthropic.com) into Settings. Photo extraction uses
   Claude with server-side refusal fallbacks enabled.

## Labels

- Sizes: 5×3 (designed landscape, rotated automatically for the
  3-inch print head), 3×2, and 2×1.25 inches (203 dpi, max print
  width 576 dots).
- Barcodes are unique random UPC-A codes. An unrotated barcode prints
  as a native printer barcode; rotated ones are drawn at exact
  dot-module resolution — both scan reliably.
- Tap a field on the preview to select it: drag to move, corner handle
  to resize, and the toolbar rotates it in 90° steps (extra fields can
  also be removed there).
- **Add field** puts extra free-text fields on the label — lot numbers,
  dates, allergens. Layouts and extra fields save per label.
- **Print a .prn file** sends any prepared printer file byte-for-byte.

## Where data lives

`data/labels.json` (your labels) and `data/config.json` (settings,
including the API key) — back up the `data/` folder to keep everything.
