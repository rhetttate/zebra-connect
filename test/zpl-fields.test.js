import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFields, applyFields, labelInches } from '../src/zpl-fields.js';

const SAMPLE = [
  'CT~~CD,~CC^~CT~', '^XA', '~TA000', '~JSN', '^XZ',
  '^XA', '^MMT', '^PW406', '^LL254', '^LS0',
  '^FT43,50^A0N,48,48^FH\\^CI28^FDBACON        $69^FS^CI27',
  '^FO20,120^GFA,8,8,1,::::::::^FS',
  '^BY3,2,144^FT63,220^BUN,,Y,N,Y', '^FH\\^FD209990069008^FS',
  '^FT300,200^A0R,30,30^FH\\^FDSIDEWAYS^FS',
  '^PQ1,0,1,Y', '^XZ',
].join('\r\n');

test('parseFields finds positioned text and barcode fields and skips graphics', () => {
  const fields = parseFields(SAMPLE);
  assert.deepEqual(fields.map((f) => [f.id, f.kind, f.text]), [
    [0, 'text', 'BACON        $69'],
    [1, 'barcode', '209990069008'],
    [2, 'text', 'SIDEWAYS'],
  ]);
  assert.deepEqual(fields[0], { id: 0, kind: 'text', text: 'BACON        $69', x: 43, y: 50, origin: 'FT', font: { h: 48, w: 48 }, rotated: false, orient: 'N', block: null });
  assert.equal(fields[1].font, null);
  assert.equal(fields[2].rotated, true);
});

test('applyFields with unchanged fields returns the identical ZPL', () => {
  assert.equal(applyFields(SAMPLE, parseFields(SAMPLE)), SAMPLE);
});

test('applyFields changes only the edited field text, position and font', () => {
  const fields = parseFields(SAMPLE);
  const out = applyFields(SAMPLE, [{ ...fields[0], text: 'BACON $79', x: 50, y: 60, font: { h: 52, w: 52 } }]);
  assert.ok(out.includes('^FT50,60^A0N,52,52^FH\\^CI28^FDBACON $79^FS^CI27'));
  assert.ok(out.includes('^FD209990069008^FS'));
  assert.ok(out.includes('^FT300,200^A0R,30,30^FH\\^FDSIDEWAYS^FS'));
  assert.equal(out.split('\r\n').length, SAMPLE.split('\r\n').length);
});

test('applyFields rejects text containing ZPL control characters', () => {
  const fields = parseFields(SAMPLE);
  assert.throws(() => applyFields(SAMPLE, [{ ...fields[0], text: 'bad^XZ' }]), /\^ or ~/);
  assert.throws(() => applyFields(SAMPLE, [{ ...fields[1], text: '12~34' }]), /\^ or ~/);
});

test('applyFields ignores unknown ids and keeps numbers sane', () => {
  const fields = parseFields(SAMPLE);
  const out = applyFields(SAMPLE, [{ ...fields[1], id: 99 }, { ...fields[0], x: -5.7, y: 12.4 }]);
  assert.ok(out.includes('^FT0,12^A0N,48,48'));
});

test('labelInches reads ^PW/^LL at 203 dpi', () => {
  assert.deepEqual(labelInches(SAMPLE), { w: 2, h: 1.25 });
  assert.equal(labelInches('^XA^FDx^FS^XZ'), null);
});

test('parseFields reports font orientation and ^FB blocks', () => {
  const zpl = '^XA^FT76,1015^A0B,72,43^FB1014,1,18,C^FH\\^FDFULLY COOKED\\5C&^FS^FT10,10^A0N,20,20^FDplain^FS^XZ';
  const [a, b] = parseFields(zpl);
  assert.equal(a.orient, 'B');
  assert.deepEqual(a.block, { w: 1014, align: 'C' });
  assert.equal(b.orient, 'N');
  assert.equal(b.block, null);
});

test('the browser copy of zpl-fields is identical to the server module', () => {
  const a = fs.readFileSync(new URL('../src/zpl-fields.js', import.meta.url), 'utf8');
  const b = fs.readFileSync(new URL('../public/zpl-fields.js', import.meta.url), 'utf8');
  assert.equal(a, b);
});
