// "Make it for me" without a server: the tablet calls the Messages API
// itself with the key from its settings. Same prompt, schema, fallback and
// parsing as src/ai-label.js; only the transport differs (fetch, not the SDK).
import { MODEL, CONTENT_SCHEMA, buildPrompt, contentFromResponse } from './shared/ai-prompt.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';

export function buildRequest({ size, text, image, today = new Date(), examples = [] }, apiKey) {
  const { system, messages } = buildPrompt({ size, text, image, today, examples });
  return {
    url: API_URL,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      // Required for calls made from a web page; the key lives only on this tablet.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: {
      model: MODEL,
      max_tokens: 4000,
      fallbacks: 'default',
      system,
      messages,
      output_config: { format: { type: 'json_schema', schema: CONTENT_SCHEMA } },
    },
  };
}

export async function requestContent(input, apiKey, { fetchImpl = globalThis.fetch, today, examples } = {}) {
  const req = buildRequest({ ...input, today, examples }, apiKey);
  let res;
  try {
    res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
  } catch {
    throw new Error('could not reach the label maker — is the tablet online?');
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = (await res.json()).error?.message ?? message; } catch { /* keep status */ }
    throw new Error(`label maker error: ${message}`);
  }
  return contentFromResponse(await res.json());
}
