// The analyze endpoint's contract, with every dependency faked so each branch is exercised
// without a network or database. DB-backed behaviour is in analyze-e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes, everythingSent } from './helpers/http.js';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';
const { makeAnalyzeHandler } = await import('../lib/handlers/analyze.js');
const { UpstreamError, UserFacingError } = await import('../lib/errors.js');

const USER = { id: 'u-1', email: 'a@example.test', plan: 'free' };
const CHANNEL = { id: 'UC1', name: 'Example', handle: '@ex', subscriberCount: 10, thumbnailUrl: '', publishedAt: '2020-01-01', uploadsPlaylistId: 'UU1' };
const VIDEOS = [1, 2, 3, 4].map(i => ({ id: `v${i}`, title: `t${i}`, viewCount: 100 * i, duration: 300, publishedAt: '2026-01-01' }));
const ENV = { YOUTUBE_API_KEY: 'yt-key-secret', GROQ_API_KEY: 'gsk_SECRETKEY' };
const URL_OK = 'https://www.youtube.com/@example';

function rig(over = {}) {
  const calls = { reserve: 0, resolve: 0, fetchVideos: 0, run: 0, insert: 0, complete: [], fail: [], reserveArgs: [] };
  const deps = {
    env: ENV,
    getUser: async () => USER,
    getUserByApiKey: async k => (k === 'wc_live_good' ? USER : null),
    reserveRun: async a => { calls.reserve++; calls.reserveArgs.push(a); return { outcome: 'reserved', runId: 'run-1' }; },
    completeRun: async (id, rid) => { calls.complete.push([id, rid]); return true; },
    failRun: async id => { calls.fail.push(id); return true; },
    resolveChannel: async () => { calls.resolve++; return CHANNEL; },
    fetchVideos: async () => { calls.fetchVideos++; return VIDEOS; },
    runAnalysis: async () => { calls.run++; return { hooks: { primaryPattern: 'x' } }; },
    insertReport: async () => { calls.insert++; return 'report-1'; },
    getReport: async () => null,
    ...over
  };
  return { handler: makeAnalyzeHandler(deps), calls };
}
const post = (extra = {}) => makeReq({ method: 'POST', body: { url: URL_OK }, userId: USER.id, ...extra });
const noUpstream = calls => assert.deepEqual([calls.resolve, calls.fetchVideos, calls.run, calls.insert], [0, 0, 0, 0]);

