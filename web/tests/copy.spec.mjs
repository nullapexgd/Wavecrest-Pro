import { test, expect } from '@playwright/test';
import { prepare, noOverflow } from './helpers.mjs';

const SHOTS = process.env.SHOTS;
const ID = '123e4567-e89b-42d3-a456-426614174000';
const video = (id, i) => ({ id, title: `Long video ${i + 1}`, publishedAt: '2026-10-01T00:00:00Z', views: 90000 - i * 8000, likes: 10, duration: 900, short: false, tags: [`T${i + 1}`] });
const report = (visibility = 'link') => ({
  reportId: ID, channel: { name: 'Example Studio', subscriberCount: 52000 }, videoCount: 3, createdAt: '2026-11-20T00:00:00Z', visibility, isOwner: true,
  analysis: { hooks: { primaryPattern: 'x' }, videoIdeas: [{ title: 'An idea to copy', rationale: 'Builds on T1.' }],
    evidence: { medianViews: 20000, computedAt: '2026-11-20T00:00:00Z', videos: ['aaaaaaaaaaa', 'bbbbbbbbbbb'].map(video) } }
});
async function open(page, context, rep = report()) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const observed = await prepare(page, { webgl: false });
  await page.route('https://i.ytimg.com/**', route => route.abort());
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }));
  await page.route('**/api/report/*', route => route.fulfill({ json: rep }));
  await page.goto(`/app?r=${rep.reportId}`);
  await expect(page.locator('[data-report]')).toBeVisible();
  return observed;
}
const clip = page => page.evaluate(() => navigator.clipboard.readText());

test('Copy link copies the share link, shows a check, and goes back to normal', async ({ page, context }) => {
  const { errors } = await open(page, context);
  const btn = page.locator('[data-copylink]');
  await btn.click();
  expect(await clip(page)).toBe(`http://127.0.0.1:4178/app?r=${ID}`.replace('127.0.0.1:4178', new URL(page.url()).host));
  await expect(btn).toHaveAttribute('data-copied', 'yes');
  await expect(btn).toContainText('Copied');
  await expect(btn.locator('.copy-tick')).toBeVisible();
  await expect(page.locator('[data-toast]')).toContainText('Link copied');
  await page.waitForTimeout(350);
  if (SHOTS) { await page.locator('[data-sharebox]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/copy-link-${page.viewportSize().width}-${test.info().project.name}.png` }); }
  await expect(btn).toContainText('Copy link', { timeout: 12000 }); // reverts by itself
  await expect(btn).not.toHaveAttribute('data-copied', /.+/);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Copy title and Copy list as JSON give the same feedback', async ({ page, context }) => {
  await open(page, context);
  const title = page.locator('.idea__copy').first();
  await title.click();
  expect(await clip(page)).toBe('An idea to copy');
  await expect(title).toHaveAttribute('data-copied', 'yes');
  await expect(title).toContainText('Copied');
  const json = page.locator('button[data-copymsg]');
  await json.click();
  expect(JSON.parse(await clip(page)).source).toBe('wavecrest');
  await expect(json).toContainText('Copied');
});

test('when the Clipboard API is blocked the field is selected and the button says what to press', async ({ page, context }) => {
  await open(page, context);
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('blocked')); document.execCommand = () => false; });
  const btn = page.locator('[data-copylink]');
  await btn.click();
  await expect(btn).toHaveAttribute('data-copied', 'no');
  await expect(btn).toContainText(/Press (⌘C|Ctrl\+C) to copy/);
  const selected = await page.evaluate(() => { const i = document.querySelector('[data-link]'); return i.value.slice(i.selectionStart, i.selectionEnd) === i.value; });
  expect(selected).toBe(true);
});

test('Copy link works again straight after a copy (the timer resets)', async ({ page, context }) => {
  await open(page, context);
  const btn = page.locator('[data-copylink]');
  await btn.click(); await btn.click();
  await expect(btn).toContainText('Copied');
  await expect(btn).toContainText('Copy link', { timeout: 12000 });
});
