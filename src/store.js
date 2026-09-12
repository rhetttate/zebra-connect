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
    // allowDuplicateBarcode: imported printer files carry real product codes,
    // and several labels for one product legitimately share one.
    create(data, { allowDuplicateBarcode = false } = {}) {
      if (!allowDuplicateBarcode) assertBarcodeFree(data);
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
      // Keeping its own barcode is always fine (it may be a shared, imported
      // code); only a change to a barcode another label uses is refused.
      if (merged.fields?.barcode !== labels[i].fields?.barcode) assertBarcodeFree(merged, id);
      merged.updatedAt = new Date().toISOString();
      labels[i] = merged;
      save();
      return merged;
    },
    remove(id) {
      labels = labels.filter((l) => l.id !== id);
      save();
    },
    // Backup restore / carrying labels to another device: labels whose id is
    // already here are left alone (no merge), everything else is added as-is,
    // barcodes included — a backup may legitimately share codes.
    importLabels(incoming) {
      let added = 0;
      let skipped = 0;
      for (const label of incoming) {
        if (labels.some((l) => l.id === label.id)) { skipped++; continue; }
        labels.push(structuredClone(label));
        added++;
      }
      if (added) save();
      return { added, skipped };
    },
  };
}
