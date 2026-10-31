import { test, expect } from '@playwright/test';
import { prepare, noOverflow } from './helpers.mjs';

const SHOTS = process.env.SHOTS;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
const video = (id, i) => ({ id, title: `Long video ${i + 1}`, publishedAt: '2026-10-01T00:00:00Z', views: 90000 - i * 8000, likes: 10, duration: 900, short: false, tags: [`T${i + 1}`] });
const report = {
  reportId: '123e4567-e89b-42d3-a456-426614174000', channel: { name: 'Example Studio', subscriberCount: 52000 }, videoCount: 5,
  createdAt: '2026-11-20T00:00:00Z', visibility: 'private', isOwner: true,
  analysis: { hooks: { primaryPattern: 'x' }, videoIdeas: [{ title: 'An idea', rationale: 'Builds on T1.' }],
    evidence: { medianViews: 20000, computedAt: '2026-11-20T00:00:00Z', videos: ids.map(video) } }
};
// `bad` = video ids whose picture request fails; everything else returns a 1px image
async function open(page, bad) {
  const observed = await prepare(page, { webgl: false });
  const state = { bad: new Set(bad) };
  await page.route('https://i.ytimg.com/**', route => {
    const id = new URL(route.request().url()).pathname.split('/')[2];
    state.bad.has(id) ? route.abort() : route.fulfill({ contentType: 'image/png', body: PNG });
  });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }));
  await page.route('**/api/report/*', route => route.fulfill({ json: report }));
  await page.goto(`/app?r=${report.reportId}`);
  await expect(page.locator('[data-report]')).toBeVisible();
  for (const s of ['next', 'clips', 'thumbnails']) await page.locator(`#s-${s}`).scrollIntoViewIfNeeded();
  return { ...observed, state };
}

test('one or two thumbnails failing get a clear tile, with no retry panel', async ({ page }) => {
  await open(page, [ids[0], ids[1]]);
  await expect(page.locator('.thumb-fail').first()).toBeVisible();
  await expect(page.locator('.thumb-fail').first()).toContainText('Thumbnail unavailable');
  await expect(page.locator('.thumbwarn')).toHaveCount(0);
  await expect(page.locator('#s-clips .pick').first().locator('.thumb-fail')).toHaveCount(1); // layout holds: tile sits where the picture was
  if (SHOTS) { await page.locator('#s-clips').scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/thumbs-few-${page.viewportSize().width}-${test.info().project.name}.png` }); }
  await noOverflow(page);
});

test('three or more failing videos show one retry panel; Try again recovers them', async ({ page }) => {
  const { state } = await open(page, ids.slice(0, 4));
  const panel = page.locator('.thumbwarn');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Some thumbnails did not load');
  if (SHOTS) { await page.waitForTimeout(400); await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/thumbs-many-${page.viewportSize().width}-${test.info().project.name}.png` }); }
  state.bad.clear(); // the network comes back
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.thumb-fail')).toHaveCount(0);
  await expect(page.locator('#s-clips .pick img').first()).toBeVisible();
});

test('Try again that still fails brings the panel back instead of looping silently', async ({ page }) => {
  await open(page, ids.slice(0, 4));
  await page.locator('.thumbwarn').getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.thumbwarn')).toBeVisible();
  await expect(page.locator('.thumb-fail').first()).toBeVisible();
});

test('the video drawer shows the same fallback when its picture is missing', async ({ page }) => {
  await open(page, [ids[0]]);
  await page.locator('#s-clips .pick').first().locator('.linklike').click();
  await expect(page.locator('dialog[open] .thumb-fail')).toContainText('Thumbnail unavailable');
});
