# Wavecrest Improve: architecture and implementation plan

Status: approved as a planning foundation, **not authorized for implementation**.

This document preserves the architecture proposal and subsequent product direction. It is an implementation handoff for Claude or another engineer, not a request to start development. No production code, migrations, billing changes, deployment, merge, or push is part of this documentation assignment.

Base: freshly fetched `origin/master`, commit `4c27939037523bfcd6ed82766fcb2380a6eb11b2`. The initial architectural review used the Wavecrest 3.0 development checkout; this handoff accounts for the latest master's migration sequence and evolving analysis contract. Revalidate contracts before implementation.

## 1. Decision and product journey

Build Improve as a private intelligence workspace around existing reports, with deterministic comparisons and user-managed plans. Keep report generation behind its existing service boundary. Dashboard visits must not trigger another AI analysis.

The long-term journey is **Explore → Understand → Improve → Measure → Repeat**.

| Stage | Action | Durable result |
| --- | --- | --- |
| Explore | Find a channel | Existing discovery experience |
| Understand | Run and save an analysis | Existing report |
| Improve | Attach a report; choose an action | Private workspace and plan |
| Measure | Compare eligible evidence; review an experiment | Explicit result with provenance |
| Repeat | Revise the plan or run another analysis | New report and revised priorities |

One workspace represents one canonical YouTube channel for one user. Users may track channels they do not own. Label those **Tracked channels**; only verified analytics authorization earns **Connected channel**. Identity comes from channel ID, not mutable handle or display name.

### Release boundaries

- **P0: prerequisite contract and policy decisions.** Resolve before dependent work; not a separate product release.
- **MVP v1, first release: P1–P3.** Secure workspaces, dashboard/history, actionable recommendations and ideas.
- **MVP v2, second release: P4–P5.** Experiments and evidence-backed comparisons.
- **Future: P6–P8.** Historical observations, connected YouTube analytics, automated evaluation and optional coaching.
- **Wavecrest Access:** separate future business/product initiative; never a dependency of the Improve MVP.

Exclude automatic publishing, autonomous experiments, team permissions, scheduled AI analyses, forecasting, a framework rewrite, and a generic workflow engine from the MVP.

## 2. Existing architecture and reuse

The checked-out 3.0 code, rather than the older Express project description, is the implementation baseline.

| Concern | Existing implementation | Reuse decision |
| --- | --- | --- |
| Backend | Serverless `api/`, injectable `lib/handlers/` factories | Keep endpoint and testing patterns |
| Database | PostgreSQL through `lib/db.js`; SQL migrations | Additive migrations and transactions |
| Reports | `reports.analysis` JSONB, channel metadata, owner, visibility | Preserve existing payloads and links |
| Report access | `lib/reports.js` centralizes access | Extend there for report request reads; do not bypass it |
| Identity | HMAC-signed cookie; Google/GitHub login | Reuse session authentication; login is not YouTube authorization |
| Quota | `analysis_runs`, `lib/quota.js` | Reuse reservation, idempotency, concurrency and refunds for analyses |
| Plans | `lib/plans.js`, manually assigned entitlements | Do not assume active Stripe subscriptions |
| Frontend | Vite, vanilla TypeScript, HTML rendering, SVG | Extend existing app; no React migration |
| Tests | Node tests, historical-report fixtures, Playwright | Extend established coverage |
| Cache infrastructure | Existing `lib/kv.js` | Reuse only if measured performance requires caching |

Primary references: `lib/reports.js`, `lib/auth.js`, `lib/http.js`, `lib/plans.js`, `lib/quota.js`, `lib/handlers/analyze.js`, `lib/analysis.js`, `lib/youtube.js`, `web/src/app/types.ts`, `web/src/app/api.ts`, `web/src/app/main.ts`, and `scripts/migrate.js`.

Reports retain selected top/recent evidence, not every fetched video. Older reports may have no evidence. A delivered analysis may have a null `reportId` after persistence failure; it cannot become a durable workspace source. Current migrations extend through `006_users_provider_unique.sql`; allocate future migration numbers at implementation time.

## 3. Dependency on AI analysis enforcement

