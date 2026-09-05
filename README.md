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
