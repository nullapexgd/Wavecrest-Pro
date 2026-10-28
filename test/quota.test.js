// Atomic quota, concurrency and retry behaviour, proven against a real Postgres with real
// parallel connections. A mock cannot show a lock works; this can.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg_ from 'pg';
import { PG_SKIP, startTempPostgres, makeUser } from './helpers/pg.js';

const { reserveRun, completeRun, failRun, getUsage, STALE_AFTER_S } = await import('../lib/quota.js');
let pg;
before(async () => { if (!PG_SKIP) pg = await startTempPostgres({ max: 60 }); });
after(async () => { await pg?.stop(); });
const opts = { skip: PG_SKIP };
const count = (rs, o) => rs.filter(r => r.outcome === o).length;
const T0 = new Date('2026-10-15T12:00:00Z');

test('50 simultaneous requests from one user reserve exactly ONE run', opts, async () => {
  const u = await makeUser(pg.pool);
  const rs = await Promise.all(Array.from({ length: 50 }, (_, i) =>
    reserveRun({ userId: u.id, limit: 25, idemKey: `key-${i}-aaaaaaaa`, now: T0 }, pg.pool)));
  assert.equal(count(rs, 'reserved'), 1);
  assert.equal(count(rs, 'in_progress'), 49);
  assert.equal(await getUsage(u.id, T0, pg.pool), 1);
});

test('NEGATIVE CONTROL: without the advisory lock the same stress DOES over-reserve (the test has teeth)', opts, async () => {
  // A dedicated pool: patched connections must never return to the shared pool.
  const rogue = new pg_.Pool({ ...pg.options, max: 60 });
  const unlocked = {
    connect: async () => {
      const c = await rogue.connect();
      const q = c.query.bind(c);
      c.query = (text, ...rest) => /pg_advisory_xact_lock/.test(String(text)) ? Promise.resolve({ rows: [], rowCount: 0 }) : q(text, ...rest);
      return c;
    }
  };
  let worst = 0;
  try {
    for (let attempt = 0; attempt < 5 && worst < 2; attempt++) {
      const u = await makeUser(pg.pool);
      const rs = await Promise.all(Array.from({ length: 50 }, (_, i) =>
        reserveRun({ userId: u.id, limit: 25, idemKey: `k${attempt}-${i}-aaaaaaa`, now: T0 }, unlocked)));
      worst = Math.max(worst, count(rs, 'reserved'));
    }
  } finally { await rogue.end(); }
  assert.ok(worst >= 2, `expected the lock-free variant to race, but it never did (max reserved = ${worst})`);
});

test('even if the lock were bypassed, a duplicate idempotency key is a replay, never a crash or a second charge', opts, async () => {
  const rogue = new pg_.Pool({ ...pg.options, max: 30 });
  const unlocked = {
    connect: async () => {
      const c = await rogue.connect();
      const q = c.query.bind(c);
      c.query = (text, ...rest) => /pg_advisory_xact_lock/.test(String(text)) ? Promise.resolve({ rows: [], rowCount: 0 }) : q(text, ...rest);
      return c;
    }
  };
  try {
    const u = await makeUser(pg.pool);
    const rs = await Promise.all(Array.from({ length: 20 }, () =>
      reserveRun({ userId: u.id, limit: 5, idemKey: 'backstop-key-0001', now: T0 }, unlocked)));
    assert.ok(count(rs, 'reserved') >= 1);
    const rows = (await pg.pool.query('SELECT count(*)::int n FROM analysis_runs WHERE user_id=$1 AND idem_key=$2', [u.id, 'backstop-key-0001'])).rows[0].n;
    assert.equal(rows, 1, 'the unique index allows only one row for a key');
  } finally { await rogue.end(); }
});

test('the monthly limit is never exceeded, however runs interleave', opts, async () => {
  const u = await makeUser(pg.pool);
  const limit = 3;
  let succeeded = 0;
  for (let round = 0; round < 6; round++) {
    const rs = await Promise.all(Array.from({ length: 8 }, () => reserveRun({ userId: u.id, limit, now: T0 }, pg.pool)));
    const won = rs.filter(r => r.outcome === 'reserved');
    assert.ok(won.length <= 1, 'one in flight at a time');
    for (const w of won) { await completeRun(w.runId, null, pg.pool); succeeded++; }
  }
  assert.equal(succeeded, limit);
  assert.equal(await getUsage(u.id, T0, pg.pool), limit);
  const after = await reserveRun({ userId: u.id, limit, now: T0 }, pg.pool);
  assert.equal(after.outcome, 'limit');
  assert.deepEqual([after.used, after.limit], [3, 3]);
});

test('free beta: exactly one analysis per month', opts, async () => {
  const u = await makeUser(pg.pool);
  const first = await reserveRun({ userId: u.id, limit: 1, now: T0 }, pg.pool);
  assert.equal(first.outcome, 'reserved');
  await completeRun(first.runId, null, pg.pool);
  assert.equal((await reserveRun({ userId: u.id, limit: 1, now: T0 }, pg.pool)).outcome, 'limit');
});

