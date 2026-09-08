import test from 'node:test';
import assert from 'node:assert/strict';
import { convertFileLabel } from '../src/convert-file.js';

const gen = () => '036000291452';
const file = (zpl, size = null, name = 'bacon') => ({ id: 'f1', kind: 'prn', size, fields: { name, barcode: '' }, zpl });

test('a 2x1.25 price tag becomes name + barcode with boxes in place', async () => {
  const zpl = '^XA^PW406^LL254^FT43,50^A0N,48,48^FH\\^FDBACON        $69^FS^BY3,2,144^FT63,220^BUN,,Y,N,Y^FH\\^FD209990069008^FS^XZ';
  const { draft, warnings } = await convertFileLabel(file(zpl, '2x1.25'), { generateBarcode: gen });
  assert.deepEqual(warnings, []);
  assert.equal(draft.size, '2x1.25');
  assert.equal(draft.fields.name, 'BACON        $69', 'inner spacing is preserved');
  assert.equal(draft.fields.barcode, '209990069008');
  assert.equal(draft.options.showDescription, false);
  // width is measured in the app's font, not estimated: a 48px bold line of that text is ~300-400 dots
  // wide, and a box that would overhang the label is nudged back inside by a few dots.
  const nb = draft.layout.name;
  assert.equal(nb.y, 2); assert.equal(nb.h, 48); assert.equal(nb.rotation, 0);
  assert.ok(nb.x >= 35 && nb.x <= 43, `x ${nb.x}`);
  assert.ok(nb.w > 280 && nb.w <= 371 && nb.x + nb.w <= 406, `measured width ${nb.w}`);
  assert.deepEqual(draft.layout.barcode, { x: 63, y: 76, w: 285, h: 174, rotation: 0 });
  assert.deepEqual(draft.extras, []);
});

test('a 5x3 file is flipped and un-rotated into the landscape canvas', async () => {
  const zpl = '^XA^PW575^LL1015^FT76,1015^A0B,72,43^FB1014,1,18,C^FH\\^CI28^FDFULLY COOKED\\5C&^FS^FT333,747^A0B,175,175^FH\\^FD$12.00^FS^BY3,2,98^FT337,48^BUI,,Y,N,Y^FH\\^FD893463827495^FS^XZ';
  const { draft, warnings } = await convertFileLabel(file(zpl, '3x5'), { generateBarcode: gen });
  assert.deepEqual(warnings, []);
  assert.equal(draft.fields.name, '$12.00');
  const nb = draft.layout.name;
  assert.equal(nb.x, 268); assert.equal(nb.y, 159); assert.equal(nb.h, 175); assert.equal(nb.rotation, 0);
  assert.equal(draft.extras.length, 1);
  const heading = draft.extras[0];
  assert.equal(heading.text, 'FULLY COOKED');
  // a centred ^FB block keeps the block as its box and centres the text inside it
  assert.deepEqual(heading.box, { x: 0, y: 5, w: 1014, h: 72 });
  assert.deepEqual([heading.fit, heading.bold, heading.align, heading.rotation], [true, true, 'C', 0]);
  // Zebra font 0 is condensed (~0.85 of Arial bold) and this heading is 43 wide for 72 tall.
  assert.equal(heading.stretch, Math.round(0.85 * (43 / 72) * 100) / 100);
  assert.equal(draft.layout.name.stretch, 0.85);
  // The barcode is 180°-oriented (I): its ^FT origin is the top-right corner in print space, so it
  // covers print x 52..337, y 48..176. Flipped and un-rotated that is the design area
  // (839, 53, 128 wide, 285 tall) at the top right — the box IS that area; the renderer
  // draws the bars sideways inside it.
  assert.deepEqual(draft.layout.barcode, { x: 839, y: 53, w: 128, h: 285, rotation: 270 });
});

