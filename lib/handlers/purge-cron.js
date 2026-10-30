// GET /api/cron/purge : the daily YouTube 30-day statistics sweep (scheduled in vercel.json).
// Idempotent and bounded, so it is safe to be callable by anyone; if CRON_SECRET is set (Vercel then sends it as
// a Bearer token) a request without it is refused.
import crypto from 'node:crypto';
import { purgeDueReports } from '../reports.js';
import { noStore } from '../http.js';
import { reportError } from '../monitor.js';

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export function makePurgeCronHandler({ purge = purgeDueReports, env = process.env, db } = {}) {
  return async function handler(req, res) {
    noStore(res);
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }); }
    if (env.CRON_SECRET && !same(String(req.headers.authorization || ''), `Bearer ${env.CRON_SECRET}`)) {
      return res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    }
    try {
      const purged = await purge({}, db);
      console.log(JSON.stringify({ evt: 'purge', purged }));
      return res.status(200).json({ purged });
    } catch (err) {
      console.error('[purge-cron]', err.message);
      await reportError(err, 'purge-cron');
      return res.status(500).json({ error: 'Purge failed', code: 'SERVER_ERROR' });
    }
  };
}
