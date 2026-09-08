import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZES, MARGIN } from '../shared/sizes.js';
import { barcodeGeometry, encodeUpcAModules, validateUpcA } from '../shared/barcode.js';
import * as srcBarcode from '../src/barcode.js';
import * as srcLayout from '../src/layout.js';

test('shared sizes match the layout module and carry margins', () => {
  assert.deepEqual(SIZES, srcLayout.SIZES);
  assert.deepEqual(MARGIN, { '3x5': 20, '3x2': 20, '2x1.25': 10 });
});

test('barcodeGeometry reserves room for UPC digits below the bars', () => {
  const g = barcodeGeometry({ x: 98, y: 225, w: 380, h: 175 });
  assert.equal(g.moduleWidth, 4);
  assert.equal(g.width, 380);
  assert.equal(g.digitHeight, 32);
  assert.equal(g.barHeight, 175 - 32 - 6);
  assert.equal(g.x, 98);
  const small = barcodeGeometry({ x: 0, y: 0, w: 335, h: 220 });
  assert.equal(small.moduleWidth, 3);
  assert.equal(small.digitHeight, 24);
  assert.equal(small.barHeight, 220 - 30, 'module width 3 keeps today\'s bar height');
});

test('src modules re-export the shared barcode helpers', () => {
  assert.equal(srcBarcode.validateUpcA, validateUpcA);
  assert.equal(srcBarcode.encodeUpcAModules, encodeUpcAModules);
  assert.equal(srcLayout.barcodeGeometry, barcodeGeometry);
  assert.equal(typeof srcBarcode.generateUpcA, 'function');
});
