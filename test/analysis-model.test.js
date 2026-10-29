// Groq retired llama-3.3-70b-versatile (404 model_not_found), which took every analysis down.
// The model is now configurable, defaults to the recommended replacement, and leaves room for reasoning tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAnalysis } from '../lib/analysis.js';

const channel = { name: 'C', handle: '@c', description: 'd', subscriberCount: 1000, viewCountTotal: 1e6, publishedAt: '2020-01-01T00:00:00Z' };
const videos = Array.from({ length: 5 }, (_, i) => ({
  id: `v${i}`, title: `Video ${i}`, publishedAt: `2026-0${i + 1}-01T00:00:00Z`, viewCount: 1000 * (i + 1), likeCount: 10, duration: 600
}));

async function request(env) {
  const realFetch = globalThis.fetch, saved = process.env.GROQ_MODEL;
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"hooks":{},"gaps":[]}' } }] }) };
  };
  if (env === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = env;
  try { await runAnalysis(channel, videos, 'test-key', AbortSignal.timeout(5000)); }
  finally { globalThis.fetch = realFetch; if (saved === undefined) delete process.env.GROQ_MODEL; else process.env.GROQ_MODEL = saved; }
  return sent;
}

test('default model is the supported one, never the retired llama-3.3-70b-versatile', async () => {
  const sent = await request(undefined);
  assert.equal(sent.model, 'openai/gpt-oss-120b');
  assert.notEqual(sent.model, 'llama-3.3-70b-versatile');
  assert.deepEqual(sent.response_format, { type: 'json_object' });
  assert.ok(sent.max_tokens >= 8000, 'room for reasoning tokens before the JSON');
});

test('GROQ_MODEL overrides the model without a code change', async () => {
  assert.equal((await request('some/other-model')).model, 'some/other-model');
});
