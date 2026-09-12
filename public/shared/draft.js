// Turns whatever a client sends into a label the drawing code can trust.
// Runs on the server (every write route) and on the tablet (local backend),
// so the two can never accept different shapes. No Node imports.
import { SIZES } from './sizes.js';
import { defaultLayout, defaultShowDescription } from './layout.js';
import { validateUpcA } from './barcode.js';

const ROTATIONS = [0, 90, 180, 270];
const EXTRA_ROLES = ['lot', 'best_by', 'packed_on', 'allergens', 'net', 'note', 'ingredients'];

const bad = (message) => Object.assign(new Error(message), { status: 400 });

function validateBox(box, what) {
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) {
    throw bad(`invalid layout box for ${what}`);
  }
}

function validateRotation(rotation, what) {
  if (!ROTATIONS.includes(rotation)) {
    throw bad(`invalid rotation for ${what} — use 0, 90, 180, or 270`);
  }
}

export function clampQuantity(quantity) {
  return Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 100);
}

export function normalizeDraft(draft) {
  if (!draft || !SIZES[draft.size]) throw bad('unknown size');
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
    extras: (Array.isArray(draft.extras) ? draft.extras : []).slice(0, 20).map((extra) => {
      const isImage = extra.kind === 'image';
      const out = {
        id: typeof extra.id === 'string' && extra.id ? extra.id : globalThis.crypto.randomUUID(),
        text: isImage ? '' : String(extra.text ?? ''),
        box: extra.box,
        rotation: extra.rotation ?? 0,
      };
      if (isImage) {
        // Only a PNG data URL of sane size may be stored; nothing else is drawn.
        if (typeof extra.image !== 'string' || extra.image.length > 400_000
          || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(extra.image)) {
          throw bad('invalid image field');
        }
        out.kind = 'image';
        out.image = extra.image;
      }
      if (extra.fit) out.fit = true;
      if (EXTRA_ROLES.includes(extra.role)) out.role = extra.role;
      if (extra.bold) out.bold = true;
      if (['L', 'C', 'R'].includes(extra.align)) out.align = extra.align;
      const stretch = Number(extra.stretch);
      if (Number.isFinite(stretch) && stretch >= 0.2 && stretch <= 3) out.stretch = stretch;
      const textSize = Number(extra.textSize);
      if (Number.isFinite(textSize) && textSize >= 8 && textSize <= 400) out.textSize = Math.round(textSize);
      return out;
    }),
  };
  if (label.fields.barcode && !validateUpcA(label.fields.barcode)) {
    throw bad('barcode must be a valid 12-digit UPC-A');
  }
  for (const key of ['name', 'description', 'barcode']) {
    const b = label.layout?.[key];
    validateBox(b, key);
    b.rotation = b.rotation ?? 0;
    validateRotation(b.rotation, key);
    const textSize = Number(b.textSize);
    if (key !== 'barcode' && Number.isFinite(textSize) && textSize >= 8 && textSize <= 400) b.textSize = Math.round(textSize);
    else delete b.textSize;
  }
  for (const extra of label.extras) {
    validateBox(extra.box, 'extra field');
    validateRotation(extra.rotation, 'extra field');
  }
  return label;
}
