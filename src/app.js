import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createConfig } from './config.js';
import crypto from 'node:crypto';
import { SIZES, defaultLayout, defaultShowDescription, printRotation } from './layout.js';
import { generateUpcA, validateUpcA } from './barcode.js';
import { renderPreview, renderPrintBitmap, rotateBitmap90CW } from './render.js';
import { buildLabelZpl, buildTestZpl, buildCalibrationZpl, setZplModeCommand } from './zpl.js';
import * as printerLib from './printer.js';
import { makeLabelContent, makeClient, houseExamples } from './ai-label.js';
import { layoutDraft } from './ai-layout.js';
import { createQueue } from './queue.js';
import { parsePrn, withQuantity } from './printer-file.js';
import { parseFields, applyFields, labelInches } from './zpl-fields.js';
import { convertFileLabel } from './convert-file.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Labelary draws ZPL at 8 dots/mm (203 dpi): one PNG pixel per printer dot.
async function renderWithLabelary({ zpl, w, h }) {
  const res = await fetch(`http://api.labelary.com/v1/printers/8dpmm/labels/${w}x${h}/0/`, {
    method: 'POST',
    headers: { accept: 'image/png', 'content-type': 'application/x-www-form-urlencoded' },
    body: zpl,
  });
  if (!res.ok) throw new Error(`Labelary ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

export function createApp({ dataDir, printerOverrides = {}, aiLabelOverride, zplRenderer = renderWithLabelary }) {
  const store = createStore(path.join(dataDir, 'labels.json'));
  const config = createConfig(path.join(dataDir, 'config.json'));
  const printer = { ...printerLib, ...printerOverrides };
  const app = express();
  app.locals.store = store;
  app.locals.config = config;

  // The AI label maker posts a base64 photo, far over 1 MB; it parses its own body.
  const AI_LABEL_PATH = '/api/ai-label';
  const jsonBody = express.json({ limit: '1mb' });
  app.use((req, res, next) => (req.path === AI_LABEL_PATH ? next() : jsonBody(req, res, next)));
  app.use(express.static(path.join(here, '..', 'public')));

  const ROTATIONS = [0, 90, 180, 270];
  const EXTRA_ROLES = ['lot', 'best_by', 'packed_on', 'allergens', 'net', 'note', 'ingredients'];

  function validateBox(box, what) {
    if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) {
      throw Object.assign(new Error(`invalid layout box for ${what}`), { status: 400 });
    }
  }

  function validateRotation(rotation, what) {
    if (!ROTATIONS.includes(rotation)) {
      throw Object.assign(new Error(`invalid rotation for ${what} — use 0, 90, 180, or 270`), { status: 400 });
    }
  }

  function normalizeDraft(draft) {
    if (!SIZES[draft.size]) throw Object.assign(new Error('unknown size'), { status: 400 });
    const label = {
      size: draft.size,
      fields: {
        name: draft.fields?.name ?? '',
        description: draft.fields?.description ?? '',
        barcode: draft.fields?.barcode ?? '',
      },
      options: {
        showDescription: draft.options?.showDescription ?? defaultShowDescription(draft.size),
      },
      layout: draft.layout ?? defaultLayout(draft.size),
      extras: (Array.isArray(draft.extras) ? draft.extras : []).slice(0, 20).map((extra) => {
        const isImage = extra.kind === 'image';
        const out = {
          id: typeof extra.id === 'string' && extra.id ? extra.id : crypto.randomUUID(),
          text: isImage ? '' : String(extra.text ?? ''),
          box: extra.box,
          rotation: extra.rotation ?? 0,
        };
        if (isImage) {
          // Only a PNG data URL of sane size may be stored; nothing else is drawn.
          if (typeof extra.image !== 'string' || extra.image.length > 400_000
            || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(extra.image)) {
            throw Object.assign(new Error('invalid image field'), { status: 400 });
          }
          out.kind = 'image';
          out.image = extra.image;
        }
        if (extra.fit) out.fit = true;
        if (EXTRA_ROLES.includes(extra.role)) out.role = extra.role;
        if (extra.bold) out.bold = true;
        if (['L', 'C', 'R'].includes(extra.align)) out.align = extra.align;
        const stretch = Number(extra.stretch);
        if (Number.isFinite(stretch) && stretch >= 0.2 && stretch <= 3) out.stretch = stretch;
        const textSize = Number(extra.textSize);
        if (Number.isFinite(textSize) && textSize >= 8 && textSize <= 400) out.textSize = Math.round(textSize);
        return out;
      }),
    };
    if (label.fields.barcode && !validateUpcA(label.fields.barcode)) {
      throw Object.assign(new Error('barcode must be a valid 12-digit UPC-A'), { status: 400 });
    }
    for (const key of ['name', 'description', 'barcode']) {
      const b = label.layout?.[key];
      validateBox(b, key);
      b.rotation = b.rotation ?? 0;
      validateRotation(b.rotation, key);
    }
    for (const extra of label.extras) {
      validateBox(extra.box, 'extra field');
      validateRotation(extra.rotation, 'extra field');
    }
    return label;
  }

  function requirePrinterIp() {
    const ip = config.get().printerIp;
    if (!ip) throw Object.assign(new Error('no printer IP configured — set it in Settings'), { status: 400 });
    return ip;
  }

  const queue = createQueue();
  app.locals.queue = queue;

  // In station mode, jobs wait for the tablet by the printer to relay
  // them over Bluetooth; in network mode they go straight out over TCP.
  async function dispatchToPrinter(zpl, name) {
    if (config.get().connection === 'station') {
      queue.add(zpl, name);
      return { ok: true, queued: true };
    }
    await printer.sendToPrinter(requirePrinterIp(), zpl);
    return { ok: true, queued: false };
  }

  const wrap = (fn) => (req, res) => {
    Promise.resolve().then(() => fn(req, res)).catch((err) => {
      const status = err.status ?? (/reach printer/i.test(err.message) ? 502 : 500);
      res.status(status).json({ error: err.message });
    });
  };

  // --- labels ---
  app.get('/api/labels', wrap((req, res) => res.json(store.list())));

  app.post('/api/labels', wrap((req, res) => {
    const label = normalizeDraft(req.body);
    if (!label.fields.barcode) {
      label.fields.barcode = generateUpcA((c) => store.barcodeExists(c));
    }
    try {
      res.json(store.create(label));
    } catch (err) {
      throw Object.assign(err, { status: 400 });
    }
  }));

  // A finished printer file becomes a "file" label: printed as-is, never edited.
  app.post('/api/labels/prn', express.raw({ type: () => true, limit: '20mb' }), wrap((req, res) => {
    const { name, size, zpl } = parsePrn(req.body, req.query.name);
    res.json(store.create({ kind: 'prn', size, fields: { name, barcode: '' }, zpl }));
  }));

  app.post('/api/labels/:id/print', wrap(async (req, res) => {
    const label = store.get(req.params.id);
    if (!label) return res.status(404).json({ error: 'not found' });
    if (label.kind !== 'prn') {
      throw Object.assign(new Error('only printer-file labels print by id'), { status: 400 });
    }
    res.json(await dispatchToPrinter(withQuantity(label.zpl, req.body?.quantity), label.fields.name));
  }));

  function requireFileLabel(id) {
    const label = store.get(id);
    if (!label) throw Object.assign(new Error('not found'), { status: 404 });
    if (label.kind !== 'prn') throw Object.assign(new Error('not a printer-file label'), { status: 400 });
    return label;
  }

  const cleanName = (body, fallback) =>
    (typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : fallback);

  app.get('/api/labels/:id/fields', wrap((req, res) => {
    const label = requireFileLabel(req.params.id);
    res.json({ fields: parseFields(label.zpl), inches: labelInches(label.zpl) });
  }));

  app.put('/api/labels/:id/fields', wrap((req, res) => {
    const label = requireFileLabel(req.params.id);
    const zpl = applyFields(label.zpl, Array.isArray(req.body?.fields) ? req.body.fields : []);
    res.json(store.update(label.id, { zpl, fields: { ...label.fields, name: cleanName(req.body, label.fields.name) } }));
  }));

  app.put('/api/labels/:id/zpl', wrap((req, res) => {
    const label = requireFileLabel(req.params.id);
    const { zpl, size } = parsePrn(String(req.body?.zpl ?? ''), label.fields.name);
    res.json(store.update(label.id, { zpl, size, fields: { ...label.fields, name: cleanName(req.body, label.fields.name) } }));
  }));

  // Converting a printer file yields a normal label that opens in the editor.
  async function convertOne(label, remove) {
    const { draft, warnings } = await convertFileLabel(label, {
      generateBarcode: () => generateUpcA((c) => store.barcodeExists(c, label.id)),
    });
    // Real product codes may be shared by several labels (sale variants etc.).
    const created = store.create(normalizeDraft(draft), { allowDuplicateBarcode: true });
    if (remove) store.remove(label.id);
    return { label: created, warnings };
  }

  app.post('/api/labels/convert-all', wrap(async (req, res) => {
    const converted = [];
    const failed = [];
    for (const label of store.list().filter((l) => l.kind === 'prn')) {
      try {
        const { label: created, warnings } = await convertOne(label, true);
        converted.push({ id: created.id, name: created.fields.name, warnings });
      } catch (err) {
        failed.push({ id: label.id, name: label.fields.name, error: err.message });
      }
    }
    res.json({ converted, failed });
  }));

  app.post('/api/labels/:id/convert', wrap(async (req, res) => {
    const label = requireFileLabel(req.params.id);
    res.json(await convertOne(label, Boolean(req.body?.remove)));
  }));

  // Preview of a raw ZPL job, sized from the file itself or the loaded roll.
  app.post('/api/preview-zpl', wrap(async (req, res) => {
    const zpl = String(req.body?.zpl ?? '');
    let inches = labelInches(zpl);
    if (!inches) {
      const dims = SIZES[config.get().loadedSize] ?? SIZES['3x5'];
      const inch = (d) => Math.round((d / 203) * 100) / 100;
      inches = { w: inch(Math.min(dims.width, dims.height)), h: inch(Math.max(dims.width, dims.height)) };
    }
    try {
      res.type('image/png').send(await zplRenderer({ zpl, w: inches.w, h: inches.h }));
    } catch (err) {
      throw Object.assign(new Error(`preview unavailable: ${err.message}`), { status: 502 });
    }
  }));

  app.get('/api/labels/:id', wrap((req, res) => {
    const label = store.get(req.params.id);
    if (!label) return res.status(404).json({ error: 'not found' });
    res.json(label);
  }));

  app.put('/api/labels/:id', wrap((req, res) => {
    if (!store.get(req.params.id)) return res.status(404).json({ error: 'not found' });
    const label = normalizeDraft(req.body);
    try {
      res.json(store.update(req.params.id, label));
    } catch (err) {
      throw Object.assign(err, { status: 400 });
    }
  }));

  app.delete('/api/labels/:id', wrap((req, res) => {
    if (!store.get(req.params.id)) return res.status(404).json({ error: 'not found' });
    store.remove(req.params.id);
    res.json({ ok: true });
  }));

  // --- barcode / preview / print ---
  app.get('/api/barcode/new', wrap((req, res) => {
    res.json({ barcode: generateUpcA((c) => store.barcodeExists(c)) });
  }));

  app.post('/api/preview', wrap(async (req, res) => {
    const label = normalizeDraft(req.body);
    res.type('image/png').send(await renderPreview(label));
  }));

  app.post('/api/print', wrap(async (req, res) => {
    const label = normalizeDraft(req.body.label ?? {});
    const quantity = Math.min(Math.max(parseInt(req.body.quantity, 10) || 1, 1), 100);
    // The barcode stays a native ZPL field only when nothing rotates it;
    // otherwise it is drawn into the bitmap at exact dot resolution.
    const rotation = printRotation(label.size);
    const nativeBarcode = rotation === 0 && (label.layout.barcode.rotation ?? 0) === 0;
    let bitmap = await renderPrintBitmap(label, { includeBarcode: !nativeBarcode });
    if (rotation === 90) bitmap = rotateBitmap90CW(bitmap);
    const zpl = buildLabelZpl({
      width: bitmap.width,
      height: bitmap.height,
      bitmap,
      barcode: nativeBarcode ? label.fields.barcode : '',
      barcodeBox: nativeBarcode ? label.layout.barcode : null,
      quantity,
      darkness: config.get().darkness,
    });
    res.json(await dispatchToPrinter(zpl, label.fields.name || 'Label'));
  }));

  app.post('/api/print-raw', express.raw({ type: () => true, limit: '20mb' }), wrap(async (req, res) => {
    res.json(await dispatchToPrinter(req.body, 'Raw .prn file'));
  }));

  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  function requireApiKey() {
    const apiKey = config.get().apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw Object.assign(new Error('no API key configured — add one in Settings'), { status: 400 });
  }

  app.post(AI_LABEL_PATH, express.json({ limit: '30mb' }), wrap(async (req, res) => {
    requireApiKey();
    const { size, image } = req.body ?? {};
    const text = String(req.body?.text ?? '').trim();
    if (!SIZES[size]) throw Object.assign(new Error('unknown size'), { status: 400 });
    if (!text && !image) {
      throw Object.assign(new Error('describe the product or add a photo first'), { status: 400 });
    }
    if (image && (!IMAGE_TYPES.includes(image.mediaType) || typeof image.data !== 'string' || !image.data)) {
      throw Object.assign(new Error('unsupported image type — use a JPEG or PNG photo'), { status: 415 });
    }
    const make = aiLabelOverride
      ?? ((input) => makeLabelContent(input, makeClient(config.get().apiKey), { examples: houseExamples(store.list()) }));
    let content;
    try {
      content = await make({ size, text, image: image ?? null });
    } catch (err) {
      throw Object.assign(err, { status: 502 });
    }
    const draft = normalizeDraft(layoutDraft({ size, content }));
    draft.fields.barcode = generateUpcA((c) => store.barcodeExists(c));
    res.json({ ...draft, warnings: content.warning ? [content.warning] : [] });
  }));

  // --- settings ---
  app.get('/api/settings', wrap((req, res) => {
    const { apiKey, ...rest } = config.get();
    res.json({ ...rest, apiKeySet: Boolean(apiKey || process.env.ANTHROPIC_API_KEY) });
  }));

  app.put('/api/settings', wrap((req, res) => {
    const { apiKey, ...rest } = config.update(req.body ?? {});
    res.json({ ...rest, apiKeySet: Boolean(apiKey || process.env.ANTHROPIC_API_KEY) });
  }));

  app.post('/api/settings/discover', wrap(async (req, res) => {
    res.json({ printers: await printer.discoverPrinters() });
  }));

  app.post('/api/settings/test-print', wrap(async (req, res) => {
    res.json(await dispatchToPrinter(buildTestZpl(), 'Test print'));
  }));

  app.post('/api/settings/calibrate', wrap(async (req, res) => {
    const mediaType = req.body?.mediaType;
    let zpl;
    try {
      zpl = buildCalibrationZpl(mediaType);
    } catch (err) {
      throw Object.assign(err, { status: 400 });
    }
    config.update({ mediaType });
    res.json(await dispatchToPrinter(zpl, 'Calibration'));
  }));

  app.post('/api/settings/zpl-mode', wrap(async (req, res) => {
    res.json(await dispatchToPrinter(setZplModeCommand(), 'Set ZPL mode'));
  }));

  // --- print station (the tablet by the printer) ---
  let stationLastSeen = 0;
  app.post('/api/station/next', wrap((req, res) => {
    stationLastSeen = Date.now();
    const job = queue.next();
    if (!job) return res.status(204).end();
    res.json(job);
  }));

  app.post('/api/station/:id/done', wrap((req, res) => {
    if (!queue.complete(req.params.id)) return res.status(404).json({ error: 'unknown job' });
    res.json({ ok: true });
  }));

  app.post('/api/station/:id/failed', wrap((req, res) => {
    if (!queue.fail(req.params.id, req.body?.error)) return res.status(404).json({ error: 'unknown job' });
    res.json({ ok: true });
  }));

  app.get('/api/station/status', wrap((req, res) => {
    res.json({
      ...queue.status(),
      stationSeenSecondsAgo: stationLastSeen
        ? Math.round((Date.now() - stationLastSeen) / 1000)
        : null,
    });
  }));

  return app;
}
