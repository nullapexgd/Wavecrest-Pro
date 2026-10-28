// One model per creator. It feeds the 3D relief, the static posters and the flat chart, so
// they cannot disagree. Everything here is OBSERVED public data (title, date, views, likes,
// Short or not) or CALCULATED from it (median, multiples of the median, crests). Nothing is
// invented. Kept to erasable TypeScript so Node can import it for the build-time posters.

export interface RawVideo {
  id: string;
  title: string;
  /** YYYY-MM-DD */
  published: string;
  views: number;
  likes: number;
  short: boolean;
}

export interface Creator {
  handle: string;
  name: string;
  tier: 'known' | 'niche';
  videos: RawVideo[];
}

export interface Video {
  id: string;
  index: number;
  /** position along time, 0..1 (oldest to newest) */
  u: number;
  /** position across the tile, 0..1: likes per view when known, otherwise spread evenly */
  v: number;
  date: string;
  title: string;
  short: boolean;
  views: number;
  likes: number;
  /** likes per view, or null when the feed gave no likes */
  likeRate: number | null;
  /** views divided by the channel median */
  rel: number;
  /** bump height before normalisation (compressed above ~11x so one hit cannot flatten the rest) */
  amp: number;
  crest: boolean;
}

export interface Field {
  nx: number;
  nz: number;
  /** height 0..1 per vertex, row-major (z rows, x columns) */
  h: Float32Array;
  /** d(height)/d(world x) and d(height)/d(world z) per vertex */
  gx: Float32Array;
  gz: Float32Array;
  /** height of the crest threshold, so the shader can paint crests */
  crestH: number;
}

export interface Model {
  creator: { handle: string; name: string; tier: 'known' | 'niche' };
  /** where the numbers came from: the saved public feed, or the live YouTube Data API */
  source: 'feed' | 'api';
  /** YYYY-MM-DD the numbers were read */
  asOf: string;
  videos: Video[];
  crests: Video[];
  /** the crests that get a printed label on the chart (the strongest few) */
  labelled: Video[];
  crestRel: number;
  maxRel: number;
  minRel: number;
  sigma: { u: number; v: number };
  field: Field;
  stats: { count: number; medianViews: number; from: string; to: string; shorts: number };
}

