import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { parseGraphics, graphicToPng } from '../src/zpl-graphics.js';

// A 16x4 bitmap: top row all black, then a diagonal.
const ROWS = [[0xff, 0xff], [0x80, 0x00], [0x40, 0x00], [0x20, 0x00]];
function z64Block() {
  const raw = Buffer.from(ROWS.flat());
  const b64 = zlib.deflateSync(raw).toString('base64');
  return `^GFA,${raw.length},${raw.length},2,:Z64:${b64}:0000`;
}

test('parseGraphics finds ^FO/^FT placed Z64 graphics with their pixel size', () => {
  const zpl = `^XA^FO20,120${z64Block()}^FS^FT10,50^A0N,20,20^FDtext^FS^XZ`;
  const [g] = parseGraphics(zpl);
  assert.equal(g.origin, 'FO');
  assert.equal(g.x, 20);
  assert.equal(g.y, 120);
  assert.equal(g.width, 16);
  assert.equal(g.height, 4);
  assert.equal(g.bytesPerRow, 2);
  assert.deepEqual([...g.bits.subarray(0, 2)], [0xff, 0xff]);
  assert.equal(parseGraphics('^XA^FDx^FS^XZ').length, 0);
});

test('graphicToPng yields a PNG data URL of the right size, rotated on request', async () => {
  const [g] = parseGraphics(`^XA^FO0,0${z64Block()}^FS^XZ`);
  const plain = await graphicToPng(g);
  assert.match(plain.image, /^data:image\/png;base64,/);
  assert.deepEqual([plain.width, plain.height], [16, 4]);
  const rotated = await graphicToPng(g, { rotate90cw: true });
  assert.deepEqual([rotated.width, rotated.height], [4, 16]);
});
