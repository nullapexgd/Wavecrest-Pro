// One shared budget for everything that spends the free AI tier (analyses and Reelcut clip searches).
// The provider's free tier is a hard daily ceiling for ALL users, so past a safe fraction of it we say
// "full today" instead of letting calls fail unpredictably for whoever comes next. Resets at 00:00 UTC.
// KV missing or erroring fails OPEN here: the per-IP limiter and per-account quota still apply, and a
// counter outage should not take the product down.
import { makeKv } from './kv.js';

export const DEFAULT_DAILY_CAP = 30; // the provider's documented ~35 a day, with headroom

const day = (now = new Date()) => now.toISOString().slice(0, 10);
export const nextReset = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();

export function makeCapacity({ kv = makeKv(), cap = Number(process.env.AI_DAILY_CAP) || DEFAULT_DAILY_CAP, now = () => new Date() } = {}) {
  const key = () => `cap:ai:${day(now())}`;
  return {
    /** Takes one unit. Returns {ok:true} or {ok:false, resetsAt}. */
    async take() {
      if (!kv) return { ok: true };
      try {
        const [used] = await kv.run([['INCR', key()], ['EXPIRE', key(), 2 * 86400, 'NX']]);
        if (used > cap) { await kv.run([['DECR', key()]]); return { ok: false, resetsAt: nextReset(now()) }; }
        return { ok: true };
      } catch {
        return { ok: true };
      }
    },
    /** Gives a unit back when the work failed and cost the provider nothing worth counting. */
    async release() {
      if (!kv) return;
      try { await kv.run([['DECR', key()]]); } catch { /* best effort */ }
    },
    async status() {
      if (!kv) return { full: false };
      try {
        const [used] = await kv.run([['GET', key()]]);
        return { full: Number(used ?? 0) >= cap, resetsAt: nextReset(now()) };
      } catch {
        return { full: false };
      }
    }
  };
}

export const CAPACITY_MESSAGE = 'Wavecrest is at its free daily limit. Try again tomorrow (UTC).';
