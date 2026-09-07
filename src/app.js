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
import { extractLabelFields, makeClient } from './extract.js';
import { createQueue } from './queue.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ dataDir, printerOverrides = {}, extractOverride }) {
  const store = createStore(path.join(dataDir, 'labels.json'));
  const config = createConfig(path.join(dataDir, 'config.json'));
  const printer = { ...printerLib, ...printerOverrides };
  const app = express();
  app.locals.store = store;
  app.locals.config = config;

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(here, '..', 'public')));

  const ROTATIONS = [0, 90, 180, 270];

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
      extras: (Array.isArray(draft.extras) ? draft.extras : []).slice(0, 20).map((extra) => ({
        id: typeof extra.id === 'string' && extra.id ? extra.id : crypto.randomUUID(),
        text: String(extra.text ?? ''),
        box: extra.box,
        rotation: extra.rotation ?? 0,
      })),
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
  app.post('/api/extract', express.raw({ type: IMAGE_TYPES, limit: '20mb' }), wrap(async (req, res) => {
    const apiKey = config.get().apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error('no API key configured — add one in Settings'), { status: 400 });
    }
    const mediaType = req.headers['content-type'];
    if (!Buffer.isBuffer(req.body) || !IMAGE_TYPES.includes(mediaType)) {
      throw Object.assign(new Error('unsupported image type — use a JPEG or PNG photo'), { status: 415 });
    }
    const extract = extractOverride
      ?? ((buf, type) => extractLabelFields(buf, type, makeClient(config.get().apiKey)));
    try {
      res.json(await extract(req.body, mediaType));
    } catch (err) {
      throw Object.assign(err, { status: 502 });
    }
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
  app.post('/api/station/next', wrap((req, res) => {
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
    res.json(queue.status());
  }));

  return app;
}