test('anonymous visitors cannot run an analysis: 401, no reservation, no upstream call', async () => {
  const { handler, calls } = rig({ getUser: async () => null });
  const res = makeRes();
  await handler(post({ userId: null }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH_REQUIRED');
  assert.equal(calls.reserve, 0);
  noUpstream(calls);
});

test('a cookie-authenticated GET (which any page could fire cross-site) is refused', async () => {
  const { handler, calls } = rig();
  const res = makeRes();
  await handler(makeReq({ method: 'GET', query: { url: URL_OK }, userId: USER.id }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(calls.reserve, 0);
});

test('a cross-site POST is refused before anything is reserved', async () => {
  const { handler, calls } = rig();
  for (const headers of [{ 'sec-fetch-site': 'cross-site' }, { origin: 'https://evil.example' }]) {
    const res = makeRes();
    await handler(post({ headers }), res);
    assert.equal(res.statusCode, 403);
  }
  assert.equal(calls.reserve, 0);
});

test('invalid or unsupported input is rejected BEFORE a run is reserved (it cannot burn quota)', async () => {
  const { handler, calls } = rig();
  for (const url of ['', 'https://vimeo.com/1', 'javascript:alert(1)', 'https://youtube.com/playlist?list=PL1', 'two words']) {
    const res = makeRes();
    await handler(post({ body: { url } }), res);
    assert.equal(res.statusCode, 400, url);
  }
  assert.equal(calls.reserve, 0);
});

test('shorts, live and embed links are accepted (they used to pass validation then fail later)', async () => {
  for (const url of ['https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ', 'https://youtube.com/embed/dQw4w9WgXcQ']) {
    const { handler, calls } = rig();
    const res = makeRes();
    await handler(post({ body: { url } }), res);
    assert.equal(res.events().at(-1).name, 'done', url);
    assert.equal(calls.reserveArgs[0].channelKey, 'videoId:dQw4w9WgXcQ');
  }
});

test('over quota: 429 PLAN_LIMIT with a reset message, and zero upstream spend', async () => {
  const { handler, calls } = rig({ reserveRun: async () => ({ outcome: 'limit', used: 1, limit: 1 }) });
  const res = makeRes();
  await handler(post(), res);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 'PLAN_LIMIT');
  assert.match(res.body.error, /free analysis/i);
  assert.equal(res.body.plan, 'free');
  noUpstream(calls);
});

test('a second analysis while one is running: 409 IN_PROGRESS, zero upstream spend', async () => {
  const { handler, calls } = rig({ reserveRun: async () => ({ outcome: 'in_progress' }) });
  const res = makeRes();
  await handler(post(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'IN_PROGRESS');
  noUpstream(calls);
});

test('if the reservation cannot be made (database down) the request FAILS CLOSED', async () => {
  const { handler, calls } = rig({ reserveRun: async () => { throw new Error('connection refused postgres://u:pw@host'); } });
  const res = makeRes();
  await handler(post(), res);
  assert.equal(res.statusCode, 503);
  assert.doesNotMatch(everythingSent(res), /postgres|pw@/);
  noUpstream(calls);
});

test('the user\'s entitlement, not the client, sets the limit passed to the quota engine', async () => {
  const mk = plan => rig({ getUser: async () => ({ ...USER, plan }) });
  for (const [plan, expected] of [['free', 1], ['starter', 25], ['pro', 100], ['team', Infinity], ['made-up', 1]]) {
    const { handler, calls } = mk(plan);
    await handler(post(), makeRes());
    assert.equal(calls.reserveArgs[0].limit, expected, plan);
  }
});

test('success: streams progress, saves a PRIVATE report for the caller, completes the run', async () => {
  const { handler, calls } = rig();
  const res = makeRes();
  await handler(post({ headers: { 'idempotency-key': 'click-0001-abcd' } }), res);
  const events = res.events();
  assert.deepEqual(events.map(e => e.name).filter((n, i, a) => a.indexOf(n) === i), ['progress', 'done']);
  const done = events.at(-1).data;
  assert.equal(done.reportId, 'report-1');
  assert.equal(done.visibility, 'private');
  assert.equal(done.isOwner, true);
  assert.deepEqual(calls.complete, [['run-1', 'report-1']]);
  assert.deepEqual(calls.fail, []);
  assert.equal(calls.reserveArgs[0].idemKey, 'click-0001-abcd');
  assert.match(res.headers['content-type'], /event-stream/);
  assert.equal(res.headers['cache-control'], 'no-cache, no-transform');
});

test('an upstream failure is REFUNDED and no upstream detail, key or body reaches the client', async () => {
  const { handler, calls } = rig({
    runAnalysis: async () => { throw new UpstreamError('ai', 429, 'rate limited: org_9f2 key gsk_SECRETKEY body {"error":"..."}'); }
  });
  const res = makeRes();
  await handler(post(), res);
  const fail = res.events().at(-1);
  assert.equal(fail.name, 'fail');
  assert.equal(fail.data.code, 'AI_UNAVAILABLE');
  assert.doesNotMatch(everythingSent(res), /gsk_|org_9f2|SECRET|429|rate limited/);
  assert.deepEqual(calls.fail, ['run-1'], 'the run is refunded');
  assert.deepEqual(calls.complete, []);
});

test('an unexpected exception is refunded and leaks nothing', async () => {
  const { handler, calls } = rig({ fetchVideos: async () => { throw new Error('ECONNRESET at postgres://user:hunter2@db.internal/app'); } });
  const res = makeRes();
  await handler(post(), res);
  assert.equal(res.events().at(-1).data.code, 'ANALYSIS_FAILED');
  assert.doesNotMatch(everythingSent(res), /hunter2|postgres|ECONNRESET|db\.internal/);
  assert.deepEqual(calls.fail, ['run-1']);
});

test('our own user-facing errors are shown, and also refunded', async () => {
  const { handler, calls } = rig({ resolveChannel: async () => { throw new UserFacingError('We could not find that channel.', 'NOT_FOUND', 404); } });
  const res = makeRes();
  await handler(post(), res);
  assert.deepEqual(res.events().at(-1), { name: 'fail', data: { message: 'We could not find that channel.', code: 'NOT_FOUND' } });
  assert.deepEqual(calls.fail, ['run-1']);
});

test('too few videos is a refunded, user-facing failure', async () => {
  const { handler, calls } = rig({ fetchVideos: async () => VIDEOS.slice(0, 2) });
  const res = makeRes();
  await handler(post(), res);
  assert.equal(res.events().at(-1).data.code, 'TOO_FEW_VIDEOS');
  assert.deepEqual(calls.fail, ['run-1']);
  assert.equal(calls.run, 0, 'the paid model call is never made');
});

test('a hung upstream hits the deadline: TIMEOUT, refunded, no hang', async () => {
  const { handler, calls } = rig({
    deadlineMs: 40,
    runAnalysis: (_c, _v, _k, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
  });
  const res = makeRes();
  await handler(post(), res);
  assert.equal(res.events().at(-1).data.code, 'TIMEOUT');
  assert.deepEqual(calls.fail, ['run-1']);
});

test('a failed report save still delivers the analysis, and the run still counts', async () => {
  const { handler, calls } = rig({ insertReport: async () => null });
  const res = makeRes();
  await handler(post(), res);
  const last = res.events().at(-1);
  assert.equal(last.name, 'done');
  assert.equal(last.data.reportId, null);
  assert.deepEqual(calls.complete, [['run-1', null]]);
  assert.deepEqual(calls.fail, []);
});

test('replay of a finished run returns the stored report with no new upstream spend', async () => {
  const row = { id: 'report-9', user_id: USER.id, visibility: 'private', channel_id: 'UC1', channel_name: 'Example',
    channel_handle: '@ex', channel_thumbnail: '', subscriber_count: 10, video_count: 4, analysis: { a: 1 }, created_at: 't' };
  const { handler, calls } = rig({
    reserveRun: async () => ({ outcome: 'replay', run: { id: 'run-0', status: 'succeeded', report_id: 'report-9' } }),
    getReport: async (id, viewer) => (id === 'report-9' && viewer === USER.id ? row : null)
  });
  const res = makeRes();
  await handler(post({ headers: { 'idempotency-key': 'click-0001-abcd' } }), res);
  assert.equal(res.events().at(-1).data.reportId, 'report-9');
  assert.equal(res.events().at(-1).data.isOwner, true);
  noUpstream(calls);
});

test('replay of an in-flight or failed run is a 409, never a second run', async () => {
  for (const [status, code] of [['reserved', 'IN_PROGRESS'], ['failed', 'PREVIOUS_FAILED']]) {
    const { handler, calls } = rig({ reserveRun: async () => ({ outcome: 'replay', run: { id: 'r', status, report_id: null } }) });
    const res = makeRes();
    await handler(post({ headers: { 'idempotency-key': 'click-0001-abcd' } }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, code);
    noUpstream(calls);
  }
});

test('a malformed Idempotency-Key is rejected', async () => {
  const { handler, calls } = rig();
  const res = makeRes();
  await handler(post({ headers: { 'idempotency-key': 'x' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.reserve, 0);
});

test('API keys: Bearer GET works, a bad key is 401, and a key never reaches the browser flow', async () => {
  const good = rig();
  const ok = makeRes();
  await good.handler(makeReq({ method: 'GET', query: { url: URL_OK }, bearer: 'wc_live_good' }), ok);
  assert.equal(ok.events().at(-1).name, 'done');

  const bad = rig();
  const no = makeRes();
  await bad.handler(makeReq({ method: 'GET', query: { url: URL_OK }, bearer: 'wc_live_nope' }), no);
  assert.equal(no.statusCode, 401);
  assert.equal(no.body.code, 'BAD_API_KEY');
  assert.equal(bad.calls.reserve, 0);
});

test('server misconfiguration is reported without naming the missing key', async () => {
  const { handler } = rig({ env: { YOUTUBE_API_KEY: 'x' } });
  const res = makeRes();
  await handler(post(), res);
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(everythingSent(res), /GROQ/);
});

// One structured line per run, so a failure has a reason and cost per report is measured.
async function runLines(over) {
  const real = console.log, lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try { const { handler } = rig(over); await handler(post(), makeRes()); } finally { console.log = real; }
  return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(l => l?.evt === 'analysis_run');
}
test('a successful run logs provider, tokens and duration, and nothing else of the report', async () => {
  const [line, ...extra] = await runLines({ runAnalysis: async () => ({ hooks: {}, quality: { provider: 'gemini', tokens: 5400, confidence: 'medium' } }) });
  assert.equal(extra.length, 0);
  assert.deepEqual([line.ok, line.provider, line.tokens, line.videos, line.confidence], [true, 'gemini', 5400, 4, 'medium']);
  assert.equal(typeof line.ms, 'number');
});
test('a failed run logs the failure class and upstream status, never the upstream body or keys', async () => {
  const lines = await runLines({ runAnalysis: async () => { throw new UpstreamError('ai', 429, 'org_9f2 key gsk_SECRETKEY body {"error":"x"}'); } });
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].ok, lines[0].failure, lines[0].service, lines[0].upstreamStatus], [false, 'UpstreamError', 'ai', 429]);
  assert.doesNotMatch(JSON.stringify(lines[0]), /gsk_|org_9f2|SECRET/);
});
