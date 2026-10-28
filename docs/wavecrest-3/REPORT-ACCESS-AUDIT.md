# P0 audit: cross-account report exposure

Audited 2026-10-28 against production `e4b7943`; fixed on `wavecrest-3`. Nothing here is deployed or applied.

## The defect

`GET /api/featured` returned the **newest report of any user** to anyone, and the CDN cached it publicly (`s-maxage=300, stale-while-revalidate`). `GET /api/report/:id` returned any report to anyone holding its UUID, and nothing recorded who owned a report or whether they meant to share it. Signed-in users' private research could appear on the homepage within minutes of running it.

## Every read path, query, cache and sharing mechanism

| # | Surface | Before | After | Proven by |
|---|---|---|---|---|
| 1 | `GET /api/featured` | Latest report of **any** user, public, edge-cached | Endpoint deleted. The public sample is a static file with no database access (Milestone C) | `INVARIANT: no endpoint publishes "the latest report"` |
| 2 | `GET /api/report/:id` | Any report, to anyone with the UUID | Owner, or anyone **only if the owner set visibility to `link`**. Otherwise 404 (not 403), so private is indistinguishable from nonexistent | `ANOTHER signed-in account…`, `…unauthenticated…`, `…indistinguishable from nonexistent` |
| 3 | Share mechanism | Implicit: every report was link-readable | Explicit and revocable: `PATCH /api/report/:id {visibility}` (owner only, ownership is in the SQL `WHERE`). New reports default to `private` | `sharing is revocable…`, `a non-owner cannot share, unshare or delete…` |
| 4 | Deletion | none | `DELETE /api/report/:id`, owner only | `the owner can delete…` |
| 5 | History | none | `GET /api/reports`: `WHERE user_id = <session user>`; no parameter can widen it; no analysis bodies | `history lists only the caller's own reports…` |
| 6 | Analysis stream result (`done` event) | Sent only to the requester | Unchanged, plus an idempotent replay re-reads the report **as the requester**, so a replay can never return someone else's | `replay of a finished run…`, e2e tests |
| 7 | Any other SQL against `reports` | Scattered | Only `lib/reports.js` may touch the table (static invariant) | `INVARIANT: only lib/reports.js…` |
| 8 | CDN / shared caches | `featured` public for 5 min | Every report response is `Cache-Control: private, no-store` with `Vary: Cookie, Authorization` | `every report response is uncacheable…` |
| 9 | CSRF on mutations | n/a | Cross-site `PATCH`/`DELETE`/logout refused (`Sec-Fetch-Site`, `Origin`), on top of `SameSite=Lax` | `cross-site mutation is refused…` |
| 10 | `api/keys.js` | Scoped by `user_id` | Reviewed, unchanged | code review |
| 11 | Logs | Logged the submitted URL | The submitted URL is no longer logged; only the resolved channel id | code review |
| 12 | Referrer leakage of `?r=<uuid>` | `Referrer-Policy: strict-origin-when-cross-origin` already set | Unchanged; cross-origin sites receive only the origin | `vercel.json` |
| 13 | Search indexing of shared links | `app.html` carries `noindex` | Unchanged | `app.html` |

Mutation checks: breaking the authorization rule, the PATCH ownership clause, the DELETE ownership clause, the history scope, or the cache header each makes at least one test fail. They were applied and reverted by hand on 2026-10-28.

## Rollout order (needs your approval at each step)

1. **Apply migrations 004 and 005** (`npm run migrate`, additive and idempotent). Do this **before** deploying the code. The new code reads `reports.visibility` and `analysis_runs`.
2. Deploy.
3. Confirm `GET /api/featured` returns 404 and that a private report returns 404 to a second account.
4. Rollback: redeploy the previous build. Migrations are additive, so the old code keeps working against the new schema.

## Decisions baked into migration 004 (change before applying if you disagree)

- **Reports with no owner** (anonymous, created before accounts) become `link`. They have no account to leak from, and the published privacy policy said "anyone with the link". Their URLs keep working.
- **Reports owned by a signed-in user** become `private`. They were never consented to be public. **Consequence:** a signed-in user's previously shared URL stops working until they re-share. To keep those URLs alive instead, change the `UPDATE` in `004_report_access.sql` to cover every row.

## Residual risks, stated plainly

- A `link`-shared report is a capability URL: anyone who has the 122-bit id can read it. That is the point of sharing; revocation is one click.
- Existing `users.email` rows created by the old GitHub fallback may hold an unverified address. The database cannot tell. A one-off review of accounts whose email domain looks unrelated to their provider profile is advisable once you approve a read-only query.
- Vercel function logs from before this change may contain submitted channel URLs until they age out.
- This is verified against a real Postgres with several accounts, not against production data. Ship Safe (Milestone F) re-checks authorization by hand.
