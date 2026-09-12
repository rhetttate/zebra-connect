# Standalone tablet — design

Date: 2026-09-12. Status: approved in chat (server-optional app, tablet is
the only copy of the labels, AI maker works on the tablet, hosted on GitHub
Pages).

## Goal

The Android tablet docked next to the ZQ620 Plus becomes the whole system at
the store: it holds the labels, shows the same editor the phone has today,
draws the label, builds the ZPL and sends it straight over Bluetooth LE.
No store PC, no USB stick, no queue. The laptop at home keeps working
unchanged against the Node server.

## Non-goals

- Phones printing at the store. The tablet is the one device there.
- Two-way sync between laptop and tablet. Labels move once (or whenever the
  user chooses) through an export/import file.
- Running Node on the tablet.
- The printer-file editor (Labelary preview), `Add a .prn to the library`,
  and network printer discovery on the tablet. All printer files were
  converted to native labels on 2026-09-07; these tools stay server-only.
- Changing the label JSON shape, the editor, or the drawing code.

## 1. Two backends behind one API

`public/api.js` today is a flat object of fetch calls. It becomes a switch:

```
public/api.js            re-exports `api`, chosen once at load
public/backend-remote.js the current fetch implementation, unchanged
public/backend-local.js  the tablet implementation described in §3–§6
```

Selection happens once at module load: `window.ZC_BACKEND` is set to
`'local'` by a tiny inline script that the build step (§7) injects into the
static site's `index.html`; the Node server serves the untouched
`index.html`, so there the value is undefined and the remote backend is
used. Nothing else in the client asks which mode it is in except the three
places listed in §8.

Both backends expose the same method names as today's `api` object plus
the new ones in §6. Methods the local backend cannot provide
(`discover`, `addPrn`, `getFileFields`, `saveFileFields`, `saveFileZpl`,
`previewZplBlob`, `convertFile`, `printFileLabel`) throw
`Error('not available on this device')`; the UI hides their controls
(§8) so users never hit that message.

## 2. Server logic that moves to `shared/`

Modules with no Node dependency move so both sides import one copy. The
`src/` file of each keeps its name and re-exports from `shared/`, so every
existing server import and test keeps working.

| moves to                 | from                        | notes |
|--------------------------|-----------------------------|-------|
| `shared/draft.js`        | `normalizeDraft`, `validateBox`, `validateRotation` in `src/app.js` | pure validation; `src/app.js` imports it |
| `shared/layout.js`       | `src/layout.js` (`printRotation`, `defaultLayout`, `defaultShowDescription`) | `src/layout.js` re-exports |
| `shared/zpl.js`          | `src/zpl.js` (all of it)     | `src/zpl.js` re-exports |
| `shared/bitmap.js`       | `renderPrintBitmap`'s pixel loop and `rotateBitmap90CW` from `src/render.js` | takes a 2D context (`bitmapFromContext(ctx, w, h)`), so it runs on `@napi-rs/canvas` and on a browser canvas alike; `src/render.js` keeps `renderPreview`/`renderPrintBitmap` as wrappers |
| `shared/upc.js`          | `generateUpcA` from `src/barcode.js` | random digits via `crypto.getRandomValues` (present in Node ≥ 19 as `globalThis.crypto` and in browsers); `src/barcode.js` re-exports |
| `shared/ai-prompt.js`    | `MODEL`, `CONTENT_SCHEMA`, `buildPrompt`, `parseContent`, `houseExamples`, and the JSON-extracting parser from `src/ai-label.js` | `src/ai-label.js` keeps `makeClient` and `makeLabelContent` (SDK transport) and imports the rest |
| `shared/ai-layout.js`    | `src/ai-layout.js`           | ids via `globalThis.crypto.randomUUID()`; `src/ai-layout.js` re-exports |
| `shared/printer-file.js` | `withQuantity` from `src/printer-file.js` | `parsePrn` stays in `src/` |

`shared/` already has the rule "no Node imports"; these modules follow it.
The server's tests keep passing without edits because the `src/` names
still resolve.

## 3. Local label store

`public/local-store.js` holds the labels in IndexedDB: database
`zebra-connect`, object store `labels`, key `id`, one record per label in
exactly the `data/labels.json` shape. The logic (list sorted by
`updatedAt` desc, duplicate-barcode refusal with the same
`allowDuplicateBarcode` escape, `create`/`update`/`remove` stamping
`createdAt`/`updatedAt`) is a copy of `src/store.js` written against a
four-method adapter (`getAll`, `get`, `put`, `delete`) so the same logic
runs in Node tests over an in-memory adapter. `create` and `update` run
`normalizeDraft` from `shared/draft.js` first, as the server routes do.

