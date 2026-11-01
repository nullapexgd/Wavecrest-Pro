// Weekly cap on browser Reelcut runs, one counter per user per UTC week (Monday start) in Upstash KV.
// Only counting happens here; the video never reaches the server. Fails closed: with no KV or a KV
// error nothing is reserved, because a run that cannot be counted must not be allowed.
import { randomUUID } from 'node:crypto';

export const REELCUT_WEEKLY_LIMIT = 3;
export const PICKS_PER_RUN = 3; // a run may re-pick clips a couple of times, not without end
const KEEP_SECS = 9 * 86400; // a week plus slack so a late refund still finds its run

/** `2026-W44` style key for the UTC week containing `now` (ISO 8601 weeks). */
export function weekKey(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow); // Thursday decides the ISO year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function resetsAt(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + (8 - (d.getUTCDay() || 7)));
  return d.toISOString();
}

export function makeReelcutQuota({ kv, limit = REELCUT_WEEKLY_LIMIT, now = () => new Date(), newId = randomUUID }) {
  const counter = userId => `reelcut:${weekKey(now())}:${userId}`;
  const runKey = (userId, runId) => `${counter(userId)}:run:${runId}`;

  return {
    /** Reserve one run. Returns {ok:true, runId, remaining} or {ok:false, reason:'LIMIT'|'UNAVAILABLE'}. */
    async reserve(userId) {
      if (!kv) return { ok: false, reason: 'UNAVAILABLE' };
      try {
        const key = counter(userId);
        const [used] = await kv.run([['INCR', key], ['EXPIRE', key, KEEP_SECS, 'NX']]);
        if (used > limit) {
          await kv.run([['DECR', key]]); // give back the slot this denied request took
          return { ok: false, reason: 'LIMIT' };
        }
        const runId = newId();
        await kv.run([['SET', runKey(userId, runId), '1', 'EX', KEEP_SECS]]);
        return { ok: true, runId, remaining: limit - used };
      } catch {
        return { ok: false, reason: 'UNAVAILABLE' };
      }
    },

    /** Give a run back after a failure. Safe to call twice: only a run that still exists is refunded. */
    async refund(userId, runId) {
      if (!kv) return { ok: false };
      try {
        const [deleted] = await kv.run([['DEL', runKey(userId, runId)]]);
        if (deleted === 1) await kv.run([['DECR', counter(userId)]]);
        return { ok: true, refunded: deleted === 1 };
      } catch {
        return { ok: false };
      }
    },

    /**
     * Count one clip-picking call against a run this user really reserved. Without a live run id there is
     * no call, so the model cannot be spent on by someone who never started a run.
     */
    async takePick(userId, runId) {
      if (!kv) return { ok: false, reason: 'UNAVAILABLE' };
      try {
        const [live] = await kv.run([['GET', runKey(userId, runId)]]);
        if (live == null) return { ok: false, reason: 'NO_RUN' };
        const key = `${runKey(userId, runId)}:picks`;
        const [n] = await kv.run([['INCR', key], ['EXPIRE', key, KEEP_SECS, 'NX']]);
        return n > PICKS_PER_RUN ? { ok: false, reason: 'LIMIT' } : { ok: true };
      } catch {
        return { ok: false, reason: 'UNAVAILABLE' };
      }
    },

    async status(userId) {
      if (!kv) return null;
      try {
        const [used] = await kv.run([['GET', counter(userId)]]);
        const n = Math.max(0, Math.min(limit, Number(used ?? 0)));
        return { limit, used: n, remaining: limit - n, resetsAt: resetsAt(now()) };
      } catch {
        return null;
      }
    }
  };
}
