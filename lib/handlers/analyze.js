// Run an analysis and stream progress as Server-Sent Events.
//
//   POST /api/analyze-stream   {url}            session cookie, same-origin only
//                              Idempotency-Key: <id>   optional; retries with the same key never charge twice
//   GET  /api/analyze-stream?url=…              API key only (Authorization: Bearer wc_live_…)
//
// Policy (docs/wavecrest-3/ASSESSMENT.md): every analysis needs an account. Anonymous
// visitors get the public sample report, never a real run. A cookie-authenticated GET is
// refused because a GET that spends quota can be fired cross-site by any page.
//
// Order matters: authenticate → validate input → atomically RESERVE a run (quota, one in
// flight, idempotency) → only then spend upstream calls. Reservation failures to reach the
// database refuse the request (fail closed); they never let a run through unmetered.
import {
  getUser as realGetUser, getUserByApiKey as realGetUserByApiKey
} from '../auth.js';
import { parseYouTubeInput, resolveChannel as realResolve, fetchVideos as realFetchVideos } from '../youtube.js';
import { runAnalysis as realRunAnalysis } from '../analysis.js';
import { insertReport as realInsertReport, getReportForViewer as realGetReport, toClientReport } from '../reports.js';
import { reserveRun as realReserve, completeRun as realComplete, failRun as realFail } from '../quota.js';
import { entitlementFor } from '../plans.js';
import { UserFacingError, toClientError } from '../errors.js';
import { noStore, jsonBody, isSameOrigin } from '../http.js';

const IDEM_RE = /^[\w-]{8,80}$/;
const HEARTBEAT_MS = 10_000;

