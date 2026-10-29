import { test, expect } from '@playwright/test';

const secs = page => page.locator('.doc > section');
const op = loc => loc.evaluate(el => Number(getComputedStyle(el).opacity));

test('sections settle once as they enter view, and stay visible before that', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.locator('html')).toHaveClass(/rv-ready/);
  const last = secs(page).last();
  const before = await op(last);
  expect(before).toBeGreaterThanOrEqual(0.85); // never hidden
  await last.scrollIntoViewIfNeeded();
  await expect.poll(() => op(last)).toBe(1);
  const t = await last.evaluate(el => getComputedStyle(el).transform);
  expect(t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)').toBe(true);
});

test('reduced motion: everything is simply shown, no transition', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4178/pricing');
  for (const s of await secs(page).all()) {
    expect(await op(s)).toBe(1);
    expect(await s.evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(0.001); // effectively none
  }
  await ctx.close();
});

test('without JavaScript nothing is offset or dimmed', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4178/pricing');
  for (const s of await secs(page).all()) expect(await op(s)).toBe(1);
  await ctx.close();
});
