# Wavecrest 3.0 release handoff (prepared 2026-10-29, nothing deployed)

Branch `wavecrest-3-integration` = `wavecrest-3` + production `master` (report-access hotfix, auth/XSS release) + the OAuth
callback fix, with the 3.0 build wired to the production routes. Production today runs `master@7d7a8bc` (old pages + fixed APIs).

## What ships
- `vercel.json`: builds `web/` and serves `web/dist` (home, pricing, privacy, terms, changelog, login, app, sample, legacy `/about`);
  `/api/*` functions and `middleware.js` unchanged; the two OAuth callback URLs are rewritten to single-segment paths (Vercel
  routes `api/auth/[...path].js` as ONE segment, so `/api/auth/google/callback` 404'd); nothing to change in Google/GitHub consoles.
- API: 3.0 handlers (owner-or-link reports, verified-email OAuth, atomic quota, minimal public health, sample-creator).
- Old root pages stay in the repo but are not served.

## Verified
Backend 148/148 (real-handler isolation, OAuth, quota, migrations, auth routing, health). `tsc`, contrast, production build OK;
no preview mock or 3D code on the analyzer pages. Browser matrix: see the final run in the chat. Not verifiable here: a live
Google/GitHub round trip (needs a real sign-in after deploy).

## Approval gates (none taken)
1. **Neon (Gate A):** apply `migrations/005_analysis_runs.sql` (additive: new table + indexes; backfill touches this month's signed-in
   reports = 0). Without it every analysis fails closed with 503. Snapshot `pre-hotfix-004-20261029` exists; take a fresh one first.
2. **Git (Gate B):** `git push origin wavecrest-3-integration:master` (fast-forward from `7d7a8bc`; check `git ls-remote origin master`).
3. **Deploy (Gate C):** production deployment of the exact pushed SHA (a push alone only builds a preview).
4. **Verify:** `/`, `/pricing`, `/login`, `/app`, `/sample`, `/about` 200; `/api/auth/me` 401; `/api/auth/google/callback` (no params) returns
   the handler's JSON 400, not Vercel's 404 page; Google and GitHub sign-in; one free analysis; `/api/featured` 403 (keep the firewall rule).
5. **Rollback:** fix forward. Never Instant Rollback to a pre-hotfix build.

## Known gaps (not blockers for a first 3.0 release, not done)
History and channel compare UI; CSP/HSTS; error monitoring; the real (not illustrative) `/sample` report; Production Branch setting
in Vercel (pushes to `master` build previews); stale `main` branch; legal review of privacy/terms.
