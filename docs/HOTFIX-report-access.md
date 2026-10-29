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

### Rollback (corrected)

**Do not redeploy the previous production build** (`master@e4b7943`, Vercel "Instant Rollback" or `isRollbackCandidate` deployments): it contains the report-exposure vulnerability. Every older deployment has it too. See "Fallback ladder" below.

**Migration 004 is never reversed automatically and its column is never dropped.** It is additive: old code ignores `visibility`, new code needs it. If the code has to change again, the column stays. Dropping it would erase owners' share/unshare choices and break the fixed code. (The DROP statements in the earlier draft of this doc were removed on purpose.)

## Production branch (verified)

Vercel project `wavecrest-pro` deploys **`master`**. Evidence (read-only, Vercel deployment history): the three latest production deployments all have `githubCommitRef: master`; the live one is `e4b7943`, identical to `origin/master`. The GitHub default branch is `main`, which is a **stale, diverged** branch (6 June commits of Gemini/Groq experiments not in `master`; `master` has 16 commits not in `main`). Merging this hotfix to `main` would NOT deploy it, and merging `main` into `master` would regress it. This hotfix is based on `master`, which is correct. Also: earlier deployments were made by "dirty CLI deploys" (`vercel --prod` uploads the working directory), so do not run `vercel --prod` from any checkout other than a clean `hotfix-report-access`.

## What the release contains

`git diff origin/master...hotfix-report-access` is 13 files (+ this doc): `api/featured.js` (deleted), `api/report/[id].js`, `api/auth/[...path].js`, `lib/db.js`, `lib/oauth.js` (new), `lib/reports.js` (new), `migrations/004_report_access.sql` (new), and test files. It contains nothing from `wavecrest-3`: no `web/`, no `middleware.js`, no `index.html`, and `app.html` only for two small, separately committed changes (deep-link init fix, owner Share toggle), no quota ledger, no sample-creator endpoint, no analyzer/evidence changes. Verify before deploying with `git diff --stat origin/master...hotfix-report-access` and confirm no path starts with `web/` or `docs/wavecrest-3/`; `app.html` is the only page touched.

## Deploy order

Migration FIRST, then code, back to back. Old code runs fine against the new schema; new code needs the column (without it reads 500 and saves fail, closed).

1. Neon: confirm backups / note a restore point (dashboard, manual).
2. Read-only counts (approval needed to touch production): `SELECT (user_id IS NULL) AS anonymous, count(*) FROM reports GROUP BY 1;` Record them. These are the expected backfill results.
3. Apply migration 004 (`npm run migrate`, approval needed).
4. Verify: `SELECT (user_id IS NULL) AS anonymous, visibility, count(*) FROM reports GROUP BY 1,2;` expect anonymous=>link only and signed-in=>private only, counts equal to step 2.
5. Push `hotfix-report-access` to `master` (approval needed). Wait for the Vercel production build to be READY.
6. Repair (below), within minutes of step 5.
7. Post-deploy checklist.

### Anonymous-report repair (exact effect)

Why it exists: between steps 3 and 5 the OLD code is still live. It inserts reports without a visibility value, so anonymous reports created in that window get the column default `private` with no owner, and nobody could ever open them. The repair flips only those to `link`.

Read-only preview first (this is the row count it will touch):

```sql
SELECT count(*) FROM reports WHERE user_id IS NULL AND visibility = 'private';
```

Guarded repair (run in a transaction; commit only if the count equals the preview):

```sql
BEGIN;
UPDATE reports SET visibility = 'link'
WHERE user_id IS NULL AND visibility = 'private'
  AND created_at >= (SELECT applied_at FROM _migrations WHERE name = '004_report_access.sql')
RETURNING id;
-- rowCount must equal the preview. If not: ROLLBACK;
COMMIT;
```

Verified on a throwaway local Postgres by simulating the window (5 anonymous + 3 signed-in rows, migration, then 2 anonymous + 1 signed-in created by old code): after migration anonymous=link 5, signed-in=private 3; preview listed exactly the 2 window rows; UPDATE affected 2; afterwards anonymous=link 7, signed-in=private 4 (the signed-in window row stayed private); a second run affected 0 (idempotent). It cannot touch a signed-in report (`user_id IS NULL` is required), and after the new code is live nothing creates an anonymous `private` row. Expected production count: the number of anonymous analyses made in the minutes between steps 3 and 5, typically 0. Production counts have NOT been read.

## Fallback ladder (never "redeploy the old build")

Every rung keeps the fix. Order of preference:

1. **Fix forward (default).** A bad hotfix is repaired with a small new commit on `master` and a redeploy (about a minute). Likely causes and fixes: 500 on `/api/report/*` = migration not applied (apply it, no code change); a user cannot sign in = their provider email is unverified (intended; not a bug); anything else = patch the single file.
2. **Contain without a deploy.** Vercel Firewall custom rule (dashboard, instant, reversible, no code or data change): block `GET /api/report/*` and `/api/featured`. Fails closed (reports unavailable) instead of open. Remove the rule when fixed. Same rule can also be applied BEFORE the hotfix to stop the ongoing exposure today (needs your approval; nothing has been changed).
3. **Last resort: previous build, only while rung 2 is active.** Never promote the old deployment without the firewall rule blocking `/api/featured` and `/api/report/*` at the same time.
4. **Schema:** never dropped. The column stays under every rung.

## Verification checklist

Pre-deploy (local/preview, no prod data)
- [ ] `LC_ALL=en_US.UTF-8 npm test` is green (see results below).
- [ ] Review the migration SQL; decide the "old signed-in links" question above.
- [ ] Optional read-only prod count, with approval: `SELECT user_id IS NULL AS anon, visibility, count(*) FROM reports GROUP BY 1,2;` after migration shows expected split.

