import test from 'node:test';
import assert from 'node:assert/strict';
import { generateUpcA } from '../public/shared/upc.js';
import { validateUpcA } from '../public/shared/barcode.js';
import * as srcBarcode from '../src/barcode.js';

test('generateUpcA returns a valid 12-digit code that is not taken', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const code = generateUpcA((c) => seen.has(c));
    assert.match(code, /^\d{12}$/);
    assert.ok(validateUpcA(code));
    seen.add(code);
  }
  assert.equal(seen.size, 50);
});

test('generateUpcA gives up when everything is taken; src re-exports it', () => {
  assert.throws(() => generateUpcA(() => true), /could not generate/);
  assert.equal(srcBarcode.generateUpcA, generateUpcA);
});
