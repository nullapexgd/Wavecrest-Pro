// GET    /api/report/:id   view   (owner, or anyone if the owner shared the link)
// PATCH  /api/report/:id   {visibility:'private'|'link'}   owner only
// DELETE /api/report/:id   owner only
//
// Missing, private-and-not-yours, and malformed-but-valid-looking ids all answer 404, so a
// UUID can never be used to learn whether a private report exists. Responses are never
// cacheable by a shared cache: the same URL returns different bodies per viewer.
import { getUser as realGetUser } from '../auth.js';
import {
  getReportForViewer, toClientReport, setVisibility, deleteReport, VISIBILITIES
} from '../reports.js';
import { UUID_RE, noStore, jsonBody, isSameOrigin } from '../http.js';

export function makeReportHandler({
  getUser = realGetUser,
  reports = { getReportForViewer, setVisibility, deleteReport },
  db
} = {}) {
  return async function handler(req, res) {
    noStore(res);
    const id = String(req.query.id || '');
    if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid report ID', code: 'INVALID_INPUT' });

    try {
      const user = await getUser(req, db).catch(() => null);
      const viewerId = user?.id ?? null;

      if (req.method === 'GET') {
        const row = await reports.getReportForViewer(id, viewerId, db);
        if (!row) return res.status(404).json({ error: 'Report not found', code: 'NOT_FOUND' });
        return res.status(200).json(toClientReport(row, viewerId));
      }

      if (req.method === 'PATCH' || req.method === 'DELETE') {
        if (!isSameOrigin(req)) return res.status(403).json({ error: 'Cross-site request refused', code: 'CSRF' });
        if (!viewerId) return res.status(401).json({ error: 'Sign in to manage reports', code: 'AUTH_REQUIRED' });

        if (req.method === 'PATCH') {
          const { visibility } = jsonBody(req);
          if (!VISIBILITIES.includes(visibility)) {
            return res.status(400).json({ error: `visibility must be one of: ${VISIBILITIES.join(', ')}`, code: 'INVALID_INPUT' });
          }
          const updated = await reports.setVisibility(id, viewerId, visibility, db);
          if (!updated) return res.status(404).json({ error: 'Report not found', code: 'NOT_FOUND' });
          return res.status(200).json({ reportId: updated.id, visibility: updated.visibility });
        }

        const deleted = await reports.deleteReport(id, viewerId, db);
        if (!deleted) return res.status(404).json({ error: 'Report not found', code: 'NOT_FOUND' });
        return res.status(200).json({ ok: true });
      }

      res.setHeader('Allow', 'GET, PATCH, DELETE');
      return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    } catch (err) {
      console.error('[report]', req.method, err.message);
      return res.status(500).json({ error: 'Failed to load report', code: 'SERVER_ERROR' });
    }
  };
}
