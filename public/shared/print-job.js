// Everything between "a label" and "the bytes the printer receives": draw at
// dot resolution, pack to 1bpp, rotate the landscape 5x3 onto the 3-inch
// head, wrap in ZPL. The server and the tablet both call this.
import { SIZES } from './sizes.js';
import { drawLabel } from './render-core.js';
import { bitmapFromContext, rotateBitmap90CW } from './bitmap.js';
import { printRotation } from './layout.js';
import { buildLabelZpl } from './zpl.js';

export async function labelJobZpl(canvas, label, { quantity = 1, darkness = null, loadImage } = {}) {
  const dims = SIZES[label.size];
  if (!dims) throw new Error('unknown size');
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext('2d');
  // Everything, barcode included, is drawn into one bitmap so the print is
  // exactly what the preview showed.
  await drawLabel(ctx, label, { includeBarcode: true, loadImage });
  let bitmap = bitmapFromContext(ctx, dims.width, dims.height);
  if (printRotation(label.size) === 90) bitmap = rotateBitmap90CW(bitmap);
  return buildLabelZpl({ width: bitmap.width, height: bitmap.height, bitmap, quantity, darkness });
}