export function makeAnalyzeHandler({
  getUser = realGetUser,
  getUserByApiKey = realGetUserByApiKey,
  resolveChannel = realResolve,
  fetchVideos = realFetchVideos,
  runAnalysis = realRunAnalysis,
  insertReport = realInsertReport,
  getReport = realGetReport,
  reserveRun = realReserve,
  completeRun = realComplete,
  failRun = realFail,
  env = process.env,
  deadlineMs = 52_000
} = {}) {
  return async function handler(req, res) {
    noStore(res);

    // ── who is asking ─────────────────────────────────────────────────────────
    const authz = String(req.headers.authorization || '');
    const bearer = authz.startsWith('Bearer ');
    let user = null;
    let input = '';

    if (bearer) {
      if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed(res, 'GET, POST');
      user = await getUserByApiKey(authz.slice(7).trim()).catch(() => null);
      if (!user) return res.status(401).json({ error: 'Invalid or revoked API key', code: 'BAD_API_KEY' });
      input = req.method === 'GET' ? String(req.query.url || '') : String(jsonBody(req).url || '');
    } else {
      if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
      if (!isSameOrigin(req)) return res.status(403).json({ error: 'Cross-site request refused', code: 'CSRF' });
      user = await getUser(req).catch(() => null);
      if (!user) {
        return res.status(401).json({
          error: 'Sign in to run an analysis. The sample report is open to everyone.',
          code: 'AUTH_REQUIRED'
        });
      }
      input = String(jsonBody(req).url || '');
    }

    // ── validate before anything is reserved or spent ─────────────────────────
    const parsed = parseYouTubeInput(input);
    if (!parsed) {
      return res.status(400).json({
        error: 'Paste a channel link like youtube.com/@handle, or a video link.',
        code: 'INVALID_INPUT'
      });
    }
    const idemHeader = req.headers['idempotency-key'];
    if (idemHeader !== undefined && !IDEM_RE.test(String(idemHeader))) {
      return res.status(400).json({ error: 'Invalid Idempotency-Key', code: 'INVALID_INPUT' });
    }
    const { YOUTUBE_API_KEY, GROQ_API_KEY } = env;
    if (!YOUTUBE_API_KEY || !GROQ_API_KEY) {
      console.error('[analyze] missing YOUTUBE_API_KEY or GROQ_API_KEY');
      return res.status(500).json({ error: 'Server isn’t configured yet', code: 'SERVER_MISCONFIGURED' });
    }

    // ── atomic reservation: quota + one-in-flight + idempotency ───────────────
    const entitlement = entitlementFor(user);
    let reservation;
    try {
      reservation = await reserveRun({
        userId: user.id,
        limit: entitlement.analysesPerMonth,
        idemKey: idemHeader ? String(idemHeader) : null,
        channelKey: `${parsed.kind}:${parsed.value}`.slice(0, 120)
      });
    } catch (err) {
      console.error('[analyze] reserveRun failed:', err.message);
      return res.status(503).json({ error: 'Temporarily unavailable. Try again shortly.', code: 'UNAVAILABLE' });
    }

    if (reservation.outcome === 'limit') {
      return res.status(429).json({
        error: entitlement.limit === 1
          ? 'You’ve used this month’s free analysis. It resets on the 1st (UTC).'
          : `Monthly limit reached (${reservation.used}/${reservation.limit}). It resets on the 1st (UTC).`,
        code: 'PLAN_LIMIT',
        used: reservation.used,
        limit: reservation.limit,
        plan: entitlement.plan
      });
    }
    if (reservation.outcome === 'in_progress') {
      return res.status(409).json({ error: 'An analysis is already running for your account.', code: 'IN_PROGRESS' });
    }
    if (reservation.outcome === 'replay') {
      const run = reservation.run;
      if (run.status === 'reserved') {
        return res.status(409).json({ error: 'That analysis is still running.', code: 'IN_PROGRESS' });
      }
      if (run.status === 'failed' || !run.report_id) {
        return res.status(409).json({ error: 'That attempt did not complete. Start a new one.', code: 'PREVIOUS_FAILED' });
      }
      const row = await getReport(run.report_id, user.id).catch(() => null);
      if (!row) return res.status(409).json({ error: 'That report is no longer available.', code: 'PREVIOUS_FAILED' });
      openStream(res);
      send(res, 'done', toClientReport(row, user.id));
      return res.end();
    }

    // ── reserved: from here every exit must complete or refund the run ────────
    const runId = reservation.runId;
    openStream(res);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    const signal = AbortSignal.timeout(deadlineMs);
    let channel = null;
    let settled = false;
    const refund = async () => {
      if (settled) return;
      settled = true;
      await failRun(runId).catch(e => console.error('[analyze] failRun:', e.message));
    };

    try {
      send(res, 'progress', { step: 1, label: 'Fetching channel info' });
      channel = await resolveChannel(input, YOUTUBE_API_KEY, signal);

      send(res, 'progress', { step: 2, label: `Found ${channel.name} · loading videos` });
      const videos = await fetchVideos(channel.uploadsPlaylistId, YOUTUBE_API_KEY, 100, ({ phase, count, total }) => {
        if (phase === 'listing') send(res, 'progress', { step: 2, label: `Found ${channel.name} · loading videos (${count})` });
        else send(res, 'progress', { step: 3, label: `Fetching video stats (${count}/${total})` });
      }, signal);
      if (videos.length < 3) {
        throw new UserFacingError('That channel needs at least 3 public videos.', 'TOO_FEW_VIDEOS', 422);
      }

      send(res, 'progress', { step: 4, label: `${videos.length} videos loaded · running AI analysis` });
      const analysis = await runAnalysis(channel, videos, GROQ_API_KEY, signal);

      send(res, 'progress', { step: 5, label: 'Saving report' });
      // A failed save must not discard the analysis the user waited for: the run still
      // counts (the work was done and delivered), the report just won't be in history.
      const reportId = await insertReport({
        channel, videoCount: videos.length, analysis, userId: user.id
      });
      settled = true;
      await completeRun(runId, reportId).catch(e => console.error('[analyze] completeRun:', e.message));

      send(res, 'done', {
        reportId,
        channel: {
          id: channel.id, name: channel.name, handle: channel.handle,
          subscriberCount: channel.subscriberCount, thumbnailUrl: channel.thumbnailUrl,
          publishedAt: channel.publishedAt
        },
        videoCount: videos.length,
        analysis,
        visibility: 'private',
        isOwner: true,
        createdAt: new Date().toISOString()
      });
    } catch (err) {
      // Detail (upstream bodies, endpoints) stays in the server log; the client gets a fixed message.
      console.error('[analyze]', err.name, err.message, {
        channelId: channel?.id, upstream: err.service, upstreamStatus: err.upstreamStatus,
        reason: err.reason, detail: err.detail
      });
      await refund();
      const { code, message } = toClientError(err);
      send(res, 'fail', { message, code });
    } finally {
      clearInterval(heartbeat);
      await refund(); // no-op once settled
    }
    res.end();
  };
}

function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return res.status(405).json({
    error: allow === 'POST' ? 'Use POST (signed in), or an API key.' : 'Method not allowed',
    code: 'METHOD_NOT_ALLOWED'
  });
}

function openStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
