import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { readFileSync } from 'node:fs';

// The render engine is not wired into a page yet, so bundle it here and run it in a real browser.
const out = await build({
  configFile: false, logLevel: 'silent',
  build: { write: false, minify: false, lib: { entry: 'src/reelcut/render.ts', formats: ['iife'], name: 'rc', fileName: 'rc' } }
});
const bundle = (Array.isArray(out) ? out[0] : out).output[0].code;
const src = readFileSync(new URL('./fixtures/clip-src.mp4', import.meta.url)).toString('base64');

for (const layout of ['blur', 'fit']) {
  test(`renders a 1080x1920 clip with audio (${layout})`, async ({ page }, info) => {
    test.skip(info.project.name !== '1440-light', 'engine test, one viewport is enough');
    test.setTimeout(60_000);
    await page.goto('/reelcut');
    await page.addScriptTag({ content: bundle });
    const r = await page.evaluate(async ([b64, layout]) => {
      const file = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'video/mp4' });
      const o = await rc.renderClip(file, { start: 1, duration: 2, layout, captions: [{ start: 1, end: 3, text: 'hello' }] });
      const url = URL.createObjectURL(new Blob([o.bytes], { type: 'video/mp4' }));
      const v = document.createElement('video'); v.src = url; v.muted = true;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('output does not play')); });
      v.currentTime = 1; await new Promise(res => (v.onseeked = res));
      const c = document.createElement('canvas'); c.width = 54; c.height = 96; const g = c.getContext('2d');
      g.drawImage(v, 0, 0, 54, 96);
      const d = g.getImageData(0, 0, 54, 96).data; let lit = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++;
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await ac.decodeAudioData(await new Blob([o.bytes]).arrayBuffer());
      return { frames: o.frames, w: v.videoWidth, h: v.videoHeight, dur: v.duration, lit, audio: buf.duration };
    }, [src, layout]);
    expect(r.w).toBe(1080); expect(r.h).toBe(1920);
    expect(r.frames).toBeGreaterThanOrEqual(58);
    expect(r.dur).toBeGreaterThan(1.8); expect(r.dur).toBeLessThan(2.3);
    expect(r.lit).toBeGreaterThan(100);
    expect(r.audio).toBeGreaterThan(1.8);
  });
}
