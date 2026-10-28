import snapshot from './creators.json';
import { buildModel, type Creator, type Model, type RawVideo } from './model';

/** The saved public-feed snapshot: always available, offline, no key. */
export const CREATORS = snapshot.creators as Creator[];
export const SNAPSHOT_DATE = snapshot.snapshot;

export const byHandle = (handle: string) => CREATORS.find(c => c.handle.toLowerCase() === handle.toLowerCase());

/** A creator other than `not`, chosen at random. Optionally from one tier only. */
export function randomCreator(not?: string): Creator {
  const pool = CREATORS.filter(c => c.handle !== not);
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export const fromSnapshot = (c: Creator): Model => buildModel(c, c.videos, 'feed', SNAPSHOT_DATE);

interface LiveBody { fetchedAt: string; videos: RawVideo[] }

const live = new Map<string, Model | null>();

/**
 * Richer data from our own cached endpoint (up to 48 uploads, from the YouTube Data API).
 * Resolves to null on any problem: the snapshot is then simply the answer. Waits at most
 * `ms`, so a slow network never holds up the first picture.
 */
export async function fromLive(c: Creator, ms = 1200): Promise<Model | null> {
  if (live.has(c.handle)) return live.get(c.handle) ?? null;
  try {
    const r = await fetch(`/api/sample-creator?id=${encodeURIComponent(c.handle)}`, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(String(r.status));
    const body = (await r.json()) as LiveBody;
    if (!Array.isArray(body.videos) || body.videos.length < 16) throw new Error('too few');
    const m = buildModel(c, body.videos, 'api', body.fetchedAt.slice(0, 10));
    live.set(c.handle, m);
    return m;
  } catch {
    live.set(c.handle, null);
    return null;
  }
}
