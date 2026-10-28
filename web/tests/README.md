# Browser QA

Run from `web/` (no credentials, database or production server needed):

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

The config builds the production Vite bundle and starts a fresh localhost-only preview
on port 4178. It refuses to reuse another server. API calls are intercepted; the hero
uses its bundled public-feed snapshot. All external browser requests are blocked.
Do not substitute `vercel dev`, a deployed URL or a real analysis call.

## Coverage

Eight projects: widths 390, 768, 1024 and 1440, each in light and dark, height 900.
The two narrow widths use native Chromium touch emulation; the wide widths use a fine
pointer. Every project runs all eight WebGL × reduced-motion × Data Saver combinations
(64 hero matrix cases, with no skips).

Assertions cover lazy 3D chunk requests, real WebGL draws, text LCP, CLS < 0.1,
horizontal document overflow (1px rounding allowance), hero/chart transitions in both
directions, opt-in, Tab order and visible focus, crest announcements/inspection,
pause, offscreen suspension/resume, hidden suspension/resume and resizing with a live
scene. Public pages and historical report deep links are checked at every project size.

The desktop-only chart-control test is skipped on narrow layouts, where those controls
are intentionally hidden in chart mode. The mobile-only opt-in test is skipped on wide
layouts. Reduced-motion and Data Saver opt-in tests run at every width.

Chromium uses SwiftShader software WebGL: this is functional QA, not a hardware FPS
benchmark. No-WebGL and `navigator.connection.saveData` are injected before page scripts.
The hidden-tab case dispatches a simulated Page Visibility state because headless tabs
do not become hidden simply by opening another tab. Offscreen intersection is real.
Reduced-motion opt-in checks that finite interaction motion settles and no ambient loop
continues. These tests are not a full WCAG audit or a Safari/Firefox certification.

## Results and debugging

`test-results/results.json` and `playwright-report/` are generated and gitignored.
Screenshots and traces are retained for failures. There are no retries to hide flakes.

```sh
npm run test:browser -- --project=390-dark
npm run test:browser -- --project=1440-light --grep='offscreen|paused'
npx playwright show-report
```

Report compatibility fixtures are synthetic examples of historical prompt shapes,
with exact source commits in `test/fixtures/historical-reports.json`. The v1 CPM range
case is explicitly marked `test.fail`: it records the renderer's known `cpmRange`
omission for Claude, who owns analyzer changes. An unexpected pass makes the suite fail,
prompting removal of the marker after the fix. The handoff in
`docs/wavecrest-3/QA-HANDOFF.md` records integration and remaining limits.
