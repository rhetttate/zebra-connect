import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, requestContent, API_URL } from '../public/local-ai.js';

const today = new Date(2026, 8, 12);
const good = JSON.stringify({ name: 'Almond Flour', description: 'Blanched.', ingredients: '', extras: [], warning: '' });

test('buildRequest carries the key, version, fallback beta, browser header and structured output', () => {
  const req = buildRequest({ size: '3x2', text: 'almond flour', image: null, today, examples: [] }, 'sk-test');
  assert.equal(req.url, API_URL);
  assert.equal(req.headers['x-api-key'], 'sk-test');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(req.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(req.headers['content-type'], 'application/json');
  assert.equal(req.body.model, 'claude-opus-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.body.max_tokens, 4000);
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.match(req.body.system, /Today is Sep 12, 2026/);
  assert.equal(req.body.messages[0].content.at(-1).text.includes('almond flour'), true);
});

test('requestContent posts the request and parses the reply', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: good }] }) };
  };
  const content = await requestContent({ size: '3x2', text: 'almond flour', image: null }, 'sk-test', { fetchImpl, today });
  assert.equal(content.name, 'Almond Flour');
  assert.equal(calls[0].url, API_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(calls[0].init.body).model, 'claude-opus-5');
});

test('requestContent turns HTTP errors, network failures and refusals into plain messages', async () => {
  const http = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'invalid x-api-key' } }) });
  await assert.rejects(requestContent({ size: '3x2', text: 'x', image: null }, 'k', { fetchImpl: http }), /invalid x-api-key/);
  const down = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(requestContent({ size: '3x2', text: 'x', image: null }, 'k', { fetchImpl: down }), /could not reach/);
  const refused = async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(requestContent({ size: '3x2', text: 'x', image: null }, 'k', { fetchImpl: refused }), /refused/);
});
