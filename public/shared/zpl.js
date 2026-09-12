
export function encodeGfa(bitmap) {
  const total = bitmap.data.length;
  let hex = '';
  for (const byte of bitmap.data) hex += byte.toString(16).padStart(2, '0');
  return `^GFA,${total},${total},${bitmap.bytesPerRow},${hex.toUpperCase()}`;
}

export function buildLabelZpl({ width, height, bitmap, quantity = 1, darkness = null }) {
  const parts = [];
  if (darkness !== null && darkness !== undefined && darkness !== '') {
    parts.push(`~SD${String(darkness).padStart(2, '0')}\n`);
  }
  parts.push('^XA\n');
  parts.push(`^PW${width}\n^LL${height}\n^LH0,0\n`);
  parts.push(`^FO0,0${encodeGfa(bitmap)}^FS\n`);
  parts.push(`^PQ${quantity}\n^XZ\n`);
  return parts.join('');
}

export function buildTestZpl() {
  return '^XA\n^PW576\n^LL200\n^FO40,40^A0N,50,50^FDZebra Connect^FS\n^FO40,110^A0N,30,30^FDTest print OK^FS\n^XZ\n';
}

export function setZplModeCommand() {
  return '! U1 setvar "device.languages" "hybrid_xml_zpl"\r\n';
}

const MEDIA_TRACKING = { gap: 'Y', mark: 'M', continuous: 'N' };

export function buildCalibrationZpl(mediaType) {
  const tracking = MEDIA_TRACKING[mediaType];
  if (!tracking) throw new Error('unknown media type — use gap, mark, or continuous');
  const setMode = `^XA^MN${tracking}^JUS^XZ\n`;
  return mediaType === 'continuous' ? setMode : setMode + '~JC\n';
}
