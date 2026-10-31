import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { prepare, noOverflow } from './helpers.mjs';

const video = (id, title, views, tags, date) => ({ id, title, publishedAt: `${date}T00:00:00Z`, views, likes: Math.round(views / 40), duration: 600, short: false, tags });
const base = {
  reportId: '123e4567-e89b-42d3-a456-426614174000', channel: { name: 'Example Studio', handle: '@example', subscriberCount: 52000 },
  videoCount: 4, createdAt: '2026-11-20T00:00:00Z', visibility: 'private', isOwner: true,
  analysis: {
    hooks: { primaryPattern: 'How I [verb] a [thing] in [time]', examples: ['How I built a desk in a day'], frequency: '2 of 4 titles' },
    videoIdeas: [{ title: 'How I built a shelf in a day', rationale: 'Builds on T1 (80K views, 4.0× its long-form median).', estimatedPerformance: 'Comparable videos ran 4×.' }],
    earningsEstimate: { monthlyViewsEstimate: 90000, cpmRPM: 'Assumed category: DIY. $2–6', estimatedMonthlyAdRevenue: '$180–$540', totalEstimate: '$180–$540/month' },
    stats: { medianViews: 20000 },
    evidence: { medianViews: 20000, computedAt: '2026-11-20T00:00:00Z', videos: [
      video('aaaaaaaaaaa', 'How I built a desk in a day', 80000, ['T1'], '2026-10-01'), video('bbbbbbbbbbb', 'Workshop tour', 30000, ['T2'], '2026-09-01'),
      video('ccccccccccc', 'Router jig basics', 18000, ['T3', 'R1'], '2026-11-10'), video('ddddddddddd', 'Sanding mistakes', 9000, ['R2'], '2026-11-01')] }
  }
};
const SHOTS = process.env.SHOTS; // optional directory for review screenshots

async function open(page, report, feedback = { status: 200, json: { ok: true } }) {
  const observed = await prepare(page, { webgl: false });
  const sent = [];
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }));
  await page.route('**/api/report/*', route => route.fulfill({ json: report }));
  await page.route('**/api/feedback', route => { sent.push(route.request().postDataJSON()); route.fulfill(feedback); });
  await page.goto(`/app?r=${report.reportId}`);
  await expect(page.locator('[data-report]')).toBeVisible();
  return { ...observed, sent };
}

test('the owner can send feedback: choose, write, send, confirm', async ({ page }) => {
  const { sent, errors } = await open(page, { ...base, isOwner: true });
  const form = page.locator('[data-feedback-form]');
  await form.scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Was this report useful?' })).toBeVisible();
  const send = form.getByRole('button', { name: 'Send feedback' });
  await expect(send).toBeDisabled();
  await form.getByRole('button', { name: 'Useful', exact: true }).click();
  await expect(form.getByRole('button', { name: 'Useful', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(send).toBeEnabled();
  await form.getByLabel(/What is missing or wrong/).fill('Add thumbnails');
  await page.waitForTimeout(450); // let the 200ms transitions finish before looking
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feedback-${page.viewportSize().width}-${test.info().project.name}.png`, fullPage: false });
  const box = await send.boundingBox(), label = await send.locator('[data-send-label]').boundingBox();
  expect(Math.abs((label.x + label.width / 2) - (box.x + box.width / 2))).toBeLessThan(2); // label dead centre in the button
  await send.click();
  await expect(page.locator('[data-feedback-done]')).toBeVisible();
  await expect(page.locator('[data-feedback-done]')).toContainText('Thank you');
  await expect(page.locator('[data-feedback-sr]')).toHaveText('Feedback sent. Thank you.');
  await page.waitForTimeout(900);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/feedback-sent-${page.viewportSize().width}-${test.info().project.name}.png`, fullPage: false });
  expect(sent).toEqual([{ useful: 'yes', message: 'Add thumbnails', reportId: base.reportId }]);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('a failed send says so and can be retried', async ({ page }) => {
  await open(page, { ...base, isOwner: true }, { status: 502, json: { code: 'SERVER_ERROR', error: 'x' } });
  const form = page.locator('[data-feedback-form]');
  await form.getByRole('button', { name: 'Not useful' }).click();
  await form.getByRole('button', { name: 'Send feedback' }).click();
  await expect(form.locator('[data-feedback-status]')).toContainText('Could not send');
  await expect(form.getByRole('button', { name: 'Send feedback' })).toBeEnabled();
});

test('a viewer who does not own the report is not asked', async ({ page }) => {
  await open(page, { ...base, isOwner: false });
  await expect(page.locator('[data-feedback]')).toHaveCount(0);
});

test('a purged report explains itself and shows no zeros', async ({ page }) => {
  const ev = { ...base.analysis.evidence, medianViews: 0, videos: base.analysis.evidence.videos.map(v => ({ ...v, views: 0, likes: 0 })) };
  const { errors } = await open(page, { ...base, isOwner: true, analysis: { ...base.analysis, evidence: ev, stats: undefined, earningsEstimate: undefined, statsPurgedAt: '2026-12-01T00:00:00Z' } });
  await expect(page.locator('.notice', { hasText: 'Statistics removed' })).toBeVisible();
  await expect(page.locator('#s-earnings')).toContainText('Removed after 30 days');
  await expect(page.locator('#s-map')).toContainText('Removed after 30 days');
  await expect(page.locator('[data-report]')).not.toContainText(/\b0 views\b|NaN/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/purged-${page.viewportSize().width}.png` });
  await noOverflow(page);
  expect(errors).toEqual([]);
});
