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

// Provider rate limits: retry the same request a bounded number of times; never retry what cannot improve.
async function withReplies(replies) {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    const r = replies[Math.min(calls++, replies.length - 1)];
    return { ok: r.status === 200, status: r.status, headers: { get: h => (h === 'retry-after' ? r.retryAfter : null) },
      json: async () => ({ choices: [{ message: { content: '{"hooks":{},"gaps":[]}' } }] }), text: async () => 'limit' };
  };
  try {
    const result = await runAnalysis(channel, videos, 'test-key', AbortSignal.timeout(20000)).then(() => 'ok', e => e);
    return { calls, result };
  } finally { globalThis.fetch = realFetch; }
}
test('a 429 is retried with the same request and then succeeds', async () => {
  const { calls, result } = await withReplies([{ status: 429, retryAfter: '0' }, { status: 200 }]);
  assert.equal(calls, 2);
  assert.equal(result, 'ok');
});
test('retries are bounded: three 429s end as an upstream error, not a loop', async () => {
  const { calls, result } = await withReplies([{ status: 429, retryAfter: '0' }]);
  assert.equal(calls, 3);
  assert.equal(result.name, 'UpstreamError');
  assert.equal(result.upstreamStatus, 429);
});
test('a long retry-after (daily limit) and a 413 fail fast without retrying', async () => {
  assert.equal((await withReplies([{ status: 429, retryAfter: '3600' }])).calls, 1);
  assert.equal((await withReplies([{ status: 413 }])).calls, 1);
  assert.equal((await withReplies([{ status: 400 }])).calls, 1);
});
