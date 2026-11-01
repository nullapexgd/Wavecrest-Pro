import { test, expect } from '@playwright/test';
import { prepare, noOverflow } from './helpers.mjs';

const ME = { user: { email: 'you@example.test', name: 'You' }, entitlement: { plan: 'free', label: 'Free beta', limit: 1 }, usage: { used: 0 }, pending: null, capacity: { full: false } };

async function rig(page, { me = null, pending, analyze } = {}) {
  const seen = { pendingPosts: [], pendingDeletes: 0, analyzes: 0 };
  await prepare(page, { webgl: false });
  await page.route('**/api/auth/me', route => (me ? route.fulfill({ json: { ...ME, ...me } }) : route.fulfill({ status: 401, json: { code: 'UNAUTHENTICATED' } })));
  await page.route('**/api/reports', route => route.fulfill({ json: { reports: [] } }));
  await page.route('**/api/auth/pending', route => {
    const m = route.request().method();
    if (m === 'POST') { seen.pendingPosts.push(route.request().postDataJSON()); return route.fulfill(pending ?? { json: { ok: true } }); }
    seen.pendingDeletes++; return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/analyze-stream', route => { seen.analyzes++; return route.fulfill(analyze ?? { status: 503, json: { error: 'x', code: 'UNAVAILABLE' } }); });
  return seen;
}

test('a signed-out visitor pastes first, then is asked to sign in with that channel named', async ({ page }, info) => {
  const seen = await rig(page);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Which channel should we read?' })).toBeVisible();
  await page.getByLabel('YouTube channel link').fill('youtube.com/@mkbhd');
  await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.getByRole('heading', { name: /Sign in to analyse this channel/ })).toBeVisible();
  await expect(page.locator('.chan')).toHaveText('youtube.com/@mkbhd');
  expect(seen.pendingPosts).toEqual([{ channel: 'youtube.com/@mkbhd' }]);
  await expect(page.getByRole('link', { name: /Continue with Google/ })).toHaveAttribute('href', '/api/auth/google');
  await expect(page.getByRole('link', { name: /Continue with GitHub/ })).toHaveAttribute('href', '/api/auth/github');
  expect(seen.analyzes).toBe(0); // nothing is spent before sign-in
  await noOverflow(page);
  await page.getByRole('button', { name: 'Change channel' }).click();
  await expect(page.getByLabel('YouTube channel link')).toBeVisible();
  expect(seen.pendingDeletes).toBe(1);
});

test('a typo is caught before sign-in, and the server refusing it is shown', async ({ page }) => {
  const seen = await rig(page, { pending: { status: 400, json: { error: 'x', code: 'INVALID_INPUT' } } });
  await page.goto('/app');
  const box = page.getByLabel('YouTube channel link');
  await box.fill('hi'); await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('#chan-err')).toBeVisible();
  expect(seen.pendingPosts).toHaveLength(0);
  await box.fill('youtube.com/not-a-channel'); await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.locator('#chan-err')).toContainText('does not look like a YouTube channel');
});

test('blocked cookies still let them sign in, and say they will need to paste again', async ({ page }) => {
  await rig(page, { pending: { status: 500, json: { code: 'ERR' } } });
  await page.goto('/app');
  await page.getByLabel('YouTube channel link').fill('@mkbhd'); await page.getByRole('button', { name: /Continue/ }).click();
  await expect(page.getByText('Sign in, then paste it again.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Continue with Google/ })).toBeVisible();
});

test('after sign-in the pending channel is confirmed, never started on its own', async ({ page }) => {
  const seen = await rig(page, { me: { pending: 'youtube.com/@mkbhd' } });
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Analyse youtube.com/@mkbhd?' })).toBeVisible();
  await expect(page.getByText('This uses your free analysis for this month.')).toBeVisible();
  await page.waitForTimeout(600);
  expect(seen.analyzes).toBe(0);
  await page.getByRole('button', { name: /Start analysis/ }).click();
  await expect.poll(() => seen.analyzes).toBe(1);
  expect(seen.pendingDeletes).toBe(1);
});

test('"Not now" clears it and puts the channel in the box', async ({ page }) => {
  const seen = await rig(page, { me: { pending: 'youtube.com/@mkbhd' } });
  await page.goto('/app');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByLabel('YouTube channel link')).toHaveValue('youtube.com/@mkbhd');
  await expect(page.locator('.pending')).toHaveCount(0);
  expect(seen.pendingDeletes).toBe(1); expect(seen.analyzes).toBe(0);
});

test('a used month cannot start the pending channel and points to the sample', async ({ page }) => {
  await rig(page, { me: { pending: '@mkbhd', usage: { used: 1 } } });
  await page.goto('/app');
  await expect(page.getByText('already used, so this cannot run')).toBeVisible();
  await expect(page.getByRole('button', { name: /Start analysis/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dismiss' })).toBeVisible();
});

test('a full day is shown up front and the form is closed', async ({ page }) => {
  await rig(page, { me: { capacity: { full: true } } });
  await page.goto('/app');
  await expect(page.getByText('Full for today.')).toBeVisible();
  await expect(page.getByLabel('YouTube channel link')).toBeDisabled();
  await expect(page.getByRole('button', { name: /Analyse/ })).toBeDisabled();
});

test('a run refused for capacity says so and nothing was used', async ({ page }) => {
  await rig(page, { me: {}, analyze: { status: 503, json: { error: 'full', code: 'CAPACITY' } } });
  await page.goto('/app');
  await page.getByLabel('YouTube channel link').fill('youtube.com/@mkbhd');
  await page.getByRole('button', { name: /Analyse/ }).click();
  await expect(page.getByRole('heading', { name: 'Full for today' })).toBeVisible();
  await expect(page.getByText('Nothing was used')).toBeVisible();
});