test('unlimited plans (limit = Infinity) are never refused for quota', opts, async () => {
  const u = await makeUser(pg.pool, 'team');
  for (let i = 0; i < 5; i++) {
    const r = await reserveRun({ userId: u.id, limit: Infinity, now: T0 }, pg.pool);
    assert.equal(r.outcome, 'reserved');
    await completeRun(r.runId, null, pg.pool);
  }
});

test('a FAILED run is refunded and does not count', opts, async () => {
  const u = await makeUser(pg.pool);
  const r = await reserveRun({ userId: u.id, limit: 1, now: T0 }, pg.pool);
  assert.equal(await failRun(r.runId, pg.pool), true);
  assert.equal(await getUsage(u.id, T0, pg.pool), 0);
  assert.equal((await reserveRun({ userId: u.id, limit: 1, now: T0 }, pg.pool)).outcome, 'reserved');
});

test('retry with the same Idempotency-Key never charges twice', opts, async () => {
  const u = await makeUser(pg.pool);
  const key = 'retry-key-0001';
  const a = await reserveRun({ userId: u.id, limit: 1, idemKey: key, now: T0 }, pg.pool);
  assert.equal(a.outcome, 'reserved');
  await completeRun(a.runId, null, pg.pool);
  for (let i = 0; i < 3; i++) {
    const b = await reserveRun({ userId: u.id, limit: 1, idemKey: key, now: T0 }, pg.pool);
    assert.equal(b.outcome, 'replay', 'a retry is a replay, even though the user is now at the limit');
    assert.equal(b.run.status, 'succeeded');
  }
  assert.equal(await getUsage(u.id, T0, pg.pool), 1);
});

test('20 parallel retries of one action with the same key charge once', opts, async () => {
  const u = await makeUser(pg.pool);
  const rs = await Promise.all(Array.from({ length: 20 }, () =>
    reserveRun({ userId: u.id, limit: 5, idemKey: 'double-click-key-1', now: T0 }, pg.pool)));
  assert.equal(count(rs, 'reserved'), 1);
  assert.equal(await getUsage(u.id, T0, pg.pool), 1);
});

test('a dead reservation (function crashed or timed out) expires and stops blocking the user', opts, async () => {
  const u = await makeUser(pg.pool);
  const dead = await reserveRun({ userId: u.id, limit: 1, now: T0 }, pg.pool);
  assert.equal(dead.outcome, 'reserved');
  const soon = new Date(T0.getTime() + (STALE_AFTER_S - 5) * 1000);
  assert.equal((await reserveRun({ userId: u.id, limit: 1, now: soon }, pg.pool)).outcome, 'in_progress');
  const later = new Date(T0.getTime() + (STALE_AFTER_S + 5) * 1000);
  const fresh = await reserveRun({ userId: u.id, limit: 1, now: later }, pg.pool);
  assert.equal(fresh.outcome, 'reserved', 'the crashed run was refunded');
  assert.equal(await completeRun(dead.runId, null, pg.pool), false, 'a crashed run cannot be resurrected');
});

test('the quota resets at the UTC month boundary, to the second', opts, async () => {
  const u = await makeUser(pg.pool);
  const lastSecond = new Date('2026-10-31T23:59:59Z');
  const r = await reserveRun({ userId: u.id, limit: 1, now: lastSecond }, pg.pool);
  await completeRun(r.runId, null, pg.pool);
  assert.equal((await reserveRun({ userId: u.id, limit: 1, now: new Date('2026-10-31T23:59:59.900Z') }, pg.pool)).outcome, 'limit');
  assert.equal((await reserveRun({ userId: u.id, limit: 1, now: new Date('2026-11-01T00:00:00Z') }, pg.pool)).outcome, 'reserved');
});

test('users are isolated: one account at its limit never blocks another', opts, async () => {
  const [a, b] = [await makeUser(pg.pool), await makeUser(pg.pool)];
  const ra = await reserveRun({ userId: a.id, limit: 1, now: T0 }, pg.pool);
  await completeRun(ra.runId, null, pg.pool);
  assert.equal((await reserveRun({ userId: a.id, limit: 1, now: T0 }, pg.pool)).outcome, 'limit');
  assert.equal((await reserveRun({ userId: b.id, limit: 1, now: T0 }, pg.pool)).outcome, 'reserved');
});

test('an idempotency key from one user cannot replay another user\'s run', opts, async () => {
  const [a, b] = [await makeUser(pg.pool), await makeUser(pg.pool)];
  const ra = await reserveRun({ userId: a.id, limit: 1, idemKey: 'shared-key-123', now: T0 }, pg.pool);
  await completeRun(ra.runId, null, pg.pool);
  const rb = await reserveRun({ userId: b.id, limit: 1, idemKey: 'shared-key-123', now: T0 }, pg.pool);
  assert.equal(rb.outcome, 'reserved');
});
