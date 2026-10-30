# Task: independent evaluation harness for the analysis pipeline

Owner: Codex. Lead/reviewer: Claude. Base: branch `ai-quality` @ 88b06ae. Work in your own worktree/branch `codex/analysis-eval`.

## Context
`lib/analysis.js` builds a prompt from `lib/analysis-facts.js` (computed numbers) and passes the model's JSON through `lib/analysis-enforce.js` (validation). Read those, `test/analysis-enforce.test.js`, `test/helpers/replay.js` and `test/fixtures/stored-replays.json` first. Rules the layer must hold: model never supplies numbers; citations must resolve AND support the claim; Shorts and long-form never blended; unknowns stay unknown (no demographics, sponsors, revenue, thumbnail detail, unannounced products); ideas fit channel identity and feasibility; stored-report schema (keys in `web/src/app/types.ts`) must not break.

## Deliverables (you own ONLY these paths)
1. `test/eval/fixtures/*.json`: at least 12 small channel fixtures (videos with id/title/viewCount/likeCount/duration/publishedAt, plus channel meta) covering: brand channel, mega creator, mid creator, tiny channel (<10 videos), Shorts-only, Shorts+long mix, dormant channel, one-viral-outlier, non-English titles, near-duplicate titles, no-dollar-amounts channel, ambiguous niche.
2. `test/eval/cases/*.json`: for each fixture, a hand-written adversarial "model output" (raw shape produced by the prompt in `buildPrompt`) containing realistic flaws: fake/misattributed tags, paraphrased quotes, demographic claims, invented products, duplicated titles, numeric forecasts in prose, wrong channelType/niche.
3. `test/eval/enforce-eval.test.js`: runs every case through `enforceAnalysis` and asserts invariants (property-style, not snapshots): every example/signal is verbatim from a cited video; pillar percentages sum to 100; no digits+`×`/`%` forecasts survive in idea text; `estimatedAge` is unknown; Shorts revenue < blended-at-long-form-rate; all 9 legacy keys present with correct types; output JSON-serialisable and < 30 KB.
4. `test/eval/schema-compat.test.js`: every `analysis` in `test/fixtures/historical-reports.json` and every enforcement output satisfies the optional-field `Analysis` type contract (write a small runtime checker mirroring `web/src/app/types.ts`).
5. `scripts/eval-live.js`: model-based evaluation. Reads `GROQ_API_KEY` from `process.env` ONLY (never reads `.env*`, never logs/prints the key or request headers), runs `runAnalysis` on chosen fixtures, prints a scorecard (claims kept/dropped per section, invariant pass/fail) and writes JSON to `test/eval/out/` (gitignored). Exits with a clear message if the key is absent. `--fixtures a,b` and `--dry` (no network, prints the prompt and token estimate) flags.
6. `scripts/eval-replay.js`: prints old-vs-new for the stored Apple/MrBeast replays via `test/helpers/replay.js` (no network) as a compact table.
7. `test/eval/README.md`: how to run each (<= 40 lines).

## Constraints
- Do NOT modify `lib/**`, `api/**`, `web/**`, `migrations/**`, `package.json`, existing tests/helpers/fixtures. If you find a bug in `lib/`, write a failing test marked `{ todo: true }` and describe it in `tasks/codex-analysis-eval.report.md`; Claude fixes it.
- No new dependencies. Node ESM, `node:test`. No network in tests. No deploy, push, or DB access.
- Add `test/eval/out/` to `.gitignore` only via a one-line addition.
- Commit on your branch only, small commits, message prefix `test(eval):`.

## Acceptance
- `npm test` passes (existing 161 + yours), `LC_ALL=en_US.UTF-8` if Postgres complains.
- Mutation check: temporarily disabling any one of these in `lib/analysis-enforce.js` makes at least one of your tests fail: tag resolution, `supports()`, quote substring check, gap presence check, idea duplicate check, brand future-entity check, demographic scrub. List which test catches each in your report.
- `scripts/eval-live.js --dry` runs with no key.
- Report at `tasks/codex-analysis-eval.report.md`: what was added, mutation table, suspected `lib/` bugs.
