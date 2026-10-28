# Wavecrest 3.0 — technical assessment and plan

Written 2026-10-28 on branch `wavecrest-3`, cut from production `e4b7943`. Every finding was verified by reading the code or the live site. Line numbers are against `e4b7943`. Resume from `PROGRESS.md`.

## 1. Ground truth

- **Production** is `origin/master` of `nullapexgd/Wavecrest-Pro`, deployed by Vercel's git integration. The live homepage is byte-identical to `origin/master:index.html`; `/api/health` reports deployment `e4b7943`.
- **The shipped app** is the root pages (`index app pricing about changelog login privacy .html`), `api/*.js`, `lib/*.js`, `middleware.js`, `migrations/`, `test/`.
  - Stack: Vercel functions, Neon Postgres, Upstash KV (edge rate limit), Groq `llama-3.3-70b-versatile`, YouTube Data API v3, Resend.
  - No build step, no types, no framework. Each page carries its own inline CSS and JS.
- **Not shipped (legacy trends app):** `server/`, `public/`, `api/index.js` (re-exports the Express server), `update-trends.py`, and two `.github/workflows/*` crons. All untracked. The root `CLAUDE.md` and `AGENTS.md` describe this dead app and are stale. Commit `1a44554` ignores it in git and in CLI uploads.
- **There is no billing.** No Stripe, no credits, no checkout. Plans are set by hand through `POST /api/admin/set-plan` (`lib/plans.js:1-4`).
- **Tests:** 13 `node:test` unit tests, all passing (session cookie, API-key format, cadence, input parsing). Nothing covers `analyze-stream`, `report`, `plans`, the OAuth callbacks, the middleware, or any rendering.
- `.env.local` was pulled from Vercel and holds production credentials. It was never opened or printed.

## 2. Findings

### 2.1 Security (independent of the redesign, so fixed first)

| ID | Sev | Where | Problem |
|---|---|---|---|
| S1 | **High** | `api/auth/[...path].js:103,159`; `lib/auth.js:99-108` | **Account takeover by email.** GitHub falls back to `emails[0]`, which can be an unverified address. Google never checks `email_verified`. `upsertUser` then answers a unique-email violation by logging into the existing account. An attacker who can present a victim's email unverified at either provider gets that account. |
| S2 | Med | `api/analyze-stream.js:27-48`; `middleware.js:7-10` | Anonymous callers get 5 analyses/hour/IP, far above Free (1/month), so plan limits are bypassed by signing out. `checkUsage` fails open on any DB error (`:39`). Uncontrolled Groq/YouTube spend. |
| S3 | Med | `api/featured.js:10-12`; `api/report/[id].js` | The homepage hero shows the **latest report from any user**, including signed-in users' private research, within minutes. Reports have no visibility concept. |
| S4 | Low-Med | `analyze-stream.js:92`; `lib/analysis.js:109` | Upstream error text (including a 200-char Groq response body) is forwarded to the browser. |
| S5 | Low | `api/health.js` | Public; lists which secrets exist and the deployment SHA. |
| S6 | Low | `api/subscribe.js` | Relays a "you're in" email to any address, limited per IP only. Persists nothing, so `privacy.html:66` ("stored") is false. |
| S7 | Low | `lib/auth.js` | Stateless 30-day cookie: logout only clears the client copy. Key hashing falls back to `SESSION_SECRET`, so rotating it silently revokes every API key. |
| S8 | Low | `analyze-stream.js` | A state-changing `GET` (consumes quota, writes a report). `SameSite=Lax` allows cross-site top-level navigation to burn a signed-in user's quota. |
| S9 | Info | `app.html`, `index.html` | Loads code from cdnjs and jsdelivr, including unpinned `motion@11`. No CSP. |

### 2.2 Analyzer integrity

