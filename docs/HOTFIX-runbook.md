# Hotfix runbook: production review, exact commands, re-share support

Nothing here has been run against production. Every query is read-only unless marked WRITE.
Results contain emails (personal data): keep them out of shared channels and tickets.
Run SQL in the Neon SQL editor for the PRODUCTION branch, not from this repo.

## A. Read-only review (before approving the deploy)

### A1. Sizes (expected backfill and Option A impact)
```sql
SELECT count(*)                                         AS reports,
       count(*) FILTER (WHERE user_id IS NULL)          AS anonymous_reports,  -- stay readable (link)
       count(*) FILTER (WHERE user_id IS NOT NULL)      AS signed_in_reports,  -- become private (Option A)
       count(DISTINCT user_id)                          AS owners,
       min(created_at) FILTER (WHERE user_id IS NOT NULL) AS first_signed_in_report,
       max(created_at)                                  AS last_report
FROM reports;
SELECT to_regclass('_migrations') IS NOT NULL AS has_migrations_table;
SELECT name, applied_at FROM _migrations ORDER BY name;  -- 004 must be absent
```

### A2. Exposure through /api/featured (upper bound; real views are unknowable, logs keep 1 hour)
Each report was "the featured report" from its creation until the next report was created
(the response was CDN-cached ~5 min). `was_featured_for` is the maximum time it could have been public.
```sql
SELECT id, (user_id IS NOT NULL) AS signed_in, channel_name, created_at,
       lead(created_at) OVER (ORDER BY created_at) - created_at AS was_featured_for
FROM reports
WHERE created_at >= '2026-06-18'          -- /api/featured was added this day
ORDER BY created_at;
```
Prioritise `signed_in = true` rows with long `was_featured_for`.

### A3. Owners (who needs a re-share option or a notice)
```sql
SELECT u.email, u.provider, u.plan, count(r.id) AS reports, max(r.created_at) AS last_report
FROM users u JOIN reports r ON r.user_id = u.id
GROUP BY 1,2,3 ORDER BY reports DESC;
```

### A4. OAuth takeover review (unverified-email linking existed in production)
Old code logged in with an unverified GitHub email and linked by email. A takeover of an existing
account leaves no trace in `users` (the attacker's provider id was never stored); a pre-claimed
address leaves a GitHub row. Review:
```sql
SELECT provider, count(*) FROM users GROUP BY 1;
SELECT id, email, name, created_at FROM users WHERE provider = 'github' ORDER BY created_at;
  -- confirm each is a person you recognise or can verify; an address you cannot tie to its owner is suspect
SELECT u.email, k.name, k.created_at, k.last_used_at, k.revoked_at
FROM api_keys k JOIN users u ON u.id = k.user_id ORDER BY k.created_at;
  -- keys created or used at odd times or by unknown clients
```
For any suspect account: contact the address owner out of band, revoke API keys, and (WRITE, with approval)
`DELETE FROM users WHERE id = '<id>'` only after exporting its reports.

## B. Exact release commands

Preconditions: clean checkout, you approved A1-A4 results, Option A confirmed.

```bash
git fetch origin
git switch hotfix-report-access
git status --short                                   # must print nothing
git merge-base --is-ancestor origin/master HEAD && echo "fast-forward OK"
git diff --stat origin/master...HEAD                 # 15 files; none under web/ or docs/wavecrest-3/
LC_ALL=en_US.UTF-8 npm test                          # 35 pass
git ls-remote origin master                          # note the SHA (expect e4b7943...); this is the fix-forward base
```

1. **Backup:** Neon dashboard, note a restore point / branch. (manual)
2. **Migration (WRITE, additive):** paste `migrations/004_report_access.sql` into the Neon SQL editor, then
   ```sql
   INSERT INTO _migrations (name) VALUES ('004_report_access.sql') ON CONFLICT DO NOTHING;
   ```
   Verify: `SELECT (user_id IS NULL) AS anonymous, visibility, count(*) FROM reports GROUP BY 1,2;` must show
   anonymous=true only `link`, anonymous=false only `private`, counts equal to A1.
3. **Deploy (WRITE):** `git push origin hotfix-report-access:master` (fast-forward; never `--force`; never `vercel --prod`).
   Wait until Vercel shows the new production deployment READY (`githubCommitRef: master`).
4. **Repair (WRITE):** within minutes of step 3:
   ```sql
   SELECT count(*) FROM reports WHERE user_id IS NULL AND visibility = 'private';   -- preview N
   BEGIN;
   UPDATE reports SET visibility = 'link'
   WHERE user_id IS NULL AND visibility = 'private'
     AND created_at >= (SELECT applied_at FROM _migrations WHERE name = '004_report_access.sql')
   RETURNING id;                                                                      -- must return exactly N rows
   COMMIT;   -- or ROLLBACK if the count differs
   ```
5. **Checks:** the post-deploy list in `HOTFIX-report-access.md` with two real accounts and a logged-out browser,
   plus: open an old `/app?r=<id>` link of an anonymous report in a browser (renders), sign in as an owner and
   confirm the Private / Shared toggle appears and works.

Fix forward, never roll back to the old build: see "Fallback ladder" in `HOTFIX-report-access.md`.
Containment without a deploy: Vercel Firewall rule blocking `GET /api/report/*` and `/api/featured` (dashboard).

## C. Re-share support (an owner asks for an old report to be shared again)

Owners can now do it themselves in the report view. For a user who cannot, WRITE (one row, owner-scoped):
```sql
UPDATE reports SET visibility = 'link'
WHERE id = '<report uuid>' AND user_id = (SELECT id FROM users WHERE email = '<owner email>')
RETURNING id, visibility;
```
Zero rows returned = wrong id or not that owner's report; do not widen the WHERE.
