# Wavecrest 3.0 — isolated QA handoff

2026-10-28. Branch `codex/wavecrest-3-qa`, based on
`wavecrest-3@f07647e8d7abf13102ecc5e3e8f8c70d05636369`.
Managed worktree: `/Users/efealibel/.codex/worktrees/dba4/Wavecrest...`.

## Ownership and safety

Codex changes own `web/tests/`, `web/playwright.config.mjs`, the web test dependency/script,
Node type setup, the hero state/lifecycle fixes in `web/src/main.ts` and
`web/src/scene/index.ts`, and footer wrapping in `web/src/styles/base.css`.
New historical fixtures live in `test/fixtures/historical-reports.json`, with tests in
`test/report-compatibility.test.js` and `web/tests/reports.spec.mjs`.

Claude retains `web/src/app/**`, `lib/**`, API handlers, analyzer contracts/normalization,
and shared progress documentation. None of these implementation files were modified.
This handoff is the ownership coordination record; no direct Claude session was available.
The tests can be integrated independently of Claude's analyzer implementation.

The source checkout's uncommitted root `package.json` dev-script change and untracked
`.agents/`, `.claude/skills/`, `.superpowers/`, `AGENTS.md`, `CLAUDE.md` and
`docs/superpowers/` were left untouched. No environment files were opened, production
credentials queried, migrations applied, paid calls made, branches pushed or sites deployed.

## Fixed defects

| Defect | Reproduction / regression | Minimal change |
|---|---|---|
| 390px document widened to 442px | Hero matrix and public-page overflow assertions | Let footer links wrap |
| Large scroll jump skipped the one-pixel state observer | Every matrix case jumps to 95% of the story and back | Observe the remainder of the story instead of one pixel |
| Paused scene stayed at hero progress after chart state changed | Pause until no callback remains, then scroll to chart | Wake the scene on state changes in every mode |
| 3D render loop hid the flat chart's inspector | Keyboard crest selection must persist across subsequent frames | Give the active chart state ownership of its inspector |
| A pending callback could fire after suspension | Count pending/executed callbacks and draw calls offscreen/hidden | Cancel the queued callback when intersection/visibility changes |

The cancellation regression was mutation-checked: temporarily removing both suspension
cancellations produced `pending = 1` at the offscreen notification, and the test failed.
The fix was restored before the final full run.

A clean install also exposed missing Node types for `vite.config.ts`. They are now an
explicit web development dependency and included in the TypeScript config.

## Historical formats

Fixtures contain synthetic text and numbers with keys verified against these commits.
They are representative prompt contracts, not exported production reports; actual model
outputs may be malformed in other ways. No production database was queried.

| Version | Source | Difference pinned |
|---|---|---|
| v0 | `2b0f2d8c81d358dd771da5a5245e2c30731cb73c:api/analyze.js` | Seven dimensions; no earnings or ideas |
| v1 | `8f6fd97a1f1394be6b76260a5f0485180b1620d8:api/analyze.js` | Adds ideas and `earningsEstimate.cpmRange` |
| v2 | `a3d624c3c84369225f84bca9e311c1025a0ec7e2:api/analyze.js` | `cpmRPM` and model arithmetic in revenue strings |
| v3 | `e4b7943af0690ccfd7d088151050547f54ff4156:lib/analysis.js` | Code-computed earnings; filtered gaps |

Each version is checked through API mapping and HTML rendering, including preserved
content, absent-evidence messaging, missing-section states, plain old citations, privacy
metadata, no mutation, and browser `/app?r=<uuid>` deep links at all eight projects.

**Open for Claude:** v1 `cpmRange` is preserved by the API but omitted by the renderer,
which reads only `cpmRPM`. The browser regression is explicitly marked expected failure
at each size/theme. It asserts the original `$4-8` range and `Education` niche survive.
After normalizing or rendering that field, remove `test.fail` from the test; an unexpected
pass deliberately fails the suite until the marker is removed. This remains a defect,
not completed compatibility support.

## Verification and reproduction

See `web/tests/README.md` for commands, coverage and artifact locations. Environment:
macOS arm64, Node v26.12.1, npm 11.20.0, Playwright 1.64.1 / Chromium 156 (SwiftShader).

- Root `LC_ALL=en_US.UTF-8 npm test`: **116 passed, 0 failed, 0 skipped**. The integration
  tests use throwaway local PostgreSQL. The sandbox initially blocked shared memory;
  rerunning with local-process permission passed. No remote database was involved.
- `cd web && npm run typecheck`: passed.
- `cd web && npm run check:contrast`: all 18 light/dark token pairs passed.
- Production Vite build: passed; executed by the browser runner before the final run.
- Final browser run: **176 total: 160 passed, 8 expected failures, 8 inapplicable skips;
  0 unexpected failures, 0 flaky results, 0 retries**, in 223.2 seconds. All **64 core
  matrix cases passed**. The eight expected failures are the v1 CPM defect, once per
  size/theme. The eight skips are mobile-only opt-in on desktop and desktop-only chart
  controls on narrow layouts. Playwright's console summary counts the expected failures
  among its “168 passed”; this breakdown comes from `test-results/results.json`.

## Integration

Keep the branch and worktree for review. Cherry-pick the QA commit, then the compatibility
commit (IDs supplied in the delivery message), onto Claude's integration branch. Preserve
any new scripts/dependencies if `web/package.json`, its lockfile or the TS config conflicts.
Rerun `npm ci` in both root and `web/`, install Chromium, and run the commands above plus
`cd web && npm run test:browser`. The root working tree and progress log need no reset.

## Limits

No Safari/Firefox or physical GPU/device run; software WebGL results are functional only.
Save Data and unavailable WebGL are injected capabilities; hidden-tab state is simulated
through Page Visibility, while offscreen intersection is real. These keyboard checks and
contrast checks are not a complete WCAG/screen-reader audit. No production report corpus,
real OAuth, YouTube or Groq run was accessed. The test server is a local production-build
preview, not a verification of production rewrites, migrations, auth or deployment wiring.