| ID | Where | Problem |
|---|---|---|
| P1 | `lib/analysis.js:83` | **The "thumbnails" dimension is fabricated.** The model never receives a thumbnail, its URL, or anything derived from one, yet is asked for "formula / characteristics / text overlay style". |
| P2 | `lib/youtube.js:109-110` | Likes and comments are fetched and never used, yet "audience loyalty" and "estimated age" are asserted. |
| P3 | `lib/youtube.js:106`; `analysis.js:58` | Video descriptions are fetched and never sent. The prompt demands monetization evidence "from titles/descriptions", but sponsor and affiliate links live only in descriptions. |
| P4 | `analysis.js:51,125-135` | Arithmetic is now computed in code (good, since `e4b7943`). But monthly views is lifetime views divided by channel age, and the RPM band is picked by the model. It is an estimate and must be labelled with its assumptions. |
| P5 | `analysis.js:112-121,156` | No schema validation. `aiAnalysis.gaps.filter` throws if the model returns a non-array, after the paid call. Pillars need not sum to 100. Output is stored as-is (`lib/db.js:46`). |
| P6 | `analysis.js:142,156` | The gap grounding check covers about 50 of up to 100 titles, so a topic covered in the other 50 survives as a "gap". It can also return zero gaps, which the UI renders as an empty card. |
| P7 | `analysis.js:92`; `youtube.js:14` | No timeout or abort on Groq or YouTube calls. With `maxDuration: 60` a slow model ends in a dropped stream instead of an error. No SSE heartbeat. |
| P8 | `analysis.js:9-29` | Cadence mixes Shorts (up to 3 min) with long-form; `Math.min(...[])` is `Infinity` with no durations; weekday is UTC; `videosPerMonth` uses the all-time mean gap. |
| P9 | `analyze-stream.js:63` | "Top 20" means the top 20 of the **latest 100 uploads**, presented as channel-wide. |
| P10 | `youtube.js:5-11` vs `52-61` | Validation accepts any `youtube.com/...` URL, but `/shorts/ID`, `/live/ID`, `/embed/ID` and `/c/name` fail later. The edge limiter has already counted the request, so bad input burns the 5/hour budget. |
| P11 | `lib/db.js:18-37` | `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE` run in the request path. |

### 2.3 Copy that contradicts the code or itself

| Claim | Where | Reality |
|---|---|---|
| "7 dimensions" | `index.html:527`; `pricing.html:167,244,301`; `changelog.html:224`; `api/subscribe.js:60` | The pipeline returns 9 sections. `app.html` and `index.html:636,677` say 9. |
| Pack sizes | `index.html:690-698` (25 / ? / 400) vs `pricing.html:183-191` (10 / 40 / 150, $0.90 / $0.73 / $0.59 each) | Two different offers. Neither exists. Code has monthly quotas: free 1, starter 25, pro 100, team unlimited (`lib/plans.js:6-11`). |
| "Buy a pack" | `index.html`, `pricing.html` | A `<button>` with no handler. There is no payment code. |
| "5 analyses/day while credits last" | `index.html:704` | No daily limit or credit balance exists. |
| Team: 10 seats, webhooks, white-label, team library, usage dashboard | `index.html:713-722`; `pricing.html:208-217` | None exist. |
| Free tier features | `pricing.html:166-172` vs `index.html:679-681` | One says PDF and sharing included, history off. The other says history saved forever, PDF off. |
| Retention | `index.html` "saved forever" vs `privacy.html:85` "up to 12 months" | Indefinite in practice; no deletion job. |
| Per-creator statistics | `index.html:397-407` | Invented numbers attributed to named real creators (e.g. "94% retention in first 30s"). Retention is a private YouTube Studio metric; no public API returns it. Also a reputational risk. |
| "1,200+ creators and agencies on the early access list" | `pricing.html:331` | No list is stored (S6). `changelog.html:159` already records removing fake testimonials; this survived. |
| Privacy policy | `privacy.html:66,71` | Omits accounts, OAuth profile data, the session cookie, API keys, and report-to-user linkage. Names no LLM processor, though channel data is sent to Groq. |

### 2.4 Engineering
- Six pages duplicate their CSS tokens and share no components. There is no type safety and no shared analysis contract between `api/` and the pages.
- **Four stored report shapes exist** (from `git log -p`). The renderer and any future analysis must read all of them (see section 3).
- Shipped front-end code loads from third-party CDNs.

## 3. Stored report shapes the normalizer must accept

| Shape | Source | Notable keys |
|---|---|---|
| v0 | `main`, `2b0f2d8`..`bbf80ad` (Gemini, early Groq) | 7 sections; no `earningsEstimate`, no `videoIdeas` |
| v1 | `main`, `8f6fd97` | adds `earningsEstimate.cpmRange`, `videoIdeas` |
| v2 | `master`, `a3d624c`..`4ee017d` | `earningsEstimate.cpmRPM` is free text, with LLM arithmetic leaking into strings |
| v3 | `master`, `e4b7943` onward | earnings computed in code; `gaps` filtered |

Which of these exist in the production database is unknown. Finding out needs one read-only query, which needs your approval.

## 4. Decisions (each can be vetoed)

