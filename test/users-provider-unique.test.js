// Production's users table is the legacy-app table: no UNIQUE (provider, provider_id), so every
// sign-in upsert failed. Reproduces that shape on a throwaway Postgres and proves migration 006 fixes it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { startTempPostgres, PG_SKIP } from './helpers/pg.js';
import { upsertUser } from '../lib/auth.js';

const sql = (f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');
const LEGACY_USERS = `CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, password_hash text, name text, avatar_url text,
  plan text NOT NULL DEFAULT 'free', provider text NOT NULL DEFAULT 'email', stripe_customer_id varchar, is_beta boolean,
  created_at timestamptz NOT NULL DEFAULT now(), email_verified boolean, digest_enabled boolean, digest_token text UNIQUE,
  discord_webhook_url text, referral_code varchar UNIQUE, referred_by uuid REFERENCES users(id), bonus_searches integer, provider_id text)`;

test('legacy users table: sign-in fails without the index and works with migration 006', { skip: PG_SKIP }, async () => {
  const pgx = await startTempPostgres({ migrate: false });
  try {
    const q = (s, p) => pgx.pool.query(s, p);
    await q(LEGACY_USERS);
    for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort().filter(f => f < '006')) await q(sql(f));
    const who = { email: 'A@Example.test', name: 'A', avatarUrl: '', provider: 'google', providerId: 'g-1' };

    await assert.rejects(upsertUser(who, pgx.pool), /ON CONFLICT specification/, 'reproduces production');

    await q(sql('006_users_provider_unique.sql'));
    await q(sql('006_users_provider_unique.sql')); // idempotent
    const first = await upsertUser(who, pgx.pool);
    const again = await upsertUser({ ...who, name: 'A2' }, pgx.pool);
    assert.equal(again.id, first.id, 'a second login is the same account');
    const other = await upsertUser({ ...who, provider: 'github', providerId: 'h-9' }, pgx.pool);
    assert.equal(other.id, first.id, 'a verified email links the other provider to the same account');
    assert.equal((await q('SELECT count(*)::int n FROM users')).rows[0].n, 1);
  } finally { await pgx.stop(); }
});

test('a database built by migration 002 already has the constraint, so 006 adds nothing', { skip: PG_SKIP }, async () => {
  const pgx = await startTempPostgres({ migrate: false });
  try {
    const q = (s) => pgx.pool.query(s);
    for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) await q(sql(f));
    const n = (await q(`SELECT count(*)::int n FROM pg_indexes WHERE tablename='users' AND indexdef LIKE '%(provider, provider_id)%'`)).rows[0].n;
    assert.equal(n, 1, 'exactly one unique index on (provider, provider_id)');
  } finally { await pgx.stop(); }
});
