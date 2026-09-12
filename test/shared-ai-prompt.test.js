import test from 'node:test';
import assert from 'node:assert/strict';
import { contentFromResponse, buildPrompt, MODEL } from '../public/shared/ai-prompt.js';
import { layoutDraft, ROLE_ORDER } from '../public/shared/ai-layout.js';
import * as srcAi from '../src/ai-label.js';
import * as srcLayout from '../src/ai-layout.js';

const good = { name: 'Almond Flour', description: 'Blanched.', ingredients: 'Almonds.', extras: [{ role: 'lot', text: 'Lot 42' }], warning: '' };

test('contentFromResponse parses bare JSON and JSON wrapped in prose', () => {
  const bare = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(good) }] };
  assert.equal(contentFromResponse(bare).name, 'Almond Flour');
  const wrapped = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here you go:\n```json\n' + JSON.stringify(good) + '\n```' }] };
  assert.deepEqual(contentFromResponse(wrapped).extras, [{ role: 'lot', text: 'Lot 42' }]);
});

test('contentFromResponse surfaces refusals and garbage', () => {
  assert.throws(() => contentFromResponse({ stop_reason: 'refusal', content: [] }), /refused/);
  assert.throws(() => contentFromResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'no json here' }] }), /could not parse/);
});

test('src modules re-export the shared AI pieces', () => {
  assert.equal(srcAi.buildPrompt, buildPrompt);
  assert.equal(srcAi.MODEL, MODEL);
  assert.equal(srcLayout.layoutDraft, layoutDraft);
  assert.deepEqual(ROLE_ORDER, ['lot', 'best_by', 'packed_on', 'allergens', 'net', 'note']);
  const draft = layoutDraft({ size: '3x2', content: good });
  assert.match(draft.extras[0].id, /^[0-9a-f-]{36}$/);
});
