// GET    /api/report/:id   owner, or anyone if the report is shared by link; else 404
// PATCH  /api/report/:id   {visibility:'private'|'link'}  owner only
// DELETE /api/report/:id   owner only
// Private-and-not-yours answers 404 (same as nonexistent) so a UUID can't be probed.
import { getUser } from '../../lib/auth.js';
import {
  VISIBILITIES, isOwner, getReportForViewer, setVisibility, deleteReport
} from '../../lib/reports.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const notFound = (res) => res.status(404).json({ error: 'Report not found' });

export default async function handler(req, res) {
  // Same URL, different body per viewer: never let a shared cache keep it.
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie, Authorization');

  const { id } = req.query;
  if (!id || !UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid report ID' });

  try {
    const user = await getUser(req).catch(() => null);
    const viewerId = user?.id ?? null;

    if (req.method === 'GET') {
      const row = await getReportForViewer(id, viewerId);
      if (!row) return notFound(res);
      return res.status(200).json({
        reportId: row.id,
        channel: { id: row.channel_id, name: row.channel_name, handle: row.channel_handle, thumbnailUrl: row.channel_thumbnail, subscriberCount: parseInt(row.subscriber_count || 0) },
        videoCount: row.video_count,
        analysis: row.analysis,
        createdAt: row.created_at,
        visibility: row.visibility,
        isOwner: isOwner(row, viewerId)
      });
    }

    if (req.method === 'PATCH' || req.method === 'DELETE') {
      // SameSite=Lax on the session cookie already keeps cross-site PATCH/DELETE anonymous.
      if (!viewerId) return res.status(401).json({ error: 'Sign in to manage reports' });

      if (req.method === 'PATCH') {
        let body = req.body;
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
        const visibility = body?.visibility;
        if (!VISIBILITIES.includes(visibility)) {
          return res.status(400).json({ error: `visibility must be one of: ${VISIBILITIES.join(', ')}` });
        }
        const updated = await setVisibility(id, viewerId, visibility);
        return updated ? res.status(200).json({ reportId: updated.id, visibility: updated.visibility }) : notFound(res);
      }

      return (await deleteReport(id, viewerId)) ? res.status(200).json({ ok: true }) : notFound(res);
    }

    res.setHeader('Allow', 'GET, PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[report/id]', err.message);
    return res.status(500).json({ error: 'Failed to fetch report' });
  }
}
