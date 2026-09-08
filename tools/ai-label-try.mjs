#!/usr/bin/env node
// Run real inputs through the AI label maker and look at the result.
//   node tools/ai-label-try.mjs <size> [--text "..."] [--photo file.jpg] [--out dir]
// Writes <out>/<n>.json (the model's content + the draft) and <out>/<n>.png
// (the rendered label). Uses the API key from data/config.json or the
// ANTHROPIC_API_KEY environment variable. Default out dir: ai-label-out/.
import fs from 'node:fs';
import path from 'node:path';
import { makeLabelContent, makeClient, houseExamples } from '../src/ai-label.js';
import { layoutDraft } from '../src/ai-layout.js';
import { renderPreview } from '../src/render.js';
import { generateUpcA } from '../src/barcode.js';
import { createStore } from '../src/store.js';
import { createConfig } from '../src/config.js';

const args = process.argv.slice(2);
const size = args[0];
const opt = (flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
const text = opt('--text') ?? '';
const photo = opt('--photo');
const out = opt('--out') ?? 'ai-label-out';
if (!size || (!text && !photo)) {
  console.error('usage: node tools/ai-label-try.mjs <3x5|3x2|2x1.25> [--text "..."] [--photo file] [--out dir]');
  process.exit(2);
}

const MEDIA = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
let image = null;
if (photo) {
  const mediaType = MEDIA[path.extname(photo).toLowerCase()];
  if (!mediaType) { console.error('photo must be .jpg, .png or .webp'); process.exit(2); }
  image = { mediaType, data: fs.readFileSync(photo).toString('base64') };
}

const dataDir = path.join(process.cwd(), 'data');
const config = createConfig(path.join(dataDir, 'config.json'));
const store = createStore(path.join(dataDir, 'labels.json'));
const examples = houseExamples(store.list());

const started = Date.now();
const content = await makeLabelContent({ size, text, image }, makeClient(config.get().apiKey), { examples });
const draft = layoutDraft({ size, content });
draft.fields.barcode = generateUpcA(() => false);
const png = await renderPreview({ ...draft, options: draft.options, layout: draft.layout });

fs.mkdirSync(out, { recursive: true });
const n = fs.readdirSync(out).filter((f) => f.endsWith('.png')).length + 1;
fs.writeFileSync(path.join(out, `${n}.json`), JSON.stringify({ input: { size, text, photo }, content, draft }, null, 2));
fs.writeFileSync(path.join(out, `${n}.png`), png);
console.log(JSON.stringify(content, null, 2));
console.log(`wrote ${out}/${n}.png in ${((Date.now() - started) / 1000).toFixed(1)}s`);
