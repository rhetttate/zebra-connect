import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

function startApp(opts = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-fe-'));
  const app = createApp({ dataDir, ...opts });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
}
const PRN = '^XA^MMT^PW406^LL254^FT43,50^A0N,48,48^FDBACON $69^FS^BY3,2,144^FT63,220^BUN,,Y,N,Y^FD209990069008^FS^PQ1,0,1,Y^XZ';
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
async function upload(base) {
  return (await fetch(`${base}/api/labels/prn?name=bacon.prn`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: PRN })).json();
}

test('fields round trip: read, edit, save, read back', async () => {
  const { base, close } = await startApp();
  try {
    const label = await upload(base);
    const got = await (await fetch(`${base}/api/labels/${label.id}/fields`)).json();
    assert.deepEqual(got.inches, { w: 2, h: 1.25 });
    assert.equal(got.fields.length, 2);
    got.fields[0].text = 'BACON $79';
    const saved = await (await fetch(`${base}/api/labels/${label.id}/fields`, json('PUT', { fields: got.fields, name: 'bacon 79' }))).json();
    assert.equal(saved.fields.name, 'bacon 79');
    assert.ok(saved.zpl.includes('^FDBACON $79^FS'));
    const again = await (await fetch(`${base}/api/labels/${label.id}/fields`)).json();
    assert.equal(again.fields[0].text, 'BACON $79');
  } finally { close(); }
});

test('bad field text and non-file labels are refused', async () => {
  const { base, close } = await startApp();
  try {
    const label = await upload(base);
    const bad = await fetch(`${base}/api/labels/${label.id}/fields`, json('PUT', { fields: [{ id: 0, text: 'x^XZ' }] }));
    assert.equal(bad.status, 400);
    const normal = await (await fetch(`${base}/api/labels`, json('POST', { size: '3x5', fields: { name: 'Flour' } }))).json();
    assert.equal((await fetch(`${base}/api/labels/${normal.id}/fields`)).status, 400);
  } finally { close(); }
});

test('raw ZPL save validates and replaces the job', async () => {
  const { base, close } = await startApp();
  try {
    const label = await upload(base);
    const bad = await fetch(`${base}/api/labels/${label.id}/zpl`, json('PUT', { zpl: 'nope' }));
    assert.equal(bad.status, 400);
    const ok = await (await fetch(`${base}/api/labels/${label.id}/zpl`, json('PUT', { zpl: '^XA^FDhi^FS^XZ' }))).json();
    assert.equal(ok.zpl, '^XA^FDhi^FS^XZ');
  } finally { close(); }
});

test('preview proxies through the injected renderer with the file size', async () => {
  const calls = [];
  const { base, close } = await startApp({ zplRenderer: async (args) => { calls.push(args); return Buffer.from('PNG!'); } });
  try {
    const res = await fetch(`${base}/api/preview-zpl`, json('POST', { zpl: PRN }));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), 'PNG!');
    assert.deepEqual(calls[0], { zpl: PRN, w: 2, h: 1.25 });
  } finally { close(); }
});

test('preview falls back to the loaded roll size and reports renderer failures as 502', async () => {
  const calls = [];
  let fail = false;
  const { base, close } = await startApp({ zplRenderer: async (args) => { calls.push(args); if (fail) throw new Error('labelary down'); return Buffer.alloc(1); } });
  try {
    await fetch(`${base}/api/preview-zpl`, json('POST', { zpl: '^XA^FDx^FS^XZ' }));
    assert.deepEqual(calls[0], { zpl: '^XA^FDx^FS^XZ', w: 2.84, h: 5 });
    fail = true;
    const res = await fetch(`${base}/api/preview-zpl`, json('POST', { zpl: '^XA^FDx^FS^XZ' }));
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /labelary down/);
  } finally { close(); }
});
