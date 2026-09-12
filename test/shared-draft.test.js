import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDraft, clampQuantity } from '../public/shared/draft.js';
import { defaultLayout } from '../public/shared/layout.js';

test('normalizeDraft fills defaults for a bare draft', () => {
  const label = normalizeDraft({ size: '3x2', fields: { name: 'Flour' } });
  assert.equal(label.fields.name, 'Flour');
  assert.equal(label.fields.description, '');
  assert.equal(label.fields.barcode, '');
  assert.equal(label.options.showDescription, false);
  assert.deepEqual(label.layout.name, { ...defaultLayout('3x2').name, rotation: 0 });
  assert.deepEqual(label.extras, []);
});

test('normalizeDraft rejects unknown sizes, bad barcodes, bad boxes and bad rotations', () => {
  assert.throws(() => normalizeDraft({ size: '9x9' }), /unknown size/);
  assert.throws(() => normalizeDraft({ size: '3x2', fields: { barcode: '123' } }), /valid 12-digit UPC-A/);
  const bad = { size: '3x2', layout: { ...defaultLayout('3x2'), name: { x: 1, y: 'no', w: 3, h: 4 } } };
  assert.throws(() => normalizeDraft(bad), /invalid layout box for name/);
  const rot = { size: '3x2', layout: { ...defaultLayout('3x2'), name: { x: 1, y: 2, w: 3, h: 4, rotation: 45 } } };
  assert.throws(() => normalizeDraft(rot), /invalid rotation for name/);
  try { normalizeDraft({ size: '9x9' }); } catch (err) { assert.equal(err.status, 400); }
});

test('normalizeDraft keeps extra ids, clips extras to 20, validates images', () => {
  const extras = Array.from({ length: 25 }, (_, i) => ({ id: `e${i}`, text: `t${i}`, box: { x: 0, y: 0, w: 10, h: 10 } }));
  const label = normalizeDraft({ size: '3x5', extras });
  assert.equal(label.extras.length, 20);
  assert.equal(label.extras[0].id, 'e0');
  const noId = normalizeDraft({ size: '3x5', extras: [{ text: 'x', box: { x: 0, y: 0, w: 1, h: 1 } }] });
  assert.match(noId.extras[0].id, /^[0-9a-f-]{36}$/);
  assert.throws(() => normalizeDraft({ size: '3x5', extras: [{ kind: 'image', image: 'nope', box: { x: 0, y: 0, w: 1, h: 1 } }] }), /invalid image field/);
});

test('clampQuantity clamps to 1..100 and defaults to 1', () => {
  assert.equal(clampQuantity('7'), 7);
  assert.equal(clampQuantity(0), 1);
  assert.equal(clampQuantity(500), 100);
  assert.equal(clampQuantity('x'), 1);
  assert.equal(clampQuantity(undefined), 1);
});
