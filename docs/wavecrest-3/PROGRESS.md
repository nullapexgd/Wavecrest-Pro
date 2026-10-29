# Wavecrest 3.0 — progress log

Read `ASSESSMENT.md` first. Branch `wavecrest-3`, base production `e4b7943`. **Never `git add -A`; stage explicit paths.** Nothing has been pushed or deployed.

## Status

| Milestone | State |
|---|---|
| A. Audit and plan | done (2026-10-28) |
| A.5 Access control, atomic quota, S1-S5, S8 | done on branch (93/93 tests); migrations 004/005 not applied, not deployed |
| B. Design system + 3D hero prototype (`web/`) | prototype working; awaiting owner steer before expanding |
| C. Public site | pricing, privacy, terms, changelog written and rendering in `web/`; needs legal review and owner contact/jurisdiction before launch |
| D. Analyzer | not started |
| E. Integration | not started |
| F. Ship-safe + release readiness | not started |

## Skills actually invoked

| Skill | When | What it changed |
|---|---|---|
| `anthropic-skills:ship-safe` | confirmed installed under that exact name; to be run at F | — |
| `pro-design`, `ui-ux-pro-max`, `high-end-visual-design`, `design-taste-frontend`, `anthropic-skills:apple-design` | before UI code (B) | daylight-chart palette, contrast-checked tokens, display-only custom font, no theme toggle, blur only on the nav pill with a reduced-transparency fallback |
| `core-3d-animation:threejs-webgl`, `anthropic-skills:web3d-integration-patterns` | before the hero (B) | vanilla Three.js, lazy 3D chunk, render gating, static poster fallback |

## Decisions made by the owner (2026-10-28)

1. **PEAK** = `~/betterwebsitework` (Masterpiece Auto). Studied for craft, not look. Lessons taken: one written design system with a one-line idea; tokens only, never raw colours in components; contrast ratios cited; a live reference page; a governance rule; a security report split into fixed / you do this / already fine / not done and why.
2. **Identity:** rebuild the look; keep the name and the wave / signal / creator-intelligence idea. Palette, type, logo geometry, layout and interaction are all open. Originality with a stated rationale, tested against the real product, not novelty for its own sake. Use the installed 3D skills, the Apple design guide skill and the taste skill; **include genuine 3D assets**.
3. **Pricing:** there is no billing (Stripe not available yet). Pricing copy states only what the code enforces. Paid tiers are not purchasable.
4. **Access policy:** **sign-in required for every analysis**; one free analysis per month, no card, low-friction OAuth signup; a **public interactive sample report** for evaluation without an account; all marketing copy matches this.
5. **P0:** the latest-user-report exposure is a privacy defect. Audit every report read path, query, cache and share mechanism; enforce ownership server-side; regression tests. Hiding it on the homepage is not enough.
6. **Atomic quotas:** usage limits, entitlements and credits are enforced atomically server-side; duplicate submissions and concurrent requests must not bypass them.

## Open items

Real prices (still unknown, none shown) · real sample channel for the public report (synthetic and labelled until approved) · approval to apply migrations 004/005 and to deploy.

## Log