Codex is modifying the enforcement layer on another branch. Do not modify, reset, cherry-pick, or otherwise interfere with its active worktree. This proposal does not assume its unfinished changes exist on master.

Before implementing P3 or stronger comparisons, agree and fixture-test:

1. Accepted report shapes, optional fields, and an explicit schema/version marker if the enforcement work provides one.
2. Which findings survive validation and how unsupported or rejected claims are represented.
3. Citation format, resolvable video IDs, evidence timestamps and sample coverage.
4. Provenance labels and the distinction between observed, calculated, inferred and estimated content.
5. Failure behavior: rejected analysis, partial report, successful but unsaved report, and quota settlement.
6. Whether model/prompt/validator versions are exposed or stored. Unknown versions stay unknown; do not invent metadata for legacy reports.

Introduce a small versioned **Improve report adapter** outside the enforcement implementation. It reads supported report shapes and produces recommendation candidates and comparison capabilities. Unknown or malformed fields degrade to unavailable. Do not copy the model prompt, validation rules, or grounding heuristics into Improve.

Persist the adapter version and source references with imported recommendations. Never silently rewrite saved user plans when enforcement changes. Re-import is explicit and idempotent. P1–P2 can proceed against agreed existing ownership/report contracts; P3 depends on candidate validity and citations, P5 on evidence comparability, and P6 on a coordinated collection/persistence hook.

Integration tests must include legacy, current and newly enforced reports. Later shared-file changes to the analysis handler, report serialization, frontend report types and fixtures must be coordinated after the enforcement branch stabilizes.

## 4. Truth and provenance contract

Separate report, observation, recommendation, plan, experiment and outcome:

- **Report:** analysis artifact produced at a particular time.
- **Observation:** measured data with source, actual observation time and coverage.
- **Recommendation:** advice grounded in a report with explicit uncertainty.
- **Plan:** a user-authored intended action.
- **Experiment:** a declared hypothesis and measurement procedure.
- **Outcome:** measured or manually reported result, never implied causation.

Saving a report does not necessarily create a new observation. Cached inputs retain their original observation timestamp. Report creation time is not a substitute for missing collection time.

Metric responses use an envelope equivalent to:

```ts
interface MetricValue {
  value: number | null;
  unit: string;
  source: 'public' | 'authorized' | 'manual';
  observedAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  sampleSize: number | null;
  coverage: 'selected_evidence' | 'recent_uploads' | 'complete_period';
  status: 'available' | 'insufficient_data' | 'incomparable' | 'expired';
  reason: string | null;
}
```

Do not convert missing or hidden metrics to zero. Legacy subscriber values may already have lost this distinction; legacy zero is ambiguous. Public reports can describe visible uploads, dates, cumulative views and sampled performance. They cannot establish impressions, CTR, watch time, retention, actual revenue or private audience demographics. Ordinary Google login does not grant YouTube Analytics access.

One snapshot supports a distribution, not a growth series. Publication dates establish upload history, not historical view counts. A report timeline is allowed in v1 but must not imply a performance timeline.

## 5. Database architecture

Use relational columns for identity, ownership, lifecycle and dates. Use bounded JSONB for evidence references and versioned calculation specifications. UUID primary keys, UTC timestamps, nonnegative integer versions and checked state values are the defaults.

### MVP v1 tables

| Table | Required fields and constraints |
| --- | --- |
| `creator_workspaces` | `id`, `user_id FK users`, `channel_id text`, `label`, `goal`, `archived_at`, `created_at`, `updated_at`, `version`; unique `(user_id, channel_id)` and `(id, user_id)` |
| `workspace_reports` | `workspace_id`, `user_id`, `report_id`, `attached_at`; PK `(workspace_id, report_id)`; composite ownership FKs |
| `workspace_recommendations` | `id`, workspace/owner, nullable source report after deletion, `source_key`, `adapter_version`, `title`, `rationale`, bounded `evidence_refs jsonb`, `evidence_quality`, `effort`, `priority_band`, `priority_reason`, `status`, version and timestamps |
| `workspace_ideas` | `id`, workspace/owner, optional recommendation and source report, optional `source_key`, `title`, `notes`, `status`, `planned_date`, `published_video_id`, version and timestamps |

