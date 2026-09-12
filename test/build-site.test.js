import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSite } from '../tools/build-site.mjs';

test('buildSite copies public, injects the local flag and worker, and fills the precache list', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-site-'));
  const { files, version } = buildSite({ out, version: 'abc1234' });
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.ok(index.indexOf("window.ZC_BACKEND='local'") < index.indexOf('src="app.js"'), 'flag precedes the app');
  assert.ok(index.includes('<script src="sw-register.js"></script>'));
  const sw = fs.readFileSync(path.join(out, 'sw.js'), 'utf8');
  assert.ok(!sw.includes('__VERSION__') && !sw.includes('__PRECACHE__'));
  assert.ok(sw.includes("'zc-abc1234'"));
  assert.equal(fs.readFileSync(path.join(out, 'version.txt'), 'utf8').trim(), 'abc1234');
  assert.equal(version, 'abc1234');
  for (const f of ['app.js', 'shared/render-core.js', 'fonts/Arimo-Regular.ttf', 'icon-192.png', 'style.css', 'manifest.webmanifest']) {
    assert.ok(fs.existsSync(path.join(out, f)), `${f} copied`);
    assert.ok(files.includes(`./${f}`), `${f} precached`);
  }
  assert.ok(!files.includes('./sw.js'), 'the worker never caches itself');
  const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  assert.deepEqual(precache, files);
});
