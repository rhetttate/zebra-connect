import test from 'node:test';
import assert from 'node:assert/strict';
import { frameFor, snapTargets, snapBox, alignBox, SNAP_THRESHOLD } from '../public/shared/snap.js';

test('frameFor is the label inset by its margin', () => {
  assert.deepEqual(frameFor('3x5'), { x: 20, y: 20, w: 975, h: 536 });
  assert.deepEqual(frameFor('2x1.25'), { x: 10, y: 10, w: 386, h: 233 });
});

test('snapTargets lists margin, centre and every other box edge and centre', () => {
  const t = snapTargets('3x2', [{ x: 100, y: 50, w: 200, h: 40 }]);
  assert.deepEqual(t.xs, [20, 288, 556, 100, 200, 300]);
  assert.deepEqual(t.ys, [20, 203, 386, 50, 70, 90]);
});

test('moving snaps the nearest edge within the threshold and reports the guide', () => {
  const targets = snapTargets('3x5', []);
  const near = snapBox({ x: 27, y: 200, w: 300, h: 60 }, { mode: 'move', targets });
  assert.equal(near.box.x, 20);
  assert.equal(near.box.y, 200);
  assert.deepEqual(near.guides, [{ x: 20 }]);

  const far = snapBox({ x: 40, y: 200, w: 300, h: 60 }, { mode: 'move', targets });
  assert.equal(far.box.x, 40);
  assert.deepEqual(far.guides, []);
});

test('moving snaps the centre to the label centre', () => {
  const targets = snapTargets('3x5', []);
  // label centre x = 507.5; box centre 357+150 = 507 → shift by 0.5, rounded
  const out = snapBox({ x: 357, y: 100, w: 300, h: 60 }, { mode: 'move', targets });
  assert.equal(out.box.x, 358);
  assert.deepEqual(out.guides, [{ x: 507.5 }]);
});

test('resizing snaps only the right and bottom edges', () => {
  const targets = snapTargets('3x5', [{ x: 600, y: 300, w: 100, h: 50 }]);
  const out = snapBox({ x: 20, y: 100, w: 675, h: 245 }, { mode: 'resize', targets });
  assert.equal(out.box.x, 20, 'origin never moves on resize');
  assert.equal(out.box.w, 680, 'right edge 695 → other box right 700');
  assert.equal(out.box.h, 250, 'bottom 345 → other box bottom 350');
  assert.deepEqual(out.guides, [{ x: 700 }, { y: 350 }]);
});

test('threshold is inclusive and ties keep the earlier target', () => {
  assert.equal(SNAP_THRESHOLD, 12);
  const targets = { xs: [100, 124], ys: [] };
  assert.equal(snapBox({ x: 112, y: 0, w: 200, h: 10 }, { mode: 'move', targets }).box.x, 100, 'equidistant → first target');
  assert.equal(snapBox({ x: 88, y: 0, w: 200, h: 10 }, { mode: 'move', targets }).box.x, 100, 'exactly 12 away snaps');
  assert.equal(snapBox({ x: 87, y: 0, w: 200, h: 10 }, { mode: 'move', targets }).box.x, 87, '13 away does not');
});

test('alignBox positions a box against the frame', () => {
  const frame = frameFor('3x5');
  const box = { x: 100, y: 100, w: 300, h: 60, rotation: 0 };
  assert.equal(alignBox(box, 'left', frame).x, 20);
  assert.equal(alignBox(box, 'center', frame).x, 358);
  assert.equal(alignBox(box, 'right', frame).x, 695);
  assert.equal(alignBox(box, 'top', frame).y, 20);
  assert.equal(alignBox(box, 'middle', frame).y, 258);
  assert.equal(alignBox(box, 'bottom', frame).y, 496);
  assert.equal(alignBox(box, 'left', frame).rotation, 0, 'other fields survive');
  assert.throws(() => alignBox(box, 'sideways', frame), /alignment/);
});
