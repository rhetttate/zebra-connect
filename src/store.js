import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function createStore(filePath) {
  let labels = [];
  if (fs.existsSync(filePath)) {
    labels = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(labels, null, 2));
    fs.renameSync(tmp, filePath);
  }

  function barcodeExists(code, exceptId) {
    return labels.some((l) => l.fields.barcode === code && l.id !== exceptId);
  }

  function assertBarcodeFree(label, exceptId) {
    if (label.fields?.barcode && barcodeExists(label.fields.barcode, exceptId)) {
      throw new Error('duplicate barcode — tap ↻ New to regenerate');
    }
  }

  return {
    list: () => [...labels].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    get: (id) => labels.find((l) => l.id === id),
    barcodeExists,
    create(data) {
      assertBarcodeFree(data);
      const now = new Date().toISOString();
      const label = { id: crypto.randomUUID(), ...data, createdAt: now, updatedAt: now };
      labels.push(label);
      save();
      return label;
    },
    update(id, patch) {
      const i = labels.findIndex((l) => l.id === id);
      if (i === -1) throw new Error('not found');
      const merged = { ...labels[i], ...patch, id, createdAt: labels[i].createdAt };
      assertBarcodeFree(merged, id);
      merged.updatedAt = new Date().toISOString();
      labels[i] = merged;
      save();
      return merged;
    },
    remove(id) {
      labels = labels.filter((l) => l.id !== id);
      save();
    },
  };
}
