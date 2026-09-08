import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, parseContent, makeLabelContent, CONTENT_SCHEMA, MODEL } from '../src/ai-label.js';

const today = new Date(2026, 8, 8); // Sep 8, 2026 (local time)

function stubClient(response) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (params) => { calls.push(params); return response; } } },
  };
}

const good = JSON.stringify({
  name: 'Almond Flour',
  description: 'Blanched, finely ground.',
  ingredients: 'Blanched almonds.',
  extras: [{ role: 'lot', text: 'Lot 42' }, { role: 'best_by', text: 'Best by Oct 15, 2026' }],
  warning: '',
});

test('buildPrompt puts the rules, today, the size, and examples in the system prompt', () => {
  const { system, messages } = buildPrompt({
    size: '3x5', text: 'almond flour lot 42', image: null, today,
    examples: [{ name: 'Olive Oil', description: 'Extra virgin, cold pressed' }],
  });
  assert.match(system, /Today is Sep 8, 2026/);
  assert.match(system, /5 × 3 inch/);
  assert.match(system, /"lot"|lot:/);
  assert.match(system, /Olive Oil — Extra virgin, cold pressed/);
  assert.ok(system.indexOf('Olive Oil') > system.indexOf('Today is'), 'examples come last so the fixed prefix caches');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.deepEqual(messages[0].content.map((b) => b.type), ['text']);
  assert.match(messages[0].content[0].text, /almond flour lot 42/);
});

test('buildPrompt sends the photo before the text, and works with a photo alone', () => {
  const image = { mediaType: 'image/jpeg', data: 'AAAA' };
  const both = buildPrompt({ size: '3x2', text: 'lot 9', image, today, examples: [] });
  assert.deepEqual(both.messages[0].content.map((b) => b.type), ['image', 'text']);
  assert.deepEqual(both.messages[0].content[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' });
  assert.match(both.messages[0].content[1].text, /lot 9/);
  assert.match(both.messages[0].content[1].text, /photo/i);

  const alone = buildPrompt({ size: '3x2', text: '', image, today, examples: [] });
  assert.deepEqual(alone.messages[0].content.map((b) => b.type), ['image', 'text']);
  assert.match(alone.messages[0].content[1].text, /photo/i);
});

test('parseContent validates roles, dedupes, caps notes, and fills gaps', () => {
  const out = parseContent({
    name: '  Salt ',
    extras: [
      { role: 'note', text: 'A' }, { role: 'note', text: 'B' }, { role: 'note', text: 'C' },
      { role: 'lot', text: 'Lot 1' }, { role: 'lot', text: 'Lot 2' },
      { role: 'bogus', text: 'x' }, { role: 'net', text: '   ' }, 'junk',
    ],
  });
  assert.equal(out.name, 'Salt');
  assert.equal(out.description, '');
  assert.equal(out.ingredients, '');
  assert.equal(out.warning, '');
  assert.deepEqual(out.extras, [
    { role: 'note', text: 'A' }, { role: 'note', text: 'B' }, { role: 'lot', text: 'Lot 1' },
  ]);
});

test('parseContent rejects a reply without a name', () => {
  assert.throws(() => parseContent({ name: '', extras: [] }), /could not parse/);
  assert.throws(() => parseContent(null), /could not parse/);
});

test('makeLabelContent calls the model with structured output and parses the reply', async () => {
  const client = stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: good }] });
  const out = await makeLabelContent(
    { size: '3x5', text: 'almond flour lot 42', image: { mediaType: 'image/png', data: 'BBBB' } },
    client, { today, examples: [] },
  );
  assert.equal(out.name, 'Almond Flour');
  assert.equal(out.ingredients, 'Blanched almonds.');
  assert.deepEqual(out.extras.map((e) => e.role), ['lot', 'best_by']);

  const params = client.calls[0];
  assert.equal(params.model, MODEL);
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.output_config.format, { type: 'json_schema', schema: CONTENT_SCHEMA });
  assert.equal(params.messages[0].content[0].type, 'image');
  assert.equal(params.messages[0].content[0].source.media_type, 'image/png');
});

test('makeLabelContent tolerates prose or fences around the JSON', async () => {
  const client = stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n' + good + '\n```' }] });
  const out = await makeLabelContent({ size: '3x5', text: 'x', image: null }, client, { today });
  assert.equal(out.name, 'Almond Flour');
});

test('makeLabelContent throws on refusal and on garbage', async () => {
  await assert.rejects(
    makeLabelContent({ size: '3x5', text: 'x', image: null },
      stubClient({ stop_reason: 'refusal', content: [] }), { today }),
    /refused/,
  );
  await assert.rejects(
    makeLabelContent({ size: '3x5', text: 'x', image: null },
      stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'no json here' }] }), { today }),
    /could not parse/,
  );
});
