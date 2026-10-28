// Small request/response helpers shared by the API handlers.

export function noStore(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie, Authorization');
}

export function jsonBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  return body && typeof body === 'object' ? body : {};
}

// CSRF defence for cookie-authenticated, state-changing requests. SameSite=Lax already
// blocks cross-site POSTs; this refuses anything the browser marks as cross-site, and
// any Origin that is not this host, as a second layer.
export function isSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client or same-origin GET-style navigation
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function sendJson(res, status, body) {
  return res.status(status).json(body);
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
