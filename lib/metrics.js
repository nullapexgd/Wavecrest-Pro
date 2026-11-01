// Counts only: how many pasted a channel, signed in, started and finished a run, per UTC day. No ids, no
// emails, no channels. Best effort: a counter failure must never affect the request it counts.
import { makeKv } from './kv.js';

export const EVENTS = ['paste', 'signin', 'started', 'completed', 'capacity_full'];
const day = (now = new Date()) => now.toISOString().slice(0, 10);

export function makeMetrics({ kv = makeKv(), now = () => new Date() } = {}) {
  return {
    async count(name) {
      if (!kv || !EVENTS.includes(name)) return;
      try {
        const key = `m:${day(now())}:${name}`;
        await kv.run([['INCR', key], ['EXPIRE', key, 40 * 86400, 'NX']]);
      } catch { /* best effort */ }
    },
    /** {day: {event: n}} for the last `days` days, newest first. */
    async read(days = 7) {
      if (!kv) return null;
      const dates = Array.from({ length: days }, (_, i) => day(new Date(now().getTime() - i * 86400000)));
      try {
        const vals = await kv.run(dates.flatMap(d => EVENTS.map(e => ['GET', `m:${d}:${e}`])));
        return Object.fromEntries(dates.map((d, i) => [d, Object.fromEntries(EVENTS.map((e, j) => [e, Number(vals[i * EVENTS.length + j] ?? 0)]))]));
      } catch {
        return null;
      }
    }
  };
}
