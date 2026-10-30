// Every read or write of a stored report goes through this file. Nothing else may
// SELECT from `reports` for a request. The rule is one function, canViewReport.
//
//   owner                      -> can view, share, unshare, delete
//   anyone, visibility = link  -> can view (read-only)
//   everyone else              -> the report does not exist (callers answer 404, never 403,
//                                 so a UUID cannot be probed for existence)
import { getPool } from './db.js';
import { isPurgeDue, isPurged, purgeAnalysis, PURGE_AFTER_DAYS } from './purge.js';

export const VISIBILITIES = ['private', 'link'];

export function isOwner(row, viewerId) {
  return Boolean(viewerId && row?.user_id && row.user_id === viewerId);
}

export function canViewReport(row, viewerId) {
  if (!row) return false;
  return isOwner(row, viewerId) || row.visibility === 'link';
}

const FULL = `id, user_id, visibility, channel_id, channel_name, channel_handle, channel_thumbnail,
              subscriber_count, video_count, analysis, created_at`;

export async function getReportForViewer(id, viewerId, db = getPool()) {
  const r = await db.query(`SELECT ${FULL} FROM reports WHERE id = $1`, [id]);
  const row = r.rows[0];
  return canViewReport(row, viewerId) ? purgeIfDue(row, db) : null;
}

// YouTube's 30-day rule: a report older than 30 days is stripped of statistics when it is read (the daily sweep
// below covers reports nobody opens). The text is kept; the UPDATE is idempotent, so concurrent readers are safe.
async function purgeIfDue(row, db) {
  if (!isPurgeDue(row.created_at) || isPurged(row.analysis)) return row;
  const analysis = purgeAnalysis(row.analysis);
  try {
    await db.query(
      "UPDATE reports SET analysis = $2, subscriber_count = NULL WHERE id = $1 AND NOT (analysis ? 'statsPurgedAt')",
      [row.id, JSON.stringify(analysis)]
    );
  } catch (err) {
    console.error('[purgeIfDue]', err.message); // still return the purged copy: never show a stale statistic
  }
  return { ...row, analysis, subscriber_count: null };
}

// Daily sweep (api/cron/purge). Bounded per call; the next run continues where this one stopped.
export async function purgeDueReports({ limit = 200 } = {}, db = getPool()) {
  const due = await db.query(
    `SELECT id, analysis FROM reports
     WHERE created_at < now() - make_interval(days => $1) AND NOT (analysis ? 'statsPurgedAt')
     ORDER BY created_at LIMIT $2`,
    [PURGE_AFTER_DAYS, limit]
  );
  for (const row of due.rows) {
    await db.query(
      "UPDATE reports SET analysis = $2, subscriber_count = NULL WHERE id = $1 AND NOT (analysis ? 'statsPurgedAt')",
      [row.id, JSON.stringify(purgeAnalysis(row.analysis))]
    );
  }
  return due.rowCount;
}

// What a client is allowed to see. user_id never leaves the server.
export function toClientReport(row, viewerId) {
  return {
    reportId: row.id,
    channel: {
      id: row.channel_id,
      name: row.channel_name,
      handle: row.channel_handle,
      thumbnailUrl: row.channel_thumbnail,
      subscriberCount: parseInt(row.subscriber_count || 0, 10)
    },
    videoCount: row.video_count,
    analysis: row.analysis,
    createdAt: row.created_at,
    visibility: row.visibility,
    isOwner: isOwner(row, viewerId)
  };
}

// The scope is in the SQL (user_id = $1), not only in JS, and the id comes from the
// verified session, never from the request.
export async function listReportsForUser(userId, { limit = 50, offset = 0 } = {}, db = getPool()) {
  const r = await db.query(
    `SELECT id, visibility, channel_id, channel_name, channel_handle, channel_thumbnail,
            subscriber_count, video_count, created_at
     FROM reports WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [userId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)]
  );
  return r.rows.map(row => ({
    reportId: row.id,
    visibility: row.visibility,
    channel: {
      id: row.channel_id,
      name: row.channel_name,
      handle: row.channel_handle,
      thumbnailUrl: row.channel_thumbnail,
      subscriberCount: isPurgeDue(row.created_at) ? 0 : parseInt(row.subscriber_count || 0, 10)
    },
    videoCount: row.video_count,
    createdAt: row.created_at
  }));
}

// Owner-only mutations: ownership is part of the WHERE clause, so a non-owner changes nothing.
export async function setVisibility(id, userId, visibility, db = getPool()) {
  if (!VISIBILITIES.includes(visibility)) return null;
  const r = await db.query(
    'UPDATE reports SET visibility = $3 WHERE id = $1 AND user_id = $2 RETURNING id, visibility',
    [id, userId, visibility]
  );
  return r.rows[0] || null;
}

export async function deleteReport(id, userId, db = getPool()) {
  const r = await db.query('DELETE FROM reports WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
  return r.rowCount > 0;
}

// New reports are private unless the schema default says otherwise; userId may be null
// only for system-created reports. Returns the new id, or null (never throws) so a failed
// save cannot discard an analysis the user already waited for.
export async function insertReport({ channel, videoCount, analysis, userId }, db = getPool()) {
  try {
    const r = await db.query(
      `INSERT INTO reports (channel_id, channel_name, channel_handle, channel_thumbnail,
                            subscriber_count, video_count, analysis, user_id, visibility)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'private') RETURNING id`,
      [channel.id, channel.name, channel.handle, channel.thumbnailUrl, channel.subscriberCount,
       videoCount, JSON.stringify(analysis), userId]
    );
    return r.rows[0].id;
  } catch (err) {
    console.error('[insertReport]', err.message);
    return null;
  }
}
