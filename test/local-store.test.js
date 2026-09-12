import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../public/local-store.js';

function memoryAdapter(seed = []) {
  const rows = new Map(seed.map((l) => [l.id, structuredClone(l)]));
  return {
    rows,
    getAll: async () => [...rows.values()].map((l) => structuredClone(l)),
    put: async (l) => { rows.set(l.id, structuredClone(l)); },
    delete: async (id) => { rows.delete(id); },
  };
}

const sample = (barcode = '036000291452') => ({
  size: '3x5',
  fields: { name: 'Flour', description: 'All purpose', barcode },
  options: { showDescription: true },
  layout: { name: { x: 20, y: 20, w: 536, h: 120 } },
});

test('create assigns id and timestamps and writes through to the adapter', async () => {
  const adapter = memoryAdapter();
  const store = await createLocalStore(adapter);
  const label = await store.create(sample());
  assert.match(label.id, /^[0-9a-f-]{36}$/);
  assert.ok(label.createdAt);
  assert.equal(store.get(label.id).fields.name, 'Flour');
  assert.equal(store.list().length, 1);
  assert.equal(adapter.rows.get(label.id).fields.name, 'Flour');
});

test('loads what the adapter already holds, sorted newest first', async () => {
  const older = { ...sample('111111111117'), id: 'a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  const newer = { ...sample('222222222224'), id: 'b', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' };
  const store = await createLocalStore(memoryAdapter([older, newer]));
  assert.deepEqual(store.list().map((l) => l.id), ['b', 'a']);
});

test('update merges and bumps updatedAt; remove deletes; unknown id throws', async () => {
  const adapter = memoryAdapter();
  const store = await createLocalStore(adapter);
  const label = await store.create(sample());
  const updated = await store.update(label.id, { fields: { ...label.fields, name: 'Sugar' } });
  assert.equal(updated.fields.name, 'Sugar');
  assert.equal(updated.fields.barcode, '036000291452');
  assert.equal(adapter.rows.get(label.id).fields.name, 'Sugar');
  await store.remove(label.id);
  assert.equal(store.get(label.id), undefined);
  assert.equal(adapter.rows.size, 0);
  await assert.rejects(store.update('nope', {}), /not found/);
});

test('duplicate barcodes are refused except on the same label or when allowed', async () => {
  const store = await createLocalStore(memoryAdapter());
  const a = await store.create(sample());
  await assert.rejects(store.create(sample()), /duplicate barcode/);
  assert.equal(store.barcodeExists('036000291452'), true);
  assert.equal(store.barcodeExists('036000291452', a.id), false);
  const b = await store.create(sample(), { allowDuplicateBarcode: true });
  await store.update(b.id, { fields: { ...b.fields, name: 'Sugar' } });
  const c = await store.create(sample('123456789012'));
  await assert.rejects(store.update(c.id, { fields: { ...c.fields, barcode: a.fields.barcode } }), /duplicate barcode/);
});

test('importLabels adds new ids as-is and skips existing ones', async () => {
  const adapter = memoryAdapter();
  const store = await createLocalStore(adapter);
  const a = await store.create(sample());
  const result = await store.importLabels([
    { ...a, fields: { ...a.fields, name: 'Changed' } },
    { ...sample('036000291452'), id: 'imp', createdAt: 'x', updatedAt: 'x' },
  ]);
  assert.deepEqual(result, { added: 1, skipped: 1 });
  assert.equal(store.get(a.id).fields.name, 'Flour');
  assert.equal(adapter.rows.get('imp').fields.name, 'Flour');
});
