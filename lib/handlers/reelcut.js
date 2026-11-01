// POST /api/reelcut  { action: 'start' }               -> reserve one of the weekly browser runs
//                    { action: 'refund', runId }        -> give it back after a failure
//                    { action: 'status' }               -> how many are left this week
//                    { action: 'pick', runId, chunks, instructions?, minSec?, maxSec? } -> 3-5 clips from a transcript (text only)
// Signed-in, same-origin only. The video never leaves the user's device; this only counts runs.
import { getUser as realGetUser } from '../auth.js';
import { jsonBody, noStore, isSameOrigin, UUID_RE } from '../http.js';
import { makeKv } from '../kv.js';
import { planFor } from '../plans.js';
import { makeReelcutQuota } from '../reelcut-quota.js';
import { reportError } from '../monitor.js';
import { makeCapacity, CAPACITY_MESSAGE } from '../capacity.js';
import { toClientError, UserFacingError } from '../errors.js';
import { pickClips as realPickClips, cleanTranscript } from '../reelcut-pick.js';

export function makeReelcutHandler({ getUser = realGetUser, quota, db, pickClips = realPickClips, capacity = makeCapacity() } = {}) {
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
        if (r.ok) return res.status(200).json({ runId: r.runId, remaining: r.remaining, parts: planFor(user).reelcutParts });
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
      if (body.action === 'pick') {
        if (typeof body.runId !== 'string' || !UUID_RE.test(body.runId)) return res.status(400).json({ error: 'Valid runId required', code: 'INVALID_INPUT' });
        cleanTranscript(body.chunks); // a malformed or oversized transcript is refused without using up one of the run's searches
        const t = await q.takePick(user.id, body.runId, planFor(user).reelcutParts);
        if (!t.ok) {
          if (t.reason === 'NO_RUN') return res.status(409).json({ error: 'Start a Reelcut run first.', code: 'NO_RUN' });
          if (t.reason === 'LIMIT') return res.status(429).json({ error: 'That run has used its clip searches.', code: 'PICK_LIMIT' });
          return res.status(503).json({ error: 'Reelcut is not available right now', code: 'UNAVAILABLE' });
        }
        const slot = await capacity.take();
        if (!slot.ok) return res.status(503).json({ error: CAPACITY_MESSAGE, code: 'CAPACITY', resetsAt: slot.resetsAt });
        try {
          return res.status(200).json({ clips: await pickClips(body.chunks, body) });
        } catch (e) {
          await capacity.release();
          throw e;
        }
      }
      return res.status(400).json({ error: 'Unknown action', code: 'INVALID_INPUT' });
    } catch (err) {
      if (err instanceof UserFacingError) return res.status(err.status).json({ error: err.message, code: err.code });
      console.error('[reelcut]', err.message, err.detail ?? '');
      await reportError(err, 'reelcut');
      if (err?.name === 'UpstreamError' || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        const c = toClientError(err);
        return res.status(502).json({ error: c.message, code: c.code });
      }
      return res.status(500).json({ error: 'Something went wrong. Try again in a moment.', code: 'SERVER_ERROR' });
    }
  };
}
