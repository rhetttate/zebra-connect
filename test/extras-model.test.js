import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { createApp } from '../src/app.js';
import { renderPreview } from '../src/render.js';

function startApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-ex-'));
  const app = createApp({ dataDir });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function blackSquarePng(size = 20) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  return `data:image/png;base64,${c.toBuffer('image/png').toString('base64')}`;
}

const base2x = () => ({
  size: '2x1.25',
  fields: { name: '', description: '', barcode: '036000291452' },
  options: { showDescription: false },
  layout: {
    name: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
    description: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
    barcode: { x: 0, y: 200, w: 10, h: 10, rotation: 0 },
  },
});

test('labels keep fit/bold/align and image extras through the API, and reject bad images', async () => {
  const { base, close } = await startApp();
  try {
    const draft = {
      ...base2x(),
      extras: [
        { text: 'BIG', box: { x: 10, y: 10, w: 200, h: 60 }, rotation: 0, fit: true, bold: true, align: 'C' },
        { kind: 'image', image: blackSquarePng(), box: { x: 250, y: 10, w: 40, h: 40 }, rotation: 90 },
      ],
    };
    const created = await (await fetch(`${base}/api/labels`, json('POST', draft))).json();
    assert.equal(created.extras[0].fit, true);
    assert.equal(created.extras[0].bold, true);
    assert.equal(created.extras[0].align, 'C');
    assert.equal(created.extras[0].stretch, undefined);
    const stretched = await (await fetch(`${base}/api/labels`, json('POST', {
      ...base2x(),
      fields: { name: '', description: '', barcode: '' }, // a second label may not reuse the first one's barcode
      extras: [{ text: 'X', box: { x: 0, y: 0, w: 50, h: 20 }, fit: true, stretch: 0.6 }],
    }))).json();
    assert.equal(stretched.extras[0].stretch, 0.6);
    assert.equal(created.extras[1].kind, 'image');
    assert.match(created.extras[1].image, /^data:image\/png;base64,/);
    assert.equal(created.extras[1].text, '');

    const bad = await fetch(`${base}/api/labels`, json('POST', { ...base2x(), extras: [{ kind: 'image', image: 'javascript:alert(1)', box: { x: 0, y: 0, w: 5, h: 5 } }] }));
    assert.equal(bad.status, 400);
  } finally { close(); }
});

// Count dark pixels inside a region of a rendered PNG by re-reading it on a canvas.
async function darkPixels(png, region) {
  const { loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(region.x, region.y, region.w, region.h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++;
  return n;
}

// Right-most inked column inside a region, or -1.
async function inkRight(png, region) {
  const { loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(region.x, region.y, region.w, region.h).data;
  let right = -1;
  for (let y = 0; y < region.h; y++) for (let x = 0; x < region.w; x++) if (d[(y * region.w + x) * 4] < 128) right = Math.max(right, x);
  return right;
}

// Bounding box of ink inside a region, or null.
async function inkBounds(png, region) {
  const { loadImage } = await import('@napi-rs/canvas');
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(region.x, region.y, region.w, region.h).data;
  let minX = Infinity; let maxX = -1; let minY = Infinity; let maxY = -1;
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) {
      if (d[(y * region.w + x) * 4] < 128) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }
  }
  return maxX < 0 ? null : { minX, maxX, minY, maxY };
}

test('plain extras and the description fill their box height and sit centred', async () => {
  const label = {
    ...base2x(),
    fields: { name: '', description: 'Hi', barcode: '' },
    options: { showDescription: true },
    layout: { ...base2x().layout, description: { x: 0, y: 130, w: 400, h: 100, rotation: 0 } },
    extras: [{ id: 'a', text: 'Hi', box: { x: 0, y: 10, w: 400, h: 100 }, rotation: 0 }],
  };
  const png = await renderPreview(label);
  for (const region of [{ x: 0, y: 10, w: 400, h: 100 }, { x: 0, y: 130, w: 400, h: 100 }]) {
    const b = await inkBounds(png, region);
    assert.ok(b, 'has ink');
    assert.ok(b.maxY - b.minY > 55, `fills height: ink ${b.maxY - b.minY}px tall in a 100px box`);
    const centre = (b.minX + b.maxX) / 2;
    assert.ok(Math.abs(centre - 200) < 20, `centred: ink centre ${centre}`);
  }
});

test('stretch narrows fitted text horizontally without shrinking it', async () => {
  const mk = (stretch) => ({
    ...base2x(),
    fields: { name: '', description: '', barcode: '' },
    extras: [{ id: 'a', text: 'MMMM', box: { x: 0, y: 0, w: 400, h: 60 }, rotation: 0, fit: true, bold: true, align: 'L', stretch }],
  });
  const wide = await inkRight(await renderPreview(mk(1)), { x: 0, y: 0, w: 400, h: 60 });
  const narrow = await inkRight(await renderPreview(mk(0.5)), { x: 0, y: 0, w: 400, h: 60 });
  assert.ok(wide > 150, `wide ${wide}`);
  assert.ok(narrow < wide * 0.6 && narrow > wide * 0.4, `narrow ${narrow} vs wide ${wide}`);
});

test('a fitted extra renders taller than the 40px wrapped cap, and image extras are drawn', async () => {
  const label = {
    ...base2x(),
    fields: { name: '', description: '', barcode: '' },
    extras: [
      { id: 'a', text: 'I', box: { x: 10, y: 10, w: 100, h: 100 }, rotation: 0, fit: true, bold: true, align: 'L' },
      { id: 'b', kind: 'image', text: '', image: blackSquarePng(20), box: { x: 300, y: 100, w: 60, h: 60 }, rotation: 0 },
    ],
  };
  const png = await renderPreview(label);
  // A fitted 100-dot-tall "I" spans well over 40 rows; a wrapped one would not.
  const rowsWithInk = [];
  for (let y = 10; y < 110; y += 5) if (await darkPixels(png, { x: 10, y, w: 100, h: 1 }) > 0) rowsWithInk.push(y);
  assert.ok(rowsWithInk.length >= 12, `ink rows: ${rowsWithInk.length}`);
  assert.ok(await darkPixels(png, { x: 300, y: 100, w: 60, h: 60 }) > 3000);
});
