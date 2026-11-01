import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes } from './helpers/http.js';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';
const { makeAuthHandler } = await import('../lib/handlers/auth.js');
const { createPendingValue, verifyPendingValue } = await import('../lib/auth.js');
const { makeCapacity } = await import('../lib/capacity.js');
const { makeMetrics } = await import('../lib/metrics.js');
const { makeAnalyzeHandler } = await import('../lib/handlers/analyze.js');

function fakeKv() {
  const data = new Map();
  return { data, async run(cmds) {
    await Promise.resolve();
    return cmds.map(([op, key, ...a]) => {
      switch (op) {
        case 'INCR': { const n = Number(data.get(key) ?? 0) + 1; data.set(key, String(n)); return n; }
        case 'DECR': { const n = Number(data.get(key) ?? 0) - 1; data.set(key, String(n)); return n; }
        case 'GET': return data.get(key) ?? null;
        case 'EXPIRE': return 1;
        case 'SET': data.set(key, a[0]); return 'OK';
        case 'DEL': return data.delete(key) ? 1 : 0;
        default: throw new Error(`unexpected ${op}`);
      }
    });
  } };
}
const USER = { id: 'u-1', email: 'c@example.test', plan: 'free' };
const rig = (over = {}) => {
  const kv = fakeKv();
  const metrics = makeMetrics({ kv });
  const handler = makeAuthHandler({ getUser: async () => USER, getUsage: async () => 0, capacity: makeCapacity({ kv, cap: 2 }), metrics, ...over });
  return { kv, handler };
};
const call = (handler, method, route, extra = {}) => { const res = makeRes(); return handler({ ...makeReq({ method, ...extra }), url: `/api/auth/${route}` }, res).then(() => res); };
const cookieOf = res => String(res.headers['set-cookie']).split(';')[0].split('=').slice(1).join('=');

test('a pasted channel is signed, expires, and cannot be forged or altered', () => {
  const v = createPendingValue('youtube.com/@mkbhd');
  assert.equal(verifyPendingValue(v), 'youtube.com/@mkbhd');
  assert.equal(verifyPendingValue(v, Date.now() + 16 * 60 * 1000), null, 'expires after 15 minutes');
  const [payload, sig] = v.split('.');
  const forged = Buffer.from(JSON.stringify({ c: 'youtube.com/@evil', exp: Date.now() + 1e6 })).toString('base64url');
  assert.equal(verifyPendingValue(`${forged}.${sig}`), null);
  assert.equal(verifyPendingValue(`${payload}.x${sig.slice(1)}`), null);
  assert.equal(verifyPendingValue('junk'), null);
  assert.equal(verifyPendingValue(undefined), null);
});

test('POST /pending stores a valid channel in an HttpOnly cookie and counts the paste', async () => {
  const { handler, kv } = rig();
  const res = await call(handler, 'POST', 'pending', { body: { channel: ' youtube.com/@mkbhd ' } });
  assert.equal(res.statusCode, 200);
  const header = String(res.headers['set-cookie']);
  assert.match(header, /^wc_pending=/); assert.match(header, /HttpOnly/); assert.match(header, /SameSite=Lax/); assert.match(header, /Max-Age=900/);
  assert.equal(verifyPendingValue(cookieOf(res)), 'youtube.com/@mkbhd');
  assert.equal([...kv.data].filter(([k]) => k.endsWith(':paste')).length, 1);
});

test('POST /pending refuses non-channel input, cross-site calls and wrong methods; DELETE clears', async () => {
  const { handler } = rig();
  for (const channel of ['', 'hello world!', 'https://evil.example/@x', '<script>', 'x'.repeat(300)]) {
    assert.equal((await call(handler, 'POST', 'pending', { body: { channel } })).statusCode, 400, channel.slice(0, 20));
  }
  assert.equal((await call(handler, 'POST', 'pending', { body: { channel: '@mkbhd' }, headers: { 'sec-fetch-site': 'cross-site' } })).statusCode, 403);
  assert.equal((await call(handler, 'GET', 'pending')).statusCode, 405);
  const del = await call(handler, 'DELETE', 'pending');
  assert.equal(del.statusCode, 200); assert.match(String(del.headers['set-cookie']), /Max-Age=0/);
});

