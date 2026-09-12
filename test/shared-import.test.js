import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImport } from '../public/shared/import.js';

const ok = { id: 'a1', size: '3x2', fields: { name: 'X', barcode: '036000291452' }, layout: {}, createdAt: 't', updatedAt: 't' };

test('validateImport accepts an array of labels and printer files', () => {
  const prn = { id: 'p1', kind: 'prn', size: null, fields: { name: 'F', barcode: '' }, zpl: '^XA^XZ' };
  assert.deepEqual(validateImport([ok, prn]), [ok, prn]);
});

test('validateImport rejects non-arrays and malformed items with a reason', () => {
  assert.throws(() => validateImport({ labels: [] }), /list of labels/);
  assert.throws(() => validateImport([{ ...ok, id: 7 }]), /id/);
  assert.throws(() => validateImport([{ ...ok, size: '9x9' }]), /size/);
  assert.throws(() => validateImport([{ ...ok, fields: null }]), /fields/);
  assert.throws(() => validateImport([{ ...ok, layout: undefined }]), /layout/);
  assert.throws(() => validateImport('[]'), /list of labels/);
});
