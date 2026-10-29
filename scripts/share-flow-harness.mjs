// Hand-run browser check for the owner Share toggle in app.html. Not part of `npm test`.
//   LC_ALL=en_US.UTF-8 node scripts/share-flow-harness.mjs     then open the printed URLs
// Serves the REAL app.html and the REAL api/report + api/auth handlers on a throwaway local
// Postgres (never reads DB_URL/DATABASE_URL/.env*). Test-only SESSION_SECRET. /__login mints a session
// cookie for a test user, so no OAuth. Steps: see docs/HOTFIX-runbook.md, "Share toggle browser check".
import http from 'node:http';
import { readFileSync } from 'node:fs';
process.env.SESSION_SECRET = 'share-flow-harness-test-secret';
const root = new URL('..', import.meta.url).pathname;
const { startTempPostgres, makeUser, makeReport } = await import('../test/helpers/pg.js');
const pgx = await startTempPostgres();
process.env.DB_URL = `postgres://test@localhost/app?host=${encodeURIComponent(pgx.options.host)}`;
const { createSessionValue } = await import('../lib/auth.js');
const reportApi = (await import('../api/report/[id].js')).default;
const authApi = (await import('../api/auth/[...path].js')).default;
const users = { A: await makeUser(pgx.pool), B: await makeUser(pgx.pool) };
const report = await makeReport(pgx.pool, { userId: users.A.id });
const port = 4192;
http.createServer((rq, rs) => {
  const u = new URL(rq.url, 'http://x');
  const res = { code: 200, setHeader: (k, v) => rs.setHeader(k, v), status(c) { this.code = c; return this; },
    json(b) { rs.writeHead(this.code, { 'content-type': 'application/json' }); rs.end(JSON.stringify(b)); }, end(x) { rs.writeHead(this.code); rs.end(x); } };
  const req = { method: rq.method, headers: rq.headers, query: Object.fromEntries(u.searchParams), body: undefined };
  if (u.pathname === '/app') { rs.writeHead(200, { 'content-type': 'text/html' }); return rs.end(readFileSync(root + 'app.html')); }
  if (u.pathname === '/__login') { rs.writeHead(302, { 'set-cookie': `wc_session=${createSessionValue(users[u.searchParams.get('u')].id)}; Path=/; HttpOnly; SameSite=Lax`, location: u.searchParams.get('to') }); return rs.end(); }
  if (u.pathname === '/__db') return pgx.pool.query('SELECT id, visibility FROM reports').then(r => res.json(r.rows));
  let b = ''; rq.on('data', c => (b += c)); rq.on('end', () => {
    if (u.pathname.startsWith('/api/report/')) { req.query.id = u.pathname.split('/').pop(); req.body = b || undefined; return reportApi(req, res); }
    if (u.pathname.startsWith('/api/auth/')) { req.query.path = u.pathname.replace('/api/auth/', '').split('/'); return authApi(req, res); }
    res.status(404).json({ error: 'no route' });
  });
}).listen(port, '127.0.0.1', () => {
  const to = encodeURIComponent(`/app?r=${report}`);
  console.log(`owner A : http://127.0.0.1:${port}/__login?u=A&to=${to}\nother B : http://127.0.0.1:${port}/__login?u=B&to=${to}\nDB state: http://127.0.0.1:${port}/__db   (Ctrl-C to stop)`);
});
process.on('SIGINT', async () => { await pgx.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await pgx.stop(); process.exit(0); });
