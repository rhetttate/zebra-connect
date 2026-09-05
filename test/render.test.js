import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPreview, renderPrintBitmap } from '../src/render.js';
import { defaultLayout } from '../src/layout.js';

const label = {
  size: '3x2',
  fields: { name: 'Sugar', description: 'Granulated', barcode: '036000291452' },
  options: { showDescription: false },
  layout: defaultLayout('3x2'),
};

test('renderPreview returns a PNG with correct dimensions', async () => {
  const buf = await renderPreview(label);
  // PNG magic bytes
  assert.deepEqual([...buf.slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR width/height are big-endian uint32 at offsets 16 and 20
  assert.equal(buf.readUInt32BE(16), 576);
  assert.equal(buf.readUInt32BE(20), 406);
});

test('renderPrintBitmap returns packed 1bpp rows with black pixels for text', async () => {
  const bmp = await renderPrintBitmap(label);
  assert.equal(bmp.width, 576);
  assert.equal(bmp.height, 406);
  assert.equal(bmp.bytesPerRow, 72); // 576/8
  assert.equal(bmp.data.length, 72 * 406);
  const blackBits = [...bmp.data].reduce((n, byte) => {
    while (byte) { n += byte & 1; byte >>= 1; }
    return n;
  }, 0);
  assert.ok(blackBits > 100, 'expected the name text to produce black pixels');
});

test('renderPrintBitmap omits the barcode region', async () => {
  const bmp = await renderPrintBitmap(label);
  // Barcode box for 3x2 default layout starts at y=225; name box ends by y=130.
  // With description hidden, everything below y=250 must be white.
  for (let y = 250; y < bmp.height; y++) {
    for (let b = 0; b < bmp.bytesPerRow; b++) {
      assert.equal(bmp.data[y * bmp.bytesPerRow + b], 0,
        `unexpected black pixel at row ${y}`);
    }
  }
});

test('renderPreview draws barcode bars (preview differs from text-only render)', async () => {
  const withBars = await renderPreview(label);
  const noBarcode = await renderPreview({
    ...label,
    fields: { ...label.fields, barcode: '' },
  });
  assert.notDeepEqual(withBars, noBarcode);
});
