import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrn, withQuantity } from '../src/printer-file.js';

const designerExport = (pw, ll) => [
  '﻿CT~~CD,~CC^~CT~', '^XA', '~TA000', '~JSN', '^XZ', '^XA', '^MMT',
  pw ? `^PW${pw}` : '', ll ? `^LL${ll}` : '', '^LS0',
  '^FT43,50^A0N,48,48^FH\\^CI28^FDBACON        $69^FS^CI27',
  '^PQ1,0,1,Y', '^XZ',
].filter(Boolean).join('\r\n');

test('parsePrn strips the BOM and names the label after the file', () => {
  const label = parsePrn(designerExport(406, 254), 'bacon.prn');
  assert.equal(label.name, 'bacon');
  assert.ok(label.zpl.startsWith('CT~~CD'));
  assert.ok(!label.zpl.includes('﻿'));
});

test('parsePrn maps the declared ^PW/^LL to the app label sizes', () => {
  assert.equal(parsePrn(designerExport(406, 254), 'a.prn').size, '2x1.25');
  assert.equal(parsePrn(designerExport(575, 1015), 'b.prn').size, '3x5');
  assert.equal(parsePrn(designerExport(575, 406), 'c.prn').size, '3x2');
});

test('parsePrn leaves size null when the file does not declare one', () => {
  assert.equal(parsePrn(designerExport(406, 0), 'd.prn').size, null);
  assert.equal(parsePrn(designerExport(0, 0), 'e.prn').size, null);
});

test('parsePrn accepts raw bytes and rejects files that are not ZPL', () => {
  const bytes = Buffer.from(designerExport(406, 254), 'utf8');
  assert.equal(parsePrn(bytes, 'bytes.prn').size, '2x1.25');
  assert.throws(() => parsePrn('hello world', 'x.prn'), /not a ZPL/i);
});

test('withQuantity rewrites an existing ^PQ and keeps its other parameters', () => {
  const zpl = withQuantity(designerExport(406, 254), 3);
  assert.match(zpl, /\^PQ3,0,1,Y/);
  assert.ok(!zpl.includes('^PQ1,'));
});

test('withQuantity inserts ^PQ before the final ^XZ when the file has none', () => {
  const zpl = withQuantity('^XA^FO10,10^FDhi^FS^XZ', 5);
  assert.equal(zpl, '^XA^FO10,10^FDhi^FS^PQ5^XZ');
});

test('withQuantity leaves the job alone for quantity 1', () => {
  const zpl = designerExport(406, 254);
  assert.equal(withQuantity(zpl, 1), zpl);
});