test('/me returns the pending channel only for a signed-in user, and never one that is tampered with', async () => {
  const { handler } = rig();
  const good = createPendingValue('@mkbhd');
  const a = await call(handler, 'GET', 'me', { headers: { cookie: `wc_pending=${good}` } });
  assert.equal(a.body.pending, '@mkbhd');
  const b = await call(handler, 'GET', 'me', { headers: { cookie: `wc_pending=${good}x` } });
  assert.equal(b.body.pending, null);
  const c = await call(handler, 'GET', 'me', {});
  assert.equal(c.body.pending, null);
  const anon = rig({ getUser: async () => null });
  assert.equal((await call(anon.handler, 'GET', 'me', { headers: { cookie: `wc_pending=${good}` } })).statusCode, 401);
});

test('the daily budget admits exactly the cap under concurrency, gives units back, and resets by day', async () => {
  const kv = fakeKv(); let t = '2026-11-01T10:00:00Z';
  const cap = makeCapacity({ kv, cap: 3, now: () => new Date(t) });
  const r = await Promise.all(Array.from({ length: 8 }, () => cap.take()));
  assert.equal(r.filter(x => x.ok).length, 3);
  assert.equal((await cap.status()).full, true);
  await cap.release();
  assert.equal((await cap.take()).ok, true);
  t = '2026-11-02T00:00:01Z';
  assert.equal((await cap.take()).ok, true);
  assert.equal(makeCapacity({ kv: null }).take().then(x => x.ok) instanceof Promise, true);
  assert.deepEqual(await makeCapacity({ kv: null }).take(), { ok: true }); // no KV: fail open
  assert.deepEqual(await makeCapacity({ kv: { run: async () => { throw new Error('down'); } } }).take(), { ok: true });
});

test('metrics count named events as numbers only, ignore unknown names, and never throw', async () => {
  const kv = fakeKv(); const m = makeMetrics({ kv, now: () => new Date('2026-11-01T10:00:00Z') });
  await m.count('paste'); await m.count('paste'); await m.count('hax');
  assert.equal((await m.read(1))['2026-11-01'].paste, 2);
  assert.equal([...kv.data.keys()].some(k => k.includes('hax')), false);
  await makeMetrics({ kv: { run: async () => { throw new Error('down'); } } }).count('paste'); // no throw
});

test('a full day refuses a new analysis before it starts, with the quota given back and nothing streamed', async () => {
  const kv = fakeKv(); const capacity = makeCapacity({ kv, cap: 1 }); await capacity.take();
  let failed = 0, resolved = 0;
  const handler = makeAnalyzeHandler({
    getUser: async () => USER, capacity, metrics: makeMetrics({ kv }),
    reserveRun: async () => ({ outcome: 'reserved', runId: 'r1' }), failRun: async () => { failed++; },
    resolveChannel: async () => { resolved++; throw new Error('should not run'); }, completeRun: async () => {},
    env: { YOUTUBE_API_KEY: 'k', GROQ_API_KEY: 'g' }
  });
  const res = makeRes();
  await handler(makeReq({ method: 'POST', body: { url: 'youtube.com/@mkbhd' }, userId: USER.id }), res);
  assert.equal(res.statusCode, 503); assert.equal(res.body.code, 'CAPACITY'); assert.ok(res.body.resetsAt);
  assert.equal(failed, 1); assert.equal(resolved, 0);
  assert.equal(res.chunks.length, 0);
});

test('Reelcut clip search spends the same daily budget, and a failed search gives its unit back', async () => {
  const { makeReelcutHandler } = await import('../lib/handlers/reelcut.js');
  const { makeReelcutQuota } = await import('../lib/reelcut-quota.js');
  const kv = fakeKv(); const capacity = makeCapacity({ kv, cap: 1 });
  const quota = makeReelcutQuota({ kv, newId: () => '123e4567-e89b-42d3-a456-426614174000' });
  const T = [{ start: 0, end: 30, text: 'hello there everyone' }];
  let fail = false;
  const handler = makeReelcutHandler({ getUser: async () => ({ ...USER, plan: 'pro' }), quota, capacity, pickClips: async () => { if (fail) throw new Error('boom'); return [{ start: 0, end: 30, title: 't', hook: 'h', reason: '' }]; } });
  const post = body => { const res = makeRes(); return handler(makeReq({ method: 'POST', body, userId: USER.id }), res).then(() => res); };
  const s = await post({ action: 'start' });
  fail = true; assert.equal((await post({ action: 'pick', runId: s.body.runId, chunks: T })).statusCode, 500);
  fail = false; assert.equal((await post({ action: 'pick', runId: s.body.runId, chunks: T })).statusCode, 200); // the failed one gave its unit back
  const full = await post({ action: 'pick', runId: s.body.runId, chunks: T });
  assert.equal(full.statusCode, 503); assert.equal(full.body.code, 'CAPACITY');
});