If IndexedDB cannot be opened (private tab, storage disabled) the app
shows one screen explaining that this browser cannot keep labels, and
stops.

## 4. Local settings

`public/local-config.js` keeps `{ darkness, mediaType, loadedSize, apiKey }`
in `localStorage` under `zc-settings`, with the same defaults as
`src/config.js` (`darkness` 15, `mediaType` 'gap', `loadedSize` '3x5').
`printerIp` and `connection` do not exist locally: the printer is always
the Bluetooth link. `getSettings` returns `apiKeySet` like the server does
and never returns the key itself to the UI.

## 5. Printing over Bluetooth

`public/station.js` keeps its Bluetooth code (chooser filters, chunked
writes, reconnect, wake lock, header chip) and gains
`sendToPrinter(bytes)` which rejects with `Error('printer not connected —
tap the printer chip')` when there is no link. In local mode it never
polls `/api/station/next`; `pump()` only runs in remote mode.

The local backend's `printLabel(label, quantity)`:

1. `normalizeDraft(label)`, clamp quantity to 1–100 (as the server does).
2. Draw on an `OffscreenCanvas` (fallback: a detached `<canvas>`) sized
   from `SIZES[label.size]` with `drawLabel(..., { includeBarcode: true,
   loadImage })`, after `ensureFonts()` so Arimo is in.
3. `bitmapFromContext`, rotate 90° CW when `printRotation(size) === 90`.
4. `buildLabelZpl({ width, height, bitmap, quantity, darkness })`.
5. `sendToPrinter(bytes)`; resolve `{ ok: true, queued: false }`.

`testPrint`, `calibrate(mediaType)` (also saves `mediaType`), `zplMode`
and `printRaw(file)` send `buildTestZpl()`, `buildCalibrationZpl()`,
`setZplModeCommand()` and the file's bytes the same way. The header chip
is shown in local mode from the first load (not only after a remembered
connection), so the user always has a way to reach Connect printer.

Same-bytes guarantee: a test renders one fixture label through
`src/render.js` + `src/zpl.js` and through `shared/bitmap.js` +
`shared/zpl.js` on an `@napi-rs/canvas` context and asserts identical ZPL.

## 6. AI maker in the browser

`public/local-ai.js` implements `makeLabel({ size, text, image })`:

1. Same input checks as the server route (known size, text or image
   present, JPEG/PNG/WebP only, key present).
2. `buildPrompt` with `houseExamples(await store.list())`.
3. `fetch('https://api.anthropic.com/v1/messages', POST)` with headers
   `x-api-key`, `anthropic-version`, `anthropic-beta:
   server-side-fallback-2026-07-01`, and
   `anthropic-dangerous-direct-browser-access: true`; body `{ model: MODEL,
   max_tokens: 4000, fallbacks: 'default', system, messages,
   output_config: { format: { type: 'json_schema', schema: CONTENT_SCHEMA } } }`.
   Exact header/field names are checked against the claude-api skill at
   implementation time.
4. `stop_reason === 'refusal'` → `Error('label maker refused this input')`;
   otherwise join text blocks, parse with the shared JSON-extracting
   parser, `parseContent`.
5. `layoutDraft`, `normalizeDraft`, fresh `generateUpcA` against the local
   store, return `{ ...draft, warnings }` exactly as the route does.

The request builder is a pure function (`buildRequest(input, key, examples)`)
so tests can assert the headers and body without a network.

## 7. Export and import (both modes)

- `api.exportLabels()` returns the full label array. Settings gets
  **Export labels**: downloads `labels-YYYY-MM-DD.json` via a blob link.
- `api.importLabels(labels)` returns `{ added, skipped }`. Settings gets
  **Import labels**: `<input type="file" accept=".json,application/json">`,
  parses the file, validates it is an array whose items have `id`,
  `fields`, `layout`, `size`; adds every label whose `id` is not already
  present (keeping its id, timestamps and barcode, duplicates allowed as
  imported printer files share real UPCs); skips the rest; toasts
  `Imported 140 labels (0 already here)`. A file that fails validation
  changes nothing and toasts the reason.
