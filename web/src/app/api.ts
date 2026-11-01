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

/** Remembers a pasted channel across sign-in (a signed cookie that expires in 15 minutes). Best effort. */
export const rememberChannel = (channel: string) =>
  fetch('/api/auth/pending', { ...same, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }) }).then(r => json<{ ok: true }>(r));
export const clearPending = () => fetch('/api/auth/pending', { ...same, method: 'DELETE' }).then(() => undefined);

export const getReport = (id: string) => fetch(`/api/report/${encodeURIComponent(id)}`, same).then(r => json<Report>(r));

export const sendFeedback = (useful: 'yes' | 'no', message: string, reportId?: string) =>
  fetch('/api/feedback', {
    ...same, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ useful, message, reportId })
  }).then(r => json<{ ok: true }>(r));

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

// One key per (channel, attempt). It is kept while an attempt might still be running on the
// server (a dropped connection), so retrying replays that run instead of reserving another.
const norm = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
const slot = (u: string) => `wc-attempt:${norm(u)}`;
export function attemptKey(url: string): string {
  try {
    const saved = JSON.parse(sessionStorage.getItem(slot(url)) ?? 'null');
    if (saved && Date.now() - saved.at < 10 * 60_000) return saved.key;
  } catch { /* storage unavailable: fall through to a fresh key */ }
  const key = crypto.randomUUID();
  try { sessionStorage.setItem(slot(url), JSON.stringify({ key, at: Date.now() })); } catch { /* ignore */ }
  return key;
}
export function forgetAttempt(url: string): void {
  try { sessionStorage.removeItem(slot(url)); } catch { /* ignore */ }
}
