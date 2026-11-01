# Final roadmap and engineering freeze (status 2026-11-01)

Owner direction (2026-10-30): finish a short, final list of engineering work, then freeze engineering and spend the time on attracting real users (TikTok and YouTube Shorts; Instagram only through a personal account). Nothing here authorises a push, deployment, migration, billing change or production data access: every release uses the supervised path in `DEPLOY-CHECKLIST.md`.

## Status
| # | Item | Status |
|---|---|---|
| 1 | YouTube 30-day data rule (purge stored statistics after 30 days, daily cron) | Shipped |
| 2 | "Useful / not useful" feedback to `NOTIFY_EMAIL` | Shipped |
| 3 | One structured log line per analysis run | Shipped |
| 4 | Sentry error reporting and alert rule | Shipped. Alert proven from a laptop on 2026-10-30; from a deployed function still to be seen on the first real error |
| 5 | "Clip these" on the report with a "Send to Reelcut" link | Shipped, now links to the on-site `/reelcut` |
| 6 | Reelcut restyle | Done in the standalone app |
| Release 3.0 | Evidence-backed analyzer, enforced CSP, retry guard, Gemini fallback | Live since 2026-10-30 |
| Release 3.1 | UI refresh (ice blue, periwinkle, one vermilion accent), paste-a-channel-then-sign-in, shared daily AI capacity guard with funnel counters, browser Reelcut at `/reelcut` (on-device transcription and rendering, 3 videos per user per week), Reelcut quota-abuse fix | Live: production `1708ac2` |

## Engineering freeze (in force since release 3.1)
Allowed without an exception, each still needing the owner's approval to ship:
1. Security fixes.
2. Fixes for real regressions in function, security or data integrity (rollback is for these only, not for cosmetic issues).
3. Compliance changes (YouTube API policy, privacy copy).
4. A change a recorded user finding clearly demands, small enough to ship as one reviewed commit.
5. UI/UX refinement, accessibility fixes and performance work that keep existing behaviour intact (owner clarification, 2026-10-31).

Not allowed: new features, new providers or services, refactors, dependency upgrades other than security, anything that adds scope. The freeze lifts at the owner's decision after a review of the funnel counters and platform analytics (target: about 30 days of data).

## Deferred, not scheduled
Clippability suggestions for paid plans (plans stay manual grants and are never advertised), shareable report cards, switching the LLM to Claude when the owner upgrades (needs the privacy page to list Anthropic and a dollar cap on the capacity guard), an anonymous first analysis, Safari and Edge support for Reelcut, a theme-color and favicon colour refresh.

## Known limits
Reelcut is desktop only; clip quality of the browser build has had one real-model check by the owner on the standalone app only; Groq's free tier is a hard daily ceiling shared by everyone (capacity guard default 30 a day, `AI_DAILY_CAP`).