Recommendation states: `open`, `accepted`, `dismissed`, `done`. Evidence quality: `direct`, `limited`, `hypothesis`. Effort: `small`, `medium`, `large`. Idea states: `backlog`, `planned`, `published`, `archived`.

Unique `(workspace_id, source_key)` for imported items prevents duplicate imports. Source keys initially use report ID, section and item index; semantic similarity across reports is not identity. Manual ideas have no import key.

### MVP v2 table

`workspace_experiments`: `id`, workspace/owner, optional idea, `hypothesis`, `intervention`, `metric_key`, `measurement_source`, bounded/versioned `baseline_spec jsonb`, `target_spec jsonb`, start/end, status, outcome, notes, version and timestamps.

States: `draft`, `running`, `completed`, `abandoned`. Outcomes: `met_target`, `missed_target`, `inconclusive`; null before review. Baseline and target freeze at start.

### Ownership and relationships

Every child has `user_id`; composite FKs reference `(id, user_id)` on its parent. Add unique `(id, user_id)` to reports for attachment ownership. Nested recommendation/idea references must also match the workspace, either through composite constraints including workspace ID or explicit transactional validation. Never allow a same-user item from another workspace to be silently linked.

Attachment verifies report ownership and matching canonical channel inside a transaction. A public-link report owned by someone else is not attachable in the MVP. Centralize report SQL in `lib/reports.js`; workspace repositories call its owner-scoped helpers.

Indexes:

- Workspaces: `(user_id, updated_at DESC, id)`.
- Attachments: `(workspace_id, attached_at DESC, report_id)`.
- Recommendations/ideas: `(workspace_id, status, updated_at DESC, id)`.
- Experiments: `(workspace_id, status, ends_at)`.

### Deletion semantics

- Workspace deletion cascades its private planning children and attachments, not original reports.
- Report deletion removes attachments and invalidates source references; preserve independent user-authored notes and plans.
- Remove copied source evidence where retention/deletion requires it. Do not retain deleted evidence hidden inside JSON.
- Nullable source-report relationships must null the source ID only, never the non-null owner column; implement appropriate FK actions or explicit transactional cleanup.
- Show affected references before confirming report deletion.
- Account deletion removes workspace records, connections and credentials.

Avoid an event-sourcing system. Current states, timestamps and immutable experiment baselines suffice initially.

### Future observation tables (P6)

- `channel_observations`: owner/workspace, source report, actual observation time, source kind, collector version, nullable channel counts, coverage metadata and expiry.
- `video_observations`: observation ID, video ID, publication time, nullable counts/duration, format classification and provenance; PK `(observation_id, video_id)`.

Store all fetched eligible videos for new observations only when permitted by the agreed retention policy. Legacy selected evidence is not a complete observation. Replayed/cached input does not create another measurement. Read legacy evidence through the adapter rather than copying it into an authoritative-looking full dataset.

### Future connected analytics tables (P7)

- `channel_connections`: owner/workspace, verified channel ID, scopes, encrypted refresh token, key version, status, last success and revocation time.
- `analytics_daily`: owner/connection, channel or video, provider date, typed metrics, dimension set, retrieved time, availability and retention metadata; unique source/date/dimension identity for idempotent upserts.
- `analytics_sync_runs`: connection, date range, lease, status, attempt count and safe error category.

Do not add future tables in the first release.

## 6. API contracts

Session authentication only for MVP workspace routes. Existing broad API keys do not automatically gain future connected-data permissions. Follow existing `{error, code}` responses.

