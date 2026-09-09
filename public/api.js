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
  addPrn: async (file) => (await call(`/api/labels/prn?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file,
  })).json(),
  printFileLabel: async (id, quantity) => (await call(`/api/labels/${id}/print`, json('POST', { quantity }))).json(),
  getFileFields: async (id) => (await call(`/api/labels/${id}/fields`)).json(),
  saveFileFields: async (id, fields, name) => (await call(`/api/labels/${id}/fields`, json('PUT', { fields, name }))).json(),
  saveFileZpl: async (id, zpl, name) => (await call(`/api/labels/${id}/zpl`, json('PUT', { zpl, name }))).json(),
  previewZplBlob: async (zpl) => (await call('/api/preview-zpl', json('POST', { zpl }))).blob(),
  convertFile: async (id) => (await call(`/api/labels/${id}/convert`, json('POST', { remove: true }))).json(),
  makeLabel: async (body) => (await call('/api/ai-label', json('POST', body))).json(),
  getSettings: async () => (await call('/api/settings')).json(),
  putSettings: async (patch) => (await call('/api/settings', json('PUT', patch))).json(),
  discover: async () => (await call('/api/settings/discover', { method: 'POST' })).json(),
  testPrint: async () => (await call('/api/settings/test-print', { method: 'POST' })).json(),
  zplMode: async () => (await call('/api/settings/zpl-mode', { method: 'POST' })).json(),
  calibrate: async (mediaType) => (await call('/api/settings/calibrate', json('POST', { mediaType }))).json(),
};
