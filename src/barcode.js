import crypto from 'node:crypto';
import { upcCheckDigit } from '../shared/barcode.js';

export { upcCheckDigit, validateUpcA, encodeUpcAModules, barcodeGeometry } from '../shared/barcode.js';

export function generateUpcA(isTaken) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let d11 = '';
    for (let i = 0; i < 11; i++) d11 += crypto.randomInt(10);
    const code = d11 + upcCheckDigit(d11);
    if (!isTaken(code)) return code;
  }
  throw new Error('could not generate a unique barcode');
}
