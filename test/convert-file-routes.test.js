import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

function startApp() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-cv-'));
  const app = createApp({ dataDir });
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}
const PRN = '^XA^PW406^LL254^FT43,50^A0N,48,48^FDBACON $69^FS^BY3,2,144^FT63,220^BUN,,Y,N,Y^FD209990069008^FS^XZ';
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const upload = async (base, name) => (await fetch(`${base}/api/labels/prn?name=${name}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: PRN })).json();

test('single convert creates an app label and can remove the file entry', async () => {
  const { base, close } = await startApp();
  try {
    const file = await upload(base, 'bacon.prn');
    const res = await fetch(`${base}/api/labels/${file.id}/convert`, json('POST', { remove: true }));
    assert.equal(res.status, 200);
    const { label, warnings } = await res.json();
    assert.deepEqual(warnings, []);
    assert.equal(label.kind, undefined);
    assert.equal(label.fields.name, 'BACON $69');
    assert.equal(label.fields.barcode, '209990069008');
    assert.equal((await fetch(`${base}/api/labels/${file.id}`)).status, 404);
    const list = await (await fetch(`${base}/api/labels`)).json();
    assert.equal(list.length, 1);
  } finally { close(); }
});

test('convert-all converts every file, removes originals, and reports', async () => {
  const { base, close } = await startApp();
  try {
    await upload(base, 'a.prn');
    await upload(base, 'b.prn');
    const normal = await (await fetch(`${base}/api/labels`, json('POST', { size: '3x5', fields: { name: 'Flour' } }))).json();
    const report = await (await fetch(`${base}/api/labels/convert-all`, { method: 'POST' })).json();
    assert.equal(report.converted.length, 2);
    assert.equal(report.failed.length, 0);
    const list = await (await fetch(`${base}/api/labels`)).json();
    assert.equal(list.length, 3);
    assert.ok(list.every((l) => l.kind !== 'prn'));
    assert.ok(list.some((l) => l.id === normal.id));
  } finally { close(); }
});

test('files sharing a UPC keep it after conversion, and re-saving such a label still works', async () => {
  const { base, close } = await startApp();
  try {
    const a = await upload(base, 'sale1.prn');
    const b = await upload(base, 'sale2.prn');
    const first = await (await fetch(`${base}/api/labels/${a.id}/convert`, json('POST', { remove: true }))).json();
    const second = await (await fetch(`${base}/api/labels/${b.id}/convert`, json('POST', { remove: true }))).json();
    assert.equal(first.label.fields.barcode, '209990069008');
    assert.equal(second.label.fields.barcode, '209990069008');
    assert.deepEqual(second.warnings, []);
    // editing the second label (same barcode, new name) must not be rejected as a duplicate
    const res = await fetch(`${base}/api/labels/${second.label.id}`, json('PUT', { ...second.label, fields: { ...second.label.fields, name: 'BACON $79' } }));
    assert.equal(res.status, 200);
    // moving the second label to an unused barcode is fine...
    const moved = await fetch(`${base}/api/labels/${second.label.id}`, json('PUT', { ...second.label, fields: { ...second.label.fields, barcode: '036000291452' } }));
    assert.equal(moved.status, 200);
    // ...but a new app label may still not take a barcode another label has
    const normal = await (await fetch(`${base}/api/labels`, json('POST', { size: '3x5', fields: { name: 'Flour', barcode: '036000291452' } }))).json();
    assert.match(normal.error ?? '', /duplicate/);
  } finally { close(); }
});

test('convert refuses normal labels', async () => {
  const { base, close } = await startApp();
  try {
    const normal = await (await fetch(`${base}/api/labels`, json('POST', { size: '3x5', fields: { name: 'Flour' } }))).json();
    assert.equal((await fetch(`${base}/api/labels/${normal.id}/convert`, json('POST', {}))).status, 400);
  } finally { close(); }
});
