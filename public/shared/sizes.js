// Label canvas sizes in printer dots at 203 dpi, and the margin the layout
// engine, snapping and alignment all treat as the printable frame.
export const SIZES = {
  '3x5': { width: 1015, height: 576 },
  '3x2': { width: 576, height: 406 },
  '2x1.25': { width: 406, height: 253 },
};

export const MARGIN = { '3x5': 20, '3x2': 20, '2x1.25': 10 };
