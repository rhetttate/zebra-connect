# AI label maker — design

Date: 2026-09-08. Status: approved in chat (approach A: structured content
from Claude, deterministic layout on the server).

## Goal

Make a finished label from a short text description, a photo of the product
or its packaging, or both — in one shot, with a draft good enough that it
rarely needs hand editing. The draft opens in the ordinary editor, unsaved,
so save and print work exactly as they do today.

This replaces the existing "Read a photo" flow (`POST /api/extract`), which
only filled in name and description.

## Non-goals

- A refine loop ("make the name bigger"). One shot only.
- Letting the model choose coordinates or font sizes. Layout is code.
- Editor polish (touch precision, snapping, text sizing, preview lag, barcode
  preview differences). That is a separate follow-up sub-project — see
  "Follow-up" at the end.
- Printer-file (`kind: 'prn'`) labels. The maker only produces native labels.

## What the model returns

One call to Claude Opus 5 (`claude-opus-5`) via `client.beta.messages.create`
with server-side refusal fallbacks (`betas: ['server-side-fallback-2026-07-01']`,
`fallbacks: 'default'`), the same setup as today's extraction. The reply is
constrained with structured output (`output_config.format`, JSON schema) so
it cannot come back malformed:

```json
{
  "name": "Almond Flour",
  "description": "Blanched, finely ground.",
  "ingredients": "Blanched almonds.",
  "extras": [
    { "role": "lot",       "text": "Lot 42" },
    { "role": "best_by",   "text": "Best by Oct 15, 2026" },
    { "role": "packed_on", "text": "Packed Sep 8, 2026" },
    { "role": "allergens", "text": "Contains: tree nuts" },
    { "role": "net",       "text": "Net wt 2 lb (907 g)" },
    { "role": "note",      "text": "Keep refrigerated" }
  ]
}
```

- `name`: short product name in title case, no marketing words. Required.
- `description`: one or two short sentences, or `""`.
- `ingredients`: the full ingredient list as one string, comma separated,
  without the leading word "Ingredients", or `""`.
- `extras`: zero or more items, at most one per role except `note` (at most
  two). Roles are a closed set: `lot`, `best_by`, `packed_on`, `allergens`,
  `net`, `note`. Anything that fits no role and is not worth printing is
  dropped.

The schema is the contract between `src/ai-label.js` and the layout engine;
extras with unknown roles are discarded on the server, never trusted.

## Prompt

`buildPrompt({ size, text, hasImage, today, examples })` in `src/ai-label.js`
returns the system prompt and the user content blocks. It is a pure function
so the tests can pin its output.

The system prompt states:

- The job: food inventory labels for a small store, printed on a thermal
  label printer, so everything must be short and literal.
- The exact schema and role vocabulary above, with a formatting rule per
  role — dates as `Best by Oct 15, 2026` / `Packed Sep 8, 2026`, lots as
  `Lot 42`, allergens as `Contains: tree nuts, wheat`, weights as
  `Net wt 2 lb (907 g)` (or count, `12 ct`).
- Today's date, so "packed today" and "best by next month" resolve.
- Never invent details. A field the input does not support is `""` or
  omitted. For a photo, read only what is legible.
- Ingredients are the most important content: when the input shows an
  ingredient list, copy it faithfully and completely, in the printed order.
- The label size, with a note that on the two small sizes ingredients are
  still returned (they are kept, not shown).
- Up to five examples of house style: the most recently updated app labels
  in the library with a non-empty name and description, rendered as
  `name → description` pairs. Examples come from `store.list()` at request
  time. They are placed last in the system prompt so the fixed part in
  front of them can be prompt-cached.

The user message carries the photo (if any) as a base64 image block, then the
typed text (if any). With neither, the endpoint returns 400 before calling
the model.

## Layout engine

`src/ai-layout.js` exports `layoutDraft({ size, content })` → a label draft
(`{ size, fields, options, layout, extras }`) ready for `normalizeDraft` and
the editor. Pure and deterministic; every number below is in dots at 203 dpi.

Shared rules:

- Margin 20 dots on all sides (10 on 2x1.25).
- `layout.name` spans the full width at the top, using the default layout's
  name height for that size.
- Extras band: the extras in role order `lot, best_by, packed_on, allergens,
  net, note`, each in a box of fixed row height (70 dots on 5x3, 50 on 3x2,
  36 on 2x1.25), two per row on 5x3, one per row on the small sizes. Each
  extra is stored as `{ id, role, text, box, rotation: 0, fit: true, bold: false, align: 'L' }`
  so it renders as a single left-aligned line. All band extras share one
  `textSize` cap (computed from the longest line, at most 80% of the row
  height) so short values stay in proportion; on 5x3 an extra longer than
  24 characters takes a full-width row. (Amended 2026-09-08 after live runs.)
- Barcode keeps the default layout's box for that size (right column on 5x3,
  bottom on the small sizes). Nothing else may overlap it.
- Body: the space left between the extras band and the bottom margin (5x3:
  left of the barcode column). On 5x3 with ingredients, the body holds an
  extra `{ role: 'ingredients', text: 'Ingredients: …', align: 'L' }` drawn as
  wrapped text; the description, if present, becomes a single fitted line
  directly under the name (`layout.description` with the extras band moved
  below it, `showDescription: true`). Without ingredients the description
  takes the whole body (`layout.description`), as the default layout does
  today.
- If the body would be shorter than a minimum (60 dots on 5x3, 40 otherwise),
  `showDescription` is false and the description box is placed with zero
  height at the bottom of the band, so the editor can still turn it on.
- Small sizes: ingredients are never placed. They are kept on the draft as
  `fields.ingredients` so switching the size to 5x3 in the editor re-runs
  the layout and shows them (see "Editor" below).

