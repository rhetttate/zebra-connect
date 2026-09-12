// Quantity handling for finished printer files (.prn). The file is a complete
// ZPL job; only ^PQ is touched. Shared by the server and the tablet.
export function withQuantity(zpl, quantity) {
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 100);
  if (qty === 1) return zpl;
  if (/\^PQ\d+/.test(zpl)) return zpl.replace(/\^PQ\d+/, `^PQ${qty}`);
  const end = zpl.lastIndexOf('^XZ');
  return end === -1 ? `${zpl}^PQ${qty}` : `${zpl.slice(0, end)}^PQ${qty}${zpl.slice(end)}`;
}
