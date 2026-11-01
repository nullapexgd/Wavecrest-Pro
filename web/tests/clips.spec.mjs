import { test, expect } from '@playwright/test';
import { prepare, noOverflow } from './helpers.mjs';

const SHOTS = process.env.SHOTS;
const video = (id, title, views, tags, date, extra = {}) => ({ id, title, publishedAt: `${date}T00:00:00Z`, views, likes: Math.round(views / 40), duration: 900, short: false, tags, ...extra });
const base = {
  reportId: '123e4567-e89b-42d3-a456-426614174000', channel: { name: 'Example Studio', handle: '@example', subscriberCount: 52000 },
  videoCount: 4, createdAt: '2026-11-20T00:00:00Z', visibility: 'private', isOwner: true,
  analysis: {
    hooks: { primaryPattern: 'x' },
    videoIdeas: [{ title: 'How I built a shelf in a day', rationale: 'Builds on T1.', estimatedPerformance: 'x' }],
    evidence: { medianViews: 20000, computedAt: '2026-11-20T00:00:00Z', videos: [
      video('aaaaaaaaaaa', 'How I built a desk in a day', 80000, ['T1'], '2026-10-01'),
      video('bbbbbbbbbbb', 'Workshop tour with a very long title that has to wrap on a phone screen without breaking the layout', 40000, ['T2'], '2026-09-01'),
      video('ccccccccccc', 'Router jig basics', 18000, ['T3'], '2026-11-10'),
      video('ddddddddddd', 'Quick tip', 90000, ['T4'], '2026-11-01', { short: true, duration: 30 })] }
  }
};
async function open(page, report) {
  const observed = await prepare(page, { webgl: false });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }));
  await page.route('**/api/report/*', route => route.fulfill({ json: report }));
  await page.goto(`/app?r=${report.reportId}`);
  await expect(page.locator('[data-report]')).toBeVisible();
  return observed;
}

test('"Clip these" lists the long videos that beat the median, with a Send to Reelcut link', async ({ page }) => {
  const { errors } = await open(page, base);
  const sec = page.locator('#s-clips');
  await sec.scrollIntoViewIfNeeded();
  await expect(sec.getByRole('heading', { name: 'Clip these' })).toBeVisible();
  await expect(sec.locator('.pick')).toHaveCount(2); // the Short and the sub-median video are left out
  await expect(sec.locator('.pick').first()).toContainText('How I built a desk in a day');
  await expect(sec.locator('.pick').first()).toContainText('supports idea: How I built a shelf in a day');
  const go = sec.getByRole('link', { name: 'Send to Reelcut' }).first();
  const link = new URL(await go.getAttribute('href'), page.url());
  expect(link.pathname).toBe('/reelcut');
  expect(link.origin).toBe(new URL(page.url()).origin); // a page on this site, not a local app
  expect(link.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa');
  expect(link.searchParams.get('instructions')).toContain('How I built a shelf in a day');
  await expect(go).not.toHaveAttribute('target', /.*/);
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/clips-${page.viewportSize().width}-${test.info().project.name}.png` });
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('with nothing worth cutting the section says so and has no links', async ({ page }) => {
  const quiet = structuredClone(base);
  quiet.analysis.evidence.videos = quiet.analysis.evidence.videos.filter(v => v.views < 20000 && !v.short);
  await open(page, quiet);
  await expect(page.locator('#s-clips')).toContainText('No long video in this report clearly beat the channel median');
  await expect(page.locator('#s-clips a')).toHaveCount(0);
});

test('a purged report shows no clip list', async ({ page }) => {
  const purged = structuredClone(base);
  purged.analysis.statsPurgedAt = '2026-12-01T00:00:00Z';
  purged.analysis.evidence.medianViews = 0;
  purged.analysis.evidence.videos.forEach(v => { v.views = 0; v.likes = 0; });
  await open(page, purged);
  await expect(page.locator('#s-clips')).toContainText('Removed after 30 days');
  await expect(page.locator('#s-clips .pick')).toHaveCount(0);
});
