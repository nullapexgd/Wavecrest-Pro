# 60-day growth roadmap (draft for owner review, not approved)

Status: proposal only. No implementation, billing change, deployment or production data access is authorised by this document. Every number marked **proposed** is a target for the owner to accept or change.

Premise: Wavecrest 3.0 is live (Free Beta, one analysis per user per UTC month). The question for the next 60 days is not "what can we build" but **do real creators come, get value and say they would pay**. Building stops except for the small, justified tasks in section 5.

Related documents (not repeated here): `ROADMAP-product-lines.md` (Wavecrest / Reelcut / bundle principles, Access), `PLAN-improve-dashboard.md` (Improve phases P0-P8; Access in section 18), `ROADMAP-job-queue.md` (rate-limit queue; currently only on branch `ai-quality`, `cb255d6`), `RELEASE-WIP.md` (what shipped, open items).

## 1. What we know and don't

| Known | Unknown (the 60 days exist to answer these) |
|---|---|
| Analysis runs end to end, about $0.002-0.006 of model cost per report (benchmark, not billed; Groq is on the free tier today) | Who the best-fit creator is and where to find them |
| Free-tier capacity is the hard ceiling: about 35 reports a day on Groq (8K tokens/min, 200K/day), plus a Gemini fallback | Whether signed-up users finish an analysis, and come back |
| The data is public YouTube data only (no creator analytics) | Whether a report from public data is worth money, and how much |
| Billing, plans and Starter/Pro/Team exist only as manual entitlements | Whether the bundle with Reelcut adds value or just complexity |

## 2. Target segment (one, to start)

**Proposed:** YouTube creators with roughly 10K-500K subscribers, uploading long-form at least twice a month, who ask "what should I make next". Why: enough upload history (31+ videos) for a full-confidence report; small enough to be the channel's own decision-maker; large enough that a better next video is worth money. Excluded for now: brand channels (reports skip earnings), Shorts-only channels, agencies (revisit at day 60 if the pilot shows they are the buyer).

## 3. Phases and goals

| Days | Focus | Exit check |
|---|---|---|
| 1-14 | Measure and polish: funnel numbers from existing data, fix the top friction, feedback prompt, compliance gap, cost numbers | Baseline funnel known; no open reliability or compliance blocker |
| 15-30 | Acquire: short-form videos, demos, 30 personal creator outreaches, 3 communities | **Proposed:** 150 signups, 100 completed analyses |
| 31-45 | Pricing research and demand validation (no billing system, no payments) | **Proposed:** 20 creator conversations, 10 written price commitments |
| 46-60 | Reelcut proof of concept, then the day-60 decision | PoC result recorded; decision made by the criteria in section 8 |

Metrics, defined once: signup (new user row), activation (completed analysis within 7 days of signup), retention (second analysis or report revisit within 30 days), share (a report set to link visibility), pricing signal (a written commitment, not a compliment). **Proposed** targets by day 60: 300 signups, activation 50%, 30-day return 25%, 10 price commitments. A paid pilot is **not** a day-60 target: there is no payment route yet (Stripe is not available to the owner), and setting one up takes longer than the window.

## 4. Marketing (cost: time, not money)

- **Short-form video, 3 a week:** a 30-60 second teardown of a real public channel's report ("what this channel should make next, and why"), built from the sample-creator data we already hold. Reuse the parked Remotion/Buffer video pipeline only if setup takes under a day; otherwise screen recordings.
- **Product demo:** one 90-second walkthrough on the landing page, from paste to report to Recent Reports.
- **Creator outreach:** 30 hand-picked channels in the segment, each offered their own free report with a personal note. Use public contact details only, no bulk email, one follow-up at most.
- **Communities:** three, chosen by where the segment already talks (for example r/NewTubers, a creator Discord, Indie Hackers). Follow each community's self-promotion rules; share something useful, not a link drop.
- **Feedback loop:** every user who finishes an analysis gets a one-question prompt ("was this useful, what is missing") and a standing offer of a 15-minute call.

## 5. Engineering tasks (small, each justified)

Axes: **Acq**uisition, **Act**ivation, **Ret**ention, **Rev**enue potential, **Rel**iability. Nothing outside this table without a new decision.

| # | Task | Improves | Notes |
|---|---|---|---|
| E1 | Read the funnel from existing tables (`users`, `analysis_runs`, `reports`), as read-only SQL. No new tracking | Act, Ret | Needs owner approval for production read access. Anonymous landing traffic: enable Vercel Web Analytics (cookie-free), no other tracker |
| E2 | One-click "useful / not useful" plus free text on the report page, sent to the existing `NOTIFY_EMAIL` | Act, Ret, Rev | Smallest possible; a feedback table only if volume justifies it |
| E3 | Fix the YouTube 30-day data rule (see section 7): refresh or purge stored view statistics | Rel | A compliance risk, not a feature; decision on approach needed |
| E4 | Sentry alert rule on new issues, and one live-proven test event | Rel | Reporting is shipped; alerts and proof are not |
| E5 | Prove the Gemini fallback once on production (or fall back to the local proof) | Rel | Only if a Groq failure is observed or the owner wants it proven |
| E6 | Cost per report in the logs (provider, tokens) so margin is measured, not assumed | Rev | Provider is already recorded in `quality.provider` |
| E7 | Copy and layout polish from feedback only: first-screen clarity, empty states, sample report as the demo | Acq, Act | No redesign |
| E8 | Reelcut PoC (days 46-60): export one Improve/report idea as a JSON bundle (idea, rationale, cited video IDs) plus a deep link Reelcut can open | Rev, Ret | No shared database, no account linking, no OAuth. Gated by the sequencing in `ROADMAP-product-lines.md`: review Reelcut's import surface first |
| E9 | Capacity guard: friendly "busy, try later" and a waitlist if daily demand passes about 30 analyses | Rel, Acq | The job queue stays a roadmap item unless demand holds above that line for a week |

