// Prompt, schema and reply handling for the AI label maker. The server (SDK)
// and the tablet (fetch) both use this; only the transport differs.
import { ROLE_ORDER } from './ai-layout.js';

export const MODEL = 'claude-opus-5';

export const CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    ingredients: { type: 'string' },
    extras: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ROLE_ORDER },
          text: { type: 'string' },
        },
        required: ['role', 'text'],
        additionalProperties: false,
      },
    },
    warning: { type: 'string' },
  },
  required: ['name', 'description', 'ingredients', 'extras', 'warning'],
  additionalProperties: false,
};

const SIZE_WORDS = {
  '3x5': '5 × 3 inch, landscape — room for a description line, several extras, and the full ingredient list',
  '3x2': '3 × 2 inch — room for the name, one or two short extras, and a barcode',
  '2x1.25': '2 × 1.25 inch — room for the name, one short extra, and a barcode',
};

const RULES = `You write the content for food inventory labels at a small store. The labels print on a thermal label printer, so every value must be short, literal, and plain text.

Reply with a JSON object of exactly this shape:
{"name": string, "description": string, "ingredients": string, "extras": [{"role": string, "text": string}], "warning": string}

Field rules:
- name: the product name, 2 to 5 words, Title Case, no slogans or marketing words. Include the variety when it matters ("Almond Flour", "Whole Milk Yogurt"). Required.
- description: one short sentence about what it is (brand, variety, or form), or "" when the input gives nothing beyond the name.
- ingredients: the ingredient list exactly as the input gives it, complete and in the same order, comma separated, without the word "Ingredients" in front. "" when the input has no ingredient list. Never guess ingredients; if only part of a list is legible, include what you can read and say so in warning.
- extras: zero or more items with these roles, at most one per role except note (at most two). Skip any role the input does not support.
  - lot: "Lot 42"
  - best_by: "Best by Oct 15, 2026"
  - packed_on: "Packed Sep 8, 2026"
  - allergens: "Contains: tree nuts, wheat" — only allergens the input states; a "may contain" line becomes "May contain: ..."
  - net: "Net wt 2 lb (907 g)" or "12 ct" — units as the input gives them; add the metric value only if the input shows it
  - note: any other short instruction worth printing, such as "Keep refrigerated" or "Organic". Under 40 characters each.
- warning: "" normally. One short sentence for the user when the photo is unreadable, the input contradicts itself, or you had to leave something out.

Write dates as "Mon D, YYYY". Resolve relative dates ("packed today", "best by end of month") against today's date.

Never invent details: everything you output must come from the input. If a photo is illegible, still return the best name you can and explain in warning.`;

export function buildPrompt({ size, text = '', image = null, today, examples = [] }) {
  const date = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  let system = `${RULES}\n\nToday is ${date}.\n\nThe label is ${SIZE_WORDS[size] ?? size}. Return ingredients even for the small sizes; the app decides what fits.`;
  const lines = examples
    .filter((e) => e?.name && e?.description)
    .map((e) => `- ${e.name} — ${e.description}`);
  if (lines.length) {
    system += `\n\nExamples of how this store names and describes products:\n${lines.join('\n')}`;
  }

  const content = [];
  if (image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  }
  const trimmed = String(text ?? '').trim();
  let ask;
  if (trimmed && image) ask = `Make the label from the photo and these notes (the notes win where they disagree):\n${trimmed}`;
  else if (trimmed) ask = `Make the label from this:\n${trimmed}`;
  else ask = 'Read the photo and make the label.';
  content.push({ type: 'text', text: ask });

  return { system, messages: [{ role: 'user', content }] };
}

const NOTE_LIMIT = 2;

// The model is told to be terse, but nothing stops it writing an essay; cap
// every field at a length the label engine can still lay out.
const clip = (value, limit) => String(value ?? '').slice(0, limit).trim();

export function parseContent(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('could not parse label content');
  const name = clip(raw.name, 60);
  if (!name) throw new Error('could not parse label content');
  const seen = {};
  const extras = [];
  for (const item of Array.isArray(raw.extras) ? raw.extras : []) {
    if (!item || typeof item !== 'object') continue;
    const role = item.role;
    const text = clip(item.text, 120);
    if (!ROLE_ORDER.includes(role) || !text) continue;
    seen[role] = (seen[role] ?? 0) + 1;
    if (seen[role] > (role === 'note' ? NOTE_LIMIT : 1)) continue;
    extras.push({ role, text });
  }
  return {
    name,
    description: clip(raw.description, 160),
    ingredients: clip(raw.ingredients, 600),
    extras,
    warning: String(raw.warning ?? '').trim(),
  };
}

// The API's structured output normally gives bare JSON; the regex is only a
// net for a reply wrapped in prose or a code fence.
export function contentFromResponse(response) {
  if (response?.stop_reason === 'refusal') throw new Error('label maker refused this input');
  const textOut = (response?.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let parsed;
  try {
    parsed = JSON.parse(textOut);
  } catch {
    const match = textOut.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('could not parse label content');
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      throw new Error('could not parse label content');
    }
  }
  return parseContent(parsed);
}

// The most recent hand-written labels show the model the store's naming style.
export function houseExamples(labels, limit = 5) {
  return labels
    .filter((l) => l.kind !== 'prn' && l.fields?.name && l.fields?.description)
    .slice(0, limit)
    .map((l) => ({ name: l.fields.name, description: l.fields.description }));
}
