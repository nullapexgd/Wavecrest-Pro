export interface Clip { start: number; end: number; title: string; hook: string; reason: string }
export class ReelcutError extends Error {
  constructor(message: string, public code: string, public status: number, public resetsAt?: string) { super(message); }
}

async function call<T>(body: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch('/api/reelcut', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new ReelcutError('Could not reach Wavecrest. Check your connection and try again.', 'NETWORK', 0);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ReelcutError(j.error ?? 'Something went wrong. Try again in a moment.', j.code ?? 'ERROR', r.status, j.resetsAt);
  return j as T;
}

export const api = {
  start: () => call<{ runId: string; remaining: number; parts: number }>({ action: 'start' }),
  refund: (runId: string) => call<{ ok: true }>({ action: 'refund', runId }).catch(() => undefined), // best effort: a failed refund must not hide the real error
  pick: (runId: string, chunks: { start: number; end: number; text: string }[], instructions: string) =>
    call<{ clips: Clip[] }>({ action: 'pick', runId, chunks, instructions }).then(r => r.clips)
};
