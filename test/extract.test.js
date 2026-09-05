import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLabelFields } from '../src/extract.js';

function stubClient(response) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => { calls.push(params); return response; },
      },
    },
  };
}

test('extractLabelFields sends the image and parses the JSON reply', async () => {
  const client = stubClient({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"name":"Olive Oil","description":"Extra virgin, cold pressed"}' }],
  });
  const out = await extractLabelFields(Buffer.from('fakeimg'), 'image/jpeg', client);
  assert.deepEqual(out, { name: 'Olive Oil', description: 'Extra virgin, cold pressed' });

  const params = client.calls[0];
  assert.equal(params.model, 'claude-opus-5');
  const image = params.messages[0].content.find((b) => b.type === 'image');
  assert.equal(image.source.media_type, 'image/jpeg');
  assert.equal(image.source.data, Buffer.from('fakeimg').toString('base64'));
});

test('extractLabelFields tolerates code fences around the JSON', async () => {
  const client = stubClient({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '```json\n{"name":"Salt","description":""}\n```' }],
  });
  const out = await extractLabelFields(Buffer.from('x'), 'image/png', client);
  assert.equal(out.name, 'Salt');
});

test('extractLabelFields surfaces refusals and unparseable output', async () => {
  await assert.rejects(
    () => extractLabelFields(Buffer.from('x'), 'image/png',
      stubClient({ stop_reason: 'refusal', content: [] })),
    /refused/,
  );
  await assert.rejects(
    () => extractLabelFields(Buffer.from('x'), 'image/png',
      stubClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] })),
    /could not parse/,
  );
});
