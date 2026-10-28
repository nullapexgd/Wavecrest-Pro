// Multi-account isolation tests for report access. Runs the REAL handlers against a
// throwaway Postgres (unix socket in a temp dir; never touches DB_URL/DATABASE_URL from env).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { startTempPostgres, makeUser, makeReport, PG_SKIP } from './helpers/pg.js';
import { makeReq, makeRes } from './helpers/http.js';

let pgx, handler, saveReport, A, B, repA, repB, repLinkB, repAnon;

before(async () => {
  if (PG_SKIP) return;
  pgx = await startTempPostgres();
  process.env.DB_URL = `postgres://test@localhost/app?host=${pgx.options.host}`;
  handler = (await import('../api/report/[id].js')).default;
  ({ saveReport } = await import('../lib/db.js'));
  A = await makeUser(pgx.pool);
  B = await makeUser(pgx.pool);
  repA = await makeReport(pgx.pool, { userId: A.id });                       // default => private
  repB = await makeReport(pgx.pool, { userId: B.id });                       // default => private
  repLinkB = await makeReport(pgx.pool, { userId: B.id, visibility: 'link' });
  repAnon = await makeReport(pgx.pool, { userId: null, visibility: 'link' });
});
after(async () => { if (pgx) { await (await import('../lib/db.js')).getPool().end(); await pgx.stop(); } });

const call = async (opts) => { const res = makeRes(); await handler(makeReq(opts), res); return res; };
const get = (id, userId) => call({ query: { id }, userId });

const skip = PG_SKIP || false;

test('schema default is private', { skip }, async () => {
  const r = await pgx.pool.query('SELECT visibility FROM reports WHERE id=$1', [repB]);
  assert.equal(r.rows[0].visibility, 'private');
});

test('owner can read their own private report', { skip }, async () => {
  const res = await get(repA, A.id);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.isOwner, true);
  assert.equal(res.body.visibility, 'private');
  assert.ok(res.body.analysis);
});

test('user A cannot read user B private report: 404, no data leaked', { skip }, async () => {
  const res = await get(repB, A.id);
  assert.equal(res.statusCode, 404);
  assert.ok(!JSON.stringify(res.body).includes('secret strategy'));
});

test('anonymous cannot read a private report', { skip }, async () => {
  const res = await get(repA, null);
  assert.equal(res.statusCode, 404);
});

test('private-not-yours is indistinguishable from nonexistent (guessed UUIDs get 404)', { skip }, async () => {
  const priv = await get(repB, A.id);
  const ghost = await get(randomUUID(), A.id);
  assert.equal(priv.statusCode, 404);
  assert.deepEqual(priv.body, ghost.body);
  for (let i = 0; i < 20; i++) assert.equal((await get(randomUUID(), null)).statusCode, 404);
});

test('forged / tampered session cookie sees nothing private', { skip }, async () => {
  const res = makeRes();
  await handler(makeReq({ query: { id: repB }, headers: { cookie: 'wc_session=eyJ1aWQiOiJ4In0.AAAA' } }), res);
  assert.equal(res.statusCode, 404);
});

test('link-shared reports are readable by anyone, as non-owner', { skip }, async () => {
  for (const viewer of [null, A.id]) {
    const res = await get(repLinkB, viewer);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isOwner, false);
  }
  assert.equal((await get(repAnon, null)).statusCode, 200);
  assert.equal((await get(repLinkB, B.id)).body.isOwner, true);
});

test('shared-link reports are readable but NOT modifiable or deletable by non-owners', { skip }, async () => {
  for (const [method, body] of [['PATCH', { visibility: 'private' }], ['DELETE', undefined]]) {
    const asA = await call({ method, query: { id: repLinkB }, userId: A.id, body });
    assert.equal(asA.statusCode, 404, `${method} as other user`);
    const anon = await call({ method, query: { id: repLinkB }, body });
    assert.equal(anon.statusCode, 401, `${method} anonymous`);
  }
  const still = await pgx.pool.query('SELECT visibility FROM reports WHERE id=$1', [repLinkB]);
  assert.equal(still.rows[0]?.visibility, 'link');
});