Post-migration, pre-code
- [ ] `\d reports` shows `visibility` + check constraint; counts match the table above.

Post-deploy (use two real accounts A, B and a logged-out browser)
- [ ] `GET /api/featured` => 404 (also from a second network/region, in case a cached copy lingers).
- [ ] Run the guarded repair above (preview count first; commit only if the counts match).
- [ ] A creates a report; B and logged-out get 404 on `/api/report/<id>`; A gets 200.
- [ ] Anonymous analysis (logged out): result page loads, reload of `/app?r=<id>` still works.
- [ ] An old anonymous report URL still works logged out.
- [ ] `PATCH /api/report/<A's id>` as B => 404, as anon => 401; `{"visibility":"link"}` as A then B/anon => 200; back to `private` => 404.
- [ ] Response headers on `/api/report/<id>`: `Cache-Control: private, no-store`.
- [ ] GitHub account with only an unverified email cannot sign in; a normal verified Google/GitHub login works and lands on `/app`.
- [ ] Vercel function logs show no new 500s on `/api/report/*` or `/api/auth/*`.

## What breaks for existing users

- Signed-in users' previously shared report links stop working for other people (404) until the owner re-shares. The old UI had no share toggle; the hotfix adds one (owner-only).
- Homepage hero "featured" card no longer shows live data (static content only; no error shown).
- Users whose GitHub account has no verified email, or whose Google email is unverified, can no longer sign in (a generic 500 "Authentication failed"). Unlikely for real accounts.
- Anyone who copied `GET /api/featured` data in the past already has it; nothing here can recall it.

## Existing shared links (DECIDED: Option A)

Owner decision: **Option A**. Existing signed-in users' reports become `private`; anonymous (ownerless) reports stay `link`. Rationale: `/api/featured` published report IDs, and Option C would keep every harvested ID openable.

**Finding: report links already do not open in the browser.** Production's `app.html` (since `4ee017d`, 2026-08-07) throws `ReferenceError: Cannot access 'TOTAL_STEPS' before initialization` on every `/app?r=<id>` load, so the report view never renders for anyone; only the JSON API works. Reproduced by serving production's unmodified `app.html`. So the practical effect of Option A on people clicking old links is smaller than it looks (they were already dead in the UI), but the API still served them by UUID, which is what Option A closes. The hotfix includes the fix (run `init` after the script is evaluated), otherwise nobody, owner included, could open a report in the browser.

**Owner re-share path (built):** the report view shows an owner-only toggle, "Private: only you" / "Shared: anyone with the link" (PATCH `/api/report/:id`; verified against a mock API). "Copy link" warns when the report is private. For a report whose owner asks for help, `docs/HOTFIX-runbook.md` has the one-row SQL.

How many links Option A affects = the number of signed-in reports (production count query in the runbook; not read).

## Was there an incident? (assessment, needs your decision)

- **What `/api/featured` exposed:** for each request window (CDN cached 300 s), the single newest report of any user: `reportId`, channel name, handle, thumbnail, subscriber count, video count, and the full analysis. **Not exposed:** user id, email, name, avatar, plan, or any other report. Data is analysis of public YouTube channels.
- **Who could have seen it:** anyone loading the homepage. Which reports were shown cannot be reconstructed exactly: each report was the newest from its creation until the next one. Upper bound = every report created while `/api/featured` was live. Vercel runtime-log retention is short, so request history is probably not recoverable.
- **Policy context:** the published privacy page already said anyone with a report link can view it and that there is no access control. The homepage publication of signed-in users' reports was not disclosed.
- **Assessment: NOT concluded.** An earlier draft called this low severity; that is withdrawn until the exposure review below is done. Facts that make it bounded but real: no account identifiers or other users' reports were exposed; but signed-in users' analyses (their chosen channels and the full analysis text) were published on the homepage without being told, for as long as `/api/featured` served them. Runtime logs cannot show who saw what: Vercel Hobby keeps only 1 hour, so exposure can only be bounded, not measured.
- **Exposure window:** `/api/featured` was added 2026-06-18. Signed-in reports exist only since accounts launched (production deploy 2026-08-07). Every report created in the window was "the featured report" from its creation until the next one was created.
- **Exposure review (runbook, owner runs or approves):** per-report "was featured for" durations, signed-in report and owner counts, the owner list (for re-share and courtesy notices), and the OAuth account review. Decide notification only after those numbers are in; legal advice on whether any notification is mandatory is still needed.

## Deferred (not in this hotfix)

- **Quota race (concurrent requests).** `checkUsage` counts saved reports *before* a multi-second analysis and the report is inserted *after*, so N parallel requests all pass. A correct fix needs a reservation ledger written under a per-user lock before any paid upstream call (`wavecrest-3` `9867cd8`: migration 005 + `lib/quota.js`). That is a new table, an analyze-flow rewrite and refund/expiry logic, i.e. not minimal or safely separable here. Interim mitigation already in place: the per-IP edge limit (5/hr). Consider also lowering it or a manual cap for the free plan if abuse is seen.
- **Poisoned existing users.** A row in `users` created through the old GitHub fallback may hold an unverified email an attacker chose, and a later verified login with that email links to it. The DB cannot tell. Suggested follow-up (needs approval): read-only review of `users` where `provider='github'` and the email domain looks unrelated to the profile; reset affected rows.
- Sign-in required for analysis, sample-creator endpoint, share toggle UI, `GET /api/reports` history, CSRF Origin check (SameSite=Lax already blocks cross-site PATCH/DELETE), `ensureTable` request-time DDL, `api/health` exposure: all left as is.
- Edge cache of the old `/api/featured` response: not verified from here; check post-deploy as listed.
