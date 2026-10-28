import { test, expect } from '@playwright/test';
import { prepare, home, story, sceneRequests, noOverflow, keyboardActivate } from './helpers.mjs';

for (const webgl of [true, false]) for (const reduced of [false, true]) for (const saveData of [false, true]) {
  test(`hero matrix WebGL=${webgl} reduce=${reduced} saveData=${saveData}`, async ({ page }, info) => {
    const { errors, requests, external } = await prepare(page, { webgl, reduced, saveData });
    await home(page);
    const auto = webgl && !reduced && !saveData && info.project.use.viewport.width >= 900;
    const stage = page.locator('[data-stage]');
    if (auto) {
      await expect(stage).toHaveAttribute('data-scene', 'on');
      await expect(stage).toHaveClass(/is-3d/);
      expect(sceneRequests(requests).length).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__qa.draws)).toBeGreaterThan(0);
    } else {
      // Longer than the idle-load timeout: a negative network assertion needs a real window.
      await page.waitForTimeout(1700);
      expect(sceneRequests(requests)).toEqual([]);
      await expect(page.locator('[data-explore]')).toBeVisible({ visible: webgl });
    }
    await expect(page.locator('#hero-title')).toBeVisible();
    await noOverflow(page);
    expect(await page.evaluate(() => window.__qa.shifts)).toBeLessThan(0.1);
    await expect.poll(() => page.evaluate(() => window.__qa.lcp)).not.toBe('');
    expect(await page.evaluate(() => window.__qa.lcp)).toMatch(/^(H1|P)$/);

    await story(page, 0.95);
    await expect(stage).toHaveClass(/is-chart/);
    await expect.poll(() => stage.evaluate(el => Number(el.style.getPropertyValue('--p')))).toBeGreaterThan(0.9);
    await expect(page.locator('[data-copy]')).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('.poster--scatter')).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-chartcopy]')).toHaveCSS('opacity', '1');
    await noOverflow(page);
    await story(page, 0);
    await expect(stage).not.toHaveClass(/is-chart/);
    await expect(page.locator('[data-copy]')).toHaveCSS('visibility', 'visible');
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
}

for (const mode of ['mobile', 'reduced', 'saveData']) {
  test(`explicit 3D opt-in: ${mode}`, async ({ page }, info) => {
    test.skip(mode === 'mobile' && info.project.use.viewport.width >= 900, 'Mobile opt-in widths only');
    const { requests, errors } = await prepare(page, { reduced: mode === 'reduced', saveData: mode === 'saveData' });
    await home(page);
    expect(sceneRequests(requests)).toEqual([]);
    await keyboardActivate(page, page.locator('[data-explore]'));
    const stage = page.locator('[data-stage]');
    await expect(stage).toHaveAttribute('data-scene', 'on');
    await expect(stage).toHaveClass(/is-3d/);
    await expect(page.locator('[data-explore]')).toBeHidden();
    await noOverflow(page);
    await keyboardActivate(page, page.locator('[data-next]'));
    await expect(page.locator('[data-live]')).not.toBeEmpty();
    await expect(page.locator('[data-inspector]')).toBeVisible();
    if (mode === 'reduced') {
      await expect(page.locator('[data-pause]')).toBeHidden();
      await expect.poll(() => page.evaluate(() => window.__qa.pending)).toBe(0);
      const count = await page.evaluate(() => window.__qa.frames);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => window.__qa.frames)).toBe(count);
    } else {
      await keyboardActivate(page, page.locator('[data-pause]'), 'Space');
      await expect(page.locator('[data-pause]')).toHaveAttribute('aria-pressed', 'true');
    }
    await story(page, 0.95);
    await expect(stage).toHaveClass(/is-chart/);
    await expect.poll(() => stage.evaluate(el => Number(el.style.getPropertyValue('--p')))).toBeGreaterThan(0.9);
    expect(errors).toEqual([]);
  });
}

