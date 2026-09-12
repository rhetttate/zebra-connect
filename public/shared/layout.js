import { SIZES } from './sizes.js';
export { SIZES };
export { barcodeGeometry } from './barcode.js';

// The ZQ620's print head is 576 dots wide, so the landscape 5x3 designer
// canvas is rotated 90° clockwise at print time.
const PRINT_ROTATION = { '3x5': 90, '3x2': 0, '2x1.25': 0 };

const DEFAULT_LAYOUTS = {
  '3x5': {
    name: { x: 30, y: 25, w: 955, h: 100 },
    description: { x: 30, y: 150, w: 590, h: 400 },
    barcode: { x: 650, y: 180, w: 335, h: 220 },
  },
  '3x2': {
    name: { x: 20, y: 20, w: 536, h: 110 },
    description: { x: 20, y: 140, w: 536, h: 80 },
    barcode: { x: 98, y: 225, w: 380, h: 175 },
  },
  '2x1.25': {
    name: { x: 10, y: 8, w: 386, h: 70 },
    description: { x: 10, y: 82, w: 386, h: 40 },
    barcode: { x: 58, y: 126, w: 290, h: 122 },
  },
};

export function printRotation(size) {
  return PRINT_ROTATION[size] ?? 0;
}

export function defaultLayout(size) {
  return structuredClone(DEFAULT_LAYOUTS[size]);
}

export function defaultShowDescription(size) {
  return size === '3x5';
}