test('a sideways barcode hugging the right edge stays inside the canvas', async () => {
  const zpl = '^XA^PW575^LL1015^FT560,20^A0B,40,40^FDX^FS^BY3,2,98^FT130,10^BUI,,Y,N,Y^FD893463827495^FS^XZ';
  const { draft } = await convertFileLabel(file(zpl, '3x5'), { generateBarcode: gen });
  const b = draft.layout.barcode;
  assert.ok(b.x >= 0 && b.x + b.w <= 1015 && b.y >= 0 && b.y + b.h <= 576, JSON.stringify(b));
  assert.ok(b.x + b.w > 1000, 'still hugs the right edge');
  assert.equal(b.rotation, 270);
  assert.ok(b.h > b.w, 'sideways: taller than wide');
});

test('embedded graphics become image extras in place, rotated for 5x3 files', async () => {
  const zlib = await import('node:zlib');
  const raw = Buffer.from([0xff, 0xff, 0x80, 0x00, 0x40, 0x00, 0x20, 0x00]); // 16x4 bitmap
  const gfa = `^GFA,8,8,2,:Z64:${zlib.deflateSync(raw).toString('base64')}:0000`;
  const small = await convertFileLabel(file(`^XA^PW406^LL254^FO20,120${gfa}^FS^FT43,50^A0N,48,48^FDHOOPS^FS^XZ`, '2x1.25'), { generateBarcode: gen });
  const img = small.draft.extras.find((e) => e.kind === 'image');
  assert.ok(img, 'image extra present');
  assert.match(img.image, /^data:image\/png;base64,/);
  assert.deepEqual(img.box, { x: 20, y: 120, w: 16, h: 4 });
  assert.ok(!small.warnings.some((w) => /graphic/i.test(w)), 'no graphic warning when the graphic is kept');

  const tall = await convertFileLabel(file(`^XA^PW575^LL1015^FO100,200${gfa}^FS^FT333,747^A0B,175,175^FD$12.00^FS^XZ`, '3x5'), { generateBarcode: gen });
  const timg = tall.draft.extras.find((e) => e.kind === 'image');
  // print rect (100,200,16,4) → design x = 1015-200-4 = 811, y = 100+1 = 101, size swapped to 4x16
  assert.deepEqual(timg.box, { x: 811, y: 101, w: 4, h: 16 });
});

test('non-UPC barcodes become text, graphics warn, missing barcode is generated', async () => {
  const zpl = '^XA^PW406^LL254^FO20,120^GFA,8,8,1,::::::::^FS^FT43,50^A0N,48,48^FDHOOPS^FS^BY2,3,60^FT60,200^BCN,60,Y,N,N^FD12345678^FS^XZ';
  const { draft, warnings } = await convertFileLabel(file(zpl, '2x1.25'), { generateBarcode: gen });
  assert.equal(draft.fields.barcode, '036000291452');
  assert.equal(draft.extras[0].text, '12345678');
  assert.match(warnings.join(' '), /graphic/i);
  assert.match(warnings.join(' '), /Code 128|barcode/i);
});

test('UPC payloads use the first 11 digits plus a computed check digit, like the printer does', async () => {
  const eleven = await convertFileLabel(file('^XA^PW406^LL254^FT10,50^A0N,40,40^FDX^FS^FT63,220^BUN,,Y,N,Y^FD03600029145^FS^XZ', '2x1.25'), { generateBarcode: gen });
  assert.equal(eleven.draft.fields.barcode, '036000291452');
  assert.deepEqual(eleven.warnings, []);
  // 12 digits with a wrong trailing digit: the printer would still encode 03600029145 + 2.
  const wrongCheck = await convertFileLabel(file('^XA^PW406^LL254^FT10,50^A0N,40,40^FDX^FS^FT63,220^BUN,,Y,N,Y^FD036000291459^FS^XZ', '2x1.25'), { generateBarcode: gen });
  assert.equal(wrongCheck.draft.fields.barcode, '036000291452');
  assert.deepEqual(wrongCheck.warnings, []);
  const tooShort = await convertFileLabel(file('^XA^PW406^LL254^FT10,50^A0N,40,40^FDX^FS^FT63,220^BUN,,Y,N,Y^FD12345^FS^XZ', '2x1.25'), { generateBarcode: gen });
  assert.equal(tooShort.draft.fields.barcode, '036000291452');
  assert.match(tooShort.warnings.join(' '), /barcode/i);
});

