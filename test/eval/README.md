# Analysis evaluation

All fixtures are synthetic; dates and offline facts use 2026-10-29 noon UTC.
Each case has prompt-shaped `raw` output and hand-authored positive/negative controls.

```sh
node --test test/eval/
LC_ALL=en_US.UTF-8 npm test
node scripts/eval-replay.js
node scripts/eval-live.js --dry
node scripts/eval-live.js --fixtures brand,tiny --dry
```

Live evaluation uses only `process.env.GROQ_API_KEY`; export it in your shell.
It never loads `.env` files. `GROQ_MODEL` is honored by production `runAnalysis`.

```sh
node scripts/eval-live.js --fixtures brand,mega
```

With no `--fixtures`, all 12 fixtures run. `--dry` needs no key, makes no
network calls, and prints system/user prompts plus a rough input-token estimate.
Live runs call production `runAnalysis`, print section counts and invariant results,
and save analysis, diagnostics and scores to ignored `test/eval/out/<fixture>.json`.
A missing key, request failure or failed invariant exits nonzero.
Counts measure retained patterns/items/fields, not correctness of every prose claim.
Computed citation multiples are historical benchmarks, exempt from forecast checks.

Schema tests mirror optional `Analysis` fields and required `Evidence` fields.
They cover historical reports, all fixture outputs and both stored replays.
The CLI tests mock the model response; automated tests never call the network.
Failing TODO tests document lib bugs without failing the suite; details and the
seven mutation results are in `tasks/codex-analysis-eval.report.md`.
