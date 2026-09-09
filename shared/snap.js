// Snapping and alignment in label dots. Pure functions shared with the phone.
import { SIZES, MARGIN } from './sizes.js';

export const SNAP_THRESHOLD = 12;

export function frameFor(size) {
  const { width, height } = SIZES[size];
  const m = MARGIN[size];
  return { x: m, y: m, w: width - 2 * m, h: height - 2 * m };
}

// Lines worth snapping to: the margin frame, the label centre, and the edges
// and centres of every other box.
export function snapTargets(size, otherBoxes) {
  const { width, height } = SIZES[size];
  const f = frameFor(size);
  const xs = [f.x, width / 2, f.x + f.w];
  const ys = [f.y, height / 2, f.y + f.h];
  for (const b of otherBoxes) {
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

function nearest(candidates, targets, threshold) {
  let best = null;
  for (const c of candidates) {
    for (const t of targets) {
      const d = t - c;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, t };
    }
  }
  return best;
}

// Moving considers left/centre/right and top/middle/bottom and shifts the
// box; resizing considers only the far edges and changes w/h.
export function snapBox(box, { mode, targets, threshold = SNAP_THRESHOLD }) {
  const out = { ...box };
  const guides = [];
  const xc = mode === 'move' ? [box.x, box.x + box.w / 2, box.x + box.w] : [box.x + box.w];
  const yc = mode === 'move' ? [box.y, box.y + box.h / 2, box.y + box.h] : [box.y + box.h];
  const sx = nearest(xc, targets.xs, threshold);
  const sy = nearest(yc, targets.ys, threshold);
  if (sx) {
    if (mode === 'move') out.x = Math.round(box.x + sx.d);
    else out.w = Math.round(box.w + sx.d);
    guides.push({ x: sx.t });
  }
  if (sy) {
    if (mode === 'move') out.y = Math.round(box.y + sy.d);
    else out.h = Math.round(box.h + sy.d);
    guides.push({ y: sy.t });
  }
  return { box: out, guides };
}

export function alignBox(box, how, frame) {
  const out = { ...box };
  switch (how) {
    case 'left': out.x = frame.x; break;
    case 'center': out.x = Math.round(frame.x + (frame.w - box.w) / 2); break;
    case 'right': out.x = frame.x + frame.w - box.w; break;
    case 'top': out.y = frame.y; break;
    case 'middle': out.y = Math.round(frame.y + (frame.h - box.h) / 2); break;
    case 'bottom': out.y = frame.y + frame.h - box.h; break;
    default: throw new Error(`unknown alignment: ${how}`);
  }
  return out;
}
