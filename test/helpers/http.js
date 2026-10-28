// Minimal req/res doubles for exercising the real handlers without a server.
import { createSessionValue } from '../../lib/auth.js';

process.env.SESSION_SECRET ??= 'test-secret-do-not-use-in-prod';

export function makeReq({ method = 'GET', query = {}, body, headers = {}, userId = null, bearer = null } = {}) {
  const h = { host: 'wavecrest.test', ...headers };
  if (userId) h.cookie = `wc_session=${createSessionValue(userId)}`;
  if (bearer) h.authorization = `Bearer ${bearer}`;
  return { method, query, body, headers: h };
}

export function makeRes() {
  const res = {
    statusCode: 200, headers: {}, chunks: [], ended: false, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.ended = true; return this; },
    flushHeaders() {},
    write(s) { this.chunks.push(String(s)); return true; },
    end() { this.ended = true; return this; },
    redirect(code, url) { this.statusCode = code; this.headers.location = url; this.ended = true; return this; },
    // Parsed SSE events written to the stream
    events() {
      return this.chunks.join('').split('\n\n').filter(e => e.startsWith('event:')).map(e => {
        const [, name] = e.match(/^event: (.+)$/m);
        const [, data] = e.match(/^data: (.+)$/m);
        return { name, data: JSON.parse(data) };
      });
    }
  };
  return res;
}

// Everything a client could ever read from a response, as one string, for leak assertions.
export function everythingSent(res) {
  return JSON.stringify(res.body ?? '') + res.chunks.join('');
}
