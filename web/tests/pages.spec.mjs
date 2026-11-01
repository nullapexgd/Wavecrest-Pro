import { test, expect } from '@playwright/test';
import { prepare, noOverflow, sceneRequests } from './helpers.mjs';

test('public pages and signed-out app keep their layout without 3D', async ({ page }) => {
  const { requests, errors } = await prepare(page);
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }));
  for (const path of ['/pricing', '/privacy', '/terms', '/changelog', '/login', '/app', '/sample', '/reelcut']) {
    const response = await page.goto(path);
    expect(response.status(), path).toBe(200);
    await expect(page.locator('main h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await noOverflow(page);
    await page.locator('footer').scrollIntoViewIfNeeded();
    await noOverflow(page);
  }
  expect(sceneRequests(requests)).toEqual([]);
  expect(errors).toEqual([]);
});
