# Deploy checklist (Wavecrest)

Use for every production deploy, including small ones. Production deploys only through `create_deployment` with `target: "production"` and an exact SHA; a push to `master` only builds a preview. Never deploy, merge, push or run migrations without the owner naming the commit.

**Freeze rule (owner, 2026-11-01).** After release 3.1 only these ship: security fixes, real regressions (function, security, data integrity), compliance changes, and a change a recorded user finding clearly demands. New features, new providers and refactors wait. See `ROADMAP-final-and-freeze.md`.

## Pre-deploy
- [ ] The change qualifies under the freeze, and the owner approved it by commit
- [ ] Tree clean; `origin/master` is an ancestor of the commit (fast-forward only)
- [ ] Production serves the SHA you expect (Vercel `list_deployments`). That deployment is the rollback target
- [ ] `LC_ALL=en_US.UTF-8 npm test` passes (needs local Postgres or the integration tests are skipped)
- [ ] `cd web && npm run typecheck && npm run build && npm run check:contrast`
- [ ] Front end changed: browser matrix `cd web && npx playwright test` (hero 3D specs can flake under load; rerun the failure alone before counting it)
- [ ] Database change: additive and idempotent, migrated BEFORE the code that needs it, with the owner's explicit approval
- [ ] New env vars: names listed and present in Vercel first. Never print or paste values. `vercel env ls production` shows names only
- [ ] Preview from the pushed branch is READY. OAuth sign-in cannot be tested on a preview (callbacks are registered for wavecrest.pro)

## Deploy
- [ ] Push the exact commit to `master`
- [ ] `create_deployment`, target production, that SHA
- [ ] Wait for READY and for the live site to serve it

## Post-deploy (first 15 minutes)
- [ ] 200 on `/`, `/app`, `/reelcut`, `/pricing`, `/privacy`, `/login`, `/sample`
- [ ] `GET /api/health` returns `{"ok":true,"db":true}`
- [ ] Headers: strict CSP on every page except `/reelcut` (its own policy), HSTS, nosniff, frame denial
- [ ] New or changed endpoints: signed-out 401, cross-site 403, junk input 400
- [ ] Runtime logs: no new errors in the last 15 minutes (a Node `url.parse` deprecation notice is known and harmless)
- [ ] Owner does one real sign-in and opens a report
- [ ] Update `CLAUDE.md` production line (SHA, deployment id, rollback list) and `.claude/context/STATE.md`

## Rollback (real regressions only, never cosmetic)
Triggers: health not 200 or database down; sign-in fails for everyone or `/app` is blank; the analyzer errors on every run; a security problem in the new code.
Targets, newest first (keep the live line in `CLAUDE.md` current): `dpl_91Xa8duPJk6uux8qzXJX32Zhi2ak` (`54afec1`, has the Reelcut refund loophole: avoid unless needed), `dpl_CrbqWuh8rb1SB5hzbmVsMbtu36KG` (`ab5e70e`, 3.0).

## Known gaps
- **Sentry from a deployed function** is unproven end to end. `SENTRY_DSN` is set for Production and Preview (checked 2026-11-01) and the reporting code is unit tested; the first real server error should reach the project and email the owner. Watch for it after launch.
- **Backups.** Neon scheduled snapshots are not available on the current plan (one manual snapshot only, 6 hour restore window). Decision (owner, 2026-11-01): backups are held elsewhere, outside Neon. Wavecrest does not create or store database dumps; the owner runs them with their own credentials.
