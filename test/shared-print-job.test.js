import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { labelJobZpl } from '../public/shared/print-job.js';
import { bitmapFromContext, rotateBitmap90CW } from '../public/shared/bitmap.js';
import { renderPrintBitmap, rotateBitmap90CW as srcRotate } from '../src/render.js';
import { buildLabelZpl } from '../src/zpl.js';
import { defaultLayout, printRotation } from '../src/layout.js';

const label = (size) => ({
  size,
  fields: { name: 'Sugar', description: 'Granulated', barcode: '036000291452' },
  options: { showDescription: true },
  layout: defaultLayout(size),
  extras: [{ id: 'e1', text: 'Lot 42', box: { x: 30, y: 300, w: 200, h: 60 }, rotation: 0 }],
});

// The server route composes renderPrintBitmap + rotate + buildLabelZpl; the
// tablet calls labelJobZpl. Both must produce the same bytes.
async function serverZpl(l, quantity, darkness) {
  let bitmap = await renderPrintBitmap(l, { includeBarcode: true });
  if (printRotation(l.size) === 90) bitmap = srcRotate(bitmap);
  return buildLabelZpl({ width: bitmap.width, height: bitmap.height, bitmap, quantity, darkness });
}

for (const size of ['3x2', '3x5']) {
  test(`labelJobZpl matches the server print path for ${size}`, async () => {
    const l = label(size);
    const expected = await serverZpl(l, 2, 12);
    const actual = await labelJobZpl(createCanvas(1, 1), l, { quantity: 2, darkness: 12, loadImage });
    assert.equal(actual, expected);
    assert.ok(actual.includes('^PQ2'));
    assert.ok(actual.startsWith('~SD12'));
  });
}

test('rotateBitmap90CW is the same function the server uses and bitmapFromContext packs 1bpp', () => {
  assert.equal(rotateBitmap90CW, srcRotate);
  const canvas = createCanvas(16, 1);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 16, 1);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 8, 1);
  const bmp = bitmapFromContext(ctx, 16, 1);
  assert.deepEqual([...bmp.data], [0xff, 0x00]);
  assert.equal(bmp.bytesPerRow, 2);
});
