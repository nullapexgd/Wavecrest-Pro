// Vercel Edge Middleware — runs in V8 isolate before the serverless fn.
// Per-IP rate limiting backed by Upstash Redis (KV REST API).
//
// Limits: /api/analyze-stream 20/hr per IP, a brake against floods. The real cost control
//         is the per-ACCOUNT atomic quota in lib/quota.js; this only has to be loose
//         enough not to lock out several real users behind one shared IP (office, carrier NAT).
//         Both GET (API key) and POST (signed-in browser) are counted.
//         /api/subscribe      3/hr (sends 2 Resend emails per call).
//         /api/feedback       10/hr (sends 1 Resend email per call).
//
// KV env vars missing: fail OPEN in dev/preview so local work isn't blocked,
// fail CLOSED in production for analyze-stream (misconfig must not expose
// unmetered LLM spend). Transient KV errors always fail open.

const LIMITS = {
  '/api/analyze-stream': { max: 20, windowSecs: 3600, methods: ['GET', 'POST'] },
  '/api/subscribe':      { max: 3,  windowSecs: 3600, methods: ['POST'] },
  '/api/feedback':       { max: 10, windowSecs: 3600, methods: ['POST'] },
  // Public and cacheable, so this is only a brake. The key is protected by the allowlist,
  // cache, lock and daily unit budget inside the handler (lib/handlers/sample-creator.js).
  '/api/sample-creator': { max: 60, windowSecs: 3600, methods: ['GET'] }
};

export const config = {
  matcher: ['/api/analyze-stream', '/api/subscribe', '/api/feedback', '/api/sample-creator']
};

export default async function middleware(request) {
  const { pathname } = new URL(request.url);
  const limit = LIMITS[pathname];
  if (!limit || !limit.methods.includes(request.method)) return;

  const { KV_REST_API_URL, KV_REST_API_TOKEN } = process.env;
  if (!KV_REST_API_URL || !KV_REST_API_TOKEN) {
    if (process.env.VERCEL_ENV === 'production' && pathname === '/api/analyze-stream') {
      console.error('[middleware] KV env vars missing in production — failing closed');
      return json({ error: 'Service temporarily unavailable', code: 'RATE_LIMITER_DOWN' }, 503);
    }
    return; // dev/preview: fail open
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || request.headers.get('x-real-ip')
    || 'unknown';

  const key = `rl:${pathname}:${ip}`;

  // Atomic pipeline: INCR key, then set EXPIRE only if key is new (NX flag)
  const r = await fetch(`${KV_REST_API_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_REST_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, limit.windowSecs, 'NX']
    ])
  }).catch(() => null);

  if (!r || !r.ok) return; // transient KV error — fail open

  const results = await r.json();
  const count = results[0]?.result ?? 0;

  if (count > limit.max) {
    return json(
      { error: `Rate limit: ${limit.max} requests per hour`, code: 'RATE_LIMITED' },
      429,
      {
        'Retry-After': String(limit.windowSecs),
        'X-RateLimit-Limit': String(limit.max),
        'X-RateLimit-Remaining': '0'
      }
    );
  }
}

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
