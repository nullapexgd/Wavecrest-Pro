# Analysis evaluation report

## Follow-up: fixes on `codex/analysis-fixes`

The user authorized production changes after the original evaluation. The five
TODOs below are now active, passing regressions; the original findings are retained
as historical context. Evaluation commits and all JSON fixtures/cases are unchanged.

| Bug | Implemented fix |
| --- | --- |
| Numeric forecasts in titles | Reject explicit numeric performance promises in titles; scrub those promises from rationale. Preserve topic numbers, product versions, dimensions, budgets and composition percentages. Computed benchmarks are unchanged. |
| Unsupported gaps | Abstain without shared topic wording in a cited title. Retained candidates get generated evidence text, low confidence and an explicit warning that identity fit/audience demand are unverified. Model demand assertions are not retained. |
| Duplicate proposed ideas | Compare each proposal against already accepted ideas using normalized equality and the existing similarity threshold, in addition to checking published titles. |
| Unsupported classification | Require corroborating public wording. Unsupported type/niche values abstain; no unsupported niche RPM is selected. Corroborated labels remain tentative. Brand wording activates brand protections even if the model incorrectly says creator. |
| Non-verbatim quotes | Check the exact stored quote substring against the cited title, preserving case, punctuation and Unicode. Legacy tagged strings still work when their quote is exact. |

### Final verification

- `LC_ALL=en_US.UTF-8 npm test`: **211 passed, 0 failed, 0 TODO**, exit 0.
  Existing temporary Postgres tests ran with sandbox permission for shared memory.
- `node --test test/eval/`: **50 passed, 0 failed, 0 TODO**, exit 0.
- `node scripts/eval-mutations.js`: **7/7 caught**, after an unmodified baseline
  passes. Checks assert assertion failures, not syntax errors or crashes. Mutation
  sources run only in a disposable temporary directory and are removed afterward.
- `npm --prefix web run typecheck` and `npm --prefix web run build`: passed.
  Installed existing locked frontend dependencies from the offline cache; no
  dependency or lockfile changes. No frontend source changes.
- Added edges for creative quantities, forecast rationale, literal gap candidates,
  absent/fake citations, dollar-sign-only non-evidence, proposal similarity,
  exact Unicode and legacy quotes,
  independent classification failures, corroborated creator/media/brand labels,
  Shorts-only and mixed revenue, and conflicting model brand classification.
- Historical schema and replay tests remain passing. API signatures and stored
  report field types are unchanged. No pushes, deploys or production data access.

### Commit handoff

- `1b60433`: production fixes and active regression tests.
- `c4b9bbf`: reusable mutation checks and handoff documentation.
- Preserved evaluation history: `fd6af8a`, `441803d`, `115690b`.
- No known release blockers from the verified schema, API or regression checks.
  Conservative abstention described below is an intentional behavior change.

### Limits and integration

Classification uses explicit public wording, not semantic verification. Literal
niche labels (description, or at least two sampled titles) are required; synonyms
and many non-English descriptions abstain. Some previously assigned RPMs therefore
become unknown, including the description-less MrBeast replay. Supported RPM tests
now provide explicit public topic wording rather than relying on a model label.
Brand clues are heuristic, with confidence capped and a public-data caveat.
Gap wording overlap is only a candidate filter; generated text expressly avoids
claiming proven semantic relevance or demand. Numeric forecast patterns cover
explicit performance promises, not every possible paraphrase or language.

After Claude's review and the user's integration approval, run the following in
an existing **clean integration checkout on `ai-quality`**, never `scroll-reveals`.
Stop if the status command shows changes or the branch is not `ai-quality`.

```sh
git status --short
git branch --show-current
git merge --no-ff codex/analysis-fixes
LC_ALL=en_US.UTF-8 npm test
node --test test/eval/
node scripts/eval-mutations.js
npm --prefix web run typecheck
npm --prefix web run build
```

The merge includes preserved evaluation history; already integrated commits are
not duplicated. Resolve any conflicts in enforcement/tests carefully and repeat
verification. Leave pushing and deployment for separate user approval.

## Original independent evaluation (before fixes)

## Scope and completed plan

- Added 12 synthetic channel fixtures and 12 hand-authored adversarial model cases:
  brand, mega creator, mid creator, tiny, Shorts only, Shorts/long mix, dormant,
  viral outlier, Spanish titles, near duplicates, no dollar amounts, ambiguous niche.
