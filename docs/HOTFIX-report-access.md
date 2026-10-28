# Hotfix: cross-user report exposure + OAuth email trust

Branch `hotfix-report-access`, based on `origin/master` (`e4b7943`). **Not pushed, not deployed, migration not applied anywhere.**
Every deploy / migration step below needs the owner's explicit approval.

## The bugs (production today)

1. `GET /api/featured` returns the **newest report of any user**, publicly, CDN-cached (`s-maxage=300`). A signed-in user's private analysis can appear on the homepage.
2. `GET /api/report/:id` returns any report to anyone holding the UUID; nothing records who owns it.
3. OAuth: accounts link by email. GitHub login falls back to the public profile email or `emails[0]` even if **unverified**; Google's `email_verified` is never checked. Claiming a victim's address on a provider = logged in as the victim.
4. (Not fixed here, see Deferred) concurrent requests can exceed the monthly quota.

## Diff summary

| File | Change |
|---|---|
| `api/featured.js` | **Deleted.** Nothing publishes "the latest report". `index.html` already ignores a non-OK response, so the homepage hero card simply keeps its static markup. |
| `api/report/[id].js` | GET: owner, or anyone if `visibility='link'`; otherwise **404** (identical body to a nonexistent id). Adds owner-only `PATCH {visibility}` and `DELETE` (ownership is in the SQL `WHERE`). Responses `Cache-Control: private, no-store`, `Vary: Cookie, Authorization`. Response gains `visibility` and `isOwner`; every existing field is unchanged. |
| `lib/reports.js` (new) | `canViewReport`, `getReportForViewer`, `setVisibility`, `deleteReport`. |
| `lib/db.js` | `saveReport` writes `visibility`: signed-in => `private`, anonymous => `link`. |
| `lib/oauth.js` (new) | `googleVerifiedEmail`, `githubVerifiedEmail`. |
| `api/auth/[...path].js` | Google requires `email_verified`. GitHub uses `/user/emails` and only a **verified** address (primary first); no public-email / `emails[0]` fallback. Callbacks are now `await`ed so their errors reach the existing `catch` (before, a refusal would have escaped it). |
| `migrations/004_report_access.sql` | Adds `reports.visibility` + CHECK. |
| `test/*` | `report-access`, `oauth`, `migration-access` tests + `helpers/` (throwaway Postgres, req/res doubles). |

Not touched: `app.html`, `index.html`, `middleware.js`, `lib/auth.js`, `lib/plans.js`, `api/analyze-stream.js`, `api/keys.js`, `web/`, no sample-creator endpoint.

## Behaviour decisions (change before applying if you disagree)

- **Anonymous reports (no owner) stay `link`-readable**, new and old. They have no account to leak from, the privacy policy says "anyone with the link", and the anonymous creator has no other way to reopen `?r=`.
- **Signed-in users' reports become `private`**, existing and new.
- 404, not 403, for private-and-not-yours.

## Migration 004

Additive and idempotent. New column `visibility text NOT NULL DEFAULT 'private'` with `CHECK IN ('private','link')`. The backfill (`user_id IS NULL` => `link`) runs only in the step that creates the column, so re-running never overwrites an owner's later choice. Metadata-only `ADD COLUMN ... DEFAULT` (PG 11+), no table rewrite.

**What happens to already-shared / old links**

| Report | After | Old URL |
|---|---|---|
| Anonymous (user_id NULL) | `link` | keeps working |
| Signed-in user's | `private` | works only for the owner while signed in; anyone else gets 404 |

To keep every old URL alive instead, change the `UPDATE` in the migration to cover all rows **before applying** (it re-opens the exposure for those rows).

### Apply

```bash
# against the real DB only after approval; reads DB_URL/DATABASE_URL from env
npm run migrate
```

### Rollback

Primary rollback is **redeploy the previous build**: old code ignores the column and keeps working. The old code is the leaky one, so that is a rollback of the *fix*. To also remove the schema change:

