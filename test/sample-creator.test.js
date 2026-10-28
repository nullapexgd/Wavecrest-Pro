import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeReq, makeRes, everythingSent } from './helpers/http.js';
import { makeSampleCreatorHandler } from '../lib/handlers/sample-creator.js';
import { config as middlewareConfig } from '../middleware.js';

const KEY = 'AIzaSyFAKE-test-key-never-real';
const creators = { alpha: 'UCaaaaaaaaaaaaaaaaaaaaaa', beta: 'UCbbbbbbbbbbbbbbbbbbbbbb', gamma: 'UCcccccccccccccccccccccc' };

// In-memory stand-in for the Upstash commands the handler uses.
function fakeKv() {
  const data = new Map();
  const kv = {
    data,
    async run(cmds) {
      await Promise.resolve();
      return cmds.map(([op, key, ...a]) => {
        switch (op) {
          case 'GET': return data.get(key) ?? null;
          case 'SET': {
            if (a.includes('NX') && data.has(key)) return null;
            data.set(key, a[0]); return 'OK';
          }
          case 'INCRBY': { const n = Number(data.get(key) ?? 0) + Number(a[0]); data.set(key, String(n)); return n; }
          case 'EXPIRE': return 1;
          case 'DEL': return data.delete(key) ? 1 : 0;
          default: throw new Error(`unexpected ${op}`);
        }
      });
    }
  };
  return kv;
}

const video = (n, extra = {}) => ({
  id: `vid${n}`, title: `Upload ${n}`, publishedAt: `2026-0${1 + (n % 9)}-1${n % 9}T10:00:00Z`,
  viewCount: 1000 * n, likeCount: 50 * n, commentCount: 3, duration: n % 2 ? 90 : 600, thumbnailUrl: '', ...extra
});

function setup({ kv = fakeKv(), env = { YOUTUBE_API_KEY: KEY }, fetchVideos } = {}) {
  const calls = [];
  const fv = fetchVideos ?? (async (playlist, key, max) => { calls.push({ playlist, key, max }); return [video(1), video(2), video(3)]; });
  const wrapped = async (...args) => { if (fetchVideos) calls.push({ playlist: args[0] }); return fv(...args); };
  const handler = makeSampleCreatorHandler({ kv, fetchVideos: wrapped, creators, env });
  const get = async id => { const res = makeRes(); await handler(makeReq({ query: { id } }), res); return res; };
  return { kv, calls, get, handler };
}

test('only allowlisted ids are served; anything else is 404 and never reaches YouTube', async () => {
  const { get, calls } = setup();
  for (const id of ['nope', '__proto__', 'constructor', 'ALPHA', '', undefined, ['alpha'], 'https://youtube.com/@mkbhd']) {
    const res = await get(id);
    assert.equal(res.statusCode, 404, String(id));
  }
  assert.equal(calls.length, 0);
});

test('non-GET methods are refused', async () => {
  const { handler, calls } = setup();
  const res = makeRes();
  await handler(makeReq({ method: 'POST', query: { id: 'alpha' } }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(calls.length, 0);
});

test('no KV configured: fails closed, YouTube is never called', async () => {
  const { get, calls } = setup({ kv: null });
  const res = await get('alpha');
  assert.equal(res.statusCode, 503);
  assert.equal(calls.length, 0);
});

test('a miss fetches once, the next request is a cache hit, and the key is never in a response', async () => {
  const { get, calls } = setup();
  const a = await get('alpha');
  assert.equal(a.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].playlist, 'UUaaaaaaaaaaaaaaaaaaaaaa');
  assert.ok(calls[0].max <= 48);
  assert.equal(a.body.videos.length, 3);
  assert.deepEqual(Object.keys(a.body.videos[0]).sort(), ['duration', 'id', 'likes', 'published', 'short', 'title', 'views']);
  assert.match(a.headers['cache-control'], /public, s-maxage=21600/);
  const b = await get('alpha');
  assert.equal(b.statusCode, 200);
  assert.equal(calls.length, 1, 'served from cache');
  assert.ok(!everythingSent(a).includes(KEY) && !everythingSent(b).includes(KEY));
});

test('a burst of simultaneous misses causes one upstream fetch, not many', async () => {
  let n = 0;
  const { get } = setup({
    fetchVideos: async () => { n++; await new Promise(r => setTimeout(r, 30)); return [video(1)]; }
  });
  const all = await Promise.all(Array.from({ length: 40 }, () => get('beta')));
  assert.equal(n, 1);
  assert.ok(all.every(r => r.statusCode === 200 || r.statusCode === 503));
  assert.ok(all.some(r => r.statusCode === 200));
});

test('the daily unit budget stops all upstream calls once spent', async () => {
  const { get, calls } = setup({ env: { YOUTUBE_API_KEY: KEY, SAMPLE_YT_DAILY_UNITS: '4' } });
  assert.equal((await get('alpha')).statusCode, 200); // 2 units
  assert.equal((await get('beta')).statusCode, 200);  // 4 units
  const third = await get('gamma');                    // would be 6 > 4
  assert.equal(third.statusCode, 503);
  assert.equal(calls.length, 2, 'the third refresh never reached YouTube');
});

test('over budget with an old copy available: serves it, marked stale, still no upstream call', async () => {
  const kv = fakeKv();
  const { get, calls } = setup({ kv, env: { YOUTUBE_API_KEY: KEY, SAMPLE_YT_DAILY_UNITS: '2' } });
  assert.equal((await get('alpha')).statusCode, 200);
  kv.data.delete('sc:v1:alpha'); // fresh copy expired; the 7-day stale copy remains
  const res = await get('alpha');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.stale, true);
  assert.equal(calls.length, 1);
});

test('an upstream failure is a clean 503 with no detail, the lock is released, and a retry works', async () => {
  let fail = true; let n = 0;
  const { get } = setup({
    fetchVideos: async () => { n++; if (fail) throw Object.assign(new Error(`boom https://x/?key=${KEY}`), { name: 'UpstreamError', upstreamStatus: 500 }); return [video(1)]; }
  });
  const bad = await get('alpha');
  assert.equal(bad.statusCode, 503);
  assert.ok(!everythingSent(bad).includes(KEY) && !everythingSent(bad).includes('boom'));
  fail = false;
  assert.equal((await get('alpha')).statusCode, 200);
  assert.equal(n, 2);
});

test('a missing YouTube key means no upstream call', async () => {
  const { get, calls } = setup({ env: {} });
  assert.equal((await get('alpha')).statusCode, 503);
  assert.equal(calls.length, 0);
});

test('the per-IP limiter covers this route, and the allowlist matches the site snapshot', () => {
  assert.ok(middlewareConfig.matcher.includes('/api/sample-creator'));
  const list = JSON.parse(readFileSync(new URL('../lib/sample-creators.json', import.meta.url)));
  assert.ok(Object.values(list).every(id => /^UC[\w-]{22}$/.test(id)));
  const snap = JSON.parse(readFileSync(new URL('../web/src/data/creators.json', import.meta.url)));
  assert.deepEqual(snap.creators.map(c => c.handle).sort(), Object.keys(list).sort());
});