- Added property checks with positive controls for citations, percentages, unknowns,
  numerical authority, format-specific benchmarks, Shorts revenue, legacy key types,
  JSON serialisability and the 30 KB ceiling. Inputs must remain unchanged.
- Added an optional-field runtime Analysis checker, including legacy `cpmRange`
  and required Evidence fields. Covers all four historical versions, all 12
  enforcement outputs (before/after JSON round-trip and with evidence), both replays,
  and malformed nested values to verify the checker rejects bad types.
- Added live and replay CLIs, README, and exactly one `.gitignore` line.
  Live mode reads the key only from the process environment; dry mode is keyless.
  Model responses are captured around production `runAnalysis` to calculate section
  retention and rejection diagnostics. Request options, headers and upstream errors
  are never printed or saved. Counts are item-level, not semantic claim scores.
- Only owned paths were changed. No dependencies, production edits, network calls,
  deploys, external database access or pushes. Full-suite tests use temporary local
  Postgres databases through the existing helper.

## Verification

- `node --test test/eval/`: 41 tests, 36 passed, 5 expected failing TODOs, zero failures.
- `LC_ALL=en_US.UTF-8 npm test`: 202 tests, 197 passed, 5 expected failing
  TODOs, zero failures (exit 0). The first sandboxed run could not allocate
  Postgres shared memory; the full run passed with the required sandbox permission.
- Keyless `node scripts/eval-live.js --dry`: all 12 prompts/token estimates printed.
- `--fixtures brand,tiny --dry`: selected fixtures only; missing key in live mode
  exits 1 with a clear message. Unknown fixture names are rejected.
- Mocked live CLI: production `runAnalysis` processes an adversarial response,
  prints a scorecard and saves JSON; credentials are absent from stdout/stderr/JSON.
- `node scripts/eval-replay.js`: compact Apple/MrBeast old/new counts, no network.
- Real live model evaluation was not run (no network required for this task).

## Mutation checks

Ran each mutation independently in a temporary copy of lib/scripts/test/eval;
repository `lib/**` was never edited. Command in each copy:
`node --test --test-name-pattern='cited evidence' test/eval/enforce-eval.test.js`.
Every mutant exited 1 from ordinary assertion failures, not TODO tests.
The named tests below end with `: cited evidence, computed numbers, unknowns and legacy shape`.

| Disabled guard | Temporary mutation | Catching test / assertion |
| --- | --- | --- |
| Tag resolution | Unknown tag falls back to first video | `mid`: exact cited hook examples; fake T99 adds an invalid duplicate |
| `supports()` | Always returns true | `mid`: misattributed T3 must not enter hook examples |
| Quote substring | Replace title substring predicate with true | `mid`: fabricated/paraphrased signal violates verbatim evidence invariant |
| Gap presence | Skip `present(opp)` rejection | `mid`: existing Sharpen a hand plane topic must not be called a gap |
| Idea duplicate | Set existing-title match to null | `near-duplicate`: punctuation-only title copy must be rejected |
| Brand future entity | Skip brand future-product/date block | `brand`: Phone 9 must be rejected after only Phone 8 was shown |
| Demographic scrub | Make demographic regex never match | `mid`: audience must not contain men/women/income/18-34 |

## Suspected lib bugs (executable failing TODOs)

All five reproductions are in `test/eval/enforce-eval.test.js`, marked `{ todo: true }`.
Claude owns the production fixes; these guarantees are not claimed as passing.

1. **Forecasts in idea titles:** `Repair a gate for 300% growth` survives. The
   numeric scrub covers rationale only. The regular invariant checks title plus
   model rationale; appended computed citation multiples remain allowed.
2. **Gap support:** `Celebrity yacht gossip` survives with `identityFit: high`
   and T1 pointing at a chair repair. Gap validation trusts the model's fit label
   after checking only citation existence and title absence.
3. **Duplicate proposed ideas:** repeating the same novel idea twice yields two
   outputs; novelty is checked against existing video titles, not other proposals.
4. **Plausible wrong classification:** a woodworking creator is accepted as a
   brand in Insurance. Valid enum values are trusted without evidence; invalid
   enums are correctly mapped to unknown (covered by the ambiguous fixture).
5. **Non-verbatim quotes:** `SHARPEN-a-hand-plane` is accepted against `Sharpen a
   hand plane`. Normalized substring matching preserves a fabricated literal quote.

These are bounded deterministic checks, not a semantic oracle. A passing live
scorecard does not establish that all claims or inferred classifications are true.
