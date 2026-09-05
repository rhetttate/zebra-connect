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