| Endpoint | Contract |
| --- | --- |
| `GET /api/improve/workspaces` | Cursor-paginated metadata summaries |
| `POST /api/improve/workspaces` | Body `{reportId, label?, goal?}`; derive owner and channel server-side; create and attach atomically |
| `GET /api/improve/workspaces/:id` | Summary, selected report, freshness, counts and capabilities |
| `PATCH /api/improve/workspaces/:id` | Label, goal or archive state with `expectedVersion` |
| `DELETE /api/improve/workspaces/:id` | Delete workspace and its private children |
| `GET /api/improve/workspaces/:id/reports` | Paginated attached report metadata |
| `POST /api/improve/workspaces/:id/reports` | `{reportId}`; owned saved report from same channel; idempotent |
| `GET /api/improve/workspaces/:id/comparison?baseline=…&current=…` | v2: deterministic comparison, eligibility and reasons |
| `GET/POST /api/improve/workspaces/:id/recommendations` | List or explicitly import candidates from attached report |
| `PATCH /api/improve/workspaces/:id/recommendations/:itemId` | Validated user-controlled state with version |
| `GET/POST /api/improve/workspaces/:id/ideas` | List or create/import an idea |
| `PATCH/DELETE /api/improve/workspaces/:id/ideas/:itemId` | Edit/remove owner-scoped item |
| `GET/POST /api/improve/workspaces/:id/experiments` | v2: list/create experiment |
| `PATCH /api/improve/workspaces/:id/experiments/:itemId` | v2: validated transition or result entry |

Use shared dispatch if deployment function limits favor it; preserve these resource semantics. New helpers belong in workspace repositories and injectable handlers, not raw SQL in endpoint files.

Rules:

- `401 AUTH_REQUIRED` for no session; `404 NOT_FOUND` for inaccessible resources.
- `400 INVALID_INPUT` for invalid bodies; `409 VERSION_CONFLICT` for stale writes.
- Updates compare `expectedVersion` and atomically increment version.
- Bound text length, request size, arrays, query ranges and page sizes; cursor ordering includes a unique tie-breaker.
- Capability fields explain unavailable comparisons rather than returning invented values.
- Imports/attachments have durable uniqueness; repeated requests return existing results.
- Manual create requests use an owner-scoped idempotency key or client-generated resource ID to prevent retry duplicates.
- Dashboard reads perform no provider/model calls.

New analysis remains on the existing endpoint and quota ledger. Attach the returned saved report explicitly afterward. If attachment fails, retry attachment only. Never use unawaited serverless background work for persistence, and do not attach a null report ID.

## 7. Authorization and isolation

Public report visibility is not workspace permission. Every query, join, aggregate, comparison, export and mutation is scoped to the authenticated owner. Never accept owner identity from request data.

```sql
UPDATE workspace_ideas
SET title = $4, version = version + 1, updated_at = now()
WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND version = $5
RETURNING ...;
```

Reuse `getUser`, `isSameOrigin`, `noStore` and stable error helpers. Validate nested IDs against workspace and owner. Resolve citations only through attached authorized sources. Escape user/model text. Keep planning notes and connected metrics out of report serializers, public sample endpoints and shared caches. Use transactions for multi-record operations.

Application scoping plus composite constraints is the consistent MVP. PostgreSQL RLS is optional defense later, only with transaction-local identity and a role that cannot bypass it. Do not introduce untested RLS on pooled connections.

## 8. Deterministic analytics (v2 and later)

| Calculation | Definition | Eligibility |
| --- | --- | --- |
| Absolute change | Current minus baseline | Matching metric, source and entity |
| Percentage change | `(current - baseline) / baseline * 100` | Positive baseline; otherwise unavailable |
| Video gain | Cumulative count difference for same video | Two actual observation times |
| Average interval gain | Gain / elapsed days | Positive elapsed time; label interval average |
| Sample median change | Difference between disclosed sample medians | Disclose composition; not proof of channel growth |
| Upload frequency | Upload count / fully covered window | Complete period coverage required |
| Plan completion | Completed accepted actions / accepted actions | Workflow progress only; zero denominator unavailable |

Rules:

1. Never create a trend from one snapshot or interpolate daily growth between two points.
2. Compare common video IDs separately from new/missing members; disclose overlap and sample sizes.
3. Missing/deleted videos are not zero-view videos. Negative corrections remain visible.
4. Changing evidence selection can change medians without underlying performance improving.
5. Format splits require reliable classification; duration alone is a heuristic.
6. Model pillar percentages and audience estimates are not measured longitudinal KPIs.
7. Existing revenue estimates are not actual revenue progress.
8. Lifetime views divided by video age cannot establish first-week performance.
9. Do not compare incompatible collector/schema versions without an explicit compatibility rule.
10. Calculations run in code; model prose cannot supply numeric results.

