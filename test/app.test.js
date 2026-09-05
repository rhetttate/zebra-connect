import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

function startApp(printerOverrides) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-app-'));
  const app = createApp({ dataDir, printerOverrides });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, close: () => server.close() });
    });
  });
}

test('label CRUD round trip with auto-filled barcode and layout', async () => {
  const { base, close } = await startApp();
  const created = await (await fetch(`${base}/api/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: '3x5', fields: { name: 'Flour', description: 'AP' } }),
  })).json();
  assert.match(created.fields.barcode, /^\d{12}$/);
  assert.ok(created.layout.name);
  assert.equal(created.options.showDescription, true);

  const list = await (await fetch(`${base}/api/labels`)).json();
  assert.equal(list.length, 1);

  const updated = await (await fetch(`${base}/api/labels/${created.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...created, fields: { ...created.fields, name: 'Sugar' } }),
  })).json();
  assert.equal(updated.fields.name, 'Sugar');

  const del = await fetch(`${base}/api/labels/${created.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await fetch(`${base}/api/labels/${created.id}`)).status, 404);
  close();
});

test('barcode/new returns a fresh valid code and preview returns a PNG', async () => {
  const { base, close } = await startApp();
  const { barcode } = await (await fetch(`${base}/api/barcode/new`)).json();
  assert.match(barcode, /^\d{12}$/);

  const res = await fetch(`${base}/api/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: '3x2', fields: { name: 'X', description: '', barcode } }),
  });
  assert.equal(res.headers.get('content-type'), 'image/png');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.slice(0, 4)], [137, 80, 78, 71]);
  close();
});

test('print builds ZPL and sends it to the configured printer', async () => {
  const sent = [];
  const { base, close } = await startApp({
    sendToPrinter: async (ip, data) => { sent.push({ ip, data: data.toString() }); },
  });
  await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ printerIp: '10.0.0.9' }),
  });
  const res = await fetch(`${base}/api/print`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      label: { size: '3x2', fields: { name: 'X', description: '', barcode: '036000291452' } },
      quantity: 2,
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(sent[0].ip, '10.0.0.9');
  assert.ok(sent[0].data.includes('^GFA'));
  assert.ok(sent[0].data.includes('^BUN'));
  assert.ok(sent[0].data.includes('^PQ2'));
  close();
});

test('print without a configured printer or with a failing printer errors clearly', async () => {
  const { base, close } = await startApp({
    sendToPrinter: async () => { throw new Error("Can't reach printer at 10.0.0.9:9100"); },
  });
  const body = JSON.stringify({ label: { size: '3x2', fields: { name: 'X', description: '', barcode: '' } } });
  const noIp = await fetch(`${base}/api/print`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  assert.equal(noIp.status, 400);

  await fetch(`${base}/api/settings`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ printerIp: '10.0.0.9' }),
  });
  const fail = await fetch(`${base}/api/print`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  });
  assert.equal(fail.status, 502);
  assert.match((await fail.json()).error, /10\.0\.0\.9/);
  close();
});

test('print-raw forwards bytes untouched; settings masks apiKey', async () => {
  const sent = [];
  const { base, close } = await startApp({
    sendToPrinter: async (ip, data) => { sent.push(data); },
  });
  await fetch(`${base}/api/settings`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ printerIp: '10.0.0.9', apiKey: 'sk-test' }),
  });
  await fetch(`${base}/api/print-raw`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' },
    body: Buffer.from('RAW PRN \x01\x02'),
  });
  assert.equal(Buffer.from(sent[0]).toString('latin1'), 'RAW PRN \x01\x02');

  const settings = await (await fetch(`${base}/api/settings`)).json();
  assert.equal(settings.apiKeySet, true);
  assert.equal('apiKey' in settings, false);
  close();
});

test('validation errors return JSON bodies and DELETE 404s on unknown ids', async () => {
  const { base, close } = await startApp();
  const bad = await fetch(`${base}/api/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: 'nope', fields: { name: 'X' } }),
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('content-type').includes('application/json'), true);
  assert.match((await bad.json()).error, /unknown size/);

  const badBarcode = await fetch(`${base}/api/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ size: '3x2', fields: { name: 'X', barcode: '123' } }),
  });
  assert.equal(badBarcode.status, 400);
  assert.match((await badBarcode.json()).error, /UPC-A/);

  const del = await fetch(`${base}/api/labels/does-not-exist`, { method: 'DELETE' });
  assert.equal(del.status, 404);
  close();
});

test('extract requires an API key, then returns extracted fields', async () => {
  const { base, close } = await startApp();
  const noKey = await fetch(`${base}/api/extract`, {
    method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('img'),
  });
  assert.equal(noKey.status, 400);
  close();

  const dataDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-app-'));
  const app2 = createApp({
    dataDir: dataDir2,
    extractOverride: async () => ({ name: 'Beans', description: 'Black beans' }),
  });
  await new Promise((resolve) => {
    const server = app2.listen(0, '127.0.0.1', async () => {
      const base2 = `http://127.0.0.1:${server.address().port}`;
      await fetch(`${base2}/api/settings`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: 'sk-test' }),
      });
      const out = await (await fetch(`${base2}/api/extract`, {
        method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('img'),
      })).json();
      assert.equal(out.name, 'Beans');
      server.close();
      resolve();
    });
  });
});
