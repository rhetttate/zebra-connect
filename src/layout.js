export const SIZES = {
  '3x5': { width: 576, height: 1015 },
  '3x2': { width: 576, height: 406 },
  '2x1.25': { width: 406, height: 253 },
};

const DEFAULT_LAYOUTS = {
  '3x5': {
    name: { x: 20, y: 20, w: 536, h: 120 },
    description: { x: 20, y: 170, w: 536, h: 540 },
    barcode: { x: 98, y: 760, w: 380, h: 220 },
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

export function defaultLayout(size) {
  return structuredClone(DEFAULT_LAYOUTS[size]);
}

export function defaultShowDescription(size) {
  return size === '3x5';
}

export function barcodeGeometry(box) {
  const moduleWidth = Math.max(2, Math.floor(box.w / 95));
  const width = moduleWidth * 95;
  return {
    moduleWidth,
    width,
    x: box.x + Math.floor((box.w - width) / 2),
    y: box.y,
    barHeight: Math.max(20, box.h - 30),
  };
}
