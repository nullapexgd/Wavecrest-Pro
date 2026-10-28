// Atomic analysis quota, concurrency and retry handling. Provider-independent: it only
// knows a user id and a numeric monthly limit (lib/plans.js entitlementFor).
//
// reserveRun() runs inside one transaction holding a per-user advisory lock, so N parallel
// requests are serialized and exactly `limit` of them can ever reserve. It also gives:
//   - idempotent retry   same (user, idemKey) never reserves twice; it replays the first run
//   - one at a time      a second analysis while one is in flight is refused, not queued
//   - dead-run expiry    a reservation older than STALE_AFTER_S (function crashed/timed out)
//                        is marked failed and stops counting against the user
//   - refunds            failed runs do not count
import { getPool } from './db.js';

export const STALE_AFTER_S = 120;

/**
 * @returns {Promise<
 *   {outcome:'reserved', runId:string} |
 *   {outcome:'replay', run:{id:string,status:string,report_id:string|null}} |
 *   {outcome:'in_progress'} |
 *   {outcome:'limit', used:number, limit:number}
 * >}
 */
export async function reserveRun(
  { userId, limit, idemKey = null, channelKey = null, now = new Date() },
  db = getPool()
) {
  const client = await db.connect();
  const at = now.toISOString();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))', [userId]);

    if (idemKey) {
      const prev = await client.query(
        'SELECT id, status, report_id FROM analysis_runs WHERE user_id = $1 AND idem_key = $2',
        [userId, idemKey]
      );
      if (prev.rows[0]) {
        await client.query('COMMIT');
        return { outcome: 'replay', run: prev.rows[0] };
      }
    }

    await client.query(
      `UPDATE analysis_runs SET status = 'failed', finished_at = $2::timestamptz
       WHERE user_id = $1 AND status = 'reserved'
         AND created_at < $2::timestamptz - make_interval(secs => $3)`,
      [userId, at, STALE_AFTER_S]
    );

    const live = await client.query(
      "SELECT 1 FROM analysis_runs WHERE user_id = $1 AND status = 'reserved' LIMIT 1",
      [userId]
    );
    if (live.rowCount > 0) {
      await client.query('COMMIT');
      return { outcome: 'in_progress' };
    }

    if (Number.isFinite(limit)) {
      const used = await client.query(
        `SELECT count(*)::int AS n FROM analysis_runs
         WHERE user_id = $1 AND status IN ('reserved', 'succeeded')
           AND (created_at AT TIME ZONE 'utc') >= date_trunc('month', $2::timestamptz AT TIME ZONE 'utc')`,
        [userId, at]
      );
      if (used.rows[0].n >= limit) {
        await client.query('COMMIT');
        return { outcome: 'limit', used: used.rows[0].n, limit };
      }
    }

    const ins = await client.query(
      `INSERT INTO analysis_runs (user_id, idem_key, channel_key, status, created_at)
       VALUES ($1, $2, $3, 'reserved', $4::timestamptz) RETURNING id`,
      [userId, idemKey, channelKey, at]
    );
    await client.query('COMMIT');
    return { outcome: 'reserved', runId: ins.rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Backstop: the unique index on (user_id, idem_key) refused a second row for the same
    // key. With the lock held that cannot happen; if it ever does, it is a replay, not a failure.
    if (err.code === '23505' && idemKey) {
      const prev = await client.query(
        'SELECT id, status, report_id FROM analysis_runs WHERE user_id = $1 AND idem_key = $2',
        [userId, idemKey]
      );
      if (prev.rows[0]) return { outcome: 'replay', run: prev.rows[0] };
    }
    throw err;
  } finally {
    client.release();
  }
}

// Only a run that is still 'reserved' can finish; an expired one stays failed.
export async function completeRun(runId, reportId, db = getPool()) {
  const r = await db.query(
    `UPDATE analysis_runs SET status = 'succeeded', report_id = $2, finished_at = now()
     WHERE id = $1 AND status = 'reserved'`,
    [runId, reportId]
  );
  return r.rowCount > 0;
}

export async function failRun(runId, db = getPool()) {
  const r = await db.query(
    "UPDATE analysis_runs SET status = 'failed', finished_at = now() WHERE id = $1 AND status = 'reserved'",
    [runId]
  );
  return r.rowCount > 0;
}

export async function getUsage(userId, now = new Date(), db = getPool()) {
  const r = await db.query(
    `SELECT count(*)::int AS used FROM analysis_runs
     WHERE user_id = $1 AND status IN ('reserved', 'succeeded')
       AND (created_at AT TIME ZONE 'utc') >= date_trunc('month', $2::timestamptz AT TIME ZONE 'utc')`,
    [userId, now.toISOString()]
  );
  return r.rows[0].used;
}
