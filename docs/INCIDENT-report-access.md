# Internal incident record: report exposure and OAuth email trust

Status: **open, severity not assigned.** Prepared 2026-10-29 from the repository, Vercel deployment history and the published privacy page. No production database or log content was available. Nothing below states that no user was affected.

## 1. What happened

1. **`GET /api/featured`** (added in commit `b626eaf`, 2026-06-18) returned, to anyone and without sign-in, the single most recent report in the `reports` table: `reportId`, channel name, handle, thumbnail, subscriber and video counts, and the complete analysis text. The response was CDN-cached for 300 seconds. The home page used it to fill a hero card.
2. **`GET /api/report/:id`** returned any report to anyone holding its UUID. Reports had no owner-based access control.
3. **OAuth sign-in linked accounts by email without requiring a verified email.** GitHub login used the public profile email or the first entry of the email list even when unverified; Google's `email_verified` was never checked. Someone able to put a victim's address on their own provider account could sign in as, or pre-claim, that victim.

## 2. Exposure window (what is known)

| Item | Evidence |
|---|---|
| `/api/featured` introduced | commit `b626eaf`, 2026-06-18 |
| Accounts (so signed-in users' reports) introduced | commit `65c689e` (2026-08-07), first production deployment 2026-08-08 02:46 UTC. The commit message says accounts had already been running in production through uncommitted CLI deployments, so the real start is **earlier and unknown** |
| Current production | deployment of `e4b7943`, 2026-08-09 01:47 UTC, still live on 2026-10-29 |
| Exposure still ongoing | yes, until the hotfix ships |

First production deployment that contained `/api/featured`: **not established** (Vercel history available to the author shows only three deployments).

## 3. What could have been exposed

- **Via `/api/featured`:** for each report, from its creation until the next report was created, the full report content above, to any visitor (and any cache). Both anonymous users' reports and signed-in users' reports.
- **Not exposed by it:** account email, name, avatar, user id, plan, API keys, or any report other than the newest.
- **Via the UUID route:** any report whose id someone knew. The id of every featured report was itself published by `/api/featured`.
- **Content is analysis of public YouTube channels** (public metadata plus model-written commentary). The published privacy page states "Anyone with the link can view the report", which covers link holders; it does not say reports are published on the home page.
- **Via the OAuth issue:** for a successfully taken-over account, that user's reports, API keys (including creating new ones), plan and usage.

## 4. What cannot be established

- **Who viewed which report.** Vercel Hobby retains runtime logs for 1 hour only; request history for the exposure window is gone. The CDN does not provide per-viewer logs to this project.
- **How many times `/api/featured` was served, or to whom.**
- **Whether any report id was harvested** from it (the endpoint was unauthenticated and trivially scriptable).
- **Whether any OAuth takeover occurred.** A takeover of an *existing* account leaves no row in `users`; a *pre-claimed* address leaves a GitHub (or Google) row that looks normal.
- **Which signed-in reports were featured**, only an upper bound (query A2 in the runbook gives each report's maximum featured duration).

## 5. Evidence of unauthorized access

**None has been found, and none could have been found with the available evidence.** Absence of evidence here is not evidence of absence: the data sources that would show it (access logs, per-request analytics) do not exist for this period. The production database review (runbook section 2) may supply leads; it has not been run by the author.

## 6. Remaining OAuth risks after the hotfix

- The fix stops new unverified emails from reaching `upsertUser`. It does **not** remove accounts created earlier with someone else's unverified email; such a row still signs its creator in, and a later login by the real owner via the other provider links into it (found in independent review).
- Emails are not case-normalised; a differently cased verified email creates a separate account (not a takeover).
- Existing sessions are not invalidated by the release.

## 7. What the hotfix changes

`/api/featured` removed; reports private to their owner unless shared by link; ownerless (anonymous) reports remain link-readable; owner can share or unshare; verified-email requirement for Google and GitHub sign-in; report deep links fixed. Existing signed-in users' reports become private (Option A). Evidence of the behaviour: `HOTFIX-report-access.md` ("Verified against the real handlers").

## 8. Limitations of this record

Written without production access, logs or database results. Dates come from git history and Vercel deployment metadata. The dirty-deployment history means actual start dates may be earlier than shown. Counts of affected reports and owners are unknown until runbook queries A1-A3 are run.

## 9. Questions for legal review (owner decision; not answered here)

- Whether publishing signed-in users' reports on the home page without notice, contrary to what the privacy page implied, creates a notification or disclosure duty, and in which jurisdictions your users are.
- Whether report content tied to an account (which channel a person analysed) is personal data in your analysis, and whether the exposure is a "personal data breach" under applicable law, given no identifiers were in the response.
- Whether and how to notify owners of exposed reports, and whether a courtesy notice is advisable regardless.
- Notification for any account confirmed or suspected to have been taken over.
- Whether the privacy policy needs updating (the new text will have to describe private-by-default reports and the share toggle).
- Record-keeping: keep this record and the review results regardless of the decision.

## 10. Production review results (read-only, 2026-10-29, redacted)

Run through the Neon connection on the production branch; nothing was written. Account identities were confirmed by the owner (both users are the owner's own accounts).

- **Reports:** 12 total, **all anonymous (no owner), 0 signed-in**; first 2026-07-02, last 2026-08-15; nothing since.
- **Users:** 2 (both Google sign-ins, both the owner's), 0 reports each, **0 API keys, 0 GitHub accounts**.
- **Migrations applied:** 001-003 only; `visibility` column absent (004 not applied).
- **Featured upper bounds** (longest each report could have been the newest, hence public via `/api/featured`): 20.1 days, 16.3 days, 5.3 days, 22 hours, 14.8 hours; the other six were each under 30 minutes. The newest report (2026-08-15) stayed featured about 75 days, until the containment rule on 2026-10-29. Real view counts remain unknowable.
- **Implication (facts, not a severity):** no signed-in user's report has ever existed in this database, so none could have been featured. The exposed content is 12 anonymous analyses of public channels, which the published privacy page already described as link-readable; the hotfix does not change any of them. Rows deleted before this review cannot be ruled out, but no delete endpoint existed.
- **OAuth:** no GitHub rows, no API keys, no reports owned by either user, so a takeover would have gained only profile/plan access. Takeover of an existing account would leave no trace, so absence of evidence remains the limit.
- **Containment:** Firewall rule denying `/api/featured` is live (HTTP 403 verified 2026-10-29).
- **Recovery point:** Neon snapshot `pre-hotfix-004-20261029` (`snap-nameless-butterfly-anvixz8c`, 33,349,632 bytes, created 16:48:13 UTC). Verified by restoring it into a temporary branch (12 reports, 2 users, 0 API keys, 3 migrations, last report 2026-08-15, no `visibility`), then deleting only that temporary branch; production was untouched throughout. Point-in-time history retention is only 6 hours, so the snapshot is the real recovery point.