- Remote mode gets `GET /api/labels/export` and `POST /api/labels/import`
  with the same semantics, so the laptop can export and a fresh laptop can
  restore.

## 8. What the tablet hides

Guarded by `api.mode === 'local'`:

- Settings: the connection choice, printer IP and Find are replaced by one
  line: "Prints go over Bluetooth to the connected printer" with a Connect
  button (opens the chooser via `connectStation`).
- Label list: **Add a .prn to the library** is hidden; **Print a .prn
  once** stays. Printer-file cards cannot exist locally (imports of
  `kind: 'prn'` are skipped with a count in the toast) so the file editor
  route is unreachable; it also refuses to render in local mode.
- The `#/station` page becomes the printer page: Connect button, status,
  log. Its copy no longer mentions phones.

## 9. Build, hosting, offline

`tools/build-site.mjs` writes `site/` (git-ignored):

- `public/*` at the root, `shared/*` under `site/shared/`.
- `index.html` with `<script>window.ZC_BACKEND='local'</script>` inserted
  before the module script, and `<script src="sw-register.js">`.
- `version.txt` containing the short git hash; `sw.js` has that stamp
  substituted into its cache name.

Client paths become relative so the same files work at `/` (Node) and
under `/zebra-connect/` (Pages): `'/shared/x.js'` → `'./shared/x.js'`,
manifest `start_url: "./"` and icon `src: "./icon-192.png"`, `location.origin`
in the flag instructions → `location.origin + location.pathname`.
The service worker (`public/sw.js`, precache list generated by the build)
caches every site file on install, serves cache-first, and on activation
of a new version posts `update-ready`; `app.js` shows a slim bar
"Update ready — Reload". Labels and settings are never in the cache.

`.github/workflows/pages.yml`: on push to the default branch, checkout,
`node tools/build-site.mjs`, upload `site/`, deploy with
`actions/deploy-pages`. The user creates the repository, adds the remote,
enables Pages (source: GitHub Actions) once. The repo holds no labels and
no key (`data/` is git-ignored), so a public repo is safe.

HTTPS gives Web Bluetooth without the Chrome flag; the flag screen in
`station.js` stays for the http:// laptop case only.

## 10. Moving day

1. Push; Pages publishes `https://<user>.github.io/<repo>/`.
2. Laptop app → Settings → Export labels.
3. Get the file onto the tablet (Drive, email, USB).
4. Tablet: open the site in Chrome → Add to Home screen → Settings →
   Import labels → set darkness, loaded size, media type, API key.
5. Tap the printer chip → Connect printer → pick the Zebra → Test print →
   Calibrate.
6. Retire the store PC and stick. Laptop stays in network mode at home.

## 11. Errors

- Print with no link: button toast "printer not connected — tap the
  printer chip", nothing sent.
- Bluetooth write fails mid-job: toast with the error and a **Retry**
  action that resends the same ZPL; the label stays on screen.
- Import: invalid JSON or wrong shape → toast, no change.
- AI: missing key, HTTP error (status + API message), network failure,
  refusal → toasts matching the server's wording.
- IndexedDB unavailable → the one-screen message in §3.

## 12. Testing

Node (`npm test`):

- Existing tests unchanged (moved modules re-exported from `src/`).
- `shared-draft.test.js`, `shared-bitmap.test.js` (bitmap and rotation
  match `src/render.js` output), `shared-upc.test.js`.
- `local-store.test.js`: the store logic over the in-memory adapter,
  including duplicate rules and `importLabels` merge counts.
- `local-ai.test.js`: `buildRequest` headers/body; refusal and parse
  paths with a stubbed fetch.
- `same-zpl.test.js`: server path vs. shared path yield identical ZPL for
  a fixture label with barcode, extras and an image.
- `app.test.js` additions: `/api/labels/export` and `/import`.
- `build-site.test.js`: build output has relative paths, the backend
  script, and a precache list covering every file.

Browser (Browser pane, static server over `site/`, no Node API): the app
boots in local mode, imports a labels export, lists and previews labels,
the editor works, Settings shows the local layout, and the service worker
serves the app after the static server is stopped. Bluetooth printing is
verified on the tablet against the printer.

## 13. README

"Bluetooth print station" becomes "Standalone tablet": the site address,
Add to Home screen, import, Connect printer. The laptop/network section
stays. Export/Import documented under "Where data lives".