Renderer change: `drawWrappedText` gains an `align` option (`'L' | 'C' | 'R'`,
default `'C'` so existing labels do not change) and honours it for wrapped
extras. The ingredients paragraph is drawn left aligned, top anchored, which
reads like a real food label rather than a centred block.

Tests (`test/ai-layout.test.js`): for every size × extra count (0, 1, 3, 6)
× ingredients (present, absent) × description (present, absent), assert every
box is inside the label, no two boxes overlap, extras keep role order, and
the barcode box equals the default. Fixtures also cover the "body too short"
case and the small-size ingredient carry-over.

## Data model changes

- `normalizeDraft` (`src/app.js`) keeps `extra.role` when it is one of the
  known roles (`lot, best_by, packed_on, allergens, net, note, ingredients`);
  anything else is dropped as today.
- `fields.ingredients` (string, optional) is preserved by `normalizeDraft`
  and the store. It is the source of truth for the ingredients paragraph; the
  `ingredients` extra is what gets drawn. On save the two can drift if the
  user edits the extra's text — that is acceptable; the extra is what prints.
- Existing labels are unaffected: no role, no ingredients field, nothing
  changes in how they render.

## Endpoint

`POST /api/ai-label`, JSON body (`express.json` at 30 MB for this route):

```json
{ "size": "3x5", "text": "almond flour lot 42 best by oct 15",
  "image": { "mediaType": "image/jpeg", "data": "<base64>" } }
```

`text` and `image` are each optional; at least one is required (400
otherwise). `mediaType` must be one of the image types already accepted by
extraction. Response: the draft from `layoutDraft`, passed through
`normalizeDraft`, plus `fields.barcode` set to a fresh unique UPC-A the same
way "New" does in the editor, and a `warnings` array (strings) for anything
the phone should toast — e.g. "Couldn't read the photo, used the text only".

Failure modes:

- No API key (config or `ANTHROPIC_API_KEY`): 400 with the same message the
  extraction endpoint uses today.
- `stop_reason === 'refusal'` after fallbacks, or a schema-invalid reply: 502
  with a message. The phone stays on the maker screen with the text intact.
- Model returns a name but nothing else: a normal 200. An empty draft is not
  an error; the editor opens and the user types.

`createApp` takes `aiLabelOverride` (same shape as `extractOverride`) so route
tests stub the model. `POST /api/extract` and `extractOverride` are removed
along with `src/extract.js` and its tests. The README's "First-time setup"
step 5 and the "Labels" section are updated to describe the maker instead of
photo extraction.

## Phone screen

On the new-label screen (`public/app.js`), the "Start from a photo" section
becomes "Make it for me":

- A textarea, placeholder "Almond flour, lot 42, best by Oct 15, contains
  tree nuts…", 3 rows, phone dictation works through the keyboard.
- A camera button (`capture="environment"`, same input as today). Once a
  photo is chosen a thumbnail appears with an × to remove it.
- The size picker, defaulting to `loadedSize` from settings (it already loads
  for the roll chip), overridable.
- A "Make label" button, disabled until there is text or a photo.

Before upload the photo is downscaled on the phone with a canvas to at most
1600 px on the long edge and re-encoded as JPEG at quality 0.85, then sent as
base64 inside the JSON body. This keeps uploads over WiFi to a few hundred
KB and keeps the model call cheap.

Tapping Make label shows a "Making your label…" toast, disables the button,
calls `api.makeLabel({ size, text, image })`, and on success calls
`renderEditor(view, draft)` — the same entry as a blank label, so the draft
is unsaved until the user taps Save. Any `warnings` are toasted after the
editor opens. On failure a red toast shows the message and the screen is left
as it was, text and photo included.

## Editor

Two small changes in `public/editor.js`:

- Extras with a `role` show the role as their tag in the field list
  ("LOT", "BEST BY", "INGREDIENTS") instead of the generic "FIELD".
- When the size changes and the draft has `fields.ingredients`, the editor
  re-requests the layout (`POST /api/ai-label/layout` with the current
  fields and extras — a thin route over `layoutDraft` that does not call the
  model) so ingredients appear on 5x3 and disappear on the small sizes.
  Manual edits to boxes are lost on a size change, as they are today.

## Tuning tool

`tools/ai-label-try.mjs <size> [--text "..."] [--photo file.jpg] [--out dir]`
runs the real model through `src/ai-label.js` and `layoutDraft`, prints the
JSON the model returned, and writes the rendered PNG via `renderPreview`. It
uses the API key from `data/config.json` or the environment. This is how the
prompt gets tuned against real products before the phone flow is touched:
run a dozen inputs, look at the PNGs, adjust the prompt, repeat.

## Testing

- `test/ai-label.test.js`: `buildPrompt` output is stable and contains the
  schema, today's date, and the examples; `makeLabelContent` (the model call
  wrapper) with a stub client parses a good reply, rejects unknown roles,
  throws on refusal, and sends the image block when given one.
- `test/ai-layout.test.js`: as described under Layout engine.
- `test/app.test.js`: route tests with `aiLabelOverride` — 400 without key,
  400 with neither text nor image, 200 returning a normalized draft with a
  fresh barcode and role-tagged extras, `warnings` passthrough, and the
  layout-only route.
- `test/render.test.js`: `drawWrappedText` left alignment paints at the left
  margin (pixel check on a rendered canvas, as the existing render tests do).

## Follow-up (not in this spec)

Editor polish sub-project, from the same conversation: touch precision when
dragging and resizing, snapping and alignment guides, easier text sizing,
preview lag, and barcodes rendering differently in the preview than in print.
