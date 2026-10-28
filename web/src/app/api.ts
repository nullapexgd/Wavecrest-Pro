// The only module that talks to the server. Every failure becomes an ApiError with the
// server's stable `code`, so the UI can show a designed state per code instead of a string.
import type { Me, Report, ReportListItem } from './types.ts';

export class ApiError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status; this.code = code; this.extra = extra;
  }
}

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body.code ?? 'ERROR', body.error ?? 'Something went wrong', body);
  return body as T;
}

const same = { credentials: 'same-origin' as const };

/** null when signed out. Anything else that fails is a real error. */
export async function me(): Promise<Me | null> {
  const r = await fetch('/api/auth/me', same);
  if (r.status === 401) return null;
  return json<Me>(r);
}

export const getReport = (id: string) => fetch(`/api/report/${encodeURIComponent(id)}`, same).then(r => json<Report>(r));

export const listReports = () =>
  fetch('/api/reports', same).then(r => json<{ reports: ReportListItem[] }>(r)).then(b => b.reports);

export const setVisibility = (id: string, visibility: 'private' | 'link') =>
  fetch(`/api/report/${encodeURIComponent(id)}`, {
    ...same, method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visibility })
  }).then(r => json<{ visibility: 'private' | 'link' }>(r));

export const deleteReport = (id: string) =>
  fetch(`/api/report/${encodeURIComponent(id)}`, { ...same, method: 'DELETE' }).then(r => json<{ ok: true }>(r));

export const logout = () => fetch('/api/auth/logout', { ...same, method: 'POST' });

export interface RunHandlers {
  onProgress(step: number, label: string): void;
}

/**
 * Starts an analysis and resolves with the finished report.
 *
 * POST + stream reader (EventSource cannot POST). One Idempotency-Key per attempt: a retry of
 * the SAME attempt can never be charged twice, a new attempt gets a new key. Refusals
 * (401, 409, 429, 503...) arrive as JSON before the stream opens; failures after it opens
 * arrive as a `fail` event.
 */
export async function analyze(url: string, key: string, h: RunHandlers): Promise<Report> {
  const r = await fetch('/api/analyze-stream', {
    ...same, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ url })
  });
  if (!(r.headers.get('content-type') ?? '').includes('text/event-stream')) return json<Report>(r);
  if (!r.body) throw new ApiError(502, 'NO_STREAM', 'The connection closed early.');

  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let cut: number;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const ev = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (!ev || !data) continue; // heartbeat comment
      const body = JSON.parse(data);
      if (ev === 'progress') h.onProgress(body.step, body.label);
      else if (ev === 'done') return body as Report;
      else if (ev === 'fail') throw new ApiError(502, body.code ?? 'FAILED', body.message ?? 'The analysis failed.');
    }
  }
  throw new ApiError(502, 'NO_RESULT', 'The connection closed before the report arrived.');
}

export const newAttemptKey = () => crypto.randomUUID();
