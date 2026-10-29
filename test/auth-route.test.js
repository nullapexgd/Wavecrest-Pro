// /api/auth/* answered 404 in production because Vercel did not fill req.query.path for the
// catch-all file. These tests drive the REAL handler with Vercel-shaped requests (URL set,
// query empty) against a throwaway Postgres and a mocked OAuth provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTempPostgres, makeUser, PG_SKIP } from './helpers/pg.js';
import { makeReq, makeRes } from './helpers/http.js';

process.env.GOOGLE_CLIENT_ID = process.env.GITHUB_CLIENT_ID = 'x';
process.env.GOOGLE_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET = 'y';
process.env.BASE_URL = 'https://wavecrest.test';

let pgx, handler, routeOf, makeAuthHandler, user;
const realFetch = globalThis.fetch;
before(async () => {
  if (PG_SKIP) return;
  pgx = await startTempPostgres();
  process.env.DB_URL = `postgres://test@localhost/app?host=${pgx.options.host}`;
  ({ default: handler, routeOf } = await import('../api/auth/[...path].js'));
  ({ makeAuthHandler } = await import('../lib/handlers/auth.js'));
  user = await makeUser(pgx.pool);
});
after(async () => { globalThis.fetch = realFetch; if (pgx) { await (await import('../lib/db.js')).getPool().end(); await pgx.stop(); } });

const skip = PG_SKIP || false;
// A request as Vercel delivers it for this file: the URL is set, query.path is not.
const call = async (method, url, extra = {}) => {
  const res = makeRes();
  await handler({ ...makeReq({ method, ...extra }), url }, res);
  return res;
};

test('routeOf reads the URL, ignores a ?path= override, and falls back to query.path without a URL', () => {
  assert.equal(routeOf({ url: '/api/auth/me', query: {} }), 'me');
  assert.equal(routeOf({ url: '/api/auth/google/callback?code=c&state=s', query: {} }), 'google/callback');
  assert.equal(routeOf({ url: '/api/auth/logout/', query: {} }), 'logout');
  assert.equal(routeOf({ url: '/api/auth/x?path=me', query: { path: 'me' } }), 'x');
  assert.equal(routeOf({ query: { path: ['github', 'callback'] } }), 'github/callback');
  assert.equal(routeOf({ url: '/api/auth', query: {} }), '');
});

test('GET /api/auth/me: 401 without a session, the user with one, never more than the profile', { skip }, async () => {
  assert.equal((await call('GET', '/api/auth/me')).statusCode, 401);
  const res = await call('GET', '/api/auth/me', { userId: user.id });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.user.id, user.id);
  assert.ok(!JSON.stringify(res.body).match(/secret|hash|token/i));
  assert.equal((await call('POST', '/api/auth/me')).statusCode, 405);
});

test('logout is POST only and clears the session cookie', { skip }, async () => {
  const get = await call('GET', '/api/auth/logout');
  assert.equal(get.statusCode, 405);
  assert.equal(get.headers.allow, 'POST');
  const post = await call('POST', '/api/auth/logout', { userId: user.id });
  assert.equal(post.statusCode, 200);
  assert.match(String(post.headers['set-cookie']), /wc_session=;.*Max-Age=0/);
});

test('sign-in starts redirect to Google and GitHub with a state cookie, and unknown routes stay 404', { skip }, async () => {
  const g = await call('GET', '/api/auth/google');
  assert.equal(g.statusCode, 302);
  assert.match(g.headers.location, /^https:\/\/accounts\.google\.com\//);
  assert.match(String(g.headers['set-cookie']), /wc_oauth_state=/);
  const h = await call('GET', '/api/auth/github');
  assert.equal(h.statusCode, 302);
  assert.match(h.headers.location, /^https:\/\/github\.com\/login\/oauth\/authorize/);
  assert.equal((await call('POST', '/api/auth/login')).statusCode, 501);
  assert.equal((await call('GET', '/api/auth/nope')).statusCode, 404);
  assert.equal((await call('GET', '/api/auth/nope?path=me')).statusCode, 404, 'a query string cannot pick the route');
});

test('a verified Google callback signs in through the URL route', { skip }, async () => {
  const json = (b) => ({ ok: true, status: 200, json: async () => b });
  const mockFetch = async (u) => {
    u = String(u);
    if (u.includes('oauth2.googleapis.com/token')) return json({ access_token: 't' });
    if (u.includes('oauth2/v3/userinfo')) return json({ sub: 'g-1', email: user.email, email_verified: true, name: 'N' });
    throw new Error('unexpected fetch ' + u);
  };
  const res = makeRes();
  await makeAuthHandler({ fetch: mockFetch })({ ...makeReq({ method: 'GET', query: { code: 'c', state: 's' }, headers: { cookie: 'wc_oauth_state=s' } }), url: '/api/auth/google/callback?code=c&state=s' }, res); // Vercel fills query from the query string, just not the path param
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/app');
  assert.match(String(res.headers['set-cookie']), /wc_session=/);
});

// ── the two OAuth callbacks are TWO path segments, which Vercel never routes to this file ──────
import { readFileSync } from 'node:fs';
const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('callbacks are rewritten to single-segment paths, and both spellings route the same', () => {
  const rw = Object.fromEntries(vercel.rewrites.map(r => [r.source, r.destination]));
  assert.deepEqual(rw, {
    '/api/auth/google/callback': '/api/auth/google-callback',
    '/api/auth/github/callback': '/api/auth/github-callback'
  });
  for (const [from, to] of Object.entries(rw)) {
    assert.ok(!/^\/api\/auth\/[^/]+\/[^/]+/.test(to), 'destination must be ONE segment under /api/auth');
    assert.equal(routeOf({ url: from + '?code=c', query: {} }), routeOf({ url: to + '?code=c', query: {} }));
  }
  assert.equal(routeOf({ url: '/api/auth/google-callback', query: {} }), 'google/callback');
  assert.equal(routeOf({ url: '/api/auth/github-callback', query: {} }), 'github/callback');
});

test('every other auth route is a single segment (so it needs no rewrite)', () => {
  const src = readFileSync(new URL('../lib/handlers/auth.js', import.meta.url), 'utf8');
  const cases = [...src.matchAll(/case '([^']+)':/g)].map(m => m[1]);
  assert.deepEqual(cases.filter(c => c.includes('/')).sort(), ['github/callback', 'google/callback']);
});

test('a verified Google callback signs in through the REWRITTEN single-segment URL', { skip }, async () => {
  const json = (b) => ({ ok: true, status: 200, json: async () => b });
  const mockFetch = async (u) => {
    u = String(u);
    if (u.includes('oauth2.googleapis.com/token')) return json({ access_token: 't' });
    if (u.includes('oauth2/v3/userinfo')) return json({ sub: 'g-1', email: user.email, email_verified: true, name: 'N' });
    throw new Error('unexpected fetch ' + u);
  };
  const res = makeRes();
  await makeAuthHandler({ fetch: mockFetch })({ ...makeReq({ method: 'GET', query: { code: 'c', state: 's' }, headers: { cookie: 'wc_oauth_state=s' } }), url: '/api/auth/google-callback?code=c&state=s' }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/app');
  assert.match(String(res.headers['set-cookie']), /wc_session=/);
});
