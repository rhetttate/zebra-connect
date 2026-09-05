import Anthropic from '@anthropic-ai/sdk';

const PROMPT = `This photo shows a food product, ingredient, or its packaging/label.
Extract the fields for an inventory label and reply with ONLY a JSON object,
no other text:
{"name": "<short product/ingredient name>", "description": "<one or two sentences: what it is, plus any useful details visible such as brand, variety, or size>"}
If you cannot tell what the product is, use your best guess for name and an empty description.`;

export function makeClient(apiKey) {
  return apiKey ? new Anthropic({ apiKey }) : new Anthropic();
}

export async function extractLabelFields(imageBuffer, mediaType, client) {
  const response = await client.beta.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBuffer.toString('base64') } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('extraction refused');
  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('could not parse extraction result');
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error('could not parse extraction result');
  }
  return {
    name: String(parsed.name ?? ''),
    description: String(parsed.description ?? ''),
  };
}
