import test from 'node:test';
import assert from 'node:assert/strict';
import { upcCheckDigit, validateUpcA, generateUpcA, encodeUpcAModules } from '../src/barcode.js';

test('upcCheckDigit computes the standard UPC-A check digit', () => {
  // Known example: 03600029145 -> check digit 2
  assert.equal(upcCheckDigit('03600029145'), '2');
  // Known example: 01234567890 -> check digit 5
  assert.equal(upcCheckDigit('01234567890'), '5');
});

test('validateUpcA accepts valid codes and rejects bad ones', () => {
  assert.equal(validateUpcA('036000291452'), true);
  assert.equal(validateUpcA('036000291453'), false); // wrong check digit
  assert.equal(validateUpcA('03600029145'), false);  // 11 digits
  assert.equal(validateUpcA('03600029145a'), false); // non-digit
});

test('generateUpcA returns a valid 12-digit code', () => {
  const code = generateUpcA(() => false);
  assert.match(code, /^\d{12}$/);
  assert.equal(validateUpcA(code), true);
});

test('generateUpcA retries until the code is not taken', () => {
  const seen = [];
  let rejects = 3;
  const code = generateUpcA((c) => {
    seen.push(c);
    return rejects-- > 0;
  });
  assert.equal(seen.length, 4);
  assert.equal(code, seen[3]);
});

test('encodeUpcAModules produces the 95-module pattern', () => {
  const m = encodeUpcAModules('036000291452');
  assert.equal(m.length, 95);
  assert.match(m, /^[01]{95}$/);
  assert.equal(m.slice(0, 3), '101');            // start guard
  assert.equal(m.slice(45, 50), '01010');        // center guard
  assert.equal(m.slice(92), '101');              // end guard
  // First digit 0 -> L-code 0001101
  assert.equal(m.slice(3, 10), '0001101');
  // Last digit (check digit 2) -> R-code = complement of L-code 0010011 = 1101100
  assert.equal(m.slice(85, 92), '1101100');
});
