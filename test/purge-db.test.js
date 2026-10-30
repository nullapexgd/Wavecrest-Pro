// The 30-day purge against a real (throwaway) Postgres, through the real handlers: an old report loses its
// statistics when read and in the daily sweep, a fresh one is untouched, and access rules do not change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PG_SKIP, startTempPostgres, makeUser } from './helpers/pg.js';
import { makeReq, makeRes } from './helpers/http.js';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';
const { makeReportHandler } = await import('../lib/handlers/report.js');
const { makePurgeCronHandler } = await import('../lib/handlers/purge-cron.js');
const { purgeDueReports } = await import('../lib/reports.js');

const ANALYSIS = {
  hooks: { primaryPattern: 'kept text', medianMultiple: 3.2 },
  stats: { medianViews: 41000 }, earningsEstimate: { monthlyViewsEstimate: 99000 },
  evidence: { medianViews: 41000, videos: [{ id: 'v1', title: 'A title', views: 41000, likes: 900, tags: ['T1'] }] }
};
let pg, handle, owner, other, oldId, oldId2, freshId;

async function add(userId, ageDays) {
  const r = await pg.pool.query(
    `INSERT INTO reports (channel_id, channel_name, subscriber_count, user_id, video_count, analysis, created_at)
     VALUES ('UCx', 'Chan', 5000, $1, 40, $2::jsonb, now() - make_interval(days => $3)) RETURNING id`,
    [userId, JSON.stringify(ANALYSIS), ageDays]);
  return r.rows[0].id;
}
const row = async id => (await pg.pool.query('SELECT subscriber_count, analysis FROM reports WHERE id=$1', [id])).rows[0];

before(async () => {
  if (PG_SKIP) return;
  pg = await startTempPostgres();
  handle = makeReportHandler({ db: pg.pool });
  owner = await makeUser(pg.pool); other = await makeUser(pg.pool);
  oldId = await add(owner.id, 31); oldId2 = await add(owner.id, 45); freshId = await add(owner.id, 5);
});
after(async () => { if (pg) await pg.stop(); });

test('reading a report older than 30 days returns and stores it without statistics', { skip: PG_SKIP }, async () => {
  const res = makeRes();
  await handle(makeReq({ method: 'GET', query: { id: oldId }, userId: owner.id }), res);
  assert.equal(res.statusCode, 200);
  const a = res.body.analysis;
  assert.equal(a.hooks.primaryPattern, 'kept text');
  assert.ok(a.statsPurgedAt);
  assert.equal(a.stats, undefined);
  assert.equal(a.earningsEstimate, undefined);
  assert.equal(a.evidence.videos[0].views, 0);
  assert.equal(res.body.channel.subscriberCount, 0);
  const stored = await row(oldId);
  assert.ok(stored.analysis.statsPurgedAt && stored.analysis.stats === undefined && stored.subscriber_count === null, 'the stored row is purged too');
});

test('a report younger than 30 days is untouched', { skip: PG_SKIP }, async () => {
  const res = makeRes();
  await handle(makeReq({ method: 'GET', query: { id: freshId }, userId: owner.id }), res);
  assert.equal(res.body.analysis.stats.medianViews, 41000);
  assert.equal(res.body.channel.subscriberCount, 5000);
  assert.equal((await row(freshId)).analysis.statsPurgedAt, undefined);
});

test('the daily sweep purges reports nobody opened, once, and leaves fresh ones alone', { skip: PG_SKIP }, async () => {
  assert.equal((await row(oldId2)).analysis.stats.medianViews, 41000, 'precondition: not yet purged');
  const cron = makePurgeCronHandler({ db: pg.pool, env: {} });
  const res = makeRes();
  await cron(makeReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.purged, 1, 'only the not-yet-purged old report');
  const stored = await row(oldId2);
  assert.ok(stored.analysis.statsPurgedAt && stored.analysis.stats === undefined && stored.subscriber_count === null);
  assert.equal((await row(freshId)).analysis.stats.medianViews, 41000);
  assert.equal(await purgeDueReports({}, pg.pool), 0, 'running it again changes nothing');
});

test('the sweep is refused without the secret when CRON_SECRET is set, and only GET is allowed', { skip: PG_SKIP }, async () => {
  const cron = makePurgeCronHandler({ purge: async () => { throw new Error('must not run'); }, env: { CRON_SECRET: 's3cret' } });
  for (const headers of [{}, { authorization: 'Bearer wrong' }]) {
    const res = makeRes();
    await cron(makeReq({ method: 'GET', headers }), res);
    assert.equal(res.statusCode, 401);
  }
  const res = makeRes();
  await cron(makeReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});

test('access rules are unchanged: a private old report is still 404 for another account', { skip: PG_SKIP }, async () => {
  const res = makeRes();
  await handle(makeReq({ method: 'GET', query: { id: oldId }, userId: other.id }), res);
  assert.equal(res.statusCode, 404);
});
