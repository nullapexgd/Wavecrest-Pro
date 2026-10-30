// GET /api/reports : the signed-in user's own reports, newest first (no analysis bodies).
// The user id comes from the verified session only; no query parameter can widen the scope.
import { getUser as realGetUser } from '../auth.js';
import { listReportsForUser } from '../reports.js';
import { noStore } from '../http.js';
import { reportError } from '../monitor.js';

export function makeReportsListHandler({ getUser = realGetUser, list = listReportsForUser, db } = {}) {
  return async function handler(req, res) {
    noStore(res);
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    }
    try {
      const user = await getUser(req, db).catch(() => null);
      if (!user) return res.status(401).json({ error: 'Sign in to see your reports', code: 'AUTH_REQUIRED' });
      const limit = Number.parseInt(req.query.limit, 10) || 50;
      const offset = Number.parseInt(req.query.offset, 10) || 0;
      const reports = await list(user.id, { limit, offset }, db);
      return res.status(200).json({ reports });
    } catch (err) {
      console.error('[reports-list]', err.message);
      await reportError(err, 'reports-list');
      return res.status(500).json({ error: 'Failed to load reports', code: 'SERVER_ERROR' });
    }
  };
}