- 2026-10-28 · Audit complete. Production is `origin/master@e4b7943`; legacy trends app confirmed dead; `1a44554` guards against shipping it. 13/13 tests pass. PEAK not found locally.
- 2026-10-28 · A.5 landed (`9867cd8`, `7b81a55`): cross-account report leak closed and proven with multi-account Postgres tests; atomic quota ledger; OAuth takeover closed. See `REPORT-ACCESS-AUDIT.md`.
- 2026-10-28 · B prototype in `web/` (Vite + TS + Three r186). Real 3D: heightfield relief of a synthetic channel with custom shaders, two Blender-modelled GLBs (31 KB, 11 KB), spring-physics probe. Budgets: initial ~21 KB gz, 3D chunk ~141 KB gz (limit 150). Auto-loads 3D only on WebGL2 + fine pointer + width >= 900 + no data-saver + no reduced-motion; otherwise an inline SVG poster and an opt-in button. Single-file build checked: zero network requests, opt-in starts the scene. Live copy: https://claude.ai/artifact/D46iFgm47WcQM9EScP4KvP (private).
- Still owed for B: Playwright matrix (no-WebGL, reduced-motion, saveData, offscreen rAF count, 390/768/1440, both themes).
- 2026-10-28 · Hero now uses real public data: 17 creators (known and smaller) snapshotted from YouTube public feeds (`web/tools/fetch-creators.mjs`, names verified against the feeds), random pick plus picker and "Another channel". Flat chart rebuilt as a real chart (log multiples of the median, time axis, Short vs video shapes, titled crest labels, hover card). Phone layout fixed.
- 2026-10-28 · `GET /api/sample-creator` (commit `c9453fa`): upgrades the sample to 48 uploads via the YouTube Data API key without being able to exhaust it. Allowlist only, KV cache 6h fresh / 7d stale, per-creator lock, global daily unit budget (`SAMPLE_YT_DAILY_UNITS`, default 300 of 10,000), fail closed without KV, per-IP brake. 10 tests, 2 mutants killed. Not exercised against real YouTube: needs a deploy or an approved local run.
- 2026-10-28 · Launch checklist (pasted by owner) added to `~/.claude/CLAUDE.md` section 7 and run against this repo. Findings: no secret-shaped strings or env files tracked; no stray localhost in shipped code. **Open:** no CSP or HSTS in `vercel.json` (only nosniff, frame deny, referrer, permissions); no error tracking or uptime monitoring wired; Neon backups unconfirmed; `/api/sample-creator` is intentionally public (listed, rate limited, budgeted).
- 2026-10-28 · Owner approved the visual direction and set priorities: P0 production hotfix, P1 Analyzer 3.0, P2 reports/onboarding, P3 verification. P0 handed to a separate session (`hotfix-report-access`, branch off `origin/master`, nothing pushed).
- 2026-10-28 · Project `CLAUDE.md` reconciled with the code (it described the dead Express "trends" app). Verified shipped surface, auth/OAuth rules, plans/quota, migrations, env names, tests.
- 2026-10-28 · **Analyzer 3.0 (first working slice).** Backend: reports now keep the evidence behind their citations (`analysis.evidence`: videos with ids, views, likes, dates, plus the true channel median), and the prompt tags videos uniquely (T = top by views, R = most recent) so "T3" can never mean two videos. No migration needed (jsonb). Front end `web/src/app/`: start form with live quota, streamed run (POST + reader, idempotency key per attempt), report with a ranked "What to make next" hero (each idea lists the videos it relied on and a counted evidence strength), performance map, the other eight dimensions with observed/calculated/inferred/estimated chips, evidence table, video drawer showing where each video is cited. States: signed out, limit reached, in progress, AI failure, unknown report, empty sections, older reports without evidence. Production bundle: app JS 5.3 KB gz + CSS 4.4 KB gz, no Three.js, preview mock not included. Verified on desktop and in the iOS Simulator (found and fixed a focus ring and a clipped grid there). 111/111 tests (7 new, escaping mutant killed). Preview: https://claude.ai/artifact/3QSwMMRMTGmESnjgsRm3YT (private; preview data, no server).
- 2026-10-29 · Codex QA branch reviewed and integrated by fast-forward (`35d7efb`, `d303754`, nothing pushed). Reviewed the source changes (sentinel height, scene wake on state change, frame-callback cancellation when offscreen or hidden, footer wrap): sound. Reproduced independently: backend 116/116, `tsc` and contrast clean, browser matrix 168 as expected (160 passed + 8 marked failures), 0 unexpected, 0 flaky, 8 skipped. The v1 `cpmRange` defect Codex flagged was in the analyzer renderer; fixed in `c14b88c` (range and niche shown, clean total as headline, original wording kept beneath), marker removed, all four sizes by two themes pass.
- 2026-10-29 · Hotfix branch `hotfix-report-access` (`7cfb1c0`, off `origin/master`) reviewed; its 35 tests reproduced. Its migration `004_report_access.sql` has the same name and an identical DO block as this branch's, so applying either first is safe; only this branch's extra index would be skipped (create it in a later migration). Not deployed.

## Needs the owner before launch

- Legal review of `privacy.html` and `terms.html` (governing law and jurisdiction deliberately omitted). Contact address used is the one already on the old privacy page (`efeali.bel@gmail.com`); confirm or replace.
- Consider whether users should be told about the report-exposure fix (it is live on production until this branch ships).
- Read the YouTube API Services Developer Policies (storage of the creator snapshot, 30-day refresh, attribution) before launch; `creators.json` is a dated snapshot of public feed data.
- **Approval needed for ONE real analysis run** (Groq + YouTube quota) on a niche channel, to replace the hand-written illustrative sample (`web/src/app/fixture.ts`) with a genuine stored report. Until then `/sample` is clearly labelled illustrative.
- Old reports have no `evidence`; they render with citations as plain text and a note. Only new analyses are fully traceable.
- A wrong-but-valid channel spends the month's single free run. Decide whether to add a free "resolve channel" confirmation step.
- Thumbnails load from `i.ytimg.com` in the report (disclosed in the privacy page).
- The home "sample report" is currently the interactive chart; the full public sample report (milestone D) is not built, so no page links to one.
