import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeReq, makeRes } from './helpers/http.js';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

const { googleVerifiedEmail, githubVerifiedEmail } = await import('../lib/oauth.js');
const { makeAuthHandler } = await import('../lib/handlers/auth.js');

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const routeFetch = routes => async (url) => {
  for (const [prefix, fn] of Object.entries(routes)) if (String(url).startsWith(prefix)) return fn(url);
  throw new Error(`unexpected fetch ${url}`);
};

test('google: only an email Google says is verified is accepted, lowercased', () => {
  assert.equal(googleVerifiedEmail({ email: 'A@B.com', email_verified: true }), 'a@b.com');
  assert.equal(googleVerifiedEmail({ email: 'a@b.com', email_verified: 'true' }), 'a@b.com');
  assert.equal(googleVerifiedEmail({ email: 'a@b.com', email_verified: false }), null);
  assert.equal(googleVerifiedEmail({ email: 'a@b.com' }), null);
  assert.equal(googleVerifiedEmail({ email_verified: true }), null);
  assert.equal(googleVerifiedEmail(null), null);
});

test('github: prefers primary+verified, never falls back to an unverified entry', () => {
  assert.equal(githubVerifiedEmail([
    { email: 'victim@x.com', primary: false, verified: false },
    { email: 'Me@x.com', primary: true, verified: true }
  ]), 'me@x.com');
  assert.equal(githubVerifiedEmail([
    { email: 'victim@x.com', primary: false, verified: false },
    { email: 'other@x.com', primary: false, verified: true }
  ]), 'other@x.com');
  // The old code returned emails[0] here, which is the takeover:
  assert.equal(githubVerifiedEmail([{ email: 'victim@x.com', primary: true, verified: false }]), null);
  assert.equal(githubVerifiedEmail([]), null);
  assert.equal(githubVerifiedEmail(undefined), null);
});

function callback(provider, routes) {
  const upserts = [];
  const handler = makeAuthHandler({
    fetch: routeFetch(routes),
    upsertUser: async u => { upserts.push(u); return { id: 'u-1' }; },
    env: { BASE_URL: 'https://wavecrest.test' }
  });
  const req = makeReq({
    query: { path: [provider, 'callback'], code: 'c', state: 's' },
    headers: { cookie: 'wc_oauth_state=s' }
  });
  const res = makeRes();
  return { handler, req, res, upserts };
}

const githubRoutes = (emails, publicEmail = null) => ({
  'https://github.com/login/oauth/access_token': () => json({ access_token: 't' }),
  'https://api.github.com/user/emails': () => json(emails),
  'https://api.github.com/user': () => json({ id: 42, login: 'attacker', name: 'Attacker', email: publicEmail })
});

test('github takeover attempt: victim email present but unverified -> no session, nothing upserted', async () => {
  const { handler, req, res, upserts } = callback('github', githubRoutes(
    [{ email: 'victim@example.com', primary: true, verified: false }],
    'victim@example.com' // even a spoofed public profile email must not be trusted
  ));
  await handler(req, res);
  assert.equal(upserts.length, 0);
  assert.equal(res.headers['set-cookie'], undefined);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/login?error=email_not_verified');
});

test('github: logs in as the attacker\'s OWN verified email, never the victim\'s', async () => {
  const { handler, req, res, upserts } = callback('github', githubRoutes([
    { email: 'victim@example.com', primary: false, verified: false },
    { email: 'attacker@evil.test', primary: true, verified: true }
  ], 'victim@example.com'));
  await handler(req, res);
  assert.deepEqual(upserts.map(u => u.email), ['attacker@evil.test']);
  assert.equal(res.headers.location, '/app');
});

test('google: unverified email is refused, verified is accepted', async () => {
  const mk = verified => callback('google', {
    'https://oauth2.googleapis.com/token': () => json({ access_token: 't' }),
    'https://www.googleapis.com/oauth2/v3/userinfo': () => json({ sub: 'g1', email: 'v@example.com', email_verified: verified, name: 'V' })
  });
  const bad = mk(false);
  await bad.handler(bad.req, bad.res);
  assert.equal(bad.upserts.length, 0);
  assert.equal(bad.res.headers.location, '/login?error=email_not_verified');

  const good = mk(true);
  await good.handler(good.req, good.res);
  assert.deepEqual(good.upserts.map(u => u.email), ['v@example.com']);
  assert.equal(good.res.headers.location, '/app');
});

test('oauth callback without a matching state cookie is refused before any network call', async () => {
  let called = false;
  const handler = makeAuthHandler({ fetch: async () => { called = true; return json({}); }, env: { BASE_URL: 'https://x.test' } });
  const res = makeRes();
  await handler(makeReq({ query: { path: ['github', 'callback'], code: 'c', state: 'forged' }, headers: { cookie: 'wc_oauth_state=real' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test('logout refuses a cross-site request', async () => {
  const handler = makeAuthHandler({ env: { BASE_URL: 'https://x.test' } });
  const res = makeRes();
  await handler(makeReq({ method: 'POST', query: { path: ['logout'] }, headers: { 'sec-fetch-site': 'cross-site' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['set-cookie'], undefined);
});
