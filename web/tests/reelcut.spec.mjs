import { test, expect } from '@playwright/test';
import { prepare, noOverflow } from './helpers.mjs';

const desktop = page => page.addInitScript(() => {
  Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
  for (const k of ['VideoEncoder', 'VideoDecoder', 'AudioEncoder', 'AudioDecoder']) window[k] ??= function () {};
});

test('a desktop browser gets the file picker, which accepts a video and refuses other files', async ({ page }) => {
  const { errors } = await prepare(page, { webgl: false });
  await desktop(page);
  await page.goto('/reelcut');
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page.locator('[data-tool]')).toBeVisible();
  await expect(page.locator('[data-blocked]')).toBeHidden();
  await page.setInputFiles('[data-file]', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await expect(page.locator('[data-file-status]')).toContainText('not a video');
  await page.setInputFiles('[data-file]', { name: 'my talk.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(3_000_000) });
  await expect(page.locator('[data-file-status]')).toContainText('my talk.mp4 · 3 MB');
  await expect(page.locator('[data-file-status]')).toContainText('stays on your computer');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('a phone is told to use a computer and can copy or email the link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { errors } = await prepare(page, { webgl: false });
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', configurable: true }));
  await page.goto('/reelcut');
  await expect(page.locator('[data-tool]')).toBeHidden();
  await expect(page.locator('[data-blocked-msg]')).toContainText('desktop or laptop');
  await expect(page.locator('[data-mail]')).toHaveAttribute('href', /^mailto:\?subject=.*body=.*reelcut/);
  await page.locator('[data-copy-link]').click();
  await expect(page.locator('[data-copy-link]')).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('/reelcut');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('a desktop browser without video encoding says so instead of failing later', async ({ page }) => {
  await prepare(page, { webgl: false });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 0, configurable: true });
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    delete window.VideoEncoder;
  });
  await page.goto('/reelcut');
  await expect(page.locator('[data-blocked-msg]')).toContainText('cannot process video');
});

test('only a YouTube link and a short brief from a report are shown', async ({ page }) => {
  await prepare(page, { webgl: false });
  await desktop(page);
  const q = (url, instructions) => `/reelcut?${new URLSearchParams({ url, instructions })}`;
  await page.goto(q('https://www.youtube.com/watch?v=aaaaaaaaaaa', 'Cut <b>this</b> out'));
  await expect(page.locator('[data-brief-url]')).toHaveText('https://www.youtube.com/watch?v=aaaaaaaaaaa');
  await expect(page.locator('[data-brief-note]')).toHaveText('Cut <b>this</b> out');
  await page.goto(q('https://evil.example/watch?v=1', 'x'));
  await expect(page.locator('[data-brief]')).toBeHidden();
  await page.goto(q('javascript:alert(1)', 'x'));
  await expect(page.locator('[data-brief]')).toBeHidden();
});
