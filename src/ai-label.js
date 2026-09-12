import Anthropic from '@anthropic-ai/sdk';
import { MODEL, CONTENT_SCHEMA, buildPrompt, contentFromResponse } from '../public/shared/ai-prompt.js';

export { MODEL, CONTENT_SCHEMA, buildPrompt, parseContent, houseExamples, contentFromResponse } from '../public/shared/ai-prompt.js';

export function makeClient(apiKey) {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

export async function makeLabelContent({ size, text, image }, client, { today = new Date(), examples = [] } = {}) {
  const { system, messages } = buildPrompt({ size, text, image, today, examples });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages,
    output_config: { format: { type: 'json_schema', schema: CONTENT_SCHEMA } },
  });
  return contentFromResponse(response);
}
