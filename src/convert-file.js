// Turn an imported printer file (ZebraDesigner ZPL) into a native label
// draft: same words and graphics in the same places, drawn by the app from
// then on. Coordinate rules are spelled out in
// docs/superpowers/specs/2026-09-07-convert-printer-files-design.md.
import { createCanvas } from '@napi-rs/canvas';
import { parseFields } from './zpl-fields.js';
import { parseGraphics, graphicToPng } from './zpl-graphics.js';
import { SIZES, defaultLayout } from './layout.js';
import { upcCheckDigit } from './barcode.js';

const MAX_EXTRAS = 20;
const ROTATION_UPRIGHT = { N: 0, R: 90, I: 180, B: 270 };
// 5x3 files are drawn the other way round from the app's landscape canvas:
// flipped 180° and un-rotated, a bottom-up (B) field reads left to right.
const ROTATION_5X3 = { B: 0, N: 90, I: 270, R: 180 };

const measureCtx = createCanvas(1, 1).getContext('2d');
// Width the app's renderer will give this text at this height, so the box
// is exactly as wide as needed and the text keeps its full size.
function measuredWidth(text, h, bold = true) {
  measureCtx.font = `${bold ? 'bold ' : ''}${h}px Arial`;
  return Math.ceil(measureCtx.measureText(text).width) + 4;
}

