-- Report access control (P0: cross-account report exposure).
--
-- Before this, any report was readable by anyone holding its UUID and the
-- homepage published the newest report of ANY user. Now every report has an
-- owner (user_id) and an explicit visibility:
--   private  owner only (default for everything created from now on)
--   link     anyone with the link; set only by the owner
--
-- One-time backfill, performed only in the same step that creates the column:
--   user_id IS NULL     -> 'link'    anonymous legacy reports have no owner, and the
--                                    published privacy policy said "anyone with the link".
--                                    Their URLs keep working.
--   user_id IS NOT NULL -> 'private' signed-in users' reports were never consented to be
--                                    public. Owners can re-enable sharing in one click.
--                                    To keep old shared URLs alive instead, change the
--                                    UPDATE below to cover every row BEFORE applying.
--
-- Additive and idempotent. Deploy order: apply this, then deploy the code.
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

CREATE INDEX IF NOT EXISTS reports_user_created_desc_idx ON reports (user_id, created_at DESC);
