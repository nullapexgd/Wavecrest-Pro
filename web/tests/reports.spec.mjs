import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { prepare, sceneRequests, noOverflow } from './helpers.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../../test/fixtures/historical-reports.json', import.meta.url)));
async function openReport(page, report) {
  const observed = await prepare(page, { webgl: false });
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }));
  await page.route('**/api/report/*', route => route.fulfill({ json: report }));
  await page.goto(`/app?r=${report.reportId}`);
  await expect(page.locator('[data-report]')).toHaveAttribute('data-report', report.reportId);
  return observed;
}
for (const { version, report } of fixtures) {
  test(`${version}: saved report deep link, layout and legacy citations`, async ({ page }) => {
    const { requests, errors } = await openReport(page, report);
    await expect(page.getByRole('heading', { name: report.channel.name, exact: true })).toBeVisible();
    await expect(page.locator('[data-section]')).toHaveCount(11);
    await expect(page.locator('#s-evidence')).toContainText('made before Wavecrest saved its evidence');
    await expect(page.locator('button.cite')).toHaveCount(0);
    await expect(page.locator('[data-actions]')).not.toContainText('Delete');
    if (version === 'v0') await expect(page.locator('#s-next')).toContainText('This report has no video ideas.');
    else await expect(page.locator('#s-next')).toContainText('video #3 and T1');
    await page.evaluate(() => document.fonts.ready);
    await noOverflow(page);
    for (const id of ['hooks', 'cadence', 'earnings', 'evidence']) {
      await page.locator(`#s-${id}`).scrollIntoViewIfNeeded();
      await noOverflow(page);
    }
    expect(sceneRequests(requests)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('v1: original CPM range remains visible', async ({ page }) => {
  const { report } = fixtures.find(f => f.version === 'v1');
  await openReport(page, report);
  await expect(page.locator('#s-earnings')).toContainText('$4-8', { timeout: 1000 });
  await expect(page.locator('#s-earnings')).toContainText('Education');
});
