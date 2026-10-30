// Error reporting to Sentry's envelope endpoint over plain fetch (no SDK: serverless functions freeze after the
// response, so the send is awaited, with a short timeout). A no-op unless SENTRY_DSN is set. Only the error
// name/message, route and release are sent: never request bodies, upstream `detail`, users, emails or IPs.
import { randomBytes } from 'node:crypto';
import { UserFacingError } from './errors.js';

export async function reportError(err, route, { dsn = process.env.SENTRY_DSN, fetchImpl = globalThis.fetch } = {}) {
  if (!dsn || err instanceof UserFacingError) return;
  try {
    const u = new URL(dsn), project = u.pathname.replace(/^\/+/, '');
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    const event = {
      event_id: randomBytes(16).toString('hex'),
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: timeout ? 'warning' : 'error',
      environment: process.env.VERCEL_ENV || 'development',
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      tags: { route, service: err?.service, upstream_status: err?.upstreamStatus },
      exception: { values: [{ type: err?.name || 'Error', value: String(err?.message ?? err).slice(0, 300) }] }
    };
    const body = [{ event_id: event.event_id, sent_at: new Date().toISOString() }, { type: 'event' }, event].map(x => JSON.stringify(x)).join('\n');
    await fetchImpl(`${u.protocol}//${u.host}/api/${project}/envelope/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=wavecrest/1` },
      body,
      signal: AbortSignal.timeout(1500)
    });
  } catch { /* monitoring must never break a request */ }
}
