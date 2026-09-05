async function call(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let message = res.statusText;
    try { message = (await res.json()).error ?? message; } catch { /* keep statusText */ }
    throw new Error(message);
  }
  return res;
}
const json = (method, body) => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

export const api = {
  listLabels: async () => (await call('/api/labels')).json(),
  getLabel: async (id) => (await call(`/api/labels/${id}`)).json(),
  createLabel: async (draft) => (await call('/api/labels', json('POST', draft))).json(),
  updateLabel: async (id, draft) => (await call(`/api/labels/${id}`, json('PUT', draft))).json(),
  deleteLabel: async (id) => (await call(`/api/labels/${id}`, { method: 'DELETE' })).json(),
  newBarcode: async () => (await call('/api/barcode/new')).json(),
  previewBlob: async (draft) => (await call('/api/preview', json('POST', draft))).blob(),
  printLabel: async (label, quantity) => (await call('/api/print', json('POST', { label, quantity }))).json(),
  printRaw: async (file) => (await call('/api/print-raw', {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
  })).json(),
  extract: async (file) => (await call('/api/extract', {
    method: 'POST', headers: { 'content-type': file.type }, body: file,
  })).json(),
  getSettings: async () => (await call('/api/settings')).json(),
  putSettings: async (patch) => (await call('/api/settings', json('PUT', patch))).json(),
  discover: async () => (await call('/api/settings/discover', { method: 'POST' })).json(),
  testPrint: async () => (await call('/api/settings/test-print', { method: 'POST' })).json(),
  zplMode: async () => (await call('/api/settings/zpl-mode', { method: 'POST' })).json(),
};
