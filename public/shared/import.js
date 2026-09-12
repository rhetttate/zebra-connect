// Shape check for a labels backup file before it is merged into a store.
// Returns the same array; throws a plain-English reason otherwise.
import { SIZES } from './sizes.js';

export function validateImport(json) {
  if (!Array.isArray(json)) throw new Error('this file is not a list of labels');
  json.forEach((l, i) => {
    const at = `label ${i + 1}`;
    if (!l || typeof l !== 'object') throw new Error(`${at} is not an object`);
    if (typeof l.id !== 'string' || !l.id) throw new Error(`${at} has no id`);
    if (!l.fields || typeof l.fields !== 'object') throw new Error(`${at} has no fields`);
    if (l.kind === 'prn') {
      if (typeof l.zpl !== 'string') throw new Error(`${at} is a printer file without ZPL`);
      if (l.size !== null && l.size !== undefined && !SIZES[l.size]) throw new Error(`${at} has an unknown size`);
      return;
    }
    if (!SIZES[l.size]) throw new Error(`${at} has an unknown size`);
    if (!l.layout || typeof l.layout !== 'object') throw new Error(`${at} has no layout`);
  });
  return json;
}
