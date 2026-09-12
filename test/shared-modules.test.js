import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZES, MARGIN } from '../public/shared/sizes.js';
import { barcodeGeometry, encodeUpcAModules, validateUpcA } from '../public/shared/barcode.js';
import * as srcBarcode from '../src/barcode.js';
import * as srcLayout from '../src/layout.js';
import * as sharedLayout from '../public/shared/layout.js';
import * as sharedZpl from '../public/shared/zpl.js';
import { withQuantity } from '../public/shared/printer-file.js';
import * as srcZpl from '../src/zpl.js';
import * as srcPrinterFile from '../src/printer-file.js';

test('src layout, zpl and printer-file re-export the shared implementations', () => {
  assert.equal(srcLayout.printRotation, sharedLayout.printRotation);
  assert.equal(srcLayout.defaultLayout, sharedLayout.defaultLayout);
  assert.equal(srcZpl.buildLabelZpl, sharedZpl.buildLabelZpl);
  assert.equal(srcZpl.buildCalibrationZpl, sharedZpl.buildCalibrationZpl);
  assert.equal(srcPrinterFile.withQuantity, withQuantity);
  assert.equal(withQuantity('^XA^XZ', 3), '^XA^PQ3^XZ');
});

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
