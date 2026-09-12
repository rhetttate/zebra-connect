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

test('local backend has every method the remote backend has', async () => {
  const { remote } = await import('../public/backend-remote.js');
  const { local } = await import('../public/backend-local.js');
  for (const name of Object.keys(remote)) {
    assert.equal(typeof local[name], typeof remote[name], `local.${name}`);
  }
  await assert.rejects(local.discover(), /not available on this device/);
});

test('station.js can be imported without a DOM and refuses to send when not connected', async () => {
  const station = await import('../public/station.js');
  assert.equal(typeof station.sendToPrinter, 'function');
  await assert.rejects(station.sendToPrinter(new Uint8Array([1])), /printer not connected/);
});
