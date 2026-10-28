// P0 regression suite: cross-account report exposure.
// Runs the REAL handlers against a REAL (throwaway) Postgres with several separate accounts
// and unauthenticated callers. It skips, loudly, if Postgres binaries are not installed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PG_SKIP, startTempPostgres, makeUser, makeReport } from './helpers/pg.js';
import { makeReq, makeRes, everythingSent } from './helpers/http.js';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';
const { makeReportHandler } = await import('../lib/handlers/report.js');
const { makeReportsListHandler } = await import('../lib/handlers/reports-list.js');
const { insertReport } = await import('../lib/reports.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pg, handleReport, handleList, alice, bob, mallory;
let alicePrivate, aliceShared, legacyAnon, bobPrivate;

before(async () => {
  if (PG_SKIP) return;
  pg = await startTempPostgres();
  handleReport = makeReportHandler({ db: pg.pool });
  handleList = makeReportsListHandler({ db: pg.pool });
  alice = await makeUser(pg.pool);
  bob = await makeUser(pg.pool);
  mallory = await makeUser(pg.pool); // an unrelated third account
  alicePrivate = await makeReport(pg.pool, { userId: alice.id, name: 'Alice secret channel' });
  aliceShared = await makeReport(pg.pool, { userId: alice.id, visibility: 'link', name: 'Alice shared' });
  bobPrivate = await makeReport(pg.pool, { userId: bob.id, name: 'Bob secret channel' });
  legacyAnon = await makeReport(pg.pool, { userId: null, visibility: 'link', name: 'Legacy anonymous' });
});
after(async () => { await pg?.stop(); });

const opts = { skip: PG_SKIP };
const get = async (id, who) => {
  const res = makeRes();
  await handleReport(makeReq({ query: { id }, userId: who?.id }), res);
  return res;
};
const send = async (method, id, who, body, headers) => {
  const res = makeRes();
  await handleReport(makeReq({ method, query: { id }, userId: who?.id, body, headers }), res);
  return res;
};

test('migration default: a report created now is private; anonymous legacy rows were backfilled to link', opts, async () => {
  const id = await insertReport({ channel: { id: 'UCx', name: 'n', handle: '@n', thumbnailUrl: '', subscriberCount: 1 }, videoCount: 5, analysis: {}, userId: alice.id }, pg.pool);
  const row = (await pg.pool.query('SELECT visibility FROM reports WHERE id=$1', [id])).rows[0];
  assert.equal(row.visibility, 'private');
});

test('owner can read their own private report; user_id never leaves the server', opts, async () => {
  const res = await get(alicePrivate, alice);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.isOwner, true);
  assert.equal(res.body.visibility, 'private');
  assert.doesNotMatch(everythingSent(res), /user_?id/i);
  assert.doesNotMatch(everythingSent(res), new RegExp(alice.id));
});

test('ANOTHER signed-in account cannot read a private report (404, not 403)', opts, async () => {
  for (const who of [bob, mallory]) {
    const res = await get(alicePrivate, who);
    assert.equal(res.statusCode, 404, `${who.email} must not see Alice's private report`);
    assert.doesNotMatch(everythingSent(res), /secret|Alice/i);
  }
});

test('an unauthenticated caller cannot read a private report', opts, async () => {
  const res = await get(alicePrivate, null);
  assert.equal(res.statusCode, 404);
  assert.doesNotMatch(everythingSent(res), /secret|Alice/i);
});

test('private-and-forbidden is indistinguishable from nonexistent (no UUID probing)', opts, async () => {
  const forbidden = await get(alicePrivate, bob);
  const missing = await get('00000000-0000-4000-8000-000000000000', bob);
  assert.equal(forbidden.statusCode, missing.statusCode);
  assert.deepEqual(forbidden.body, missing.body);
});

test('a link-shared report is readable by others and anonymous callers, read-only', opts, async () => {
  for (const who of [bob, null]) {
    const res = await get(aliceShared, who);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isOwner, false);
    assert.equal(res.body.visibility, 'link');
  }
});

test('anonymous legacy reports (no owner) keep working by link', opts, async () => {
  const res = await get(legacyAnon, null);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.isOwner, false);
});

test('a non-owner cannot share, unshare or delete someone else\'s report, and nothing changes', opts, async () => {
  const patch = await send('PATCH', alicePrivate, bob, { visibility: 'link' });
  assert.equal(patch.statusCode, 404);
  const del = await send('DELETE', alicePrivate, bob);
  assert.equal(del.statusCode, 404);
  const patchShared = await send('PATCH', aliceShared, bob, { visibility: 'private' });
  assert.equal(patchShared.statusCode, 404);

  const rows = (await pg.pool.query('SELECT id, visibility FROM reports WHERE id = ANY($1)', [[alicePrivate, aliceShared]])).rows;
  assert.equal(rows.length, 2, 'both reports still exist');
  assert.equal(rows.find(r => r.id === alicePrivate).visibility, 'private');
  assert.equal(rows.find(r => r.id === aliceShared).visibility, 'link');
});

