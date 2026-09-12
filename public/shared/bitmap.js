// 1-bit-per-pixel packing of a drawn label, as the printer wants it. Works on
// any canvas 2D context (browser or @napi-rs/canvas). No Node imports.

// Luminance under 128 is a black dot; bit 7 of each byte is the leftmost pixel.
export function bitmapFromContext(ctx, width, height) {
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const bytesPerRow = Math.ceil(width / 8);
  const data = new Uint8Array(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = (y * width + x) * 4;
      const lum = 0.299 * rgba[px] + 0.587 * rgba[px + 1] + 0.114 * rgba[px + 2];
      if (lum < 128) {
        data[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { data, bytesPerRow, width, height };
}

// Rotates a 1bpp bitmap 90° clockwise: design pixel (x, y) lands at
// printed (height - 1 - y, x).
export function rotateBitmap90CW(bitmap) {
  const { width, height, bytesPerRow, data } = bitmap;
  const outWidth = height;
  const outHeight = width;
  const outBytesPerRow = Math.ceil(outWidth / 8);
  const out = new Uint8Array(outBytesPerRow * outHeight);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * bytesPerRow + (x >> 3)] & (0x80 >> (x & 7))) {
        const ox = height - 1 - y;
        const oy = x;
        out[oy * outBytesPerRow + (ox >> 3)] |= 0x80 >> (ox & 7);
      }
    }
  }
  return { data: out, bytesPerRow: outBytesPerRow, width: outWidth, height: outHeight };
}
