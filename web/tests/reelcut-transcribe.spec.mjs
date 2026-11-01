import { test, expect } from '@playwright/test';
import { build, preview } from 'vite';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The transcriber is not on a page yet, so build a tiny harness around it and serve it from localhost
// (WebCodecs and workers need a secure context). The live model test downloads ~150 MB: opt in with
// REELCUT_LIVE_WHISPER=1.
const root = new URL('./fixtures/whisper-harness', import.meta.url).pathname;
let server, url;
test.beforeAll(async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'whisper-harness-'));
  await build({ root, base: './', logLevel: 'silent', configFile: false, build: { outDir, emptyOutDir: true, target: 'es2022' } });
  server = await preview({ root, logLevel: 'silent', configFile: false, build: { outDir }, preview: { port: 0, host: '127.0.0.1' } });
  url = server.resolvedUrls.local[0];
});
test.afterAll(() => server?.close());

const b64 = f => readFileSync(new URL(`./fixtures/${f}`, import.meta.url)).toString('base64');
const toBlob = `(b64 => new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'video/mp4' }))`;

test.describe.configure({ mode: 'serial' });
// REELCUT_CHANNEL=chrome runs against the installed Chrome, which has a real GPU adapter (the bundled Chromium has none).
// REELCUT_CHROMIUM=/usr/bin/chromium does the same with a system browser (Linux).
if (process.env.REELCUT_CHROMIUM) test.use({ launchOptions: { executablePath: process.env.REELCUT_CHROMIUM, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'] } });
else if (process.env.REELCUT_CHANNEL) test.use({ channel: process.env.REELCUT_CHANNEL, launchOptions: { args: ['--enable-unsafe-webgpu'] } });

test('decodes a window to 16 kHz mono with the right length and signal', async ({ page }, info) => {
  test.skip(info.project.name !== '1440-light', 'engine test, one viewport is enough');
  await page.goto(url);
  const out = await page.evaluate(async ([data, mk]) => {
    const file = eval(mk)(data);
    const a = await window.decodeWindow(file, 1, 3);
    let sum = 0; for (const v of a) sum += v * v;
    return { n: a.length, rms: Math.sqrt(sum / a.length) };
  }, [b64('clip-src.mp4'), toBlob]);
  expect(out.n).toBeGreaterThan(31900); expect(out.n).toBeLessThanOrEqual(32000); // 2 s at 16 kHz
  expect(out.rms).toBeGreaterThan(0.05); // the fixture is a sine tone, not silence
});

test('cancel ends the transcriber and rejects', async ({ page }, info) => {
  test.skip(info.project.name !== '1440-light', 'engine test, one viewport is enough');
  await page.goto(url);
  const msg = await page.evaluate(async ([data, mk]) => {
    const file = new File([await eval(mk)(data).arrayBuffer()], 'a.mp4');
    const t = window.transcribe(file);
    setTimeout(() => t.cancel(), 50);
    return t.result.then(() => 'resolved', e => e.message);
  }, [b64('speech.mp4'), toBlob]);
  expect(msg).toBe('Cancelled');
});

test('live: transcribes speech on this device with timestamps', async ({ page }, info) => {
  test.skip(info.project.name !== '1440-light' || !process.env.REELCUT_LIVE_WHISPER, 'set REELCUT_LIVE_WHISPER=1 (downloads the model)');
  test.setTimeout(240_000);
  await page.goto(url);
  const r = await page.evaluate(async ([data, mk, DEV]) => {
    const file = new File([await eval(mk)(data).arrayBuffer()], 'speech.mp4');
    const stages = new Set();
    const out = await window.transcribe(file, { language: 'en', device: DEV, onProgress: s => stages.add(s) }).result;
    return { text: out.chunks.map(c => c.text).join(' '), first: out.chunks[0], last: out.chunks.at(-1), device: out.device, stages: [...stages] };
  }, [b64('speech.mp4'), toBlob, process.env.REELCUT_DEVICE || undefined]);
  console.log('live whisper:', JSON.stringify(r));
  expect(r.text.toLowerCase()).toContain('quick brown fox');
  expect(r.text.toLowerCase()).toContain('coffee');
  expect(r.first.start).toBeGreaterThanOrEqual(0); expect(r.last.end).toBeLessThan(12);
  expect(r.stages).toContain('model');
});
