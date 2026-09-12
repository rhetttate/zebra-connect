import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-store-'));
  return { store: createStore(path.join(dir, 'labels.json')), dir };
}

const sample = (barcode = '036000291452') => ({
  size: '3x5',
  fields: { name: 'Flour', description: 'All purpose', barcode },
  options: { showDescription: true },
  layout: { name: { x: 20, y: 20, w: 536, h: 120 } },
});

test('create assigns id and timestamps, get and list retrieve it', () => {
  const { store } = tmpStore();
  const label = store.create(sample());
  assert.ok(label.id);
  assert.ok(label.createdAt);
  assert.equal(store.get(label.id).fields.name, 'Flour');
  assert.equal(store.list().length, 1);
});

test('data persists across store instances', () => {
  const { store, dir } = tmpStore();
  const label = store.create(sample());
  const store2 = createStore(path.join(dir, 'labels.json'));
  assert.equal(store2.get(label.id).fields.barcode, '036000291452');
});

test('update merges patch and bumps updatedAt; remove deletes', () => {
  const { store } = tmpStore();
  const label = store.create(sample());
  const updated = store.update(label.id, { fields: { ...label.fields, name: 'Sugar' } });
  assert.equal(updated.fields.name, 'Sugar');
  assert.equal(updated.fields.barcode, '036000291452');
  store.remove(label.id);
  assert.equal(store.get(label.id), undefined);
  assert.throws(() => store.update('nope', {}), /not found/);
});

test('duplicate barcodes are rejected, except on the same label', () => {
  const { store } = tmpStore();
  const a = store.create(sample());
  assert.throws(() => store.create(sample()), /duplicate barcode/);
  assert.equal(store.barcodeExists('036000291452'), true);
  assert.equal(store.barcodeExists('036000291452', a.id), false);
  // updating the same label keeping its own barcode is fine
  store.update(a.id, { options: { showDescription: false } });
});

test('importLabels adds labels whose id is new and skips the rest', () => {
  const { store } = tmpStore();
  const a = store.create(sample());
  const incoming = [
    { ...a, fields: { ...a.fields, name: 'Changed' } },
    { id: 'imported-1', size: '3x2', fields: { name: 'B', description: '', barcode: '036000291452' }, options: {}, layout: {}, extras: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  assert.deepEqual(store.importLabels(incoming), { added: 1, skipped: 1 });
  assert.equal(store.get(a.id).fields.name, 'Flour', 'existing label untouched');
  assert.equal(store.get('imported-1').fields.barcode, '036000291452', 'shared barcodes allowed on import');
  assert.equal(store.list().length, 2);
});

test('imported labels may share a real barcode, but moving to a taken one is still refused', () => {
  const { store } = tmpStore();
  const a = store.create(sample());
  const b = store.create(sample(), { allowDuplicateBarcode: true });
  assert.equal(b.fields.barcode, a.fields.barcode);
  // re-saving b with its own (shared) barcode must work
  store.update(b.id, { fields: { ...b.fields, name: 'Sugar' } });
  const c = store.create(sample('123456789012'));
  assert.throws(() => store.update(c.id, { fields: { ...c.fields, barcode: a.fields.barcode } }), /duplicate barcode/);
});
