import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPreview, renderPrintBitmap, rotateBitmap90CW } from '../src/render.js';
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

test('renderPreview renders the 3x5 as a landscape 1015x576 canvas', async () => {
  const buf = await renderPreview({
    size: '3x5',
    fields: { name: 'Flour', description: 'AP', barcode: '036000291452' },
    options: { showDescription: true },
    layout: defaultLayout('3x5'),
  });
  assert.equal(buf.readUInt32BE(16), 1015);
  assert.equal(buf.readUInt32BE(20), 576);
});

test('rotateBitmap90CW maps design pixels to printed positions', () => {
  // 8x2 input: pixel (0,0) and pixel (7,1) set.
  const input = { width: 8, height: 2, bytesPerRow: 1, data: new Uint8Array([0x80, 0x01]) };
  const out = rotateBitmap90CW(input);
  assert.equal(out.width, 2);
  assert.equal(out.height, 8);
  assert.equal(out.bytesPerRow, 1);
  // (x,y) -> (H-1-y, x): (0,0) -> (1,0); (7,1) -> (0,7)
  const expected = new Uint8Array(8);
  expected[0] = 0x40; // bit at x=1 in row 0
  expected[7] = 0x80; // bit at x=0 in row 7
  assert.deepEqual(out.data, expected);
});

test('a rotated name renders differently than an unrotated one', async () => {
  const base = {
    size: '3x2',
    fields: { name: 'Rotated', description: '', barcode: '' },
    options: { showDescription: false },
  };
  const flat = await renderPrintBitmap({ ...base, layout: defaultLayout('3x2') });
  const layout = defaultLayout('3x2');
  layout.name.rotation = 90;
  const rotated = await renderPrintBitmap({ ...base, layout });
  assert.notDeepEqual(flat.data, rotated.data);
});

test('extra fields render as black pixels inside their box', async () => {
  const bmp = await renderPrintBitmap({
    size: '3x2',
    fields: { name: '', description: '', barcode: '' },
    options: { showDescription: false },
    layout: defaultLayout('3x2'),
    extras: [{ id: 'e1', text: 'LOT 42', box: { x: 40, y: 300, w: 300, h: 60 }, rotation: 0 }],
  });
  let blackInBox = 0;
  for (let y = 300; y < 360; y++) {
    for (let x = 40; x < 340; x++) {
      if (bmp.data[y * bmp.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) blackInBox++;
    }
  }
  assert.ok(blackInBox > 50, 'expected extra field text pixels');
});

test('renderPrintBitmap can include the barcode when asked', async () => {
  const without = await renderPrintBitmap(label);
  const withBc = await renderPrintBitmap(label, { includeBarcode: true });
  const count = (b) => [...b.data].reduce((n, byte) => {
    while (byte) { n += byte & 1; byte >>= 1; }
    return n;
  }, 0);
  assert.ok(count(withBc) > count(without) + 500, 'barcode bars should add many black pixels');
});

function blackIn(bmp, x0, x1, y0, y1) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (bmp.data[y * bmp.bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) return true;
    }
  }
  return false;
}

test('wrapped extras honour align L (left, top anchored) and default to centred', async () => {
  const base = {
    size: '3x2',
    fields: { name: '', description: '', barcode: '' },
    options: { showDescription: false },
    layout: defaultLayout('3x2'),
  };
  const extra = { id: 'e1', text: 'Hi', box: { x: 20, y: 150, w: 500, h: 60 }, rotation: 0 };

  const left = await renderPrintBitmap({ ...base, extras: [{ ...extra, align: 'L' }] });
  assert.ok(blackIn(left, 20, 80, 150, 210), 'left-aligned text starts at the left edge');
  assert.ok(!blackIn(left, 300, 520, 150, 210), 'nothing in the right half');

  const centred = await renderPrintBitmap({ ...base, extras: [extra] });
  assert.ok(!blackIn(centred, 20, 80, 150, 210), 'centred text leaves the left edge blank');
  assert.ok(blackIn(centred, 200, 340, 150, 210), 'centred text sits in the middle');
});