test('the original file name is kept in the description for searching, not printed', async () => {
  const zpl = '^XA^PW406^LL254^FT43,50^A0N,48,48^FD$69^FS^XZ';
  const { draft } = await convertFileLabel(file(zpl, '2x1.25', 'bacon'), { generateBarcode: gen });
  assert.equal(draft.fields.name, '$69');
  assert.equal(draft.fields.description, 'bacon');
  assert.equal(draft.options.showDescription, false);
});

test('boxes are clamped inside the label canvas so the editor never flags them', async () => {
  // Barcode baseline at y=225 with 112-dot bars: 225-112=113 top, +142 box = 255 > 253 canvas.
  const zpl = '^XA^PW406^LL254^FT380,50^A0N,48,48^FDWIDE TEXT^FS^BY3,2,112^FT63,225^BUN,,Y,N,Y^FD209990069008^FS^XZ';
  const { draft } = await convertFileLabel(file(zpl, '2x1.25'), { generateBarcode: gen });
  const inside = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 406 && b.y + b.h <= 253;
  assert.ok(inside(draft.layout.barcode), JSON.stringify(draft.layout.barcode));
  assert.ok(inside(draft.layout.name), JSON.stringify(draft.layout.name));
  assert.equal(draft.layout.barcode.h, 142);
  assert.equal(draft.layout.barcode.y, 111);
});

test('an undeclared size is inferred from how far the fields reach', async () => {
  // Fields down to y=374 cannot fit 2x1.25 (253 tall) → 3x2.
  const tall = '^XA^FT20,60^A0N,40,40^FDTide^FS^BY3,2,102^FT170,374^BUN,,Y,N,Y^FD012345678905^FS^XZ';
  const a = await convertFileLabel(file(tall, null), { generateBarcode: gen });
  assert.equal(a.draft.size, '3x2');
  assert.match(a.warnings.join(' '), /size/i);
  // Fields within 406x253 → 2x1.25.
  const small = '^XA^FT20,60^A0N,40,40^FDChicken^FS^BY3,2,63^FT89,223^BUN,,Y,N,Y^FD012345678905^FS^XZ';
  const b = await convertFileLabel(file(small, null), { generateBarcode: gen });
  assert.equal(b.draft.size, '2x1.25');
});

test('barcode boxes follow the file\'s module width and bar height', async () => {
  // ^BY2 → 2 dots/module → 190 wide; height 60 from ^BY.
  const narrow = '^XA^PW406^LL254^BY2,3,60^FT60,200^BUN,,Y,N,Y^FD012345678905^FS^XZ';
  const a = await convertFileLabel(file(narrow, '2x1.25'), { generateBarcode: gen });
  assert.deepEqual(a.draft.layout.barcode, { x: 60, y: 140, w: 190, h: 90, rotation: 0 });
  // ^BY4 → 380 wide; the ^BU height parameter (80) overrides ^BY's.
  const wide = '^XA^PW575^LL406^BY4,2,120^FT10,300^BUN,80,Y,N,Y^FD012345678905^FS^XZ';
  const b = await convertFileLabel(file(wide, '3x2'), { generateBarcode: gen });
  assert.deepEqual(b.draft.layout.barcode, { x: 10, y: 220, w: 380, h: 110, rotation: 0 });
});

test('size falls back from ^PW and warns when nothing is declared; extras are capped at 20', async () => {
  const lines = Array.from({ length: 23 }, (_, i) => `^FT10,${30 + i * 9}^A0N,8,8^FDline ${i}^FS`).join('');
  const { draft, warnings } = await convertFileLabel(file(`^XA${lines}^XZ`, null), { generateBarcode: gen });
  assert.equal(draft.size, '2x1.25');
  assert.equal(draft.extras.length, 20);
  assert.match(warnings.join(' '), /size/i);
  assert.match(warnings.join(' '), /20/);
});
