import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.js';
import { createConfig } from './config.js';
import { SIZES, defaultLayout, defaultShowDescription } from './layout.js';
import { generateUpcA, validateUpcA } from './barcode.js';
import { renderPreview, renderPrintBitmap } from './render.js';
import { buildLabelZpl, buildTestZpl, setZplModeCommand } from './zpl.js';
import * as printerLib from './printer.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ dataDir, printerOverrides = {} }) {
  const store = createStore(path.join(dataDir, 'labels.json'));
  const config = createConfig(path.join(dataDir, 'config.json'));
  const printer = { ...printerLib, ...printerOverrides };
  const app = express();
  app.locals.store = store;
  app.locals.config = config;

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(here, '..', 'public')));

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
    };
    if (label.fields.barcode && !validateUpcA(label.fields.barcode)) {
      throw Object.assign(new Error('barcode must be a valid 12-digit UPC-A'), { status: 400 });
    }
    return label;
  }

  function requirePrinterIp() {
    const ip = config.get().printerIp;
    if (!ip) throw Object.assign(new Error('no printer IP configured — set it in Settings'), { status: 400 });
    return ip;
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
    const ip = requirePrinterIp();
    const label = normalizeDraft(req.body.label ?? {});
    const quantity = Math.min(Math.max(parseInt(req.body.quantity, 10) || 1, 1), 100);
    const bitmap = await renderPrintBitmap(label);
    const zpl = buildLabelZpl({
      width: bitmap.width,
      height: bitmap.height,
      bitmap,
      barcode: label.fields.barcode,
      barcodeBox: label.layout.barcode,
      quantity,
      darkness: config.get().darkness,
    });
    await printer.sendToPrinter(ip, zpl);
    res.json({ ok: true });
  }));

  app.post('/api/print-raw', express.raw({ type: () => true, limit: '20mb' }), wrap(async (req, res) => {
    const ip = requirePrinterIp();
    await printer.sendToPrinter(ip, req.body);
    res.json({ ok: true });
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
    await printer.sendToPrinter(requirePrinterIp(), buildTestZpl());
    res.json({ ok: true });
  }));

  app.post('/api/settings/zpl-mode', wrap(async (req, res) => {
    await printer.sendToPrinter(requirePrinterIp(), setZplModeCommand());
    res.json({ ok: true });
  }));

  return app;
}