```sql
ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_visibility_check;
ALTER TABLE reports DROP COLUMN IF EXISTS visibility;
DELETE FROM _migrations WHERE name = '004_report_access.sql';
```

(Dropping the column loses owners' share/unshare choices. Tested in `migration-access.test.js`.)

## Deploy order: migration FIRST, then code

The new code selects/inserts `visibility`; without the column reads 500 and saves fail (fail closed, but broken). Old code runs fine against the new schema, so the window between the two steps is safe, with **one catch**: anonymous reports created by the old code in that window get the column default `private` with no owner, which nobody can open. After the code is live, run once (idempotent, harmless to repeat):

```sql
UPDATE reports SET visibility = 'link' WHERE user_id IS NULL AND visibility = 'private';
```

## Verification checklist

Pre-deploy (local/preview, no prod data)
- [ ] `LC_ALL=en_US.UTF-8 npm test` is green (see results below).
- [ ] Review the migration SQL; decide the "old signed-in links" question above.
- [ ] Optional read-only prod count, with approval: `SELECT user_id IS NULL AS anon, visibility, count(*) FROM reports GROUP BY 1,2;` after migration shows expected split.

Post-migration, pre-code
- [ ] `\d reports` shows `visibility` + check constraint; counts match the table above.

Post-deploy (use two real accounts A, B and a logged-out browser)
- [ ] `GET /api/featured` => 404 (also from a second network/region, in case a cached copy lingers).
- [ ] Run the heal `UPDATE` above.
- [ ] A creates a report; B and logged-out get 404 on `/api/report/<id>`; A gets 200.
- [ ] Anonymous analysis (logged out): result page loads, reload of `/app?r=<id>` still works.
- [ ] An old anonymous report URL still works logged out.
- [ ] `PATCH /api/report/<A's id>` as B => 404, as anon => 401; `{"visibility":"link"}` as A then B/anon => 200; back to `private` => 404.
- [ ] Response headers on `/api/report/<id>`: `Cache-Control: private, no-store`.
- [ ] GitHub account with only an unverified email cannot sign in; a normal verified Google/GitHub login works and lands on `/app`.
- [ ] Vercel function logs show no new 500s on `/api/report/*` or `/api/auth/*`.

## What breaks for existing users

- Signed-in users' previously shared report links stop working for other people (404) until re-shared. **The old UI has no share toggle**: "Copy link" copies a URL that only the owner can open. Re-sharing is possible only via `PATCH /api/report/:id` until a UI exists (or tell users which ones to flip; or run the "keep old links" variant above).
- Homepage hero "featured" card no longer shows live data (static content only; no error shown).
- Users whose GitHub account has no verified email, or whose Google email is unverified, can no longer sign in (a generic 500 "Authentication failed"). Unlikely for real accounts.
- Anyone who copied `GET /api/featured` data in the past already has it; nothing here can recall it.

## Deferred (not in this hotfix)

- **Quota race (concurrent requests).** `checkUsage` counts saved reports *before* a multi-second analysis and the report is inserted *after*, so N parallel requests all pass. A correct fix needs a reservation ledger written under a per-user lock before any paid upstream call (`wavecrest-3` `9867cd8`: migration 005 + `lib/quota.js`). That is a new table, an analyze-flow rewrite and refund/expiry logic, i.e. not minimal or safely separable here. Interim mitigation already in place: the per-IP edge limit (5/hr). Consider also lowering it or a manual cap for the free plan if abuse is seen.
- **Poisoned existing users.** A row in `users` created through the old GitHub fallback may hold an unverified email an attacker chose, and a later verified login with that email links to it. The DB cannot tell. Suggested follow-up (needs approval): read-only review of `users` where `provider='github'` and the email domain looks unrelated to the profile; reset affected rows.
- Sign-in required for analysis, sample-creator endpoint, share toggle UI, `GET /api/reports` history, CSRF Origin check (SameSite=Lax already blocks cross-site PATCH/DELETE), `ensureTable` request-time DDL, `api/health` exposure: all left as is.
- Edge cache of the old `/api/featured` response: not verified from here; check post-deploy as listed.
