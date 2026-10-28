-- Analysis ledger: the atomic source of truth for quota, concurrency and retries.
--
-- Counting rows in `reports` after the fact cannot stop N parallel requests from all
-- passing the check, and it ignores failed runs and double submits. A run is reserved
-- BEFORE any paid upstream call, under a per-user advisory lock (lib/quota.js).
--
--   reserved   in flight (counts against quota; auto-expires after 120s if the function died)
--   succeeded  delivered (counts against quota)
--   failed     not delivered (refunded: does not count)
--
-- idem_key makes a retry of the SAME user action return the first result instead of
-- charging again. Provider-independent: nothing here knows about any payment provider.
CREATE TABLE IF NOT EXISTS analysis_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idem_key    text,
  channel_key text,
  status      text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'succeeded', 'failed')),
  report_id   uuid REFERENCES reports(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS analysis_runs_idem_uq ON analysis_runs (user_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS analysis_runs_user_created_idx ON analysis_runs (user_id, created_at DESC);

-- Carry this month's existing usage over so nobody gets a fresh allowance on deploy.
INSERT INTO analysis_runs (user_id, status, channel_key, report_id, created_at, finished_at)
SELECT r.user_id, 'succeeded', r.channel_id, r.id, r.created_at, r.created_at
FROM reports r
WHERE r.user_id IS NOT NULL
  AND (r.created_at AT TIME ZONE 'utc') >= date_trunc('month', now() AT TIME ZONE 'utc')
  AND NOT EXISTS (SELECT 1 FROM analysis_runs a WHERE a.report_id = r.id);
