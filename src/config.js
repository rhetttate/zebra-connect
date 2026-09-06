import fs from 'node:fs';
import path from 'node:path';

const DEFAULTS = { printerIp: '', darkness: 15, apiKey: '', mediaType: 'gap', loadedSize: '3x5' };

export function createConfig(filePath) {
  let settings = { ...DEFAULTS };
  if (fs.existsSync(filePath)) {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    for (const key of Object.keys(DEFAULTS)) {
      if (key in saved) settings[key] = saved[key];
    }
  }
  return {
    get: () => ({ ...settings }),
    update(patch) {
      for (const key of Object.keys(DEFAULTS)) {
        if (key in patch) settings[key] = patch[key];
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(settings, null, 2));
      fs.renameSync(tmp, filePath);
      return { ...settings };
    },
  };
}
