import test from 'node:test';
import assert from 'node:assert/strict';
import { convertFileLabel } from '../src/convert-file.js';

const gen = () => '036000291452';
const file = (zpl, size = null, name = 'bacon') => ({ id: 'f1', kind: 'prn', size, fields: { name, barcode: '' }, zpl });

test('a 2x1.25 price tag becomes name + barcode with boxes in place', () => {
  const zpl = '^XA^PW406^LL254^FT43,50^A0N,48,48^FH\\^FDBACON        $69^FS^BY3,2,144^FT63,220^BUN,,Y,N,Y^FH\\^FD209990069008^FS^XZ';
  const { draft, warnings } = convertFileLabel(file(zpl, '2x1.25'), { generateBarcode: gen });
  assert.deepEqual(warnings, []);
  assert.equal(draft.size, '2x1.25');
  assert.equal(draft.fields.name, 'BACON $69');
  assert.equal(draft.fields.barcode, '209990069008');
  assert.equal(draft.options.showDescription, false);
  assert.deepEqual(draft.layout.name, { x: 43, y: 2, w: 259, h: 48, rotation: 0 });
  assert.deepEqual(draft.layout.barcode, { x: 63, y: 76, w: 285, h: 174, rotation: 0 });
  assert.deepEqual(draft.extras, []);
});

test('a 5x3 file is flipped and un-rotated into the landscape canvas', () => {
  const zpl = '^XA^PW575^LL1015^FT76,1015^A0B,72,43^FB1014,1,18,C^FH\\^CI28^FDFULLY COOKED\\5C&^FS^FT333,747^A0B,175,175^FH\\^FD$12.00^FS^BY3,2,98^FT337,48^BUI,,Y,N,Y^FH\\^FD893463827495^FS^XZ';
  const { draft, warnings } = convertFileLabel(file(zpl, '3x5'), { generateBarcode: gen });
  assert.deepEqual(warnings, []);
  assert.equal(draft.fields.name, '$12.00');
  assert.deepEqual(draft.layout.name, { x: 268, y: 159, w: 630, h: 175, rotation: 0 });
  assert.equal(draft.extras.length, 1);
  assert.equal(draft.extras[0].text, 'FULLY COOKED');
  // centred ^FB block of 1014: est = 12 chars * 43 * 0.6 = 310, x = 0 + (1014 - 310) / 2 = 352
  assert.deepEqual(draft.extras[0].box, { x: 352, y: 5, w: 310, h: 72 });
  assert.equal(draft.extras[0].rotation, 0);
  assert.equal(draft.layout.barcode.rotation, 270);
});

test('non-UPC barcodes become text, graphics warn, missing barcode is generated', () => {
  const zpl = '^XA^PW406^LL254^FO20,120^GFA,8,8,1,::::::::^FS^FT43,50^A0N,48,48^FDHOOPS^FS^BY2,3,60^FT60,200^BCN,60,Y,N,N^FD12345678^FS^XZ';
  const { draft, warnings } = convertFileLabel(file(zpl, '2x1.25'), { generateBarcode: gen });
  assert.equal(draft.fields.barcode, '036000291452');
  assert.equal(draft.extras[0].text, '12345678');
  assert.match(warnings.join(' '), /graphic/i);
  assert.match(warnings.join(' '), /Code 128|barcode/i);
});

test('UPC payloads use the first 11 digits plus a computed check digit, like the printer does', () => {
  const eleven = convertFileLabel(file('^XA^PW406^LL254^FT10,50^A0N,40,40^FDX^FS^FT63,220^BUN,,Y,N,Y^FD03600029145^FS^XZ', '2x1.25'), { generateBarcode: gen });
  assert.equal(eleven.draft.fields.barcode, '036000291452');
  assert.deepEqual(eleven.warnings, []);
  // 12 digits with a wrong trailing digit: the printer would still encode 03600029145 + 2.
  const wrongCheck = convertFileLabel(file('^XA^PW406^LL254^FT10,50^A0N,40,40^FDX^FS^FT63,220^BUN,,Y,N,Y^FD036000291459^FS^XZ', '2x1.25'), { generateBarcode: gen });
  assert.equal(wrongCheck.draft.fields.barcode, '036000291452');
  assert.deepEqual(wrongCheck.warnings, []);
  const tooShort = convertFileLabel(file('^XA^PW406^LL254^FT10,50^A0N,40,40^FDX^FS^FT63,220^BUN,,Y,N,Y^FD12345^FS^XZ', '2x1.25'), { generateBarcode: gen });
  assert.equal(tooShort.draft.fields.barcode, '036000291452');
  assert.match(tooShort.warnings.join(' '), /barcode/i);
});

test('the original file name is kept in the description for searching, not printed', () => {
  const zpl = '^XA^PW406^LL254^FT43,50^A0N,48,48^FD$69^FS^XZ';
  const { draft } = convertFileLabel(file(zpl, '2x1.25', 'bacon'), { generateBarcode: gen });
  assert.equal(draft.fields.name, '$69');
  assert.equal(draft.fields.description, 'bacon');
  assert.equal(draft.options.showDescription, false);
});

test('boxes are clamped inside the label canvas so the editor never flags them', () => {
  // Barcode baseline at y=225 with 112-dot bars: 225-112=113 top, +142 box = 255 > 253 canvas.
  const zpl = '^XA^PW406^LL254^FT380,50^A0N,48,48^FDWIDE TEXT^FS^BY3,2,112^FT63,225^BUN,,Y,N,Y^FD209990069008^FS^XZ';
  const { draft } = convertFileLabel(file(zpl, '2x1.25'), { generateBarcode: gen });
  const inside = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 406 && b.y + b.h <= 253;
  assert.ok(inside(draft.layout.barcode), JSON.stringify(draft.layout.barcode));
  assert.ok(inside(draft.layout.name), JSON.stringify(draft.layout.name));
  assert.equal(draft.layout.barcode.h, 142);
  assert.equal(draft.layout.barcode.y, 111);
});

test('size falls back from ^PW and warns when nothing is declared; extras are capped at 20', () => {
  const lines = Array.from({ length: 23 }, (_, i) => `^FT10,${30 + i * 20}^A0N,18,18^FDline ${i}^FS`).join('');
  const { draft, warnings } = convertFileLabel(file(`^XA${lines}^XZ`, null), { generateBarcode: gen });
  assert.equal(draft.size, '2x1.25');
  assert.equal(draft.extras.length, 20);
  assert.match(warnings.join(' '), /size/i);
  assert.match(warnings.join(' '), /20/);
});
