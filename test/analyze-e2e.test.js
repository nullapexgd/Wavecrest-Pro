// End to end on a real (throwaway) Postgres: the real analyze handler, quota engine and
// report storage, with only YouTube and Groq stubbed. Concurrency, retries, refunds and
// cross-account privacy are checked through the same code path production uses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PG_SKIP, startTempPostgres, makeUser } from './helpers/pg.js';
import { makeReq, makeRes } from './helpers/http.js';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';
const { makeAnalyzeHandler } = await import('../lib/handlers/analyze.js');
const { makeReportHandler } = await import('../lib/handlers/report.js');
const { getUser, getUserByApiKey } = await import('../lib/auth.js');
const { reserveRun, completeRun, failRun } = await import('../lib/quota.js');
const { insertReport, getReportForViewer } = await import('../lib/reports.js');

let pg, upstream, analyze, viewReport;
let alice, bob, carol;
const CHANNEL = { id: 'UC1', name: 'Example', handle: '@ex', subscriberCount: 10, thumbnailUrl: '', publishedAt: '2020-01-01', uploadsPlaylistId: 'UU1' };
const VIDEOS = [1, 2, 3, 4].map(i => ({ id: `v${i}`, title: `t${i}`, viewCount: 100 * i, duration: 300, publishedAt: '2026-01-01' }));

before(async () => {
  if (PG_SKIP) return;
  pg = await startTempPostgres({ max: 60 });
  upstream = { analyses: 0, failNext: false };
  analyze = makeAnalyzeHandler({
    env: { YOUTUBE_API_KEY: 'k', GROQ_API_KEY: 'k' },
    getUser: req => getUser(req, pg.pool),
    getUserByApiKey: k => getUserByApiKey(k, pg.pool),
    reserveRun: a => reserveRun(a, pg.pool),
    completeRun: (id, rid) => completeRun(id, rid, pg.pool),
    failRun: id => failRun(id, pg.pool),
    insertReport: a => insertReport(a, pg.pool),
    getReport: (id, viewer) => getReportForViewer(id, viewer, pg.pool),
    resolveChannel: async () => CHANNEL,
    fetchVideos: async () => VIDEOS,
    runAnalysis: async () => {
      await new Promise(r => setTimeout(r, 25)); // a realistic window for requests to overlap
      if (upstream.failNext) { upstream.failNext = false; throw new Error('boom'); }
      upstream.analyses++;
      return { hooks: { primaryPattern: 'private strategy' } };
    }
  });
  viewReport = makeReportHandler({ db: pg.pool });
  [alice, bob] = [await makeUser(pg.pool), await makeUser(pg.pool)];
  carol = await makeUser(pg.pool, 'team');
});
after(async () => { await pg?.stop(); });
const opts = { skip: PG_SKIP };

async function run(user, { key, url = 'https://www.youtube.com/@example' } = {}) {
  const res = makeRes();
  await analyze(makeReq({ method: 'POST', body: { url }, userId: user.id, headers: key ? { 'idempotency-key': key } : {} }), res);
  const done = res.events().find(e => e.name === 'done');
  const fail = res.events().find(e => e.name === 'fail');
  return { res, done: done?.data, fail: fail?.data, status: res.statusCode, code: res.body?.code };
}
const view = async (id, user) => {
  const res = makeRes();
  await viewReport(makeReq({ query: { id }, userId: user?.id }), res);
  return res;
};

test('FREE BETA: 10 simultaneous clicks from one account run exactly ONE analysis', opts, async () => {
  const before_ = upstream.analyses;
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => run(alice, { key: `alice-click-${i}-xxxxxxxx` })));
  assert.equal(results.filter(r => r.done).length, 1, 'exactly one analysis was delivered');
  assert.equal(upstream.analyses - before_, 1, 'and only one paid upstream analysis was run');
  assert.ok(results.filter(r => !r.done).every(r => [409, 429].includes(r.status)));

  const next = await run(alice, { key: 'alice-next-xxxxxxxx' });
  assert.equal(next.status, 429);
  assert.equal(next.code, 'PLAN_LIMIT');
  assert.equal(upstream.analyses - before_, 1, 'still only one');
});

