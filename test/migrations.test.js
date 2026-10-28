// Applies migrations to a database that already holds realistic LEGACY data, the way
// production would, and checks the backfill rules and idempotency. Throwaway Postgres only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PG_SKIP, startTempPostgres } from './helpers/pg.js';

const MIG = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const sql = f => readFileSync(join(MIG, f), 'utf8');
let pg, owner, ownedId, anonId, ownedThisMonth, oldOwned;

before(async () => {
  if (PG_SKIP) return;
  pg = await startTempPostgres({ migrate: false });
  for (const f of ['001_reports.sql', '002_users.sql', '003_api_keys.sql']) await pg.pool.query(sql(f));
  owner = (await pg.pool.query(
    `INSERT INTO users (email, provider, provider_id, plan) VALUES ('o@example.test','github','1','pro') RETURNING id`)).rows[0].id;
  const ins = async (userId, createdAt) => (await pg.pool.query(
    `INSERT INTO reports (channel_id, channel_name, analysis, user_id, created_at)
     VALUES ('UC1','Chan','{}'::jsonb,$1,$2) RETURNING id`, [userId, createdAt])).rows[0].id;
  anonId = await ins(null, new Date().toISOString());
  ownedThisMonth = await ins(owner, new Date().toISOString());
  oldOwned = await ins(owner, '2020-01-15T00:00:00Z');
});
after(async () => { await pg?.stop(); });
const opts = { skip: PG_SKIP };
const vis = async id => (await pg.pool.query('SELECT visibility FROM reports WHERE id=$1', [id])).rows[0].visibility;

test('004: owned reports become private, ownerless legacy reports stay link-readable', opts, async () => {
  await pg.pool.query(sql('004_report_access.sql'));
  assert.equal(await vis(anonId), 'link');
  assert.equal(await vis(ownedThisMonth), 'private');
  assert.equal(await vis(oldOwned), 'private');
});

test('004 is idempotent and never undoes a later owner decision', opts, async () => {
  await pg.pool.query("UPDATE reports SET visibility='private' WHERE id=$1", [anonId]);
  await pg.pool.query("UPDATE reports SET visibility='link' WHERE id=$1", [ownedThisMonth]);
  await pg.pool.query(sql('004_report_access.sql'));
  await pg.pool.query(sql('004_report_access.sql'));
  assert.equal(await vis(anonId), 'private', 're-running must not flip it back to link');
  assert.equal(await vis(ownedThisMonth), 'link');
});

test('004: the CHECK constraint rejects any visibility other than private/link', opts, async () => {
  await assert.rejects(pg.pool.query("UPDATE reports SET visibility='public' WHERE id=$1", [anonId]), /reports_visibility_check/);
});

test('005: this month\'s existing usage is carried into the ledger exactly once', opts, async () => {
  await pg.pool.query(sql('005_analysis_runs.sql'));
  await pg.pool.query(sql('005_analysis_runs.sql'));
  const runs = (await pg.pool.query('SELECT report_id, status FROM analysis_runs WHERE user_id=$1', [owner])).rows;
  assert.equal(runs.length, 1, 'only the owned report from this month, once, not the 2020 one or the anonymous one');
  assert.equal(runs[0].report_id, ownedThisMonth);
  assert.equal(runs[0].status, 'succeeded');
});

test('005: deleting a report keeps the ledger row (usage is not refunded by deletion)', opts, async () => {
  await pg.pool.query('DELETE FROM reports WHERE id=$1', [ownedThisMonth]);
  const runs = (await pg.pool.query('SELECT report_id FROM analysis_runs WHERE user_id=$1', [owner])).rows;
  assert.equal(runs.length, 1);
  assert.equal(runs[0].report_id, null);
});
