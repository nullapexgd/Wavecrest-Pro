import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes, everythingSent } from './helpers/http.js';
import { makeReelcutQuota, weekKey, resetsAt } from '../lib/reelcut-quota.js';
import { makeReelcutHandler } from '../lib/handlers/reelcut.js';

// In-memory stand-in for the Upstash commands the quota uses. Each command is atomic, as on Upstash.
function fakeKv({ failAfter = Infinity } = {}) {
  const data = new Map(); let calls = 0;
  return {
    data,
    async run(cmds) {
      await Promise.resolve();
      if (++calls > failAfter) throw new Error('kv down');
      return cmds.map(([op, key, ...a]) => {
        switch (op) {
          case 'INCR': { const n = Number(data.get(key) ?? 0) + 1; data.set(key, String(n)); return n; }
          case 'DECR': { const n = Number(data.get(key) ?? 0) - 1; data.set(key, String(n)); return n; }
          case 'GET': return data.get(key) ?? null;
          case 'SET': data.set(key, a[0]); return 'OK';
          case 'DEL': return data.delete(key) ? 1 : 0;
          case 'EXPIRE': return 1;
          default: throw new Error(`unexpected ${op}`);
        }
      });
    }
  };
}
let n = 0;
const ids = () => `123e4567-e89b-42d3-a456-${String(++n).padStart(12, '0')}`;
const at = iso => () => new Date(iso);

test('weeks are ISO weeks in UTC and reset on Monday', () => {
  assert.equal(weekKey(new Date('2026-11-01T12:00:00Z')), '2026-W44'); // Sunday
  assert.equal(weekKey(new Date('2026-11-02T00:00:00Z')), '2026-W45'); // Monday
  assert.equal(weekKey(new Date('2026-12-31T23:59:59Z')), '2026-W53');
  assert.equal(weekKey(new Date('2027-01-01T00:00:00Z')), '2026-W53'); // year boundary belongs to W53
  assert.equal(resetsAt(new Date('2026-11-01T12:00:00Z')), '2026-11-02T00:00:00.000Z');
  assert.equal(resetsAt(new Date('2026-11-02T00:00:00Z')), '2026-11-09T00:00:00.000Z');
});

test('exactly three of ten concurrent starts are admitted, and the counter ends at three', async () => {
  const kv = fakeKv(); const q = makeReelcutQuota({ kv, newId: ids });
  const r = await Promise.all(Array.from({ length: 10 }, () => q.reserve('u1')));
  assert.equal(r.filter(x => x.ok).length, 3);
  assert.equal(r.filter(x => !x.ok && x.reason === 'LIMIT').length, 7);
  assert.equal((await q.status('u1')).used, 3);
  assert.equal(new Set(r.filter(x => x.ok).map(x => x.runId)).size, 3);
});

test('users and weeks are counted separately', async () => {
  const kv = fakeKv(); let t = '2026-11-01T10:00:00Z';
  const q = makeReelcutQuota({ kv, newId: ids, now: () => new Date(t) });
  for (let i = 0; i < 3; i++) assert.ok((await q.reserve('u1')).ok);
  assert.equal((await q.reserve('u1')).reason, 'LIMIT');
  assert.ok((await q.reserve('u2')).ok);
  t = '2026-11-02T00:00:01Z';
  assert.ok((await q.reserve('u1')).ok);
});

test('a refund frees one slot, once, and only for a run that exists', async () => {
  const kv = fakeKv(); const q = makeReelcutQuota({ kv, newId: ids });
  const a = await q.reserve('u1'); await q.reserve('u1'); await q.reserve('u1');
  assert.equal((await q.reserve('u1')).reason, 'LIMIT');
  assert.deepEqual(await q.refund('u1', a.runId), { ok: true, refunded: true });
  assert.deepEqual(await q.refund('u1', a.runId), { ok: true, refunded: false }); // replay
  assert.deepEqual(await q.refund('u1', '123e4567-e89b-42d3-a456-999999999999'), { ok: true, refunded: false });
  assert.deepEqual(await q.refund('u2', a.runId), { ok: true, refunded: false }); // someone else's run id
  assert.equal((await q.status('u1')).used, 2);
  assert.ok((await q.reserve('u1')).ok);
  assert.equal((await q.reserve('u1')).reason, 'LIMIT');
});

test('fails closed without KV or when KV errors', async () => {
  assert.deepEqual(await makeReelcutQuota({ kv: null }).reserve('u1'), { ok: false, reason: 'UNAVAILABLE' });
  const q = makeReelcutQuota({ kv: fakeKv({ failAfter: 0 }), newId: ids });
  assert.deepEqual(await q.reserve('u1'), { ok: false, reason: 'UNAVAILABLE' });
  assert.equal(await q.status('u1'), null);
});

const USER = { id: 'u-1', email: 'creator@example.test', plan: 'free' };
const post = (body, extra = {}) => makeReq({ method: 'POST', body, userId: USER.id, ...extra });
function rig(over = {}) {
  const kv = fakeKv();
  const quota = makeReelcutQuota({ kv, newId: ids });
  return { kv, handler: makeReelcutHandler({ getUser: async () => USER, quota, ...over }) };
}

test('handler: start, status, refund round trip with no secrets in the response', async () => {
  const { handler } = rig();
  const s = makeRes(); await handler(post({ action: 'start' }), s);
  assert.equal(s.statusCode, 200); assert.equal(s.body.remaining, 2); assert.match(s.body.runId, /^[0-9a-f-]{36}$/);
  const st = makeRes(); await handler(post({ action: 'status' }), st);
  assert.equal(st.body.used, 1);
  const rf = makeRes(); await handler(post({ action: 'refund', runId: s.body.runId }), rf);
  assert.equal(rf.statusCode, 200);
  const st2 = makeRes(); await handler(post({ action: 'status' }), st2);
  assert.equal(st2.body.used, 0);
  assert.doesNotMatch(everythingSent(st2), /creator@example|reelcut:/);
});

test('handler: the fourth start is a 429 with the reset time', async () => {
  const { handler } = rig();
  for (let i = 0; i < 3; i++) { const r = makeRes(); await handler(post({ action: 'start' }), r); assert.equal(r.statusCode, 200); }
  const r = makeRes(); await handler(post({ action: 'start' }), r);
  assert.equal(r.statusCode, 429); assert.equal(r.body.code, 'QUOTA_EXCEEDED'); assert.ok(r.body.resetsAt);
});

test('handler: anonymous, cross-site, wrong method, bad input and missing KV', async () => {
  for (const [req, status, over] of [
    [post({ action: 'start' }), 401, { getUser: async () => null }],
    [post({ action: 'start' }, { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
    [makeReq({ method: 'GET', userId: USER.id }), 405],
    [post({ action: 'nope' }), 400],
    [post({ action: 'refund', runId: 'not-a-uuid' }), 400],
    [post({ action: 'start' }), 503, { quota: makeReelcutQuota({ kv: null }) }]
  ]) {
    const { handler } = rig(over);
    const res = makeRes(); await handler(req, res);
    assert.equal(res.statusCode, status);
  }
});
