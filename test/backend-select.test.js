import test from 'node:test';
import assert from 'node:assert/strict';

// Fresh module instances per case: the choice is made once at import time.
async function load(flag) {
  if (flag) globalThis.ZC_BACKEND = flag; else delete globalThis.ZC_BACKEND;
  const { api } = await import(`../public/api.js?case=${flag ?? 'none'}`);
  return api;
}

test('api is the remote backend unless the page declares local', async () => {
  const remote = await load(undefined);
  assert.equal(remote.mode, 'remote');
  assert.equal(typeof remote.listLabels, 'function');
  assert.equal(typeof remote.exportLabels, 'function');
  await remote.init();
});

test('api is the local backend when the page declares local', async () => {
  const local = await load('local');
  assert.equal(local.mode, 'local');
  assert.equal(typeof local.listLabels, 'function');
});