Connected comparisons require equal completed periods, matching dimensions/filters/timezone and provider availability cutoffs. Refresh revision-prone recent periods. Aggregate ratios from proper denominators, not unweighted daily percentages.

## 9. Recommendations and idea planning (v1)

Adapt existing `videoIdeas`, `gaps` and sufficiently grounded findings. Each candidate contains a concrete action, source report and resolvable evidence, goal relevance, evidence quality, effort, transparent priority reason and measurement suggestion (or an explicit unmeasurable state).

Ranking is deterministic: user-pinned first, then goal-aligned supported actions, then lower effort within equal evidence quality, then stable source order. If goal relevance cannot be established without an additional model call, leave it unclassified or let the user choose; do not pretend a keyword match is validated reasoning.

Avoid invented impact percentages. Accepting a recommendation may create an editable idea idempotently. Require the user to provide a publication video ID; do not infer which upload matches a proposed title. New reports never overwrite accepted plans or dismissed states.

## 10. Experiments and progress (v2)

Require hypothesis, intervention, primary metric/source, baseline definition, target, evaluation window, video IDs or selection rule and known confounders before starting. Freeze baseline and target when running. A running experiment must be explicitly reset to draft or replaced before changing its evaluation definition.

MVP v2 permits manual outcomes labeled manual. Automated public outcomes need eligible observations; private outcomes wait for authorization and coverage. Incomplete data yields `inconclusive`.

Say “the selected metric increased during the experiment window,” not “this recommendation caused growth.” Topic, timing, age and seasonality remain confounders. Separate execution progress (published ideas, completed actions/experiments) from performance progress (eligible observed metrics).

## 11. Frontend structure and behavior

Extend `web/src/app/improve/` with `api.ts`, `types.ts`, `workspace.ts`, `recommendations.ts`, `ideas.ts`, and in v2 `comparison.ts`, `experiments.ts`. Follow the existing API boundary and `ApiError`; reuse evidence rendering, escaping, formatting and accessible SVG conventions.

Initial route: `/app?view=improve&workspace=<id>`. Preserve `/app?r=<reportId>` links. A new standalone page is unnecessary unless later product design requires it.

Content order: identity/public-or-connected badge/freshness, goal and next action, recommendations, ideas/experiments, history/comparison. History is report history in v1, not a growth chart.

Required states: no reports, one snapshot, incompatible sources, expired evidence, unsaved analysis, deleted source, exhausted quota, load failure and edit conflict. Do not convert failed requests into empty lists. Keep unsaved edits on recoverable failures.

Provide accessible tables alongside charts, keyboard controls, focus restoration and explicit save errors. Start with lists and status controls, not drag-and-drop. Never load the marketing 3D scene for workspace interaction. Visual layout review can use the project's brainstorming visual companion during the separately authorized implementation/design phase.

## 12. Quota, caching, costs and performance

Dashboard reads, calculations and manual planning make zero model calls. Existing analysis generation consumes existing quota; attachments, imports, edits and reviews do not. Replayed results do not create fresh observations or charges.

Optional future coaching needs its own budget/reservation semantics, not an overloaded `analysis_runs` job engine. Operational spending limits still apply to unlimited product entitlements. Instrument provider requests, token usage, safe cost estimates, latency and failures without recording private content.

Start with indexed PostgreSQL queries. Use existing KV infrastructure only after measurement. A future comparison cache key includes owner, workspace, ordered source IDs, source versions and calculator version; invalidate on deletion/expiry. Authenticated responses remain private/no-store.

Paginate summaries, fetch full reports only on demand, bound comparison inputs and avoid N+1 queries. Proposed acceptance targets under representative load: warm API p95 under 500 ms, initial summary under 100 KB, zero provider calls on dashboard reads, bounded query count independent of listed workspace count. These are targets, not measurements already achieved.

## 13. Privacy, retention and connected analytics

Historical storage is a launch dependency, not an assumption. YouTube policy constrains retention, refresh/deletion and derived metrics. Confirm applicable permissions and policy before enabling historical calculations; durable user-authored planning can ship independently. Refreshing a current count must not rewrite a historical value while preserving its old timestamp.

