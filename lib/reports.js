// Access rule for stored reports. One function decides who may read one:
//   owner                      -> view, share, unshare, delete
//   anyone, visibility = link  -> view (read-only)
//   everyone else              -> the report "does not exist" (callers answer 404, never 403)
import { getPool } from './db.js';

export const VISIBILITIES = ['private', 'link'];

export function isOwner(row, viewerId) {
  return Boolean(viewerId && row?.user_id && row.user_id === viewerId);
}

export function canViewReport(row, viewerId) {
  return Boolean(row) && (isOwner(row, viewerId) || row.visibility === 'link');
}

export async function getReportForViewer(id, viewerId) {
  const r = await getPool().query(
    `SELECT id, user_id, visibility, channel_id, channel_name, channel_handle, channel_thumbnail,
            subscriber_count, video_count, analysis, created_at
     FROM reports WHERE id = $1`,
    [id]
  );
  const row = r.rows[0];
  return canViewReport(row, viewerId) ? row : null;
}

// Ownership is in the WHERE clause, so a non-owner changes nothing.
export async function setVisibility(id, userId, visibility) {
  const r = await getPool().query(
    'UPDATE reports SET visibility = $3 WHERE id = $1 AND user_id = $2 RETURNING id, visibility',
    [id, userId, visibility]
  );
  return r.rows[0] || null;
}

export async function deleteReport(id, userId) {
  const r = await getPool().query('DELETE FROM reports WHERE id = $1 AND user_id = $2', [id, userId]);
  return r.rowCount > 0;
}
