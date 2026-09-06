import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZES, defaultLayout, defaultShowDescription, barcodeGeometry, printRotation } from '../src/layout.js';

test('SIZES match the 203dpi dot dimensions (3x5 designs as landscape 5x3)', () => {
  assert.deepEqual(SIZES['3x5'], { width: 1015, height: 576 });
  assert.deepEqual(SIZES['3x2'], { width: 576, height: 406 });
  assert.deepEqual(SIZES['2x1.25'], { width: 406, height: 253 });
});

test('printRotation is 90 for the landscape 5x3 and 0 elsewhere', () => {
  assert.equal(printRotation('3x5'), 90);
  assert.equal(printRotation('3x2'), 0);
  assert.equal(printRotation('2x1.25'), 0);
});

test('defaultLayout returns boxes inside the label for every size', () => {
  for (const size of Object.keys(SIZES)) {
    const { width, height } = SIZES[size];
    const layout = defaultLayout(size);
    for (const key of ['name', 'description', 'barcode']) {
      const b = layout[key];
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= width && b.y + b.h <= height,
        `${size}.${key} box out of bounds`);
    }
  }
});

test('defaultLayout returns a fresh object each call', () => {
  const a = defaultLayout('3x5');
  a.name.x = 999;
  assert.notEqual(defaultLayout('3x5').name.x, 999);
});

test('defaultShowDescription is on only for 3x5', () => {
  assert.equal(defaultShowDescription('3x5'), true);
  assert.equal(defaultShowDescription('3x2'), false);
  assert.equal(defaultShowDescription('2x1.25'), false);
});

test('barcodeGeometry centers a whole-module barcode in the box', () => {
  const g = barcodeGeometry({ x: 98, y: 760, w: 380, h: 220 });
  assert.equal(g.moduleWidth, 4);            // floor(380/95)
  assert.equal(g.width, 380);                // 4*95
  assert.equal(g.x, 98);
  assert.equal(g.y, 760);
  assert.equal(g.barHeight, 190);            // 220-30
  const small = barcodeGeometry({ x: 0, y: 0, w: 100, h: 40 });
  assert.equal(small.moduleWidth, 2);        // clamped minimum
  assert.equal(small.barHeight, 20);         // clamped minimum
});
