// The public health response says only whether the app and database are up; configuration
// detail, the deployed commit and database error text need the admin secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRes } from './helpers/http.js';

process.env.DB_URL = 'postgres://nobody@127.0.0.1:1/none'; // refuses connections immediately
process.env.ADMIN_SECRET = 'health-test-admin-secret';
process.env.VERCEL_GIT_COMMIT_SHA = 'abcdef1234567890';
const handler = (await import('../api/health.js')).default;
const call = async (headers = {}, method = 'GET') => {
  const res = makeRes();
  const e = console.error; console.error = () => {};
  try { await handler({ method, headers }, res); } finally { console.error = e; }
  return res;
};

test('public health: only ok and db, even when the database is down', async () => {
  for (const h of [{}, { 'x-admin-secret': 'wrong' }, { 'x-admin-secret': '' }]) {
    const res = await call(h);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(Object.keys(res.body).sort(), ['db', 'ok']);
    assert.ok(!/ECONN|127\.0\.0\.1|nobody|env|deployment|abcdef/.test(JSON.stringify(res.body)));
  }
});

test('admin health: configuration flags and commit', async () => {
  const res = await call({ 'x-admin-secret': 'health-test-admin-secret' });
  assert.equal(res.body.deployment, 'abcdef1');
  assert.equal(typeof res.body.env.SESSION_SECRET, 'boolean');
  assert.ok(Object.values(res.body.env).every(v => typeof v === 'boolean'), 'flags only, never values');
});

test('health is GET only', async () => {
  assert.equal((await call({}, 'POST')).statusCode, 405);
});
