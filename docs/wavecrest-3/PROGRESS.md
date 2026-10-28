# Wavecrest 3.0 — progress log

Read `ASSESSMENT.md` first. Branch `wavecrest-3`, base production `e4b7943`. **Never `git add -A`; stage explicit paths.** Nothing has been pushed or deployed.

## Status

| Milestone | State |
|---|---|
| A. Audit and plan | done (2026-10-28) |
| A.5 Access control, atomic quota, S1-S5, S8 | done on branch (93/93 tests); migrations 004/005 not applied, not deployed |
| B. Design system + 3D hero prototype (`web/`) | prototype working; awaiting owner steer before expanding |
| C. Public site | not started |
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
