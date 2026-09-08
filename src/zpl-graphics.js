// Embedded graphics in ZebraDesigner exports: ^GFA blocks in the :Z64:
// (zlib + base64) encoding, placed by a ^FO/^FT just before them. Decoded
// to PNG data URLs so they can live inside a label as image extras.
import zlib from 'node:zlib';
import { createCanvas } from '@napi-rs/canvas';

const GFA = /\^F([TO])(\d+),(\d+)\^GFA,(\d+),(\d+),(\d+),:Z64:([A-Za-z0-9+/=]+):[0-9A-Fa-f]{4}/g;

export function parseGraphics(zpl) {
  const out = [];
  for (const m of zpl.matchAll(GFA)) {
    const total = Number(m[5]);
    const bytesPerRow = Number(m[6]);
    if (!total || !bytesPerRow) continue;
    let bits;
    try { bits = zlib.inflateSync(Buffer.from(m[7], 'base64')); } catch { continue; }
    if (bits.length < total) continue;
    out.push({
      origin: `F${m[1]}`, x: Number(m[2]), y: Number(m[3]),
      width: bytesPerRow * 8, height: Math.floor(total / bytesPerRow),
      bytesPerRow, bits: bits.subarray(0, total),
    });
  }
  return out;
}

// Black pixels become opaque black, everything else transparent, so a
// graphic can sit over other fields without a white block around it.
export async function graphicToPng(g, { rotate90cw = false } = {}) {
  const { width, height, bytesPerRow, bits } = g;
  const outW = rotate90cw ? height : width;
  const outH = rotate90cw ? width : height;
  const canvas = createCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(outW, outH);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!((bits[y * bytesPerRow + (x >> 3)] >> (7 - (x & 7))) & 1)) continue;
      const ox = rotate90cw ? height - 1 - y : x;
      const oy = rotate90cw ? x : y;
      const i = (oy * outW + ox) * 4;
      img.data[i] = 0; img.data[i + 1] = 0; img.data[i + 2] = 0; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { image: `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`, width: outW, height: outH };
}
