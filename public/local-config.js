// Tablet settings in localStorage. Same keys and defaults as src/config.js,
// except that the printer is always the Bluetooth link, so there is no
// printerIp and no connection mode.
export const DEFAULTS = { darkness: 15, apiKey: '', mediaType: 'gap', loadedSize: '3x5' };
const KEY = 'zc-settings';

export function createLocalConfig(storage) {
  let settings = { ...DEFAULTS };
  try {
    const saved = JSON.parse(storage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      for (const key of Object.keys(DEFAULTS)) {
        if (key in saved) settings[key] = saved[key];
      }
    }
  } catch { /* unreadable — defaults stand */ }
  return {
    get: () => ({ ...settings }),
    update(patch) {
      for (const key of Object.keys(DEFAULTS)) {
        if (key in patch) settings[key] = patch[key];
      }
      try { storage.setItem(KEY, JSON.stringify(settings)); } catch { /* storage full or blocked */ }
      return { ...settings };
    },
  };
}