1. **Stack: Vite + TypeScript, vanilla Three.js, keep `api/` and `lib/`.**
   - Benefit: tree-shaken, lazily loaded 3D; one token file instead of six copies; a typed analysis contract; bundled and pinned dependencies (closes S9) and a CSP.
   - Rejected: React/R3F (a framework migration for no product gain), and Next.js (the page set is small and static).
   - Vite's `publicDir` points at a new `static/` folder so the untracked legacy `public/` is never copied into the build.
2. **3D is hero-only and progressive.** The LCP element is text. The 3D chunk loads after idle, and only if all of these hold: WebGL works, reduced-motion is off, `saveData` is off, and the viewport is wide. Every other case gets a static SVG generated from the same dataset. The analyzer is 2D.
3. **Evidence model.** Every claim in a report carries a `basis`: `observed`, `calculated`, `inferred`, `estimated`, or `unavailable`, plus the video IDs it cites. A deterministic metrics layer (`lib/metrics.js`) computes cadence, view distribution, outliers, engagement, title features, upload-time histogram, sponsor/affiliate signals, momentum and topic terms. The LLM only interprets those computed facts. Where a section fails validation, the report renders the rest and marks it `unavailable`.
4. **One contract.** A single plain-ESM module under `lib/` holds the schema, validator and normalizer. The API validates with it and the pages render from it. Tests use the existing `node:test`.
5. **Thumbnails.** First make the dimension honest (no claims without input). Real thumbnail analysis needs a vision model: a new cost and a new provider, so it is proposed, not assumed.
6. **Stream with `fetch`, not `EventSource`**, so the client can read the status code and JSON body of 429 and `PLAN_LIMIT` responses.
7. **Local-first.** No push (a branch push may trigger a Vercel preview that runs against whatever database the Preview environment points to). A fixture-driven mock API serves all visual QA.

## 5. Milestones and gates

| | Deliverable | Gate |
|---|---|---|
| **A** | This document; `PROGRESS.md`; guard commit | Tree clean of legacy files; tests pass |
| **A.5** | S1-S5, S8 fixed with regression tests; `/api/featured` stops leaking | New tests fail before the fix and pass after |
| **B** | Design system and tokens; Signal Field prototype | Written budgets below are met and checked |
| **C** | Homepage, pricing, privacy, changelog; honest copy | Route-parity script passes; every claim traces to code or a source |
| **D** | Metrics layer, schema, normalizer, new analyzer UI, history, compare, export | One fixture per stored shape renders; real-run check approved by you |
| **E** | Integration; CSP; docs refreshed | Parity script, tests, no console errors |
| **F** | `anthropic-skills:ship-safe`, manual authz review, accessibility, performance | Findings triaged; evidence recorded |

**Performance and 3D gates (all checkable in Playwright):**
- LCP element is text, not the canvas.
- The 3D chunk is *not requested* under reduced motion, stubbed no-WebGL, `saveData`, or a 390px viewport.
- Zero `requestAnimationFrame` callbacks while the hero is offscreen or the tab is hidden (instrumented count).
- gzip budgets: landing JS before the 3D chunk ≤ 30 KB; the 3D chunk ≤ 150 KB (if tree-shaken Three.js exceeds it, drop to a purpose-built WebGL2 renderer); CSS ≤ 20 KB; analyzer JS ≤ 45 KB with no WebGL.
- Headless Chromium renders WebGL in software, so any FPS from it is labelled software-rendered, not a GPU result.

**Route parity gate (rerun every milestone):** `/`, `/app`, `/pricing`, `/about`, `/changelog`, `/login`, `/privacy` resolve; `/app?r=<uuid>` still renders; `middleware.js` matchers still fire; nothing from the legacy app is reachable.

## 6. Needs your approval or new infrastructure

- **Never run without approval:** `npm run migrate`, `vercel dev`, `vercel --prod`, pushing the branch, any query against the production database, and any real analysis run (costs Groq and YouTube quota).
- **New infra / schema (migration files are written, not applied):** report visibility column; email-verified flag; saved collections; vision-model thumbnail analysis; any billing.
- **Doable on the current backend:** analysis history (`reports.user_id` exists), comparison of two reports, exports, re-run with freshness label, onboarding.
- **Before finalizing retention and earnings copy:** read the current YouTube API Services Developer Policies (data storage, refresh, derived metrics) from the primary source.

## 7. Open questions (put to the owner)

PEAK location; whether the current cream/serif/terracotta identity is a fixed brand or open to change; which prices and quotas are real; the anonymous allowance; and what replaces the hero's live-report card.
