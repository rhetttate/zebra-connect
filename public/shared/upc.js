// Random UPC-A codes for new labels. globalThis.crypto exists in Node 19+ and
// every browser, so this runs unchanged on the server and the tablet.
import { upcCheckDigit } from './barcode.js';

function randomDigit() {
  const buf = new Uint8Array(1);
  // Reject values that would bias the digit (250..255).
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < 250) return buf[0] % 10;
  }
}

export function generateUpcA(isTaken) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let d11 = '';
    for (let i = 0; i < 11; i++) d11 += randomDigit();
    const code = d11 + upcCheckDigit(d11);
    if (!isTaken(code)) return code;
  }
  throw new Error('could not generate a unique barcode');
}