Track source expiry. Expired evidence becomes unavailable and is purged/redacted in rows, JSON, caches and derived artifacts. Define a scheduled cleanup owner and failure alerts before storing retention-bound data. Avoid copying unnecessary channel metadata into multiple tables. Account deletion and revocation must have tested propagation and documented backup expiry behavior.

Connected analytics requires explicit incremental authorization and verified returned channel identity. Use minimal read-only scopes; revenue requires separate permission. Encrypt refresh tokens with a dedicated key and version; never reuse plaintext API-key storage or expose tokens in logs/responses. Document key rotation before launch.

Sync with bounded jobs, leases, idempotent upserts, retry backoff and provider coverage. Disconnection stops queued work, revokes credentials where supported and triggers applicable deletion. Connected metrics never enter publicly shareable reports; future sharing requires a separate sanitized projection.

References, checked during architectural review; recheck at implementation because policies and capabilities change:

- [YouTube Analytics reference](https://developers.google.com/youtube/analytics/reference)
- [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies)
- [Compliance guidance](https://developers.google.com/youtube/terms/developer-policies-guide)

No assumption is made that all Studio metrics are exposed by an API, that history can be reconstructed before collection, or that authorization permits indefinite retention.

## 14. Migration and rollout strategy

1. Revalidate latest master, active enforcement changes, migration numbering and deployed report shapes in an isolated implementation branch after approval.
2. Add only v1 tables/constraints/indexes in the first migration. Test forward application and repeat invocation through the existing migration ledger against disposable PostgreSQL.
3. Do not automatically import every user's report or create speculative observations. Explicit workspace creation/attachment avoids expensive backfills and preserves intent.
4. Audit existing data before adding ownership constraints; do not weaken constraints to accommodate unknown relationships. Large index work needs a deployment-specific lock assessment; the current runner wraps migrations in transactions, so concurrent index operations require a separate approved approach if necessary.
5. Apply additive schema before code that requires it. Gate the feature for internal validation, then controlled availability. Roll back application exposure first; do not drop user-created records during rollback.
6. Add v2 tables only for the second release. Add future observation/connection tables only when their contracts and retention controls are ready.
7. Keep existing report serialization and URLs compatible. If an integration changes shared analysis persistence, coordinate with the enforcement owner and test save-failure/quota behavior.
8. No production migrations, rollouts or account changes are authorized by this plan.

## 15. Test requirements

Use Node unit/handler tests, disposable PostgreSQL integration tests and existing Playwright patterns. No production database is needed. Mock upstream APIs. Extend `test/fixtures/historical-reports.json` and compatibility tests after agreement with the enforcement owner.

| Area | Required coverage |
| --- | --- |
| Isolation | User B cannot list, attach, compare, mutate, export or delete User A's resources |
| Sharing | Public report link grants no workspace/connected permission |
| Constraints | Cross-owner and cross-workspace relationships rejected |
| Legacy compatibility | Missing evidence, malformed optional fields, unknown versions degrade safely |
| Arithmetic | Zero denominator, missing metrics, negative corrections, incompatible samples/windows |
| Time | One snapshot never becomes growth; cached input never becomes a fresh measurement |
| Concurrency | Duplicate imports/creates remain unique; stale edit conflicts |
| Persistence | Failed attachment retries without another paid analysis |
| Deletion | Source removal invalidates evidence and preserves independent user notes |
| Experiments | Frozen baselines; incomplete results are inconclusive |
| UI | Reload persistence, keyboard/mobile use, visible errors, preserved edits |
| Performance | Bounded payload/query count; zero dashboard model calls |
| Future connections | OAuth channel mismatch, scope gaps, token expiry/revocation, job replay and deletion |

Run the existing repository tests plus relevant web typecheck/build/browser checks during implementation. Add focused regression checks rather than redundant tests that mirror trivial rendering code.

## 16. Prioritized roadmap and phase acceptance

### P0 — Contract and policy prerequisite

Deliver: agreed adapter inputs, supported provenance, retention/derived-metric decision, deletion semantics and phase scope.

Acceptance: documented enforcement boundary and representative fixtures; unknown capabilities explicitly unavailable; no reliance on unfinished branch internals. Policy-sensitive measurements remain gated if unresolved.

### MVP v1: first release, P1–P3

**P1 — Secure workspaces and persistence.** Add v1 schema, repositories, owner-only APIs and report attachment. Acceptance: migration tests pass; workspace creation/attachment atomic; channel matching enforced; cross-user/cross-workspace tests pass; unsaved reports rejected; existing report access unchanged.

**P2 — Dashboard and report history.** Add workspace routing, summaries, history and truthful empty/error states. Acceptance: state survives reload; no history fabricated from snapshot data; shared reports disclose no workspace data; keyboard/mobile flows work; no upstream calls on reads; payload/query budgets verified.

**P3 — Actionable recommendations and ideas.** Add versioned adapter, deterministic prioritization, explicit import, state changes and editable idea planning. Acceptance: supported citations resolve; invalid/unsupported candidates do not become authoritative advice; repeated import is idempotent; user edits survive new reports; no extra model calls; enforcement compatibility suite passes.

First-release exit: complete P1–P3 and applicable P0 gates, security tests, typecheck/build and targeted browser tests. No experiments, automated outcomes, private analytics or performance-growth promise is needed for v1.

### MVP v2: second release, P4–P5

**P4 — Experiments and execution progress.** Add experiment schema/API/UI, manual review and workflow summaries. Acceptance: baseline/target freeze, valid transitions, manual provenance, inconclusive result handling and no causal claims; existing ideas remain compatible.

**P5 — Evidence-backed comparisons.** Add deterministic calculator and comparison UI. Acceptance: one snapshot unavailable; actual timestamp/coverage eligibility enforced; sample changes disclosed; negative/zero/missing values handled; incompatible or expired evidence rejected; arithmetic fixtures pass; no fabricated daily series.

Second-release exit: P4–P5 and relevant policy approvals pass. Comparisons may legitimately be unavailable for existing reports. Full observations in P6 improve coverage but must not be faked to satisfy v2.

### Future: P6–P8

**P6 — Historical observations.** Coordinate full collection and persistence after enforcement integration. Acceptance: real observation timestamps, coverage and collector versions; cache replay deduplicated; retention cleanup tested; no legacy history invented; save/quota failure behavior agreed.

**P7 — Connected YouTube analytics.** Add consent, verified connection, protected credentials and bounded sync. Acceptance: verified channel and scopes; token encryption/rotation; revocation/deletion; retry/idempotency; provider data availability; no shared-report leakage. Recheck available metrics and provider requirements.

**P8 — Automated evaluation and optional coaching.** Add only for metrics with adequate comparable coverage. Acceptance: reproducible outcomes, explicit uncertainty, separate inference budget/reservations, operational spend controls and no causal or forecasting claims unsupported by evidence.

Implement phases as separately reviewable changes after authorization. Do not bundle future tables, pricing or connection scopes into the first release.

## 17. Architectural risks and unnecessary complexity

Primary risks: misleading history from selected evidence, leaking private metrics through shared reports, retaining data beyond permitted limits, stale/missing source evidence, evolving enforcement shapes, quota settlement/persistence discrepancies and operational cost despite unlimited entitlement.

Mitigations: versioned adapters, strict ownership, metric envelopes, explicit capability states, policy gates, tested deletion and existing reservation contracts.

Skip a frontend framework migration, warehouse, vector database, event sourcing, generic queue engine, automatic semantic deduplication, invented numerical impact scores and full cache layer. Add infrastructure only when measured demand or required reliability justifies it.

## 18. Wavecrest Access — separate future business/product initiative

### Purpose and status

Make professional creator intelligence accessible while keeping Wavecrest commercially sustainable. This is a future evaluation track, separate from Improve v1/v2. No final discounts, eligibility rules, prices, benefits or billing changes are approved.

Potential programs:

- Student and educator discounts.
- Veteran discounts.
- Senior discounts.
- Free or sponsored access for qualifying nonprofits.
- A genuinely useful free tier for small creators.

Do not assume the current free analysis allowance is the final Access offering. Evaluate useful outcomes, not only free request counts: persistent planning, report reuse and manual ideas have low marginal inference cost and may provide meaningful access without unlimited generation.

### Eligibility and privacy

Compare self-attestation, institutional/domain verification, trusted verification providers and limited manual review. An email domain alone may be insufficient and can exclude legitimate applicants. Provide an accessible appeal path and alternatives for people unable to use a particular verifier.

Collect the minimum result needed: program, verification status, verifier/reference, verification time, expiry and decision reason category. Prefer a verifier's eligibility assertion over retaining ID documents, birth dates, military records or sensitive nonprofit paperwork. Never place eligibility documents in reports, prompts, analytics events or support logs. If temporary document review is unavoidable, define restricted access, short deletion windows and audit controls before launch.

Determine geographic availability, age criteria, student re-verification, educator scope and nonprofit qualification during policy design. Do not infer sensitive eligibility from browsing behavior or model analysis. Do not invent senior age thresholds or final proof requirements in this architecture.

### Entitlements and Stripe compatibility

Keep eligibility, commercial billing and analysis entitlement distinct. An approved eligibility record does not itself prove payment or authorize unlimited inference. A future resolver should combine base plan, approved grant, expiry and usage policy server-side.

The current code uses manually assigned plans; do not assume Stripe is active. When billing is separately authorized, evaluate Stripe discounts/promotion codes or sponsor-funded subscriptions against supported API behavior and business rules at that time. Keep the provider adapter responsible for translating verified billing events into entitlements, with idempotent webhook handling and reconciliation. Never trust a client-supplied discount, eligibility flag or successful checkout redirect.

Specify stacking, renewal, expiration, cancellation, sponsor exhaustion, refunds and grace periods before implementation. Preserve access to user-authored plans on benefit expiry where practical; pause new paid computation according to policy rather than deleting work.

Potential future records, not MVP migrations: `access_applications`, minimal `eligibility_verifications`, time-bounded `entitlement_grants`, and sponsor budget/allocation records if sponsorship is pursued. Add only the records needed for the approved program.

### Abuse prevention and costs

Use account-level eligibility and grant uniqueness, verification expiry, rate limits and existing atomic analysis reservations. Prevent duplicate grant redemption and concurrent overspend. Avoid invasive fingerprinting or blanket penalties for shared school/nonprofit networks. Provide review for false positives.

Budget both successful and failed upstream work operationally; refunded product quota does not refund provider cost. Track per-program inference cost, provider quota, support/verification costs and sponsored commitments. Dashboard reuse should remain inexpensive. Never expose unlimited model usage solely because access is free or sponsored.

Evaluate sustainable allowances using measured token/request distributions, retries, cache reuse, retention/storage cost, support burden and contribution margin. Test low-cost model strategies only against the same quality/enforcement requirements. Discount status must not bypass grounding, security or privacy controls.

### Evaluation roadmap and acceptance

1. Research audience needs and barriers; identify the smallest useful program and a credible funding model.
2. Model conservative cost scenarios, sponsor caps and operational spending limits using real usage distributions. Do not set discounts from unsupported forecasts.
3. Select eligibility/verification and appeal rules; complete data-minimization and deletion design.
4. Define entitlement/billing behavior and test lifecycle transitions in an isolated sandbox, including duplicate webhooks, expired verification and exhausted sponsor budgets.
5. Run a separately approved limited pilot. Measure activation, retained usefulness, cost per active beneficiary, support load, abuse/false-positive rates and sponsor sustainability.
6. Expand only after explicit product and financial approval.

Acceptance before launch: documented eligibility and appeals, accessible application flow, minimal retained sensitive data, tested deletion, server-enforced quotas, reconciled billing/grants, bounded funding exposure and a useful free experience. This document authorizes none of those changes.

## 19. Handoff checklist

- Obtain separate implementation authorization; this document is the approved planning foundation only.
- Re-read repository instructions and current master; inspect active worktrees without modifying them.
- Coordinate enforcement contracts before dependent code.
- Implement first-release P1–P3 only unless scope is explicitly expanded.
- Keep public/authorized data, report time/observation time and execution/performance progress distinct.
- Do not invent private metrics, past measurements, final Access discounts or billing availability.
- Use isolated branches and reviewable commits; production migration, push, merge and deployment need their own authorization.
