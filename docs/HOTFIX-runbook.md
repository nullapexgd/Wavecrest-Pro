# Hotfix runbook: report access + OAuth verified email

Branch `hotfix-report-access`, based on production's `origin/master` (`e4b7943`). **Nothing in this file has been run against production.**
Every step marked **GATE n** changes production and needs the owner's explicit, separate approval for that gate.
Everything else is read-only or local. Production deploys from **`master`** (verified from Vercel deployment history; `main` is a stale branch and is not deployed).

Files: this runbook, `HOTFIX-report-access.md` (design, decisions), `INCIDENT-report-access.md` (facts about the exposure).

## 1. Pre-deployment requirements (all must be true)

- [ ] Owner has read the redacted A1-A4 results (section 2) and decided on any follow-up for suspect accounts.
- [ ] A valid Neon restore point is confirmed (section 3).
- [ ] Option A (existing signed-in reports become private) confirmed. (Decided 2026-10-29.)
- [ ] Clean checkout of the hotfix branch; tests pass; diff is limited:
```bash
git fetch origin
git switch hotfix-report-access
git status --short                                    # prints nothing
git merge-base --is-ancestor origin/master HEAD && echo "fast-forward OK"
git diff --stat origin/master...HEAD                  # none of: web/ middleware.js index.html lib/quota.js docs/wavecrest-3
git diff --name-only origin/master...HEAD | grep -E '^(web/|middleware\.js|index\.html|vercel\.json|package(-lock)?\.json)' && echo "STOP: unrelated file" || echo "release limited to hotfix"
LC_ALL=en_US.UTF-8 npm test                           # all pass; the integration tests use a throwaway local Postgres only
git ls-remote origin master                           # expect e4b7943...; record it as the fix-forward base
```
- [ ] Never deploy with `vercel --prod` (it uploads the working directory) and never merge into `main`.

## 2. Production database review (read-only)

Run in the Neon SQL editor on the **production** branch. All statements are `SELECT`. Output is **redacted**: emails are masked and replaced by an 8-character `ref` (first 8 hex of md5 of the address); channel names and report content are never selected. To identify one person afterwards: `SELECT email FROM users WHERE substr(md5(email),1,8) = '<ref>'` (keep that out of shared channels). Paste the outputs back; do not paste connection strings.

**A1. Sizes and migration state** (what the backfill and Option A will do)
```sql
SELECT count(*)                                          AS reports,
       count(*) FILTER (WHERE user_id IS NULL)           AS anonymous_reports,   -- stay readable (link)
       count(*) FILTER (WHERE user_id IS NOT NULL)       AS signed_in_reports,   -- become private (Option A)
       count(DISTINCT user_id)                           AS owners,
       min(created_at) FILTER (WHERE user_id IS NOT NULL) AS first_signed_in_report,
       max(created_at)                                   AS last_report
FROM reports;
SELECT to_regclass('_migrations') IS NOT NULL AS has_migrations_table;
SELECT name, applied_at FROM _migrations ORDER BY name;   -- errors if the table is missing; 004 must be absent
SELECT column_name FROM information_schema.columns WHERE table_name = 'reports' ORDER BY ordinal_position;  -- no 'visibility' yet
```

**A2. Exposure through /api/featured** (upper bound only; real views cannot be known)
Each report was "the featured report" from its creation until the next report was created (response CDN-cached ~5 minutes).
```sql
SELECT id, (user_id IS NOT NULL) AS signed_in, created_at,
       lead(created_at) OVER (ORDER BY created_at) - created_at AS was_featured_for
FROM reports
WHERE created_at >= '2026-06-18'
ORDER BY created_at;
```

**A3. Owners** (who needs a re-share or a notice)
```sql
SELECT substr(md5(u.email),1,8) AS ref, u.provider, u.plan, count(r.id) AS reports, max(r.created_at) AS last_report
FROM users u JOIN reports r ON r.user_id = u.id
GROUP BY 1,2,3 ORDER BY reports DESC;
```

