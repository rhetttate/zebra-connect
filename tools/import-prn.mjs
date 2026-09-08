#!/usr/bin/env node
// Push every .prn file in a folder into the label library as "file" labels.
//   node tools/import-prn.mjs <folder> [server=http://127.0.0.1:3000]
// Files whose name already exists as a file label are skipped, so re-running is safe.
import fs from 'node:fs';
import path from 'node:path';

const [folder, server = 'http://127.0.0.1:3000'] = process.argv.slice(2);
if (!folder) {
  console.error('usage: node tools/import-prn.mjs <folder> [server]');
  process.exit(2);
}

const existing = new Set(
  (await (await fetch(`${server}/api/labels`)).json())
    .filter((l) => l.kind === 'prn')
    .map((l) => l.fields.name.toLowerCase()),
);

const files = fs.readdirSync(folder).filter((f) => /\.prn$/i.test(f)).sort();
let added = 0; let skipped = 0; let failed = 0;
for (const file of files) {
  const name = path.basename(file, path.extname(file));
  if (existing.has(name.toLowerCase())) { skipped++; continue; }
  const res = await fetch(`${server}/api/labels/prn?name=${encodeURIComponent(file)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: fs.readFileSync(path.join(folder, file)),
  });
  if (res.ok) {
    const label = await res.json();
    console.log(`added   ${name}  (${label.size ?? 'size unknown'})`);
    added++;
  } else {
    console.log(`FAILED  ${name}: ${(await res.json().catch(() => ({}))).error ?? res.status}`);
    failed++;
  }
}
console.log(`\n${added} added, ${skipped} already present, ${failed} failed`);
process.exit(failed ? 1 : 0);
