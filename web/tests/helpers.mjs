import { expect } from '@playwright/test';

export async function prepare(page, { webgl = true, reduced = false, saveData = false } = {}) {
  const errors = [];
  const requests = [];
  const external = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4178') {
      external.push(url.href);
      return route.abort();
    }
    if (url.pathname.startsWith('/api/')) {
      // Exercise the bundled public-feed fallback, never a real API or credentials.
      return route.fulfill({ json: { videos: [] } });
    }
    return route.continue();
  });
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(({ webgl, saveData }) => {
    Object.defineProperty(navigator, 'connection', { value: { saveData }, configurable: true });
    if (!webgl) {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        return /webgl/i.test(kind) ? null : getContext.call(this, kind, ...args);
      };
    }
    window.__qa = { frames: 0, pending: 0, draws: 0, shifts: 0, lcp: '', sceneVisible: null, pendingAfterIntersection: null };
    const raf = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Set();
    window.requestAnimationFrame = callback => {
      const id = raf(time => {
        pending.delete(id); window.__qa.pending = pending.size;
        window.__qa.frames++; callback(time);
      });
      pending.add(id); window.__qa.pending = pending.size;
      return id;
    };
    window.cancelAnimationFrame = id => {
      pending.delete(id); window.__qa.pending = pending.size;
      cancel(id);
    };
    const NativeObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback, options) {
        super((entries, observer) => {
          callback(entries, observer);
          for (const entry of entries) if (entry.target.hasAttribute('data-stage')) {
            window.__qa.sceneVisible = entry.isIntersecting;
            window.__qa.pendingAfterIntersection = window.__qa.pending;
          }
        }, options);
      }
    };
    for (const kind of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!kind) continue;
      for (const name of ['drawArrays', 'drawElements']) {
        const draw = kind.prototype[name];
        kind.prototype[name] = function (...args) { window.__qa.draws++; return draw.apply(this, args); };
      }
    }
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__qa.shifts += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__qa.lcp = entry.element?.tagName ?? '';
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  }, { webgl, saveData });
  return { errors, requests, external };
}

export const sceneRequests = requests => requests.filter(url => /\/assets\/(scene|three)-.*\.js/.test(url));

export async function home(page) {
  await page.goto('/?creator=mkbhd');
  await expect(page.locator('[data-picker]')).toBeVisible();
  await expect(page.locator('[data-stage]')).toHaveAttribute('data-creator', /.+/);
  await page.evaluate(() => document.fonts.ready);
}

export async function story(page, fraction) {
  await page.locator('[data-stage]').evaluate((stage, fraction) => {
    window.scrollTo({ top: stage.offsetTop + (stage.offsetHeight - innerHeight) * fraction, behavior: 'instant' });
  }, fraction);
}

export async function noOverflow(page) {
  const size = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  const offenders = await page.evaluate(() => [...document.querySelectorAll('body *')]
    .filter(el => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'absolute')
    .map(el => ({ tag: el.tagName, class: el.getAttribute('class'), right: el.getBoundingClientRect().right })).slice(-12));
  expect(size.scroll, JSON.stringify(offenders)).toBeLessThanOrEqual(size.width + 1);
}

export async function keyboardActivate(page, locator, key = 'Enter') {
  // Start each traversal at the skip link, then verify the real forward Tab order.
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate(el => el === document.activeElement)) {
      expect(await locator.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
      await page.keyboard.press(key);
      return;
    }
  }
  throw new Error('Control was not reachable by Tab');
}