export const WORLD = { w: 4.8, d: 3.0, amp: 0.95, skirt: 0.3 } as const;
export const GRID = { nx: 144, nz: 96 } as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
export function formatMonth(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export function formatViews(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
export function formatMultiple(rel: number): string {
  if (rel >= 10 || Math.abs(rel - Math.round(rel)) < 0.05) return `${Math.round(rel)}x`;
  return `${rel.toFixed(1)}x`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ampFor = (rel: number) => Math.min(1.2, 0.19 * Math.pow(rel, 0.72));

export function buildModel(
  creator: { handle: string; name: string; tier: 'known' | 'niche' },
  raw: RawVideo[],
  source: 'feed' | 'api',
  asOf: string
): Model {
  const sorted = [...raw].filter(v => v.views > 0).sort((a, b) => a.published.localeCompare(b.published));
  const n = sorted.length;
  const med = median(sorted.map(v => v.views));
  const t0 = Date.parse(sorted[0]!.published);
  const t1 = Date.parse(sorted[n - 1]!.published);

  // Likes per view decides front-to-back placement when most uploads report likes; otherwise
  // the tile is spread evenly so nothing is implied by an axis we do not have.
  const haveLikes = sorted.filter(v => v.likes > 0).length >= n * 0.7;
  const rank = [...sorted.keys()].sort((a, b) => (sorted[a]!.likes / sorted[a]!.views) - (sorted[b]!.likes / sorted[b]!.views));
  const rankOf = new Map(rank.map((k, r) => [k, r]));

  const videos: Video[] = sorted.map((r, i) => {
    const rel = r.views / med;
    const likeRate = r.likes > 0 ? r.likes / r.views : null;
    const spread = ((i * 0.6180339887) % 1);
    return {
      id: r.id, index: i,
      u: t1 === t0 ? 0.5 : 0.045 + 0.91 * ((Date.parse(r.published) - t0) / (t1 - t0)),
      v: haveLikes ? 0.14 + 0.72 * ((rankOf.get(i) as number) / Math.max(1, n - 1)) : 0.16 + 0.68 * spread,
      date: r.published, title: r.title, short: r.short, views: r.views, likes: r.likes, likeRate,
      rel, amp: ampFor(rel), crest: false
    };
  });

  // Crest line: 2x the median when at least two uploads reach it, otherwise the second best.
  const byRel = [...videos].sort((a, b) => b.rel - a.rel);
  const crestRel = byRel.filter(v => v.rel >= 2).length >= 2 ? 2 : Math.max(1.1, (byRel[1] as Video).rel);
  const crests = byRel.filter(v => v.rel >= crestRel - 1e-9).slice(0, 8);
  for (const c of crests) c.crest = true;
  crests.sort((a, b) => a.u - b.u);
  const labelled = [...crests].sort((a, b) => b.rel - a.rel).slice(0, 6);

  const sigma = { u: clamp(0.42 / n, 0.011, 0.034), v: n < 30 ? 0.1 : 0.075 };
  const field = buildField(videos, sigma, crestRel);

  return {
    creator: { handle: creator.handle, name: creator.name, tier: creator.tier },
    source, asOf, videos, crests, labelled, crestRel, sigma, field,
    maxRel: byRel[0]!.rel, minRel: byRel[n - 1]!.rel,
    stats: {
      count: n, medianViews: Math.round(med), from: sorted[0]!.published, to: sorted[n - 1]!.published,
      shorts: sorted.filter(v => v.short).length
    }
  };
}

function baseline(u: number, v: number): number {
  return Math.max(0.01, 0.045 + 0.03 * u + 0.03 * Math.sin(u * 11 + v * 4) + 0.02 * Math.sin(u * 27 - v * 9 + 1.3));
}

/** Gaussian-bump relief: one bump per video, plus a gentle baseline swell. */
export function buildField(videos: Video[], sigma: { u: number; v: number }, crestRel: number, nx: number = GRID.nx, nz: number = GRID.nz): Field {
  const raw = new Float32Array(nx * nz);
  let max = 0;
  for (let j = 0; j < nz; j++) {
    const v = j / (nz - 1);
    for (let i = 0; i < nx; i++) {
      const u = i / (nx - 1);
      let h = baseline(u, v);
      for (const m of videos) {
        const du = (u - m.u) / sigma.u;
        const dv = (v - m.v) / sigma.v;
        const q = du * du + dv * dv;
        if (q < 30) h += m.amp * Math.exp(-0.5 * q);
      }
      raw[j * nx + i] = h;
      if (h > max) max = h;
    }
  }
  const h = raw.map(x => x / max);
  const dx = WORLD.w / (nx - 1);
  const dz = WORLD.d / (nz - 1);
  const gx = new Float32Array(nx * nz);
  const gz = new Float32Array(nx * nz);
  const at = (i: number, j: number) => h[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))] as number;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      gx[j * nx + i] = (at(i + 1, j) - at(i - 1, j)) / (2 * dx);
      gz[j * nx + i] = (at(i, j + 1) - at(i, j - 1)) / (2 * dz);
    }
  }
  return { nx, nz, h, gx, gz, crestH: (ampFor(crestRel) + 0.07) / max };
}

/** Bilinear height at (u, v), both 0..1. */
export function heightAt(f: Field, u: number, v: number): number {
  const x = Math.min(f.nx - 1.0001, Math.max(0, u * (f.nx - 1)));
  const z = Math.min(f.nz - 1.0001, Math.max(0, v * (f.nz - 1)));
  const i = Math.floor(x), j = Math.floor(z);
  const tx = x - i, tz = z - j;
  const a = f.h[j * f.nx + i] as number, b = f.h[j * f.nx + i + 1] as number;
  const c = f.h[(j + 1) * f.nx + i] as number, d = f.h[(j + 1) * f.nx + i + 1] as number;
  return a * (1 - tx) * (1 - tz) + b * tx * (1 - tz) + c * (1 - tx) * tz + d * tx * tz;
}

/** The video whose bump the point (u, v) sits on, or null if it is on open ground. */
export function nearestVideo(m: Model, u: number, v: number, reach = 2.4): Video | null {
  let best: Video | null = null;
  let bestQ = reach * reach;
  for (const x of m.videos) {
    const du = (u - x.u) / m.sigma.u;
    const dv = (v - x.v) / m.sigma.v;
    const q = du * du + dv * dv;
    if (q < bestQ) { bestQ = q; best = x; }
  }
  return best;
}
