import crypto from 'node:crypto';

const L_CODES = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];

export function upcCheckDigit(d11) {
  if (!/^\d{11}$/.test(d11)) throw new Error('need 11 digits');
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const n = d11.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? n * 3 : n; // positions 1,3,5,... (1-indexed odd) weigh 3
  }
  return String((10 - (sum % 10)) % 10);
}

export function validateUpcA(code) {
  return /^\d{12}$/.test(code) && upcCheckDigit(code.slice(0, 11)) === code[11];
}

export function generateUpcA(isTaken) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let d11 = '';
    for (let i = 0; i < 11; i++) d11 += crypto.randomInt(10);
    const code = d11 + upcCheckDigit(d11);
    if (!isTaken(code)) return code;
  }
  throw new Error('could not generate a unique barcode');
}

export function encodeUpcAModules(code12) {
  if (!validateUpcA(code12)) throw new Error('invalid UPC-A code');
  const rCode = (d) => L_CODES[d].replace(/[01]/g, (c) => (c === '0' ? '1' : '0'));
  let out = '101';
  for (let i = 0; i < 6; i++) out += L_CODES[code12.charCodeAt(i) - 48];
  out += '01010';
  for (let i = 6; i < 12; i++) out += rCode(code12.charCodeAt(i) - 48);
  return out + '101';
}
