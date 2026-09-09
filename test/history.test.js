import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../public/history.js';

function harness(limit) {
  let state = { n: 0 };
  const events = [];
  const h = createHistory(
    () => structuredClone(state),
    (s) => { state = s; },
    { limit, onChange: () => events.push([h.canUndo, h.canRedo]) },
  );
  return { h, get state() { return state; }, set(n) { state = { n }; }, events };
}

test('commit records a step; undo and redo walk the stack', () => {
  const t = harness();
  assert.equal(t.h.canUndo, false);
  t.set(1); assert.equal(t.h.commit(), true);
  t.set(2); t.h.commit();
  assert.equal(t.h.canUndo, true);
  assert.equal(t.h.undo(), true);
  assert.deepEqual(t.state, { n: 1 });
  assert.equal(t.h.canRedo, true);
  t.h.undo();
  assert.deepEqual(t.state, { n: 0 });
  assert.equal(t.h.undo(), false, 'nothing left');
  t.h.redo();
  assert.deepEqual(t.state, { n: 1 });
});

test('a new commit clears the redo stack and a no-op commit is ignored', () => {
  const t = harness();
  t.set(1); t.h.commit();
  t.h.undo();
  assert.equal(t.h.canRedo, true);
  t.set(5); t.h.commit();
  assert.equal(t.h.canRedo, false);
  assert.equal(t.h.commit(), false, 'same state twice is not a step');
  assert.equal(t.h.redo(), false);
});

test('undo restores a clone, not the live object', () => {
  const t = harness();
  t.set(1); t.h.commit();
  t.h.undo();
  t.state.n = 99; // mutate what applyState installed
  t.h.redo();
  t.h.undo();
  assert.deepEqual(t.state, { n: 0 }, 'history kept its own copy');
});

test('the stack is capped and reset clears it', () => {
  const t = harness(3);
  for (let i = 1; i <= 5; i++) { t.set(i); t.h.commit(); }
  let steps = 0;
  while (t.h.undo()) steps++;
  assert.equal(steps, 3);
  assert.deepEqual(t.state, { n: 2 });
  t.h.reset();
  assert.equal(t.h.canUndo, false);
  assert.equal(t.h.canRedo, false);
  assert.ok(t.events.length > 0, 'onChange fired');
});