**A4. OAuth account concerns.** Old code accepted an unverified GitHub email and linked accounts by email. A takeover of an existing account leaves **no trace in `users`** (the attacker's provider id was never stored); a pre-claimed address leaves a GitHub row.
```sql
SELECT provider, count(*) FROM users GROUP BY 1;
SELECT substr(md5(email),1,8) AS ref, left(email,2) || '***@' || split_part(email,'@',2) AS masked, created_at
FROM users WHERE provider = 'github' ORDER BY created_at;
SELECT substr(md5(u.email),1,8) AS ref, k.created_at, k.last_used_at, k.revoked_at
FROM api_keys k JOIN users u ON u.id = k.user_id ORDER BY k.created_at;
```
**This release does not remove a planted account.** A `users` row created earlier with someone else's unverified email still signs its creator in through the stored provider id, and a later legitimate login by the real owner with the other provider would link into that row. Independent review of the diff flagged this. Remediation for any row you judge suspect needs your approval (**GATE 6**): export its reports, revoke its API keys, delete or reset the row, and tell the real owner out of band.

Reading the results: GitHub rows you cannot tie to a real person, and API keys created or used at odd times, are the leads. The results can show leads, not proof of a takeover. Do not draw "no one was affected" from empty output.

Neither the counts nor any result have been seen by the author; do not infer them.

## 3. Backup verification (owner, in the Neon console; creating a branch is a production-project change, so GATE 1)

Console labels vary by plan and version; the intent matters.
1. **History window.** Project → the `production` branch → *Backup & restore* (point-in-time restore). Write down the earliest restorable time. This depends on your plan; if it is short, do step 2 and 3.
2. **Snapshot branch (GATE 1).** *Branches → Create branch*, parent `production`, "current point in time", name `pre-hotfix-004-YYYYMMDD`. It is copy-on-write, takes no downtime, and does not change production. Open that branch's SQL editor and compare `SELECT count(*) FROM reports; SELECT count(*) FROM users; SELECT count(*) FROM api_keys;` with production: equal. Never point the app at it.
3. **Optional logical dump (GATE 1, local only).** Get the unpooled connection string from the console. Do not paste it into chat or commit it.
```bash
export PROD_DB_URL='postgres://...'    # from the Neon console
pg_dump "$PROD_DB_URL" --no-owner --format=custom --file="$HOME/wavecrest-pre-004-$(date +%Y%m%d-%H%M).dump"
pg_restore --list "$HOME"/wavecrest-pre-004-*.dump | grep -E 'TABLE DATA.*(reports|users|api_keys)'   # all three present
unset PROD_DB_URL
```
4. **Acceptance:** you can state (a) the restore point's timestamp, (b) its row counts equal production's, (c) how you would restore from it. Only then continue.

**Recovery that keeps the fix.** Prefer fix-forward (section 9). If data must be restored: keep the Firewall rule from section 9 active first; restore the branch to the restore point; the restored database has no `visibility` column, so immediately re-apply `migrations/004_report_access.sql` (idempotent), then the guarded repair (section 6), then verify counts. Data written after the restore point is lost. **Never redeploy the old build to recover.**

## 4. Migration execution and verification (GATE 2: apply migration 004)

`004` is additive and idempotent: adds `reports.visibility text NOT NULL DEFAULT 'private'` with a CHECK, backfills only inside the step that creates the column (`user_id IS NULL` → `link`, else `private`), never drops or rewrites data. Verified on throwaway databases: existing rows are byte-identical after it, re-running changes nothing, rollback restores the prior schema (test `migration-access.test.js`).
1. Paste `migrations/004_report_access.sql` into the Neon SQL editor (production branch), then:
```sql
INSERT INTO _migrations (name) VALUES ('004_report_access.sql') ON CONFLICT DO NOTHING;
```
(If A1 showed no `_migrations` table, stop and ask: the table must be created exactly as `scripts/migrate.js` does.)
2. Verify:
```sql
SELECT (user_id IS NULL) AS anonymous, visibility, count(*) FROM reports GROUP BY 1,2 ORDER BY 1 DESC,2;
```
Expect only `anonymous=true / link` and `anonymous=false / private`, with counts equal to A1. Anything else: stop.

## 5. Deployment from a clean branch (GATE 3: push to `master`)

Order is a hard requirement. Code before migration means every report read returns 500 and new analyses are not saved (an outage, not a leak).

Run immediately after section 4 (the old code stays safe against the new column, but anonymous reports it creates in between need section 6).
```bash
git status --short                                   # nothing
git fetch origin && git ls-remote origin master      # still the recorded e4b7943...
git push origin hotfix-report-access:master          # fast-forward only. NEVER --force.
```
Vercel builds `master` automatically. Wait until the deployment shows READY with `githubCommitRef: master` and the new SHA. If the push is rejected as non-fast-forward, stop: something else changed `master`.

## 6. Anonymous-report repair (GATE 4: one guarded UPDATE)

Why: between sections 4 and 5, the old code inserts anonymous reports as `private` with no owner, which nobody could open. Preview first (read-only):
```sql
SELECT count(*) FROM reports WHERE user_id IS NULL AND visibility = 'private';    -- N
```
Verified on a throwaway database: it touches exactly those rows, never a signed-in report, and is idempotent. Expected N: the number of anonymous analyses in the minutes between the migration and the deploy, probably 0. After approval:
```sql
BEGIN;
UPDATE reports SET visibility = 'link'
WHERE user_id IS NULL AND visibility = 'private'
  AND created_at >= (SELECT applied_at FROM _migrations WHERE name = '004_report_access.sql')
RETURNING id;                         -- must return exactly N rows
COMMIT;                               -- ROLLBACK if the count differs
```

## 7. Post-deployment smoke tests

Anonymous (read-only):
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://wavecrest.pro/api/featured                          # 404
curl -s -o /dev/null -w "%{http_code}\n" https://wavecrest.pro/api/report/<id of a SIGNED-IN report>  # 404 (use an id from section 2; do not print it)
curl -s -o /dev/null -w "%{http_code}\n" https://wavecrest.pro/api/report/<id of an anonymous report>  # 200
curl -sI https://wavecrest.pro/api/report/<id of an anonymous report> | grep -i cache-control          # private, no-store
```
Two real accounts (A, B) and a logged-out browser:
- [ ] A analyses a channel; the report opens at `/app?r=<id>` (deep link renders); A sees "Private: only you".
- [ ] B and the logged-out browser get "Report not found" for that link.
- [ ] A clicks the toggle: "Shared"; B and logged-out can open it and see no toggle; A clicks again: B gets "Report not found".
- [ ] An old anonymous report link opens in the browser; the homepage loads (its hero card keeps static content).
- [ ] The Share toggle browser check in a throwaway environment (no production): `LC_ALL=en_US.UTF-8 node scripts/share-flow-harness.mjs`, then open the printed owner/other URLs.

OAuth:
- [ ] A normal Google login and a normal GitHub login (verified primary email) succeed and land on `/app`; an existing user's id from `/api/auth/me` is unchanged.
- [ ] A GitHub account whose only email is unverified is refused (generic "Authentication failed"); no user row is created for it (re-run the A4 GitHub list: no new row).
- [ ] A Google account with an unverified email is refused (rare; test only if you have one).

## 8. Monitoring and failure detection

Vercel Hobby keeps **1 hour** of runtime logs, so watch live for the first hour, then rely on counts.
- Vercel → Logs, production, level Error, paths `/api/report/*` and `/api/auth/*`; also check `/` and the analyze flow end to end once.
- Failure signals: any 500 on `/api/report/*` (usually migration not applied), sign-in failures beyond the intended unverified-email refusals, anonymous report links returning 404.
- Re-run A1 after 24 hours: anonymous reports still `link`, no new anonymous `private` rows.
- There is no error tracking or uptime monitoring wired; that remains an open launch item.

## 9. Fix-forward and containment (never restore the vulnerable build)

Every older production deployment contains the vulnerability: do **not** use Vercel Instant Rollback or promote `e4b7943`.
1. **Fix forward (default).** Small commit on `hotfix-report-access`, same gates (`git push origin hotfix-report-access:master`). Typical: 500s on report routes = migration not applied (apply it, no code change).
2. **Contain without a deploy (GATE 5).** Vercel Firewall custom rule blocking `GET /api/report/*` and `/api/featured`. Instant, reversible, fails closed (reports unavailable). Remove the rule when fixed. May also be applied *before* this release to stop the ongoing exposure.
3. **Last resort:** the old build only while rung 2 is active.
4. **Schema:** never dropped; the `visibility` column stays under every rung. Migration 004 is not reversed.

## 10. Outstanding risks and deferred work

Not fixed by this release (each is real):
- **Stored XSS risk in `app.html` (pre-existing, unresolved).** The report renderer inserts some model-written values without escaping: pillar `percentage` (`data-width="${p.percentage}%"` and text), `analysis.cadence.avgDurationMinutes / videosPerMonth / peakDay` for older reports, and the channel's first character. The model's output is influenced by YouTube video titles, so a hostile channel could plant markup that runs for anyone who opens its report. Reports written by the current code compute the cadence fields themselves, which narrows but does not remove it. Fix (escape these four sinks) is a separate small change; the hotfix was kept narrow.
- **Security headers.** `vercel.json` sets nosniff, frame deny, referrer-policy and permissions-policy only. No `Content-Security-Policy`, no HSTS (Vercel serves HTTPS and may add its own HSTS on the platform domain; not verified for `wavecrest.pro`).
- **Quota race.** Concurrent analyses can exceed the monthly limit (needs the reservation ledger from the 3.0 work). Mitigation today: per-IP edge limit.
- **OAuth review.** Past takeovers cannot be ruled out from the database (section 2, A4). Accounts created through the old GitHub fallback may hold an unverified email.
- **Case sensitivity.** The hotfix does not normalise email case (kept to match existing accounts).
- **Request-time DDL** (`ensureTable` in `lib/db.js`) remains.
- **`main` branch** is stale and diverged; decide whether to delete or reset it so it cannot be deployed by mistake.
- **Two GitHub workflows** (legacy trends, digest) call endpoints the shipped app lacks; disable them.
- **Share toggle** is only in the old `app.html`; the 3.0 UI replaces it.
