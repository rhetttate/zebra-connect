import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

function startApp(printerOverrides) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-prn-'));
  const app = createApp({ dataDir, printerOverrides });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, close: () => server.close() });
    });
  });
}

const PRN = '﻿CT~~CD,~CC^~CT~\r\n^XA^MMT^PW406^LL254^LS0^FT43,50^A0N,48,48^FDBACON $69^FS^PQ1,0,1,Y^XZ';

async function upload(base, name, body = PRN) {
  return fetch(`${base}/api/labels/prn?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  });
}

test('uploading a .prn adds a file label with its size and appears in the list', async () => {
  const { base, close } = await startApp();
  const res = await upload(base, 'bacon.prn');
  assert.equal(res.status, 200);
  const label = await res.json();
  assert.equal(label.kind, 'prn');
  assert.equal(label.fields.name, 'bacon');
  assert.equal(label.size, '2x1.25');
  assert.ok(label.id);

  const list = await (await fetch(`${base}/api/labels`)).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'prn');
  close();
});

test('uploading something that is not ZPL is rejected with 400', async () => {
  const { base, close } = await startApp();
  const res = await upload(base, 'junk.prn', 'not a label');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /ZPL/);
  close();
});

test('printing a file label sends its ZPL with the requested quantity', async () => {
  const sent = [];
  const { base, close } = await startApp({ sendToPrinter: async (ip, zpl) => { sent.push({ ip, zpl }); } });
  await fetch(`${base}/api/settings`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ printerIp: '10.0.0.9', connection: 'network' }),
  });
  const label = await (await upload(base, 'bacon.prn')).json();
  const res = await fetch(`${base}/api/labels/${label.id}/print`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ quantity: 4 }),
  });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0].zpl, /\^PQ4,0,1,Y/);
  assert.ok(!sent[0].zpl.includes('﻿'));
  close();
});

test('print on a normal label id or unknown id is refused', async () => {
  const { base, close } = await startApp();
  const normal = await (await fetch(`${base}/api/labels`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: '3x5', fields: { name: 'Flour' } }),
  })).json();
  const res = await fetch(`${base}/api/labels/${normal.id}/print`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 400);
  const missing = await fetch(`${base}/api/labels/nope/print`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(missing.status, 404);
  close();
});

test('file labels can be deleted like any other label', async () => {
  const { base, close } = await startApp();
  const label = await (await upload(base, 'bacon.prn')).json();
  assert.equal((await fetch(`${base}/api/labels/${label.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(`${base}/api/labels`)).json()).length, 0);
  close();
});
