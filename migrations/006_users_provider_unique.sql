-- Sign-in upserts users with ON CONFLICT (provider, provider_id), which needs a unique index on
-- exactly that pair. Production's users table predates these migrations (it came from the legacy
-- app), so 002's CREATE TABLE IF NOT EXISTS was a no-op and the constraint was never created:
-- every Google/GitHub sign-in failed with "no unique or exclusion constraint matching the ON
-- CONFLICT specification". Additive and idempotent. On a database built by 002 the same-named
-- constraint already exists and this does nothing. Rollback: DROP INDEX users_provider_provider_id_key.
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_provider_id_key ON users (provider, provider_id);