test('anonymous mutation attempts are rejected with 401', opts, async () => {
  assert.equal((await send('PATCH', alicePrivate, null, { visibility: 'link' })).statusCode, 401);
  assert.equal((await send('DELETE', alicePrivate, null)).statusCode, 401);
});

test('cross-site mutation is refused even for the owner (CSRF)', opts, async () => {
  const res = await send('PATCH', alicePrivate, alice, { visibility: 'link' }, { 'sec-fetch-site': 'cross-site' });
  assert.equal(res.statusCode, 403);
  const bad = await send('DELETE', alicePrivate, alice, undefined, { origin: 'https://evil.example' });
  assert.equal(bad.statusCode, 403);
});

test('sharing is revocable: owner shares, others can read, owner unshares, others lose access', opts, async () => {
  const id = await makeReport(pg.pool, { userId: alice.id, name: 'Toggle me' });
  assert.equal((await get(id, bob)).statusCode, 404);
  assert.equal((await send('PATCH', id, alice, { visibility: 'link' })).statusCode, 200);
  assert.equal((await get(id, bob)).statusCode, 200);
  assert.equal((await get(id, null)).statusCode, 200);
  assert.equal((await send('PATCH', id, alice, { visibility: 'private' })).statusCode, 200);
  assert.equal((await get(id, bob)).statusCode, 404);
  assert.equal((await get(id, null)).statusCode, 404);
});

test('invalid visibility and malformed ids are rejected', opts, async () => {
  assert.equal((await send('PATCH', alicePrivate, alice, { visibility: 'public' })).statusCode, 400);
  assert.equal((await send('PATCH', alicePrivate, alice, {})).statusCode, 400);
  assert.equal((await get('not-a-uuid', alice)).statusCode, 400);
  assert.equal((await get("' OR 1=1 --", alice)).statusCode, 400);
});

test('the owner can delete; the report is then gone for everyone', opts, async () => {
  const id = await makeReport(pg.pool, { userId: bob.id, visibility: 'link' });
  assert.equal((await send('DELETE', id, bob)).statusCode, 200);
  assert.equal((await get(id, bob)).statusCode, 404);
  assert.equal((await get(id, null)).statusCode, 404);
});

test('every report response is uncacheable by shared caches and varies by credentials', opts, async () => {
  for (const [id, who] of [[alicePrivate, alice], [alicePrivate, bob], [aliceShared, null], ['x', null]]) {
    const res = await get(id, who);
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.match(res.headers.vary, /Cookie/);
  }
});

test('history lists only the caller\'s own reports, never another account\'s, and no analysis bodies', opts, async () => {
  const list = async (who, query = {}) => {
    const res = makeRes();
    await handleList(makeReq({ query, userId: who?.id }), res);
    return res;
  };
  const a = await list(alice);
  const b = await list(bob);
  assert.equal(a.statusCode, 200);
  const aIds = a.body.reports.map(r => r.reportId);
  const bIds = b.body.reports.map(r => r.reportId);
  assert.ok(aIds.includes(alicePrivate) && aIds.includes(aliceShared));
  assert.ok(!aIds.includes(bobPrivate) && !aIds.includes(legacyAnon));
  assert.ok(bIds.includes(bobPrivate));
  assert.ok(!bIds.includes(alicePrivate) && !bIds.includes(aliceShared), 'a shared link is not part of another user\'s history');
  assert.doesNotMatch(everythingSent(a), /secret strategy|"analysis"/);

  // No parameter can widen the scope.
  const sneaky = await list(bob, { user_id: alice.id, userId: alice.id, all: '1', limit: '1000' });
  assert.ok(!sneaky.body.reports.some(r => aIds.includes(r.reportId)));
  assert.equal((await list(null)).statusCode, 401);
  assert.equal(a.headers['cache-control'], 'private, no-store');
});

test('INVARIANT: only lib/reports.js may read or write the reports table', () => {
  const offenders = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js') && !p.endsWith(join('lib', 'reports.js'))) {
        const src = readFileSync(p, 'utf8');
        if (/\b(FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+reports\b/i.test(src)) offenders.push(p.replace(ROOT + '/', ''));
      }
    }
  };
  walk(join(ROOT, 'api'));
  walk(join(ROOT, 'lib'));
  assert.deepEqual(offenders, [], 'these files query `reports` outside the single authorized path');
});

test('INVARIANT: no endpoint publishes "the latest report" (the old /api/featured leak is gone)', () => {
  assert.equal(existsSync(join(ROOT, 'api', 'featured.js')), false);
  const apiSources = [];
  const walk = dir => readdirSync(dir).forEach(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.js')) apiSources.push(readFileSync(p, 'utf8'));
  });
  walk(join(ROOT, 'api'));
  walk(join(ROOT, 'lib'));
  assert.ok(!apiSources.some(s => /ORDER BY created_at DESC\s+LIMIT 1\b/i.test(s)));
});
