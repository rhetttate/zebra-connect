import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalConfig, DEFAULTS } from '../public/local-config.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
}

test('defaults match the server minus printerIp and connection', () => {
  const cfg = createLocalConfig(memoryStorage());
  assert.deepEqual(cfg.get(), { darkness: 15, apiKey: '', mediaType: 'gap', loadedSize: '3x5' });
  assert.deepEqual(Object.keys(DEFAULTS).sort(), ['apiKey', 'darkness', 'loadedSize', 'mediaType']);
});

test('update persists only known keys and survives a reload', () => {
  const storage = memoryStorage();
  const cfg = createLocalConfig(storage);
  cfg.update({ darkness: 22, printerIp: '1.2.3.4', apiKey: 'sk-x' });
  assert.equal(cfg.get().darkness, 22);
  assert.equal(cfg.get().printerIp, undefined);
  const again = createLocalConfig(storage);
  assert.equal(again.get().apiKey, 'sk-x');
});

test('a corrupt stored value falls back to defaults', () => {
  const storage = memoryStorage();
  storage.setItem('zc-settings', '{not json');
  assert.equal(createLocalConfig(storage).get().darkness, 15);
});
