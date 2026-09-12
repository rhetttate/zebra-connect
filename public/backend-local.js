// The tablet as the whole system: labels in IndexedDB, drawing and ZPL in
// this browser, bytes straight down the Bluetooth link, AI drafts straight
// from the Messages API. Same method names and return shapes as
// backend-remote.js so nothing else in the app knows the difference.
import { createLocalStore, indexedDbAdapter } from './local-store.js';
import { createLocalConfig } from './local-config.js';
import { sendToPrinter } from './station.js';
import { requestContent } from './local-ai.js';
import { labelJobZpl } from './shared/print-job.js';
import { normalizeDraft, clampQuantity } from './shared/draft.js';
import { generateUpcA } from './shared/upc.js';
import { buildTestZpl, buildCalibrationZpl, setZplModeCommand } from './shared/zpl.js';
import { layoutDraft } from './shared/ai-layout.js';
import { houseExamples } from './shared/ai-prompt.js';
import { validateImport } from './shared/import.js';
import { drawLabel } from './shared/render-core.js';
import { SIZES } from './shared/sizes.js';
import { ensureFonts, loadImage } from './preview.js';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const encoder = new TextEncoder();
const unavailable = async () => { throw new Error('not available on this device'); };
const notFound = () => Object.assign(new Error('not found'), { status: 404 });

let storePromise = null;
function store() {
  if (!storePromise) storePromise = createLocalStore(indexedDbAdapter());
  return storePromise;
}
const config = createLocalConfig(globalThis.localStorage ?? { getItem: () => null, setItem: () => {} });

async function send(zpl) {
  const bytes = typeof zpl === 'string' ? encoder.encode(zpl) : zpl;
  await sendToPrinter(bytes);
  return { ok: true, queued: false };
}

async function drawToCanvas(draft) {
  const label = normalizeDraft(draft);
  await ensureFonts();
  const canvas = document.createElement('canvas');
  const { width, height } = SIZES[label.size];
  canvas.width = width;
  canvas.height = height;
  await drawLabel(canvas.getContext('2d'), label, { includeBarcode: true, loadImage });
  return canvas;
}

function publicSettings() {
  const { apiKey, ...rest } = config.get();
  return { ...rest, apiKeySet: Boolean(apiKey), connection: 'bluetooth' };
}

export const local = {
  mode: 'local',
  // Opens the database up front so a broken browser fails at startup, not on
  // the first tap.
  init: async () => { await store(); },

  listLabels: async () => (await store()).list(),
  getLabel: async (id) => {
    const label = (await store()).get(id);
    if (!label) throw notFound();
    return label;
  },
  createLabel: async (draft) => {
    const s = await store();
    const label = normalizeDraft(draft);
    if (!label.fields.barcode) label.fields.barcode = generateUpcA((c) => s.barcodeExists(c));
    return s.create(label);
  },
  updateLabel: async (id, draft) => {
    const s = await store();
    if (!s.get(id)) throw notFound();
    return s.update(id, normalizeDraft(draft));
  },
  deleteLabel: async (id) => {
    const s = await store();
    if (!s.get(id)) throw notFound();
    await s.remove(id);
    return { ok: true };
  },
  newBarcode: async () => {
    const s = await store();
    return { barcode: generateUpcA((c) => s.barcodeExists(c)) };
  },
  previewBlob: async (draft) => {
    const canvas = await drawToCanvas(draft);
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('preview failed'))), 'image/png'));
  },
  printLabel: async (draft, quantity) => {
    const label = normalizeDraft(draft);
    await ensureFonts();
    const zpl = await labelJobZpl(document.createElement('canvas'), label, {
      quantity: clampQuantity(quantity),
      darkness: config.get().darkness,
      loadImage,
    });
    return send(zpl);
  },
  printRaw: async (file) => send(new Uint8Array(await file.arrayBuffer())),

  addPrn: unavailable,
  printFileLabel: unavailable,
  getFileFields: unavailable,
  saveFileFields: unavailable,
  saveFileZpl: unavailable,
  previewZplBlob: unavailable,
  convertFile: unavailable,
  discover: unavailable,

  makeLabel: async ({ size, text, image }) => {
    const { apiKey } = config.get();
    if (!apiKey) throw new Error('no API key configured — add one in Settings');
    text = String(text ?? '').trim();
    if (!SIZES[size]) throw new Error('unknown size');
    if (!text && !image) throw new Error('describe the product or add a photo first');
    if (image && (!IMAGE_TYPES.includes(image.mediaType) || typeof image.data !== 'string' || !image.data)) {
      throw new Error('unsupported image type — use a JPEG or PNG photo');
    }
    const s = await store();
    const content = await requestContent({ size, text, image: image ?? null }, apiKey, { examples: houseExamples(s.list()) });
    const draft = normalizeDraft(layoutDraft({ size, content }));
    draft.fields.barcode = generateUpcA((c) => s.barcodeExists(c));
    return { ...draft, warnings: content.warning ? [content.warning] : [] };
  },

  getSettings: async () => publicSettings(),
  putSettings: async (patch) => { config.update(patch ?? {}); return publicSettings(); },
  testPrint: async () => send(buildTestZpl()),
  zplMode: async () => send(setZplModeCommand()),
  calibrate: async (mediaType) => {
    const zpl = buildCalibrationZpl(mediaType); // throws on an unknown type
    config.update({ mediaType });
    return send(zpl);
  },

  exportLabels: async () => (await store()).list(),
  // Printer-file entries need the server (Labelary preview, ZPL field editor),
  // so they are counted and left out here.
  importLabels: async (json) => {
    const labels = validateImport(json);
    const files = labels.filter((l) => l.kind === 'prn').length;
    const result = await (await store()).importLabels(labels.filter((l) => l.kind !== 'prn'));
    return { ...result, skippedFiles: files };
  },
};
