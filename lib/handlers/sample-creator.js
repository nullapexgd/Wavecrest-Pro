// GET /api/sample-creator?id=<handle> : recent public uploads of one real creator, for the
// public homepage chart. This is the only anonymous route that can spend YouTube quota, so it
// is built to be unable to exhaust the key, in layers that each hold on their own:
//
//   1. allowlist   only the ids in lib/sample-creators.json; no URL or handle is ever accepted
//   2. cache       6 h fresh + 7 d stale in KV, and a CDN cache header on top
//   3. lock        one refresh at a time per creator, so a burst of misses is one fetch
//   4. budget      a global per-day counter of quota units; over it, nothing calls YouTube
//   5. fail closed no KV (so no cache, lock or budget) means no YouTube call at all
//
// Worst case with the defaults: 16 creators x 4 refreshes a day x 2 units = 128 units a day,
// capped at SAMPLE_YT_DAILY_UNITS (default 300) of the key's 10,000 free daily units. The
// per-IP limit in middleware.js is an extra brake, not the protection.
import SAMPLE_CREATORS from '../sample-creators.json' with { type: 'json' };
import { fetchVideos as realFetchVideos } from '../youtube.js';
import { makeKv } from '../kv.js';

const FRESH_S = 6 * 3600;
const STALE_S = 7 * 86400;
const LOCK_S = 20;
const UNITS_PER_REFRESH = 2; // playlistItems (1 page) + videos (1 page) at 50 uploads
const MAX_UPLOADS = 48;
const SHORT_MAX_SECONDS = 180;

export function makeSampleCreatorHandler({
  kv: kvOpt, fetchVideos = realFetchVideos, creators = SAMPLE_CREATORS, now = Date.now, env = process.env
} = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
    }
    const id = req.query?.id;
    if (typeof id !== 'string' || !Object.hasOwn(creators, id)) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'Unknown creator', code: 'UNKNOWN_CREATOR' });
    }

    const unavailable = (retry = 0) => {
      res.setHeader('Cache-Control', 'no-store');
      if (retry) res.setHeader('Retry-After', String(retry));
      return res.status(503).json({ error: 'Live sample data is unavailable right now', code: 'SAMPLE_UNAVAILABLE' });
    };
    const ok = body => {
      res.setHeader('Cache-Control', `public, s-maxage=${FRESH_S}, stale-while-revalidate=86400`);
      return res.status(200).json(body);
    };

    const kv = kvOpt !== undefined ? kvOpt : makeKv();
    if (!kv) return unavailable(); // layer 5: no cache or budget, so no YouTube call

    const freshKey = `sc:v1:${id}`;
    const staleKey = `sc:v1:stale:${id}`;
    const lockKey = `sc:v1:lock:${id}`;
    try {
      const [fresh, stale] = await kv.run([['GET', freshKey], ['GET', staleKey]]);
      if (fresh) return ok(JSON.parse(fresh));
      const serveStale = () => (stale ? ok({ ...JSON.parse(stale), stale: true }) : unavailable(2));

      const [locked] = await kv.run([['SET', lockKey, '1', 'NX', 'EX', LOCK_S]]);
      if (locked !== 'OK') return serveStale(); // someone else is already refreshing

      try {
        const cap = Number.parseInt(env.SAMPLE_YT_DAILY_UNITS, 10) || 300;
        const day = new Date(now()).toISOString().slice(0, 10);
        const budgetKey = `sc:v1:units:${day}`;
        const [used] = await kv.run([['INCRBY', budgetKey, UNITS_PER_REFRESH], ['EXPIRE', budgetKey, 172800, 'NX']]);
        if (used > cap) {
          console.warn('[sample-creator] daily unit budget reached');
          return serveStale();
        }
        const apiKey = env.YOUTUBE_API_KEY;
        if (!apiKey) return serveStale();

        let videos;
        try {
          videos = await fetchVideos(`UU${creators[id].slice(2)}`, apiKey, MAX_UPLOADS, () => {}, AbortSignal.timeout(8000));
        } catch (err) {
          // Log the error kind only. The request URL carries the key, so never log more.
          console.error('[sample-creator] upstream failed:', err?.name, err?.upstreamStatus ?? '');
          return serveStale();
        }
        const body = {
          id,
          fetchedAt: new Date(now()).toISOString(),
          source: 'YouTube Data API',
          videos: videos
            .map(v => ({
              id: v.id, title: v.title, published: v.publishedAt.slice(0, 10),
              views: v.viewCount, likes: v.likeCount, duration: v.duration, short: v.duration <= SHORT_MAX_SECONDS
            }))
            .sort((a, b) => a.published.localeCompare(b.published))
        };
        await kv.run([['SET', freshKey, JSON.stringify(body), 'EX', FRESH_S], ['SET', staleKey, JSON.stringify(body), 'EX', STALE_S]]);
        return ok(body);
      } finally {
        await kv.run([['DEL', lockKey]]).catch(() => {});
      }
    } catch (err) {
      console.error('[sample-creator]', err?.message);
      return unavailable();
    }
  };
}