// ^FH hex escapes become characters and \& (new line) a space; the spacing
// inside a field is part of its design and stays as typed.
function decodeText(raw) {
  return raw
    .replace(/\\([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\&/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .trim();
}

function guessSize(label, zpl, fields) {
  if (label.size && SIZES[label.size]) return { size: label.size, warning: null };
  const pw = Number(/\^PW(\d+)/.exec(zpl)?.[1]);
  if (pw === 406) return { size: '2x1.25', warning: null };
  if (pw === 575) {
    const upright = fields.some((f) => f.kind === 'text' && f.orient === 'N');
    return { size: upright ? '3x2' : '3x5', warning: null };
  }
  return { size: '2x1.25', warning: 'file declares no size — assumed 2 × 1.25' };
}

// In the app's model a box is always the area the element covers on the
// label; the renderer draws rotated content to fit inside it. So a sideways
// field's box is simply its visual footprint.
function placeRotated(footprint, rotation) {
  return { ...footprint, rotation };
}

// Keep a box inside the design canvas: the editor refuses layouts that
// stick out, and a file's baseline maths can land a dot or two past the edge.
function clampBox(box, size) {
  const { width, height } = SIZES[size];
  const w = Math.min(box.w, width);
  const h = Math.min(box.h, height);
  return {
    ...box,
    w, h,
    x: Math.min(Math.max(0, box.x), width - w),
    y: Math.min(Math.max(0, box.y), height - h),
  };
}

// Design-space anchor and rotation of a field: the top-left of an unrotated
// line of height h starting at the field's origin.
function anchor(f, size, h) {
  if (size === '3x5') return { x: 1015 - f.y, y: f.x + 1 - h, rotation: ROTATION_5X3[f.orient] ?? 0 };
  const top = f.origin === 'FT' ? f.y - h : f.y;
  return { x: f.x, y: top, rotation: ROTATION_UPRIGHT[f.orient] ?? 0 };
}

// Zebra's built-in font 0 is a condensed face: at the same nominal size it
// runs about 0.85× the width of Arial bold (measured against Labelary
// renders). A field's own w/h ratio condenses it further.
const ZEBRA_CONDENSE = 0.85;
const stretchOf = (font) => Math.round(ZEBRA_CONDENSE * ((font?.w && font?.h) ? font.w / font.h : 1) * 100) / 100;

function textExtra(f, size, text) {
  const h = f.font?.h ?? 30;
  const stretch = stretchOf(f.font);
  const a = anchor(f, size, h);
  const centred = f.block?.align === 'C' && f.block.w > 0;
  const w = centred ? f.block.w : Math.ceil(measuredWidth(text, h) * stretch);
  const upright = a.rotation === 0 || a.rotation === 180;
  // For sideways text the footprint is h wide and w tall.
  const footprint = upright ? { x: a.x, y: a.y, w, h } : { x: a.x, y: a.y, w: h, h: w };
  const box = placeRotated(footprint, a.rotation);
  return {
    text, box: { x: box.x, y: box.y, w: box.w, h: box.h }, rotation: a.rotation,
    fit: true, bold: true, align: centred ? 'C' : 'L', stretch,
  };
}

// The ^BY that precedes a barcode carries its bar height.
function barHeightBefore(zpl, field) {
  const before = zpl.slice(0, zpl.indexOf(`^FD${field.text}`));
  const matches = [...before.matchAll(/\^BY\d+,[\d.]*,(\d+)/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : 100;
}

// The rectangle a barcode covers in print space. ^FO is always the top-left
// corner; ^FT's origin moves with the orientation: bottom-left (N),
// top-left (R), top-right (I), bottom-right (B).
function barcodePrintRect(f, barHeight) {
  const w = 285; // module width 3 × 95 modules, what barcodeGeometry() yields
  const h = barHeight + 30; // bars plus the digits underneath
  const sideways = f.orient === 'R' || f.orient === 'B';
  const rw = sideways ? h : w;
  const rh = sideways ? w : h;
  if (f.origin === 'FO') return { x: f.x, y: f.y, w: rw, h: rh };
  switch (f.orient) {
    case 'R': return { x: f.x, y: f.y, w: rw, h: rh };
    case 'I': return { x: f.x - rw, y: f.y, w: rw, h: rh };
    case 'B': return { x: f.x - rw, y: f.y - rh, w: rw, h: rh };
    default: return { x: f.x, y: f.y - barHeight, w: rw, h: rh };
  }
}

function barcodeBox(f, size, zpl) {
  const r = barcodePrintRect(f, barHeightBefore(zpl, f));
  // Design-space footprint: 5x3 files are flipped and un-rotated (see spec).
  const footprint = size === '3x5'
    ? { x: 1015 - r.y - r.h, y: r.x + 1, w: r.h, h: r.w }
    : r;
  const rotation = (size === '3x5' ? ROTATION_5X3 : ROTATION_UPRIGHT)[f.orient] ?? 0;
  return placeRotated(footprint, rotation);
}

function isUpcField(zpl, field) {
  const before = zpl.slice(0, zpl.indexOf(`^FD${field.text}`));
  const lastBarcodeCmd = [...before.matchAll(/\^B([A-Z0-9])[A-Z]?/g)].filter((m) => m[1] !== 'Y').pop();
  return lastBarcodeCmd?.[1] === 'U';
}

async function imageExtras(zpl, size) {
  const out = [];
  for (const g of parseGraphics(zpl)) {
    const png = await graphicToPng(g, { rotate90cw: size === '3x5' });
    const top = g.origin === 'FT' ? g.y - g.height : g.y;
    const box = size === '3x5'
      ? { x: 1015 - top - g.height, y: g.x + 1, w: g.height, h: g.width }
      : { x: g.x, y: top, w: g.width, h: g.height };
    out.push({ kind: 'image', text: '', image: png.image, box, rotation: 0 });
  }
  return out;
}

export async function convertFileLabel(label, { generateBarcode }) {
  const warnings = [];
  const zpl = label.zpl;
  const fields = parseFields(zpl);
  const { size, warning } = guessSize(label, zpl, fields);
  if (warning) warnings.push(warning);

  const texts = fields
    .filter((f) => f.kind === 'text')
    .map((f) => ({ ...f, decoded: decodeText(f.text) }))
    .filter((f) => f.decoded);
  const barcodes = fields.filter((f) => f.kind === 'barcode');
  const layout = defaultLayout(size);
  for (const key of Object.keys(layout)) layout[key].rotation = 0;

  // Name = biggest text; the rest become extras in place.
  texts.sort((a, b) => (b.font?.h ?? 0) - (a.font?.h ?? 0));
  const [nameField, ...rest] = texts;
  const name = nameField?.decoded ?? label.fields.name;
  if (nameField) {
    const { box, rotation, stretch } = textExtra(nameField, size, nameField.decoded);
    layout.name = { ...box, rotation, stretch };
  }
  const extras = rest.map((f) => textExtra(f, size, f.decoded));

  // Barcode: UPC-A only; anything else is kept as text. The printer encodes
  // the first 11 digits of a ^BU payload and computes the check digit
  // itself, so the app does the same rather than trusting a 12th digit.
  let barcode = '';
  for (const b of barcodes) {
    const upc = isUpcField(zpl, b);
    const digits = b.text.replace(/\D/g, '');
    if (upc && digits.length >= 11 && !barcode) {
      barcode = digits.slice(0, 11) + upcCheckDigit(digits.slice(0, 11));
      layout.barcode = barcodeBox(b, size, zpl);
      continue;
    }
    warnings.push(!upc
      ? 'non-UPC barcode (e.g. Code 128) kept as text, not as a barcode'
      : barcode
        ? `extra barcode ${b.text} kept as text — the app holds one barcode per label`
        : `barcode ${b.text} is too short for UPC-A — replaced with a new one`);
    extras.push(textExtra({ ...b, font: { h: 30, w: 30 } }, size, b.text));
  }
  if (!barcode) {
    barcode = generateBarcode();
    if (!barcodes.length) warnings.push('file had no barcode — a new UPC-A was generated');
  }

  // Graphics (logos, or text ZebraDesigner turned into pictures) ride along
  // as image extras; anything not in the Z64 encoding is dropped.
  const images = await imageExtras(zpl, size);
  const graphicCount = (zpl.match(/\^GFA/g) ?? []).length;
  if (graphicCount > images.length) warnings.push(`${graphicCount - images.length} embedded graphic(s) dropped — unsupported encoding`);
  extras.push(...images);

  if (extras.length > MAX_EXTRAS) {
    warnings.push(`${extras.length - MAX_EXTRAS} fields dropped — the app allows 20 extra fields`);
    extras.length = MAX_EXTRAS;
  }
  for (const key of Object.keys(layout)) layout[key] = clampBox(layout[key], size);
  for (const extra of extras) extra.box = clampBox(extra.box, size);

  return {
    draft: {
      size,
      // The file's own name goes in the (hidden) description so the library
      // can still be searched by it; the printed name is the label's big text.
      fields: { name, description: label.fields?.name ?? '', barcode },
      options: { showDescription: false },
      layout,
      extras,
    },
    warnings,
  };
}
