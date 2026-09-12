# Zebra Connect

Design, store, and print labels on a Zebra ZQ620 Plus from your phone.

## Start the app

The server starts by itself when you log in to this PC
(`start-zebra-connect.vbs` in the Windows Startup folder runs it hidden
in the background). To run it by hand instead:

    npm install
    npm start

The terminal prints the address to open on your phone, e.g.
`http://192.168.1.10:3000`. Your phone and the PC must be on the same
WiFi network as the printer.

## Put it on a phone (app icon)

On each phone, open the address above in the browser, then:

- **iPhone:** Safari → Share button → **Add to Home Screen** → Add.
- **Android:** Chrome → menu (⋮) → **Add to Home screen**.

You get a "Labels" icon that opens the app full-screen. Tip: reserve
the PC's IP address in your router (DHCP reservation) so the address
never changes; if a phone can't connect, check Windows Defender
Firewall → "Allow an app" → Node.js is allowed on Private networks.

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
5. For the AI label maker, paste an Anthropic API key
   (console.anthropic.com) into Settings. It uses Claude with server-side
   refusal fallbacks enabled.

## Labels

- Sizes: 5×3 (designed landscape, rotated automatically for the
  3-inch print head), 3×2, and 2×1.25 inches (203 dpi, max print
  width 576 dots).
- Barcodes are unique random UPC-A codes, drawn at exact dot resolution in
  real UPC-A style (tall guard bars, digits beside the symbol). The preview
  is drawn on your phone with the same code and font the printer uses, so
  what you see is what prints.
- Tap a field on the preview to select it: drag to move (edges and centres
  snap to the margins and to other fields, with a guide line when they do),
  drag the corner handle to resize, and use the toolbar to rotate, align
  left/centre/right/top/middle/bottom, and set the text size — **Auto** fills
  the box, **−/+** step a fixed size, **All** gives every extra field the
  same size. Undo and Redo sit above the preview. The expand button opens
  the label full screen, turned sideways to use the phone's long axis; tap
  Done to come back.
- **Add field** puts extra free-text fields on the label — lot numbers,
  dates, allergens. Layouts and extra fields save per label.
- **Make it for me** (on the New label screen) builds a whole label from a
  typed description, a photo of the product or its ingredient panel, or
  both: name, a short description, lot, best-by and packed-on dates,
  allergens, net weight, notes, and the full ingredient list. Ingredients
  only fit on 5×3 labels. The draft opens in the editor for any tweaks.
  To try inputs from the PC and see the result as a PNG:
  `node tools/ai-label-try.mjs 3x5 --text "..." [--photo file.jpg]`.
- **Add a .prn to the library** keeps a finished printer file (ZebraDesigner
  export) as a "printer file" entry: it shows in the list with its size, and
  tapping it opens a quantity/print sheet instead of the editor. Swipe the
  card (or tap it and choose **Edit**) to change its text, barcode, field
  position and text size on a live preview; the preview is drawn by the
  Labelary web service, so it needs internet, while printing does not.
  **Convert to app label** (on the print sheet or in that editor) turns the
  file into a regular label with movable fields, keeping its UPC even when
  other labels share it; graphics are dropped and extra barcodes become text.
  `POST /api/labels/convert-all` converts every file in the library at once.
  **Print a .prn once** sends a file byte-for-byte without keeping it. To
  load a whole folder at once: `node tools/import-prn.mjs <folder> [server-url]`.

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
and open `http://<server-ip>:3000/#/station` on the tablet (the first
visit shows a one-time Chrome flag to enable Bluetooth for that address).

## Where data lives

`data/labels.json` (your labels) and `data/config.json` (settings,
including the API key) — back up the `data/` folder to keep everything.

**Settings → Export labels** downloads the whole library as one JSON file;
**Import labels** adds the labels from such a file that are not already
present. On the tablet, labels live in the browser's IndexedDB and settings
(including the API key) in localStorage — export before clearing site data.
