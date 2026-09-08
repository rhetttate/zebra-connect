// Finished printer files (.prn exported from ZebraDesigner and friends).
// They are complete ZPL jobs, so the app stores them as-is and only touches
// the print quantity.
import path from 'node:path';
import { SIZES } from './layout.js';

const BOM = '﻿';

function textOf(input) {
  const text = Buffer.isBuffer(input) || input instanceof Uint8Array
    ? Buffer.from(input).toString('utf8')
    : String(input ?? '');
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

// ZebraDesigner writes ^PW/^LL in dots for the 203 dpi head; match them to
// the app's label sizes with a little slack for rounding.
function sizeFor(zpl) {
  const pw = Number(/\^PW(\d+)/.exec(zpl)?.[1]);
  const ll = Number(/\^LL(\d+)/.exec(zpl)?.[1]);
  if (!pw || !ll) return null;
  const near = (a, b) => Math.abs(a - b) <= 8;
  for (const [key, { width, height }] of Object.entries(SIZES)) {
    // The 5x3 designer canvas is landscape but prints rotated on the 576-dot
    // head, so accept the declared dimensions in either orientation.
    if ((near(pw, width) && near(ll, height)) || (near(pw, height) && near(ll, width))) return key;
  }
  return null;
}

export function parsePrn(input, filename) {
  const zpl = textOf(input);
  if (!/\^XA[\s\S]*\^XZ/.test(zpl)) {
    throw Object.assign(new Error('not a ZPL printer file (no ^XA…^XZ job)'), { status: 400 });
  }
  const name = path.basename(String(filename ?? ''), path.extname(String(filename ?? ''))).trim() || 'Printer file';
  return { name, size: sizeFor(zpl), zpl };
}

export function withQuantity(zpl, quantity) {
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 100);
  if (qty === 1) return zpl;
  if (/\^PQ\d+/.test(zpl)) return zpl.replace(/\^PQ\d+/, `^PQ${qty}`);
  const end = zpl.lastIndexOf('^XZ');
  return end === -1 ? `${zpl}^PQ${qty}` : `${zpl.slice(0, end)}^PQ${qty}${zpl.slice(end)}`;
}
