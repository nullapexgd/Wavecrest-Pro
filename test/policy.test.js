import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes } from './helpers/http.js';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';
const { entitlementFor, PLANS } = await import('../lib/plans.js');
const { parseYouTubeInput, looksLikeYouTubeInput } = await import('../lib/youtube.js');

test('entitlements: unknown or missing plans fall back to the free beta, never to a paid tier', () => {
  for (const user of [null, undefined, {}, { plan: 'enterprise' }, { plan: '__proto__' }, { plan: 'FREE' }]) {
    assert.equal(entitlementFor(user).plan, 'free');
    assert.equal(entitlementFor(user).limit, 1);
  }
  assert.equal(entitlementFor({ plan: 'pro' }).limit, 100);
});

test('entitlements: unlimited is JSON-safe (null), and no plan is marked purchasable (no billing exists)', () => {
  assert.equal(entitlementFor({ plan: 'team' }).limit, null);
  assert.equal(JSON.parse(JSON.stringify(entitlementFor({ plan: 'team' }))).limit, null);
  assert.ok(Object.values(PLANS).every(p => p.purchasable === false));
});

test('youtube input: every supported shape resolves to the right kind', () => {
  const cases = [
    ['@mkbhd', 'handle', 'mkbhd'],
    ['mkbhd', 'handle', 'mkbhd'],
    ['https://www.youtube.com/@mkbhd/videos', 'handle', 'mkbhd'],
    ['https://youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ', 'channelId', 'UCBJycsmduvYEL83R_U4JriQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'videoId', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ&t=5', 'videoId', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'videoId', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'videoId', 'dQw4w9WgXcQ'],
    ['https://youtube.com/live/dQw4w9WgXcQ', 'videoId', 'dQw4w9WgXcQ'],
    ['youtube.com/user/legacy_name', 'legacy', 'legacy_name'],
    ['youtube.com/c/CustomName', 'custom', 'CustomName']
  ];
  for (const [input, kind, value] of cases) assert.deepEqual(parseYouTubeInput(input), { kind, value }, input);
});

test('youtube input: links we cannot resolve are rejected up front', () => {
  for (const input of [
    'https://youtube.com/playlist?list=PL123', 'https://youtube.com/feed/subscriptions',
    'https://youtube.com/watch', 'https://youtube.com/watch?v=short', 'https://youtu.be/short',
    'https://youtube.com.evil.test/@mkbhd', 'https://evil.test/youtube.com/@mkbhd',
    'youtube.com', 'https://youtube.com/', 'http://[::1]/@x', 'file:///etc/passwd', '@@x'
  ]) assert.equal(looksLikeYouTubeInput(input), false, input);
});

test('youtube input: nothing user-controlled can reach a YouTube API URL unescaped', () => {
  for (const input of ['@a&key=evil', '@a%26part=x', 'youtube.com/@a?part=x']) {
    const p = parseYouTubeInput(input);
    if (p) assert.match(p.value, /^[\w.-]+$/, `${input} -> ${p.value}`);
  }
});

// ── edge limiter ─────────────────────────────────────────────────────────────
async function limiter(method, path, count) {
  const calls = [];
  const realFetch = globalThis.fetch;
  Object.assign(process.env, { KV_REST_API_URL: 'https://kv.test', KV_REST_API_TOKEN: 't' });
  globalThis.fetch = async (url, init) => { calls.push(url); return { ok: true, json: async () => [{ result: count }, { result: 1 }] }; };
  try {
    const { default: middleware } = await import('../middleware.js');
    const out = await middleware(new Request(`https://wavecrest.test${path}`, { method, headers: { 'x-forwarded-for': '203.0.113.9' } }));
    return { calls, out };
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
  }
}

test('edge limiter counts BOTH the browser POST and the API-key GET on /api/analyze-stream', async () => {
  for (const method of ['POST', 'GET']) {
    const { calls } = await limiter(method, '/api/analyze-stream', 1);
    assert.equal(calls.length, 1, `${method} must be counted`);
  }
});

test('edge limiter returns 429 with Retry-After once over the limit, and ignores other methods', async () => {
  const over = await limiter('POST', '/api/analyze-stream', 21);
  assert.equal(over.out.status, 429);
  assert.ok(over.out.headers.get('retry-after'));
  const under = await limiter('POST', '/api/analyze-stream', 20);
  assert.equal(under.out, undefined);
  assert.equal((await limiter('DELETE', '/api/analyze-stream', 99)).calls.length, 0);
});

test('edge limiter still guards /api/subscribe', async () => {
  assert.equal((await limiter('POST', '/api/subscribe', 4)).out.status, 429);
});

// ── health ───────────────────────────────────────────────────────────────────
test('health: a public caller learns up/down only; env and deployment need the admin secret', async () => {
  process.env.ADMIN_SECRET = 'admin-secret-for-test';
  process.env.YOUTUBE_API_KEY = 'x';
  delete process.env.DATABASE_URL; delete process.env.DB_URL;
  const { default: health } = await import('../api/health.js');

  const pub = makeRes();
  await health(makeReq({}), pub);
  assert.deepEqual(Object.keys(pub.body).sort(), ['db', 'ok']);
  assert.doesNotMatch(JSON.stringify(pub.body), /YOUTUBE|GROQ|RESEND|deployment/);

  const wrong = makeRes();
  await health(makeReq({ headers: { 'x-admin-secret': 'nope' } }), wrong);
  assert.deepEqual(Object.keys(wrong.body).sort(), ['db', 'ok']);

  const admin = makeRes();
  await health(makeReq({ headers: { 'x-admin-secret': 'admin-secret-for-test' } }), admin);
  assert.ok(admin.body.env && 'deployment' in admin.body);
});