test('the report Alice just paid for is private: Bob and anonymous callers cannot read it', opts, async () => {
  const mine = (await pg.pool.query('SELECT id, visibility, user_id FROM reports WHERE user_id=$1', [alice.id])).rows;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].visibility, 'private');
  assert.equal((await view(mine[0].id, alice)).statusCode, 200);
  assert.equal((await view(mine[0].id, bob)).statusCode, 404);
  assert.equal((await view(mine[0].id, null)).statusCode, 404);
});

test('two different accounts running at the same moment do not interfere', opts, async () => {
  const [b, c] = await Promise.all([run(bob, { key: 'bob-first-xxxxxxxxx' }), run(carol, { key: 'carol-first-xxxxxxx' })]);
  assert.ok(b.done && c.done);
  assert.notEqual(b.done.reportId, c.done.reportId);
  assert.equal((await view(c.done.reportId, bob)).statusCode, 404, 'Bob cannot read Carol\'s report');
  assert.equal((await view(b.done.reportId, carol)).statusCode, 404, 'Carol cannot read Bob\'s report');
});

test('a retry of the same action (same key) returns the same report and never runs or charges again', opts, async () => {
  const u = await makeUser(pg.pool);
  const first = await run(u, { key: 'retry-me-0000001' });
  assert.ok(first.done);
  const before_ = upstream.analyses;
  const retry = await run(u, { key: 'retry-me-0000001' });
  assert.equal(retry.done?.reportId, first.done.reportId);
  assert.equal(upstream.analyses, before_, 'no second upstream analysis');
  const used = (await pg.pool.query("SELECT count(*)::int n FROM analysis_runs WHERE user_id=$1 AND status='succeeded'", [u.id])).rows[0].n;
  assert.equal(used, 1);
});

test('double-click: two requests with the same key at once run once; the other is told it is in progress', opts, async () => {
  const u = await makeUser(pg.pool);
  const before_ = upstream.analyses;
  const [a, b] = await Promise.all([run(u, { key: 'dbl-click-000001' }), run(u, { key: 'dbl-click-000001' })]);
  assert.equal([a, b].filter(r => r.done).length, 1);
  assert.equal([a, b].find(r => !r.done).status, 409);
  assert.equal(upstream.analyses - before_, 1);
});

test('a failed analysis is refunded: the user can try again and is only charged for the success', opts, async () => {
  const u = await makeUser(pg.pool);
  upstream.failNext = true;
  const failed = await run(u, { key: 'fail-then-ok-001' });
  assert.equal(failed.fail?.code, 'ANALYSIS_FAILED');
  assert.doesNotMatch(JSON.stringify(failed.res.chunks), /boom/);

  const ok = await run(u, { key: 'fail-then-ok-002' });
  assert.ok(ok.done, 'the refund left the free analysis available');
  assert.equal((await run(u, { key: 'fail-then-ok-003' })).status, 429);
  const ledger = (await pg.pool.query('SELECT status FROM analysis_runs WHERE user_id=$1 ORDER BY created_at', [u.id])).rows.map(r => r.status);
  assert.deepEqual(ledger, ['failed', 'succeeded']);
});

test('team (unlimited) entitlements are honoured and unaffected by the free-beta limit', opts, async () => {
  const before_ = upstream.analyses;
  for (let i = 0; i < 3; i++) assert.ok((await run(carol, { key: `carol-loop-${i}-xxxxxx` })).done);
  assert.equal(upstream.analyses - before_, 3);
});

test('INVARIANT: no account ever has more successful analyses this month than its entitlement', opts, async () => {
  const rows = (await pg.pool.query(
    `SELECT u.plan, a.user_id, count(*)::int AS n FROM analysis_runs a JOIN users u ON u.id=a.user_id
     WHERE a.status IN ('reserved','succeeded') GROUP BY u.plan, a.user_id`)).rows;
  const limits = { free: 1, starter: 25, pro: 100, team: Infinity };
  for (const r of rows) assert.ok(r.n <= limits[r.plan], `user on ${r.plan} has ${r.n}`);
  assert.ok(rows.length >= 4);
});
