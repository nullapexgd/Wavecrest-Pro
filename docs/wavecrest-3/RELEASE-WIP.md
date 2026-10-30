# Release WIP — paused before production

Owner requested preserving WIP instead of rushing deployment. Resume only after renewed release direction.

Branch: `release/improve-quality-motion`.
Integrated candidate: `57f84ad5451584927b230e0bc61646a8a1c9572d`.
Base: fetched `origin/master` at `4c27939`.

## Included

- Reviewed `integrate/improve-access-analysis` (`6b72cb1`), preserving AI fixes/evaluation history and Improve/Access planning documentation.
- Completed `scroll-reveals`: `698c9a0`, `3e2ddaf` (Appearance & Motion).
- Glass nav, OAuth routing, security fixes and migration 006 already existed in master; preserved without re-merging their branches.
- No conflicts, new migrations or dashboard/Access implementation.

## Completed checks

- Backend: 211 passed, zero failures/skips/TODOs; disposable local PostgreSQL only.
- AI evaluation: 50 passed.
- Mutations: all seven caught.
- Frontend typecheck/build passed.
- Two bounded live model evaluations (`mid`, `brand`) through the existing Vercel production environment passed all seven invariant checks each. Inputs were synthetic fixtures, not a real-channel end-to-end run. This does not prove semantic quality or production workflow correctness.
- Vercel project identity confirmed: `wavecrest-pro`, production URL `https://wavecrest.pro`.

## Incomplete / required before release

- Full Playwright matrix was still running when paused (at least 145 tests had passed); do not claim a complete browser pass. Rerun or inspect completed results before release.
- Human-quality review of live recommendations and full live-output schema validation remain incomplete.
- Real-channel authenticated analysis, saved-report access and production UI smoke checks remain unperformed.
- Re-fetch master and revalidate ancestry before any merge/push.

No master merge, push, deployment or production migration was performed. Existing worktrees/source branches remain untouched. Deploy only from master when separately resumed and all required gates pass.

Local test logs: `/private/tmp/release-{backend,eval,browser}.log`. Live fixture outputs are ignored under `test/eval/out/`; no credentials are committed. Vercel linking created a local environment file, which was removed without printing it.

## Update 2026-10-30 — analysis enforcement integration

- Merged `ai-quality` (loosened classification/niche/gap rules; live-eval fixes: gap citations from rationale, unverified structural hooks, commercial-wording requirement for monetization signals, shared-tag dedup).
- Verified on this branch: backend 215/215, 7/7 mutation checks caught, web typecheck/build pass. Historical-report and schema-compat tests pass (no stored-report field removed; new fields optional).
- Live evaluation (real model) run on 6 of 12 fixtures: mid, brand, shorts-only, shorts-long, tiny, ambiguous. Invariants pass; outputs reviewed by hand. Remaining 6 fixtures not run live.
- Still open: full Playwright matrix, authenticated real-channel analysis, UI smoke checks. Not merged to master, not deployed.

## Final validation — candidate `5822961` (code-identical; docs commits after it change only this file)

**What ships vs production master (`4c27939`, fast-forward):** 55 files. Deployed surface: `lib/analysis.js`, `lib/analysis-facts.js`, `lib/analysis-enforce.js` and 13 `web/` files (appearance/motion settings, scroll reveals, nav, styles). Everything else is tests, scripts, tasks and docs. No `api/`, `migrations/`, `package*.json` or `vercel.json` change: **no database change and no new env var.**

| Check | Result |
|---|---|
| Backend (`npm test`, throwaway Postgres) | 215/215 pass |
| Mutation checks | 7/7 caught |
| Web typecheck + build | pass |
| Playwright full matrix (4 widths x light/dark, 8 projects: theme, motion, nav, hero, reports UI) | 268 passed, 12 skipped by design, 0 failed (exit 0) |
| Historical reports / schema | `report-compatibility`, `schema-compat` and 12-fixture eval pass; every legacy key kept, new fields optional, no migration |
| Ownership isolation, quota, idempotency (automated, two accounts) | `report-access`, `reports-access`, `quota`, `policy` tests pass |
| Live model, 6/12 fixtures | invariants pass; outputs hand-reviewed |
| Real channels (public data, nothing stored): Clickspring (694K, small creator), Apple (brand) | reviewed below |

**Not done (blockers for a fully manual sign-off):**
- Authenticated flow on the preview (Google sign-in, saved report, reopen from Recent Reports, quota message) and two-account isolation on a live deployment. The preview `wavecrest-928zvf1z7-…vercel.app` is behind Vercel protection (302), sign-in needs the owner's credentials, and the preview's database/OAuth configuration could not be verified (env listing 403). Automated tests cover the same logic locally; they do not prove preview/production configuration. Owner should run a 10-minute smoke (below) right after deploy.

**Real-channel review (model `openai/gpt-oss-120b`):**
- Brand (Apple): classified brand (corroborated), earnings "Not applicable", no monetization claims, hook labelled low confidence. Good.
- Small creator (Clickspring): estimate labelled assumed category ($593-$2,879/mo from 5 recent uploads), 0.7 uploads/month, low-confidence ideas marked "no benchmark". Good.
- Questionable, not fixed (model quality, not enforcement bugs): Apple idea "Vision Pro Pro Edition" is an invented product that passed (no number to trigger the brand check); Clickspring gap/idea "CNC milling" contradicts the channel's hand-machining identity; a "giveaway" title is phrased as a "possible sponsor tie-in" (unverified wording); a 0% pillar can appear; idea benchmarks cite top performers so multiples look optimistic; gap rationales can include outside knowledge ("Apple's public commitments"). Next step is benchmarking stronger models, not more heuristics.

**Recommendation: conditional GO** (Playwright is green) once the owner accepts the manual-smoke gap. Low blast radius: analysis output only plus front-end polish; no DB/env change; instant rollback.

**Deploy steps (all need owner approval):**
1. `git fetch`; confirm `origin/master` is still `4c27939`; confirm release HEAD (record exact SHA here).
2. Fast-forward `master` to that SHA and push (production deploys only via explicit deployment of that exact SHA, not by the push alone).
3. Create the production deployment for that SHA; wait for READY.
4. Smoke: `/api/health` ok; home loads; theme/motion gear works; sign in; run one analysis; open it from Recent Reports; second account cannot open the first's report (404); quota message after the monthly allowance.
5. Rollback: promote the previous production deployment (`4c27939`). No migration to undo.
