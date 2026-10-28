-- Report access control (P0 hotfix: cross-account report exposure).
--
-- Every report gets an explicit visibility:
--   private  owner only (default for everything created from now on)
--   link     anyone holding the link (read-only); only the owner can change it
--
-- One-time backfill, done only in the step that creates the column:
--   user_id IS NULL     -> 'link'    anonymous reports have no owner and the published
--                                    privacy policy said "anyone with the link"; URLs keep working.
--   user_id IS NOT NULL -> 'private' signed-in users never consented to publication.
--                                    Their old URLs stop working for everyone but them.
--
-- Additive and idempotent. Deploy order: apply this, then deploy the code.
-- Rollback: see docs/HOTFIX-report-access.md (old code ignores the column).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'reports' AND column_name = 'visibility'
  ) THEN
    ALTER TABLE reports ADD COLUMN visibility text NOT NULL DEFAULT 'private';
    UPDATE reports SET visibility = 'link' WHERE user_id IS NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_visibility_check') THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_visibility_check CHECK (visibility IN ('private', 'link'));
  END IF;
END $$;
