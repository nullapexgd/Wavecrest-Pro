// Accounts link by email, so only provider-VERIFIED emails may log in.
// Drives the real callbacks with a mocked provider (global fetch) against a throwaway Postgres.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTempPostgres, makeUser, PG_SKIP } from './helpers/pg.js';
import { makeReq, makeRes } from './helpers/http.js';
import { googleVerifiedEmail, githubVerifiedEmail } from '../lib/oauth.js';

process.env.GOOGLE_CLIENT_ID = process.env.GITHUB_CLIENT_ID = 'x';
process.env.GOOGLE_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET = 'y';
process.env.BASE_URL = 'https://wavecrest.test';

let pgx, handler, victim;
const realFetch = globalThis.fetch;
before(async () => {
  if (PG_SKIP) return;
  pgx = await startTempPostgres();
  process.env.DB_URL = `postgres://test@localhost/app?host=${pgx.options.host}`;
  handler = (await import('../api/auth/[...path].js')).default;
  victim = await makeUser(pgx.pool);
});
after(async () => { globalThis.fetch = realFetch; if (pgx) { await (await import('../lib/db.js')).getPool().end(); await pgx.stop(); } });

const json = (b) => ({ ok: true, status: 200, json: async () => b });
function mockProvider({ google, githubUser, githubEmails }) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/token')) return json({ access_token: 't' });
    if (u.includes('googleapis.com/oauth2/v3/userinfo')) return json(google);
    if (u.includes('github.com/login/oauth/access_token')) return json({ access_token: 't' });
    if (u.endsWith('api.github.com/user')) return json(githubUser);
    if (u.endsWith('api.github.com/user/emails')) return json(githubEmails);
    throw new Error('unexpected fetch ' + u);
  };
}
async function callback(provider) {
  const res = makeRes();
  const req = makeReq({ query: { path: [provider, 'callback'], state: 's', code: 'c' }, headers: { cookie: 'wc_oauth_state=s' } });
  await handler(req, res);
  return res;
}
const userCount = async (email) =>
  (await pgx.pool.query('SELECT count(*)::int n FROM users WHERE email=$1', [email])).rows[0].n;
const noisy = (fn) => { const e = console.error; console.error = () => {}; return fn().finally(() => { console.error = e; }); };

test('pure helpers: only verified emails pass', () => {
  assert.equal(googleVerifiedEmail({ email: 'a@x.com', email_verified: true }), 'a@x.com');
  assert.equal(googleVerifiedEmail({ email: 'a@x.com', email_verified: false }), null);
  assert.equal(googleVerifiedEmail({ email: 'a@x.com' }), null);
  assert.equal(githubVerifiedEmail([{ email: 'u@x.com', verified: false, primary: true }]), null);
  assert.equal(githubVerifiedEmail([{ email: 'u@x.com', verified: false }, { email: 'v@x.com', verified: true }]), 'v@x.com');
  assert.equal(githubVerifiedEmail(null), null);
});

test('GitHub: attacker with UNVERIFIED victim email (public profile + list) cannot take over', { skip: PG_SKIP }, async () => {
  mockProvider({
    githubUser: { id: 666, login: 'evil', email: victim.email },        // public email: attacker-set
    githubEmails: [{ email: victim.email, primary: true, verified: false }]
  });
  const res = await noisy(() => callback('github'));
  assert.equal(res.statusCode, 500);
  assert.ok(!res.headers['set-cookie']?.toString().includes('wc_session=') || res.headers['set-cookie'].toString().includes('wc_session=;'));
  assert.equal(await userCount(victim.email), 1);                       // no linking, no new user
  const evil = await pgx.pool.query("SELECT 1 FROM users WHERE provider='github' AND provider_id='666'");
  assert.equal(evil.rowCount, 0);
});

test('Google: unverified email is refused', { skip: PG_SKIP }, async () => {
  mockProvider({ google: { sub: 'g1', email: victim.email, email_verified: false, name: 'E' } });
  const res = await noisy(() => callback('google'));
  assert.equal(res.statusCode, 500);
  assert.equal(await userCount(victim.email), 1);
});

test('verified GitHub email signs in (new account) and re-login is stable', { skip: PG_SKIP }, async () => {
  mockProvider({
    githubUser: { id: 777, login: 'ok' },
    githubEmails: [{ email: 'ok@example.test', primary: true, verified: true }]
  });
  const r1 = await callback('github');
  assert.equal(r1.statusCode, 302);
  const r2 = await callback('github');
  assert.equal(r2.statusCode, 302);
  assert.equal(await userCount('ok@example.test'), 1);
});

test('verified Google email for an existing account links to it (legitimate owner)', { skip: PG_SKIP }, async () => {
  mockProvider({ google: { sub: 'g-victim', email: victim.email, email_verified: true, name: 'V' } });
  const res = await callback('google');
  assert.equal(res.statusCode, 302);
  assert.equal(await userCount(victim.email), 1);
});
