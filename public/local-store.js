// The tablet's label library. Records are the exact JSON shape of
// data/labels.json, kept in IndexedDB and mirrored in memory so lookups are
// synchronous like the server store. The adapter is swappable so the logic
// runs in Node tests over a Map.

const DB_NAME = 'zebra-connect';
const STORE = 'labels';

export function indexedDbAdapter() {
  let dbPromise = null;
  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!globalThis.indexedDB) { reject(new Error('this browser cannot keep labels (no IndexedDB)')); return; }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('could not open the label database'));
      });
    }
    return dbPromise;
  }
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error ?? new Error('label database error'));
      tx.onabort = () => reject(tx.error ?? new Error('label database error'));
    });
  };
  return {
    getAll: () => run('readonly', (s) => s.getAll()),
    put: (label) => run('readwrite', (s) => s.put(label)),
    delete: (id) => run('readwrite', (s) => s.delete(id)),
  };
}

export async function createLocalStore(adapter) {
  let labels = await adapter.getAll();

  function barcodeExists(code, exceptId) {
    return labels.some((l) => l.fields?.barcode === code && l.id !== exceptId);
  }

  function assertBarcodeFree(label, exceptId) {
    if (label.fields?.barcode && barcodeExists(label.fields.barcode, exceptId)) {
      throw new Error('duplicate barcode — tap ↻ New to regenerate');
    }
  }

  return {
    list: () => [...labels].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
    get: (id) => labels.find((l) => l.id === id),
    barcodeExists,
    async create(data, { allowDuplicateBarcode = false } = {}) {
      if (!allowDuplicateBarcode) assertBarcodeFree(data);
      const now = new Date().toISOString();
      const label = { id: globalThis.crypto.randomUUID(), ...data, createdAt: now, updatedAt: now };
      await adapter.put(label);
      labels.push(label);
      return label;
    },
    async update(id, patch) {
      const i = labels.findIndex((l) => l.id === id);
      if (i === -1) throw new Error('not found');
      const merged = { ...labels[i], ...patch, id, createdAt: labels[i].createdAt };
      if (merged.fields?.barcode !== labels[i].fields?.barcode) assertBarcodeFree(merged, id);
      merged.updatedAt = new Date().toISOString();
      await adapter.put(merged);
      labels[i] = merged;
      return merged;
    },
    async remove(id) {
      await adapter.delete(id);
      labels = labels.filter((l) => l.id !== id);
    },
    async importLabels(incoming) {
      let added = 0;
      let skipped = 0;
      for (const label of incoming) {
        if (labels.some((l) => l.id === label.id)) { skipped++; continue; }
        const copy = structuredClone(label);
        await adapter.put(copy);
        labels.push(copy);
        added++;
      }
      return { added, skipped };
    },
  };
}