Not in scope: new analysis dimensions, the Improve dashboard build (P1+), Access, billing, dashboards for creators, redesigns, a queue, new infrastructure.

## 6. Pricing research and paid pilot (billing stays off)

1. **Research (days 31-45):** during the creator calls, ask what they pay today for tools (vidIQ, TubeBuddy, editors, thumbnail services), what a better "next video" is worth, and four price-sensitivity questions (too cheap, cheap, getting expensive, too expensive per month). 15-20 conversations.
2. **Anchor test:** show 2-3 price/limit shapes on a waitlist page (copy only, nothing purchasable) and count which one people join. `plans.js` keeps `purchasable:false`; no checkout, no provider.
3. **Paid pilot (after day 60, not on the critical path):** needs a payment route and the Vercel plan on Pro (Hobby forbids commercial use) first. Until then, demand is judged by the price commitments above and by behaviour (return visits, shares, unprompted requests for more analyses). When a route exists and the owner approves, 3-5 creators pay a founding price for a defined 30-day pilot, with the entitlement granted via the existing `set-plan` admin route.
4. **Unit economics today:** model cost is roughly $0.002-0.006 a report, so margin is not the risk; acquisition cost, support time and the free-tier ceiling are. Record the real figures from E6.

## 7. YouTube API compliance and operating costs

Verified against Google's pages on 2026-10-30; the owner (or counsel) should re-read the current text before relying on it.

- **Quota:** default 10,000 units a day; `channels.list`, `playlistItems.list` and `videos.list` cost 1 unit a call. The analyzer uses those three (no search), so about 5 units per analysis by estimate (measure in E1): quota is not a constraint at beta scale. More would need a quota extension via the API Compliance Audit.
- **The 30-day rule (action needed, E3):** the policy says statistics retrieved without authorisation may not be stored more than 30 days, and stored data must be deleted or refreshed after 30 days (III.E.4.b-c). Saved reports keep titles and view counts indefinitely. Options: refresh the statistics on view, purge the statistics fields after 30 days and keep the analysis text, or store only derived results. Needs an owner decision; until then this is the largest compliance exposure.
- **Disclosures (appear in place):** `terms.html` links YouTube's Terms of Service; `privacy.html` states use of YouTube API Services and links the Google Privacy Policy. Keep both.
- **User deletion:** the policy expects removal of a user's data within 7 days of a deletion request; report deletion already exists. Account deletion is not yet a self-service flow (note, not a task).
- **No scraping:** all data goes through the API; keep it that way.

Production runs entirely on free tiers (owner-confirmed); the only paid items are the Claude and Codex development tools.

| Cost line | Today | Note |
|---|---|---|
| Vercel | Hobby, $0 | **Hobby is non-commercial, personal use only** (Vercel docs, Hobby plan page). Must move to Pro (listed at $20 per developer seat a month) before the first paid pilot or any revenue. Hobby also keeps only 1 hour of runtime logs, so Sentry is the real error history |
| Groq analysis | $0, free tier | About 35 reports a day ceiling; about $0.002-0.006 a report if billed (benchmark). Paid upgrade is paused by Groq |
| Gemini fallback | $0, free key | Free-tier quotas can change |
| Neon, Upstash | $0, free tiers | Limits not re-checked here; owner to read the headroom (storage, compute hours, command counts) in the dashboards before acquisition starts |
| Resend (waitlist email) | $0, free tier | Daily send cap applies |
| Domain | Owner to fill in | |
| Claude, Codex | Paid | Development only |

First costs to expect if the pilot works: Vercel Pro seat, then paid Groq (when the upgrade reopens) or a second paid model provider, then Neon/Upstash tiers if usage grows.

## 8. Day-60 decision criteria (proposed)

- **Continue building:** activation at least 40%, at least 25% of activated users return within 30 days, at least 10 written price commitments from the target segment (paid pilots follow once a payment route exists), and nobody finds a compliance or reliability blocker. Then fund the Improve dashboard (P1-P3) and decide the Reelcut bundle on the PoC evidence.
- **Reposition:** usage is healthy but willingness to pay is weak in this segment, or buyers turn out to be different (agencies, managers, a Reelcut-first audience). Change the segment or the offer, not the code; revisit the product-lines roadmap.
- **Pause:** under 100 signups after 30 hours of outreach, or activation under 25%, or no price commitment from 15+ conversations. Keep the service running at near-zero cost, stop feature work, and record what was learned.
- A mixed result gets one more 30-day experiment with a single named hypothesis, not an open-ended extension.

## 9. Decisions needed from the owner

1. Accept or change the segment, the targets and the day-60 criteria.
2. Approve read-only production queries for E1 (funnel).
3. Choose the 30-day-rule approach for E3.
4. Decide how a paid pilot will be paid for once Stripe is unavailable (a different provider, or later), and the founding price. Not needed before day 60.
5. Upgrade Vercel to Pro before any paid pilot, and check Neon/Upstash headroom before acquisition starts (section 7).
6. Confirm whether outreach and public teardown videos name real channels, and the rules for that.
