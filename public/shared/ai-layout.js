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
  const colW = Math.floor((bodyW - (P.cols - 1) * P.gap) / P.cols);

  // Stack: [one-line description] → extras band → body. Returns what is left.
  function place(list, withDescLine) {
    let y = bandTop;
    const layout = { name, barcode };
    if (withDescLine) {
      layout.description = box(P.margin, y, bodyW, P.descLineH);
      y += P.descLineH + P.gap;
    }

    // One size for the whole band, read off the short lines only: a long line
    // wraps at that size rather than dragging every other value down with it.
    const short = list.filter((e) => e.text.length <= WIDE_CHARS);
    const textSize = short.length
      ? Math.min(...short.map((e) => estimateSize(e.text, colW, P.rowH)))
      : Math.round(P.rowH * SIZE_CAP);
    // Rows are only as tall as their text, and a long line gets two of them.
    const shortH = Math.min(P.rowH, Math.round(textSize * 1.5));
    const wrapH = Math.round(textSize * 1.15 * 2 + textSize * 0.4);

    const placed = [];
    let rowY = y;
    let col = 0;
    for (const e of list) {
      const common = { id: globalThis.crypto.randomUUID(), role: e.role, text: e.text, rotation: 0, align: 'L', textSize };
      if (e.text.length > WIDE_CHARS) {
        if (col > 0) { rowY += shortH + P.gap; col = 0; }
        placed.push({ ...common, box: box(P.margin, rowY, bodyW, wrapH) });
        rowY += wrapH + P.gap;
      } else {
        placed.push({ ...common, box: box(P.margin + col * (colW + P.gap), rowY, colW, shortH), fit: true });
        col += 1;
        if (col === P.cols) { rowY += shortH + P.gap; col = 0; }
      }
    }
    if (col > 0) rowY += shortH + P.gap;
    return { layout, placed, textSize, bodyY: rowY, bodyH: bodyBottom - rowY };
  }

  let extras = orderedExtras(content.extras);
  let withDescLine = Boolean(ingredients && description);
  let result = place(extras, withDescLine);
  // Ingredients need a body to live in; give up the description line first.
  if (ingredients && result.layout.description && result.bodyH < P.minBody) {
    withDescLine = false;
    result = place(extras, false);
  }
  // Then drop trailing extras — role order puts notes last — until the band
  // stops running past the body. Every size, not just the small ones.
  const needBody = ingredients ? P.minBody : 0;
  while (result.bodyH < needBody && extras.length) {
    extras = extras.slice(0, -1);
    result = place(extras, withDescLine);
  }
  const { layout, placed, textSize, bodyY, bodyH } = result;

  let showDescription = Boolean(layout.description);
  if (ingredients && bodyH >= P.minBody) {
    placed.push({
      id: globalThis.crypto.randomUUID(),
      role: 'ingredients',
      text: `Ingredients: ${ingredients}`,
      box: box(P.margin, bodyY, bodyW, bodyH),
      rotation: 0,
      align: 'L',
      // Big enough to read, but never a headline in a tall empty body.
      textSize: Math.max(textSize, 28),
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
