#!/usr/bin/env node
// Assembles the static site (the tablet's app) from public/:
//   node tools/build-site.mjs [outDir=site]
// index.html gets the local-backend flag and the service-worker registration;
// sw.js gets the version stamp and the list of files to cache.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', 'public');

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

function gitVersion() {
  try { return execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return String(Date.now()); }
}

export function buildSite({ root = ROOT, out = path.join(here, '..', 'site'), version = gitVersion() } = {}) {
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(root, out, { recursive: true });

  const indexPath = path.join(out, 'index.html');
  let index = fs.readFileSync(indexPath, 'utf8');
  index = index.replace(
    '<script type="module" src="app.js"></script>',
    "<script>window.ZC_BACKEND='local'</script>\n<script type=\"module\" src=\"app.js\"></script>\n<script src=\"sw-register.js\"></script>",
  );
  if (!index.includes("ZC_BACKEND='local'")) throw new Error('index.html: module script tag not found');
  fs.writeFileSync(indexPath, index);
  fs.writeFileSync(path.join(out, 'version.txt'), `${version}\n`);

  const files = walk(out).filter((f) => f !== 'sw.js').map((f) => `./${f}`);
  const swPath = path.join(out, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8')
    .replace('__VERSION__', version)
    .replace('__PRECACHE__', JSON.stringify(files, null, 2));
  fs.writeFileSync(swPath, sw);
  return { files, version };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const { files, version } = buildSite({ out });
  console.log(`site built (${files.length} files, version ${version})`);
}
