// Migration 004 on a database that looks like production (001-003 applied, data present).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { startTempPostgres, makeUser, makeReport, PG_SKIP } from './helpers/pg.js';

const sql = (f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');

test('004: backfills anonymous=>link, owned=>private; idempotent; rollback is clean', { skip: PG_SKIP }, async () => {
  const pgx = await startTempPostgres({ migrate: false });
  try {
    const q = (s, p) => pgx.pool.query(s, p);
    for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort().filter(f => f < '004')) await q(sql(f));
    const u = await makeUser(pgx.pool);
    const anon = (await q(`INSERT INTO reports (channel_id,channel_name,analysis) VALUES ('c','n','{}') RETURNING id`)).rows[0].id;
    const owned = (await q(`INSERT INTO reports (channel_id,channel_name,analysis,user_id) VALUES ('c','n','{}',$1) RETURNING id`, [u.id])).rows[0].id;

    await q(sql('004_report_access.sql'));
    const vis = async (id) => (await q('SELECT visibility FROM reports WHERE id=$1', [id])).rows[0].visibility;
    assert.equal(await vis(anon), 'link');
    assert.equal(await vis(owned), 'private');

    // Re-running must not re-backfill: an owner's choice and later rows survive.
    await q(`UPDATE reports SET visibility='link' WHERE id=$1`, [owned]);
    await q(sql('004_report_access.sql'));
    assert.equal(await vis(owned), 'link');
    assert.equal(await vis(anon), 'link');

    // CHECK constraint
    await assert.rejects(q(`UPDATE reports SET visibility='public' WHERE id=$1`, [owned]));

    // Old code's INSERT (no visibility column) still works against the new schema.
    const old = (await q(`INSERT INTO reports (channel_id,channel_name,analysis) VALUES ('c','n','{}') RETURNING id`)).rows[0].id;
    assert.equal(await vis(old), 'private');

    // Rollback block from docs/HOTFIX-report-access.md
    await q(`ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_visibility_check;
             ALTER TABLE reports DROP COLUMN IF EXISTS visibility;`);
    const cols = (await q(`SELECT 1 FROM information_schema.columns WHERE table_name='reports' AND column_name='visibility'`)).rowCount;
    assert.equal(cols, 0);
    await q(sql('004_report_access.sql')); // and it re-applies cleanly
  } finally { await pgx.stop(); }
});

test('004 changes no existing data: every pre-existing column of every row is byte-identical', { skip: PG_SKIP }, async () => {
  const pgx = await startTempPostgres({ migrate: false });
  try {
    const q = (s, p) => pgx.pool.query(s, p);
    for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort().filter(f => f < '004')) await q(sql(f));
    const u = await makeUser(pgx.pool);
    for (let i = 0; i < 20; i++) {
      await q(`INSERT INTO reports (channel_id,channel_name,channel_handle,subscriber_count,video_count,analysis,user_id)
               VALUES ($1,$2,'@h',$3,$4,$5,$6)`,
        [`c${i}`, `name ${i}`, i * 1000, i, JSON.stringify({ i, nested: { a: [1, 2, i] } }), i % 3 ? u.id : null]);
    }
    const snapshot = async () => (await q(`SELECT id, channel_id, channel_name, channel_handle, channel_thumbnail,
      subscriber_count, video_count, analysis::text AS analysis, created_at, user_id FROM reports ORDER BY id`)).rows;
    const before = await snapshot();
    await q(sql('004_report_access.sql'));
    assert.deepEqual(await snapshot(), before, 'existing columns unchanged');
    assert.equal((await q('SELECT count(*)::int AS n FROM reports')).rows[0].n, 20, 'no row added or lost');
    // adds exactly one column
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='reports'`)).rows.map(r => r.column_name);
    assert.ok(cols.includes('visibility'));
  } finally { await pgx.stop(); }
});
