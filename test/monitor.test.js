import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportError } from '../lib/monitor.js';
import { UpstreamError, UserFacingError } from '../lib/errors.js';

const DSN = 'https://abc123key@o1.ingest.sentry.io/456';
const capture = () => { const calls = []; return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true }; } }; };

test('without SENTRY_DSN nothing is sent', async () => {
  const { calls, fetchImpl } = capture();
  await reportError(new Error('boom'), 'analyze', { dsn: '', fetchImpl });
  assert.equal(calls.length, 0);
});

test('expected user-facing errors are not reported', async () => {
  const { calls, fetchImpl } = capture();
  await reportError(new UserFacingError('bad input'), 'analyze', { dsn: DSN, fetchImpl });
  assert.equal(calls.length, 0);
});

test('an upstream failure is sent to the envelope endpoint without its detail', async () => {
  const { calls, fetchImpl } = capture();
  await reportError(new UpstreamError('ai', 429, 'SECRET-PROVIDER-BODY user@example.com'), 'analyze', { dsn: DSN, fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://o1.ingest.sentry.io/api/456/envelope/');
  assert.match(calls[0].init.headers['X-Sentry-Auth'], /sentry_key=abc123key/);
  const [, , event] = calls[0].init.body.split('\n').map(l => JSON.parse(l));
  assert.equal(event.exception.values[0].type, 'UpstreamError');
  assert.deepEqual([event.tags.route, event.tags.service, event.tags.upstream_status], ['analyze', 'ai', 429]);
  assert.ok(!calls[0].init.body.includes('SECRET-PROVIDER-BODY') && !calls[0].init.body.includes('user@example.com'));
});

test('a deadline timeout is a warning, not an error', async () => {
  const { calls, fetchImpl } = capture();
  const t = new Error('deadline'); t.name = 'TimeoutError';
  await reportError(t, 'analyze', { dsn: DSN, fetchImpl });
  assert.equal(JSON.parse(calls[0].init.body.split('\n')[2]).level, 'warning');
});

test('a failing monitor never throws into the request', async () => {
  await reportError(new Error('x'), 'report', { dsn: DSN, fetchImpl: async () => { throw new Error('network down'); } });
  await reportError(new Error('x'), 'report', { dsn: 'not a url', fetchImpl: async () => ({}) });
});
