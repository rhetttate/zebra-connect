import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createConfig } from '../src/config.js';

function tmpConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zc-config-'));
  const file = path.join(dir, 'config.json');
  return { config: createConfig(file), file };
}

test('get returns defaults when no file exists', () => {
  const { config } = tmpConfig();
  assert.deepEqual(config.get(), { printerIp: '', darkness: 15, apiKey: '', mediaType: 'gap' });
});

test('update merges, persists, and ignores unknown keys', () => {
  const { config, file } = tmpConfig();
  const out = config.update({ printerIp: '192.168.1.50', bogus: 'x' });
  assert.equal(out.printerIp, '192.168.1.50');
  assert.equal(out.darkness, 15);
  assert.equal('bogus' in out, false);
  const reloaded = createConfig(file);
  assert.equal(reloaded.get().printerIp, '192.168.1.50');
});

test('mediaType defaults to gap and persists', () => {
  const { config } = tmpConfig();
  assert.equal(config.get().mediaType, 'gap');
  assert.equal(config.update({ mediaType: 'mark' }).mediaType, 'mark');
});
