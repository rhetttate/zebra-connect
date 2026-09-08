// Turn an imported printer file (ZebraDesigner ZPL) into a native label
// draft: same words in the same places, drawn by the app from then on.
// Coordinate rules are spelled out in
// docs/superpowers/specs/2026-09-07-convert-printer-files-design.md.
import { parseFields } from './zpl-fields.js';
import { SIZES, defaultLayout } from './layout.js';
import { upcCheckDigit } from './barcode.js';

const MAX_EXTRAS = 20;
const ROTATION_UPRIGHT = { N: 0, R: 90, I: 180, B: 270 };
// 5x3 files are drawn the other way round from the app's landscape canvas:
// flipped 180° and un-rotated, a bottom-up (B) field reads left to right.
const ROTATION_5X3 = { B: 0, N: 90, I: 270, R: 180 };

function decodeText(raw) {
  return raw
    .replace(/\\([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\&/g, ' ')
    .replace(/\s+/g, ' ')
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

const estWidth = (text, w) => Math.max(40, Math.round(text.length * w * 0.6));

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

// Box for a text field in design space.
function textBox(f, size, text) {
  const h = f.font?.h ?? 30;
  const w = estWidth(text, f.font?.w ?? h);
  const shift = f.block?.align === 'C' ? Math.round((f.block.w - w) / 2) : 0;
  if (size === '3x5') {
    return { box: { x: 1015 - f.y + shift, y: f.x + 1 - h, w, h }, rotation: ROTATION_5X3[f.orient] ?? 0 };
  }
  const top = f.origin === 'FT' ? f.y - h : f.y;
  return { box: { x: f.x + shift, y: top, w, h }, rotation: ROTATION_UPRIGHT[f.orient] ?? 0 };
}

// The ^BY that precedes a barcode carries its bar height.
function barHeightBefore(zpl, field) {
  const before = zpl.slice(0, zpl.indexOf(`^FD${field.text}`));
  const matches = [...before.matchAll(/\^BY\d+,[\d.]*,(\d+)/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : 100;
}

function barcodeBox(f, size, zpl) {
  const barHeight = barHeightBefore(zpl, f);
  const w = 285; // module width 3 × 95 modules, what barcodeGeometry() yields
  const h = barHeight + 30;
  if (size === '3x5') {
    const rotated = f.orient === 'N' || f.orient === 'I';
    return {
      x: 1015 - f.y,
      y: Math.max(0, f.x + 1 - (rotated ? w : h)),
      w: rotated ? h : w,
      h: rotated ? w : h,
      rotation: rotated ? 270 : 0,
    };
  }
  const top = f.origin === 'FT' ? f.y - barHeight : f.y;
  return { x: f.x, y: Math.max(0, top), w, h, rotation: ROTATION_UPRIGHT[f.orient] ?? 0 };
}

function isUpcField(zpl, field) {
  const before = zpl.slice(0, zpl.indexOf(`^FD${field.text}`));
  const lastBarcodeCmd = [...before.matchAll(/\^B([A-Z0-9])[A-Z]?/g)].filter((m) => m[1] !== 'Y').pop();
  return lastBarcodeCmd?.[1] === 'U';
}

export function convertFileLabel(label, { generateBarcode }) {
  const warnings = [];
  const zpl = label.zpl;
  const fields = parseFields(zpl);
  const { size, warning } = guessSize(label, zpl, fields);
  if (warning) warnings.push(warning);
  if (/\^GF/.test(zpl)) warnings.push('embedded graphic dropped — the app cannot hold images');

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
    const { box, rotation } = textBox(nameField, size, nameField.decoded);
    layout.name = { ...box, rotation };
  }
  const extras = [];
  for (const f of rest) {
    const { box, rotation } = textBox(f, size, f.decoded);
    extras.push({ text: f.decoded, box, rotation });
  }

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
    const { box, rotation } = textBox({ ...b, font: { h: 30, w: 30 } }, size, b.text);
    extras.push({ text: b.text, box, rotation });
  }
  if (!barcode) {
    barcode = generateBarcode();
    if (!barcodes.length) warnings.push('file had no barcode — a new UPC-A was generated');
  }

  if (extras.length > MAX_EXTRAS) {
    warnings.push(`${extras.length - MAX_EXTRAS} text lines dropped — the app allows 20 extra fields`);
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
