import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const speech = readFileSync(new URL('./fixtures/speech.mp4', import.meta.url));
const RUN = '123e4567-e89b-42d3-a456-426614174000';
const only = (info) => test.skip(info.project.name !== '1440-light', 'flow test, one viewport is enough');

async function mockApi(page, handler) {
  const calls = [];
  await page.route('**/api/reelcut', async route => {
    const body = route.request().postDataJSON();
    calls.push(body);
    const r = await handler(body);
    await route.fulfill({ status: r.status ?? 200, json: r.json });
  });
  return calls;
}
const pickFile = async page => {
  await page.goto('/reelcut');
  await page.setInputFiles('[data-file]', { name: 'speech.mp4', mimeType: 'video/mp4', buffer: speech });
  await expect(page.locator('[data-file-status]')).toContainText('stays on your computer');
};

test('signed-out visitors are asked to sign in and nothing is left reserved', async ({ page }, info) => {
  only(info);
  const calls = await mockApi(page, () => ({ status: 401, json: { error: 'Sign in to use Reelcut', code: 'AUTH_REQUIRED' } }));
  await pickFile(page);
  await page.locator('[data-go]').click();
  await expect(page.locator('[data-error]')).toContainText('Sign in to use Reelcut');
  await expect(page.locator('[data-error] a')).toHaveAttribute('href', '/login');
  expect(calls.map(c => c.action)).toEqual(['start']); // no run existed, so nothing to refund
});

test('a used-up week says when it resets', async ({ page }, info) => {
  only(info);
  await mockApi(page, () => ({ status: 429, json: { error: 'x', code: 'QUOTA_EXCEEDED', resetsAt: '2026-11-09T00:00:00.000Z' } }));
  await pickFile(page);
  await page.locator('[data-go]').click();
  await expect(page.locator('[data-error]')).toContainText("used this week's videos");
});

test('live: file to transcript to clips to a downloadable MP4, refunding nothing on success', async ({ page }, info) => {
  only(info);
  test.skip(!process.env.REELCUT_LIVE_WHISPER, 'set REELCUT_LIVE_WHISPER=1 (downloads the speech model)');
  test.setTimeout(240_000);
  const calls = await mockApi(page, body => {
    if (body.action === 'start') return { json: { runId: RUN, remaining: 2, parts: 2 } };
    if (body.action === 'pick') {
      const t = body.chunks;
      return { json: { clips: [{ start: t[0].start, end: Math.min(t.at(-1).end, t[0].start + 5), title: 'The quick brown fox', hook: t[0].text.slice(0, 40), reason: 'opens the video' }] } };
    }
    return { json: { ok: true } };
  });
  await pickFile(page);
  await page.locator('[data-length]').selectOption('90-180');
  await page.locator('[data-go]').click();
  const card = page.locator('.clipcard').first();
  await expect(card).toBeVisible({ timeout: 200_000 });
  await expect(card.locator('h2')).toHaveText('The quick brown fox');
  const pick = calls.find(c => c.action === 'pick');
  expect(pick.runId).toBe(RUN);
  expect([pick.minSec, pick.maxSec]).toEqual([90, 180]);
  expect(pick.chunks.map(c => c.text).join(' ').toLowerCase()).toContain('quick brown fox');
  await card.getByRole('button', { name: 'Make this clip' }).click();
  const dl = card.getByRole('link', { name: 'Download' });
  await expect(dl).toBeVisible({ timeout: 60_000 });
  const size = await page.evaluate(async href => (await (await fetch(href)).blob()).size, await dl.getAttribute('href'));
  expect(size).toBeGreaterThan(20_000);
  expect(calls.some(c => c.action === 'refund')).toBe(false);
});

test('live: cancelling gives the run back', async ({ page }, info) => {
  only(info);
  test.skip(!process.env.REELCUT_LIVE_WHISPER, 'set REELCUT_LIVE_WHISPER=1 (downloads the speech model)');
  const calls = await mockApi(page, body => (body.action === 'start' ? { json: { runId: RUN, remaining: 2, parts: 2 } } : { json: { ok: true } }));
  await pickFile(page);
  await page.locator('[data-go]').click();
  await expect(page.locator('[data-work]')).toBeVisible();
  await page.locator('[data-cancel]').click();
  await expect(page.locator('[data-error]')).toContainText('did not use one of your videos');
  expect(calls.filter(c => c.action === 'refund')).toHaveLength(1);
});
