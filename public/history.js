// Undo/redo over snapshots. Browser-safe and dependency-free so it can be
// unit-tested in Node. `getState` must return a fresh copy each call.
export function createHistory(getState, applyState, { limit = 50, onChange = () => {} } = {}) {
  let current = getState();
  let past = [];
  let future = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return {
    commit() {
      const next = getState();
      if (same(next, current)) return false;
      past.push(current);
      if (past.length > limit) past.shift();
      current = next;
      future = [];
      onChange();
      return true;
    },
    undo() {
      if (!past.length) return false;
      future.push(current);
      current = past.pop();
      applyState(structuredClone(current));
      onChange();
      return true;
    },
    redo() {
      if (!future.length) return false;
      past.push(current);
      current = future.pop();
      applyState(structuredClone(current));
      onChange();
      return true;
    },
    reset() {
      current = getState();
      past = [];
      future = [];
      onChange();
    },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}
