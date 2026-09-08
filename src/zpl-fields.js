// Positioned ^FD fields inside a finished ZPL job (ZebraDesigner exports).
// parseFields reads them; applyFields writes edits back in place so the
// rest of the file stays byte-identical. No Node imports: public/zpl-fields.js
// is a verbatim copy of this file for the browser editor.

const POS = /\^(FT|FO)(\d+),(\d+)/g;
const FONT = /\^A([0-9A-Z@])([NRIB])?,(\d+),(\d+)/;
const BARCODE = /\^B[A-Z0-9]/;
const PAYLOAD = /\^FD([\s\S]*?)\^FS/;

// Each segment runs from a ^FT/^FO to the ^FS that closes its field, with
// the character offsets of the three parts an edit may rewrite.
function segments(zpl) {
  const out = [];
  for (const m of zpl.matchAll(POS)) {
    const end = zpl.indexOf('^FS', m.index);
    if (end === -1) continue;
    const body = zpl.slice(m.index, end + 3);
    const payload = PAYLOAD.exec(body);
    if (!payload || body.includes('^GF')) continue; // graphics and empty fields are not editable
    const font = FONT.exec(body);
    const fontNums = font ? `${font[3]},${font[4]}` : '';
    out.push({
      origin: m[1], x: Number(m[2]), y: Number(m[3]),
      posNumStart: m.index + 3, posNumEnd: m.index + m[0].length,
      font: font ? {
        h: Number(font[3]), w: Number(font[4]), rotated: (font[2] ?? 'N') !== 'N',
        numStart: m.index + font.index + font[0].length - fontNums.length,
        numEnd: m.index + font.index + font[0].length,
      } : null,
      kind: BARCODE.test(body.slice(0, payload.index)) ? 'barcode' : 'text',
      text: payload[1],
      textStart: m.index + payload.index + 3,
      textEnd: m.index + payload.index + 3 + payload[1].length,
    });
  }
  return out;
}

export function parseFields(zpl) {
  return segments(zpl).map((s, id) => ({
    id, kind: s.kind, text: s.text, x: s.x, y: s.y, origin: s.origin,
    font: s.font ? { h: s.font.h, w: s.font.w } : null,
    rotated: Boolean(s.font?.rotated),
  }));
}

const clampDots = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Math.round(Number(n))) : 0);

export function applyFields(zpl, fields) {
  const segs = segments(zpl);
  const edits = [];
  for (const f of fields ?? []) {
    const s = segs[f.id];
    if (!s) continue;
    const text = String(f.text ?? s.text);
    if (/[\^~]/.test(text)) throw Object.assign(new Error('text may not contain ^ or ~'), { status: 400 });
    edits.push({ start: s.textStart, end: s.textEnd, value: text });
    edits.push({ start: s.posNumStart, end: s.posNumEnd, value: `${clampDots(f.x ?? s.x)},${clampDots(f.y ?? s.y)}` });
    if (s.font && f.font) {
      edits.push({
        start: s.font.numStart, end: s.font.numEnd,
        value: `${Math.max(1, clampDots(f.font.h ?? s.font.h))},${Math.max(1, clampDots(f.font.w ?? s.font.w))}`,
      });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let out = zpl;
  for (const e of edits) out = out.slice(0, e.start) + e.value + out.slice(e.end);
  return out;
}

export function labelInches(zpl) {
  const pw = Number(/\^PW(\d+)/.exec(zpl)?.[1]);
  const ll = Number(/\^LL(\d+)/.exec(zpl)?.[1]);
  if (!pw || !ll) return null;
  const inches = (dots) => Math.round((dots / 203) * 100) / 100;
  return { w: inches(pw), h: inches(ll) };
}