test('keyboard skip link and creator picker work without WebGL', async ({ page }) => {
  await prepare(page, { webgl: false });
  await home(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main$/);
  const before = await page.locator('[data-stage]').getAttribute('data-creator');
  await keyboardActivate(page, page.locator('[data-pick-another]'));
  await expect(page.locator('[data-stage]')).not.toHaveAttribute('data-creator', before);
});

test('offscreen and hidden scene suspend callbacks and resume on return', async ({ page }, info) => {
  await prepare(page);
  await home(page);
  if (info.project.use.viewport.width < 900) await page.locator('[data-explore]').click();
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-scene', 'on');
  await expect.poll(() => page.evaluate(() => window.__qa.frames)).toBeGreaterThan(3);
  await page.locator('footer').evaluate(el => el.scrollIntoView({ behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.__qa.sceneVisible)).toBe(false);
  expect(await page.evaluate(() => window.__qa.pendingAfterIntersection)).toBe(0);
  const stopped = await page.evaluate(() => ({ ...window.__qa }));
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__qa.frames)).toBe(stopped.frames);
  expect(await page.evaluate(() => window.__qa.draws)).toBe(stopped.draws);
  await story(page, 0);
  await expect.poll(() => page.evaluate(() => window.__qa.draws)).toBeGreaterThan(stopped.draws);

  // Chromium headless does not hide a tab when another is opened. Dispatch the Page
  // Visibility API state explicitly, and record this as simulated in the QA notes.
  const hiddenPending = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.__qa.pending;
  });
  expect(hiddenPending).toBe(0);
  const hidden = await page.evaluate(() => window.__qa.frames);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__qa.frames)).toBe(hidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => window.__qa.frames)).toBeGreaterThan(hidden);
});


test('paused 3D still changes to the chart on a scroll jump', async ({ page }) => {
  await prepare(page);
  await home(page);
  if (await page.locator('[data-explore]').isVisible()) await page.locator('[data-explore]').click();
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-scene', 'on');
  await page.locator('[data-pause]').click();
  await expect(page.locator('[data-pause]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__qa.pending)).toBe(0);
  const stopped = await page.evaluate(() => window.__qa.frames);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__qa.frames)).toBe(stopped);
  await story(page, 0.95);
  await expect(page.locator('[data-stage]')).toHaveClass(/is-chart/);
  await expect.poll(() => page.locator('[data-stage]').evaluate(el => Number(el.style.getPropertyValue('--p')))).toBeGreaterThan(0.9);
});


test('scene and chart stay within the viewport after resizing', async ({ page }) => {
  await prepare(page);
  await home(page);
  if (await page.locator('[data-explore]').isVisible()) await page.locator('[data-explore]').click();
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-scene', 'on');
  for (const width of [1440, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await story(page, 0);
    await expect(page.locator('[data-stage]')).not.toHaveClass(/is-chart/);
    await expect(page.locator('[data-pin]')).toHaveCSS('width', `${width}px`);
    await noOverflow(page);
    await story(page, 0.95);
    await expect(page.locator('[data-stage]')).toHaveClass(/is-chart/);
    await expect.poll(() => page.locator('[data-stage]').evaluate(el => Number(el.style.getPropertyValue('--p')))).toBeGreaterThan(0.9);
    await noOverflow(page);
  }
});

test('chart inspector survives multiple render frames after keyboard selection', async ({ page }, info) => {
  test.skip(info.project.use.viewport.width < 900, 'Narrow layout exposes the accessible crest list instead');
  await prepare(page);
  await home(page);
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-scene', 'on');
  await story(page, 0.95);
  await expect(page.locator('[data-stage]')).toHaveClass(/is-chart/);
  await keyboardActivate(page, page.locator('[data-next]'));
  await expect(page.locator('[data-inspector]')).toBeVisible();
  const title = await page.locator('[data-i-title]').textContent();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-inspector]')).toBeVisible();
  await expect(page.locator('[data-i-title]')).toHaveText(title);
});
