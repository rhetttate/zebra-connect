import crypto from 'node:crypto';
import { SIZES, defaultLayout } from './layout.js';

// Extras print in this order; anything with another role is not an extra.
export const ROLE_ORDER = ['lot', 'best_by', 'packed_on', 'allergens', 'net', 'note'];

// Geometry per size, in dots at 203 dpi. The small sizes use a shorter name
// and barcode than the hand-editing defaults so a band of extras fits.
const PARAMS = {
  '3x5': { margin: 20, gap: 10, nameH: 100, rowH: 70, cols: 2, descLineH: 60, minBody: 60 },
  '3x2': { margin: 20, gap: 8, nameH: 80, rowH: 50, cols: 1, minBody: 40, barcodeH: 130 },
  '2x1.25': { margin: 10, gap: 6, nameH: 60, rowH: 36, cols: 1, minBody: 40, barcodeH: 100 },
};

const box = (x, y, w, h) => ({ x, y, w, h });

// Rough Arial glyph width as a fraction of the font size; the renderer still
// shrinks text that measures wider, so this only has to be close.
const CHAR_W = 0.55;
// Band text never grows past this share of its row, so short values like
// "Lot 42" stay in proportion with dates and allergen lines.
const SIZE_CAP = 0.8;
// On the 5x3, an extra longer than this takes a full-width row.
const WIDE_CHARS = 24;

function estimateSize(text, width, rowH) {
  return Math.max(12, Math.min(Math.round(rowH * SIZE_CAP), Math.floor(width / (CHAR_W * text.length))));
}

function orderedExtras(extras) {
  return (Array.isArray(extras) ? extras : [])
    .map((e) => ({ role: e?.role, text: String(e?.text ?? '').trim() }))
    .filter((e) => ROLE_ORDER.includes(e.role) && e.text)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

export function layoutDraft({ size, content }) {
  const dims = SIZES[size];
  const P = PARAMS[size];
  if (!dims || !P) throw new Error('unknown size');
  const { width, height } = dims;
  const def = defaultLayout(size);

  const name = box(P.margin, P.margin, width - 2 * P.margin, P.nameH);
  let barcode;
  let bodyW;
  let bodyBottom;
  if (size === '3x5') {
    barcode = box(def.barcode.x, def.barcode.y, def.barcode.w, def.barcode.h);
    bodyW = def.barcode.x - 2 * P.gap - P.margin;
    bodyBottom = height - P.margin;
  } else {
    barcode = box(def.barcode.x, height - P.margin - P.barcodeH, def.barcode.w, P.barcodeH);
    bodyW = width - 2 * P.margin;
    bodyBottom = barcode.y - P.gap;
  }

  const description = String(content.description ?? '').trim();
  const ingredients = size === '3x5' ? String(content.ingredients ?? '').trim() : '';
  const bandTop = name.y + name.h + P.gap;

  // Small labels: keep only as many extras as fit above the barcode.
  let extras = orderedExtras(content.extras);
  if (size !== '3x5') {
    const maxRows = Math.max(0, Math.floor((bodyBottom - bandTop + P.gap) / (P.rowH + P.gap)));
    extras = extras.slice(0, maxRows * P.cols);
  }

  // Stack: [one-line description] → extras band → body. Returns what is left.
  function place(withDescLine) {
    let y = bandTop;
    const layout = { name, barcode };
    if (withDescLine) {
      layout.description = box(P.margin, y, bodyW, P.descLineH);
      y += P.descLineH + P.gap;
    }
    const colW = Math.floor((bodyW - (P.cols - 1) * P.gap) / P.cols);
    const placed = [];
    let col = 0;
    let row = 0;
    for (const e of extras) {
      const wide = P.cols > 1 && e.text.length > WIDE_CHARS;
      if (wide && col > 0) { col = 0; row++; }
      const w = wide ? bodyW : colW;
      placed.push({
        id: crypto.randomUUID(),
        role: e.role,
        text: e.text,
        box: box(P.margin + col * (colW + P.gap), y + row * (P.rowH + P.gap), w, P.rowH),
        rotation: 0,
        fit: true,
        align: 'L',
      });
      if (wide) { col = 0; row++; }
      else { col++; if (col === P.cols) { col = 0; row++; } }
    }
    const rows = row + (col > 0 ? 1 : 0);
    if (placed.length) {
      const textSize = Math.min(...placed.map((p) => estimateSize(p.text, p.box.w, P.rowH)));
      for (const p of placed) p.textSize = textSize;
      y += rows * (P.rowH + P.gap);
    }
    return { layout, placed, bodyY: y, bodyH: bodyBottom - y };
  }

  let result = place(Boolean(ingredients && description));
  if (ingredients && result.layout.description && result.bodyH < P.minBody) result = place(false);
  const { layout, placed, bodyY, bodyH } = result;

  let showDescription = Boolean(layout.description);
  if (ingredients && bodyH >= P.minBody) {
    placed.push({
      id: crypto.randomUUID(),
      role: 'ingredients',
      text: `Ingredients: ${ingredients}`,
      box: box(P.margin, bodyY, bodyW, bodyH),
      rotation: 0,
      align: 'L',
    });
  }
  if (!layout.description) {
    // The body box is the description's home whether or not it is shown, so
    // the editor's checkbox has somewhere sensible to reveal it.
    const h = Math.max(bodyH, P.minBody);
    layout.description = box(P.margin, Math.min(bodyY, bodyBottom - h), bodyW, h);
    showDescription = !ingredients && Boolean(description) && bodyH >= P.minBody;
  }

  return {
    size,
    fields: { name: String(content.name ?? '').trim(), description, barcode: '' },
    options: { showDescription },
    layout,
    extras: placed,
  };
}