test('user A cannot share, unshare or delete user B private report', { skip }, async () => {
  assert.equal((await call({ method: 'PATCH', query: { id: repB }, userId: A.id, body: { visibility: 'link' } })).statusCode, 404);
  assert.equal((await call({ method: 'DELETE', query: { id: repB }, userId: A.id })).statusCode, 404);
  const r = await pgx.pool.query('SELECT visibility FROM reports WHERE id=$1', [repB]);
  assert.equal(r.rows[0]?.visibility, 'private');
  assert.equal((await get(repB, null)).statusCode, 404);
});

test('anonymous cannot modify or delete an ownerless link report', { skip }, async () => {
  assert.equal((await call({ method: 'DELETE', query: { id: repAnon }, userId: A.id })).statusCode, 404);
  assert.equal((await call({ method: 'PATCH', query: { id: repAnon }, userId: A.id, body: { visibility: 'private' } })).statusCode, 404);
  assert.equal((await get(repAnon, null)).statusCode, 200);
});

test('owner can share, unshare (revocable), then delete', { skip }, async () => {
  const id = await makeReport(pgx.pool, { userId: A.id });
  assert.equal((await get(id, B.id)).statusCode, 404);
  const shared = await call({ method: 'PATCH', query: { id }, userId: A.id, body: { visibility: 'link' } });
  assert.equal(shared.statusCode, 200);
  assert.equal((await get(id, B.id)).statusCode, 200);
  assert.equal((await get(id, null)).statusCode, 200);
  await call({ method: 'PATCH', query: { id }, userId: A.id, body: { visibility: 'private' } });
  assert.equal((await get(id, B.id)).statusCode, 404);
  assert.equal((await call({ method: 'DELETE', query: { id }, userId: A.id })).statusCode, 200);
  assert.equal((await get(id, A.id)).statusCode, 404);
});

test('PATCH rejects invalid visibility values', { skip }, async () => {
  for (const v of ['public', '', null, 1, undefined]) {
    const res = await call({ method: 'PATCH', query: { id: repA }, userId: A.id, body: { visibility: v } });
    assert.equal(res.statusCode, 400);
  }
});

test('malformed ids are rejected before touching the DB; unsupported methods 405', { skip }, async () => {
  assert.equal((await get("x' OR '1'='1", A.id)).statusCode, 400);
  assert.equal((await call({ method: 'POST', query: { id: repA }, userId: A.id })).statusCode, 405);
});

test('report responses are never cacheable by a shared cache', { skip }, async () => {
  for (const res of [await get(repAnon, null), await get(repA, A.id), await get(repB, A.id)]) {
    assert.equal(res.headers['cache-control'], 'private, no-store');
    assert.match(res.headers.vary, /Cookie/);
  }
});

test('no endpoint publishes "the latest report": /api/featured is gone', () => {
  assert.ok(!existsSync(new URL('../api/featured.js', import.meta.url)));
  assert.ok(!readFileSync(new URL('../vercel.json', import.meta.url), 'utf8').includes('featured'));
});

test('saveReport: signed-in => private, anonymous => link (ownerless)', { skip }, async () => {
  const ch = { id: 'UCx', name: 'N', handle: '@n', thumbnailUrl: 't', subscriberCount: 1 };
  const mine = await saveReport(ch, 5, { a: 1 }, A.id);
  const anon = await saveReport(ch, 5, { a: 1 }, null);
  const rows = (await pgx.pool.query('SELECT id, visibility FROM reports WHERE id = ANY($1)', [[mine, anon]])).rows;
  assert.equal(rows.find(r => r.id === mine).visibility, 'private');
  assert.equal(rows.find(r => r.id === anon).visibility, 'link');
  assert.equal((await get(mine, B.id)).statusCode, 404);
});
