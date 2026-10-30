import { test, expect } from '@playwright/test';
import { prepare } from './helpers.mjs';

const html = page => page.locator('html');
const open = async page => { await page.locator('[data-settings-open]').click(); await expect(page.locator('[data-settings]')).toBeVisible(); };
const pick = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).check({ force: true });
const bg = page => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.beforeEach(async ({ page }) => { await prepare(page, { webgl: false }); });

test('gear is reachable signed-out and the panel names the current state', async ({ page }) => {
  await page.goto('/pricing');
  await open(page);
  await expect(page.locator('[data-status="theme"]')).toContainText(/Following system · (Dark|Light) appearance/);
  await expect(page.locator('[data-status="motion"]')).toContainText(/Following system · (Reduced motion enabled|Full motion)/);
  await expect(page.locator('input[name="theme"][value="system"]')).toBeChecked();
  await expect(page.locator('input[name="motion"][value="system"]')).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-settings]')).toBeHidden();
});

test('theme: Light and Dark override the system, System follows it live', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/pricing');
  const light = await bg(page);
  await open(page);
  await pick(page, 'theme', 'dark');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  const dark = await bg(page);
  expect(dark).not.toBe(light);
  await pick(page, 'theme', 'system');
  await expect(html(page)).not.toHaveAttribute('data-theme', /.*/);
  expect(await bg(page)).toBe(light);
  await page.emulateMedia({ colorScheme: 'dark' }); // system changes while open
  await expect.poll(() => bg(page)).toBe(dark);
  await expect(page.locator('[data-status="theme"]')).toContainText('Dark appearance');
  await pick(page, 'theme', 'light');
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
  expect(await bg(page)).toBe(light); // forced light beats a dark system
});

test('motion: Reduced and Full override the system; System follows it live', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/pricing');
  await expect(html(page)).toHaveAttribute('data-motion', 'full');
  await open(page);
  await pick(page, 'motion', 'reduced');
  await expect(html(page)).toHaveAttribute('data-motion', 'reduced');
  await expect(page.locator('[data-status="motion"]')).toContainText('Reduced');
  await pick(page, 'motion', 'system');
  await expect(html(page)).toHaveAttribute('data-motion', 'full');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(html(page)).toHaveAttribute('data-motion', 'reduced');
  await expect(page.locator('[data-status="motion"]')).toContainText('Reduced motion enabled');
  await pick(page, 'motion', 'full'); // explicit Full beats the system setting, and says so
  await expect(html(page)).toHaveAttribute('data-motion', 'full');
  await expect(page.locator('[data-status="motion"]')).toContainText('overriding your system');
});

test('choices persist across reloads and other pages', async ({ page }) => {
  await page.goto('/pricing');
  await open(page);
  await pick(page, 'theme', 'dark');
  await pick(page, 'motion', 'reduced');
  await page.goto('/privacy');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(html(page)).toHaveAttribute('data-motion', 'reduced');
  await page.reload();
  await open(page);
  await expect(page.locator('input[name="theme"][value="dark"]')).toBeChecked();
  await expect(page.locator('input[name="motion"][value="reduced"]')).toBeChecked();
});

test('saved choices are applied before first paint, even if module scripts never run', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('wc-theme', 'dark'); localStorage.setItem('wc-motion', 'reduced'); });
  await page.route('**/*.js', route => route.abort()); // inline pre-paint script only
  await page.goto('/pricing');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await expect(html(page)).toHaveAttribute('data-motion', 'reduced');
});

test('blocked storage: panel still works for this visit and nothing throws', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const deny = () => { throw new DOMException('blocked', 'SecurityError'); };
    Object.defineProperty(window, 'localStorage', { get: deny, configurable: true });
  });
  await page.goto('/pricing');
  await open(page);
  await pick(page, 'theme', 'dark');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('without JavaScript the site follows the system and the gear stays hidden', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:4178/pricing');
  await expect(page.locator('[data-settings-open]')).toBeHidden();
  const [color, op] = await page.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.querySelector('.doc > section')).opacity]);
  expect(color).not.toBe('rgb(255, 255, 255)');
  expect(op).toBe('1');
  await ctx.close();
});

test('panel fits the viewport, is keyboard-operable and does not lock or shift the page', async ({ page }) => {
  await page.goto('/pricing');
  const vp = page.viewportSize();
  const before = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.locator('[data-settings-open]').focus();
  await page.keyboard.press('Enter');
  const box = await page.locator('[data-settings] .settings__form').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  await page.keyboard.press('Tab'); // focus is trapped in the dialog
  expect(await page.evaluate(() => !!document.activeElement.closest('[data-settings]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-settings]')).toBeHidden();
  await expect(page.locator('[data-settings-open]')).toBeFocused(); // focus returns
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(before);
  await page.mouse.wheel(0, 300); // scrolling still works afterwards
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
});

test('the panel text keeps WCAG AA contrast in both themes', async ({ page }) => {
  await page.goto('/pricing');
  await open(page);
  for (const theme of ['light', 'dark']) {
    await pick(page, 'theme', theme);
    await page.evaluate(() => Promise.all(document.getAnimations().map(a => a.finished.catch(() => {})))); // sample settled colours, not mid-transition
    const ratios = await page.evaluate(() => {
      const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const solid = el => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const a = c.match(/[\d.]+/g); if (a && (a.length < 4 || Number(a[3]) > 0.95)) return c; } return 'rgb(255,255,255)'; };
      return [...document.querySelectorAll('[data-settings] h2, [data-settings] legend, [data-settings] label span, [data-settings] .seg__status, [data-settings] .settings__note')].map(el => {
        const a = lum(getComputedStyle(el).color), b = lum(solid(el));
        return { t: el.textContent.trim().slice(0, 20), r: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      });
    });
    for (const { t, r } of ratios) expect(r, `${theme}: "${t}"`).toBeGreaterThanOrEqual(4.5);
  }
});
