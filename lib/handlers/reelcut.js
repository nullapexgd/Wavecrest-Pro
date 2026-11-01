// POST /api/reelcut  { action: 'start' }               -> reserve one of the weekly browser runs
//                    { action: 'refund', runId }        -> give it back after a failure
//                    { action: 'status' }               -> how many are left this week
// Signed-in, same-origin only. The video never leaves the user's device; this only counts runs.
import { getUser as realGetUser } from '../auth.js';
import { jsonBody, noStore, isSameOrigin, UUID_RE } from '../http.js';
import { makeKv } from '../kv.js';
import { makeReelcutQuota } from '../reelcut-quota.js';
import { reportError } from '../monitor.js';

export function makeReelcutHandler({ getUser = realGetUser, quota, db } = {}) {
  return async function handler(req, res) {
    noStore(res);
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }); }
    if (!isSameOrigin(req)) return res.status(403).json({ error: 'Cross-site request refused', code: 'FORBIDDEN' });
    try {
      const user = await getUser(req, db).catch(() => null);
      if (!user) return res.status(401).json({ error: 'Sign in to use Reelcut', code: 'AUTH_REQUIRED' });
      const q = quota ?? makeReelcutQuota({ kv: makeKv() });
      const body = jsonBody(req);

      if (body.action === 'start') {
        const r = await q.reserve(user.id);
        if (r.ok) return res.status(200).json({ runId: r.runId, remaining: r.remaining });
        if (r.reason === 'LIMIT') {
          const s = await q.status(user.id);
          return res.status(429).json({ error: 'You have used this week\'s Reelcut videos.', code: 'QUOTA_EXCEEDED', resetsAt: s?.resetsAt });
        }
        return res.status(503).json({ error: 'Reelcut is not available right now', code: 'UNAVAILABLE' });
      }
      if (body.action === 'refund') {
        if (typeof body.runId !== 'string' || !UUID_RE.test(body.runId)) return res.status(400).json({ error: 'Valid runId required', code: 'INVALID_INPUT' });
        const r = await q.refund(user.id, body.runId);
        return r.ok ? res.status(200).json({ ok: true }) : res.status(503).json({ error: 'Reelcut is not available right now', code: 'UNAVAILABLE' });
      }
      if (body.action === 'status') {
        const s = await q.status(user.id);
        return s ? res.status(200).json(s) : res.status(503).json({ error: 'Reelcut is not available right now', code: 'UNAVAILABLE' });
      }
      return res.status(400).json({ error: 'Unknown action', code: 'INVALID_INPUT' });
    } catch (err) {
      console.error('[reelcut]', err.message);
      await reportError(err, 'reelcut');
      return res.status(500).json({ error: 'Something went wrong. Try again in a moment.', code: 'SERVER_ERROR' });
    }
  };
}
