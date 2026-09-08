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
- **Add a .prn to the library** keeps a finished printer file (ZebraDesigner
  export) as a "printer file" entry: it shows in the list with its size, and
  tapping it opens a quantity/print sheet instead of the editor. Swipe the
  card (or tap it and choose **Edit**) to change its text, barcode, field
  position and text size on a live preview; the preview is drawn by the
  Labelary web service, so it needs internet, while printing does not.
  **Print a .prn once** sends a file byte-for-byte without keeping it. To
  load a whole folder at once: `node tools/import-prn.mjs <folder> [server-url]`.

## Bluetooth print station (printer not on WiFi)

When the printer can't join the network (e.g. WPA3-only WiFi), use a
tablet docked next to it as the relay:

1. In **Settings**, set "How prints reach the printer" to **Bluetooth
   print station**.
2. On the tablet (Android, Chrome), open `http://<server-ip>:3000/#/station`.
   The first visit shows a one-time Chrome flag to enable Bluetooth for
   this site — follow the on-screen steps, relaunch Chrome, return.
3. Tap **Connect printer** and pick the Zebra from the list.
4. Leave the page open (it keeps the screen awake). Prints from any
   phone queue up and print automatically; the page shows a live log.

The printer needs Bluetooth LE enabled
(`! U1 setvar "bluetooth.le.controller_mode" "both"` — already done for
this printer). Big 5×3 labels take a few extra seconds over Bluetooth.

## Where data lives

`data/labels.json` (your labels) and `data/config.json` (settings,
including the API key) — back up the `data/` folder to keep everything.
