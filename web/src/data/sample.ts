// A fictional channel, generated from a fixed seed. It is ILLUSTRATIVE: the page says so
// wherever it appears, and nothing here is real creator data. One source feeds the 3D
// relief, the static poster and the chart annotations, so they can never disagree.
//
// Kept to erasable TypeScript only (no enums, no parameter properties) because
// tools/posters.mjs imports this file straight from Node.

export interface Video {
  id: string;
  index: number;
  /** position along time, 0..1 */
  u: number;
  /** position across topics, 0..1 */
  v: number;
  week: number;
  date: string;
  pillar: string;
  views: number;
  /** views divided by the channel median */
  rel: number;
  /** bump height before normalisation */
  amp: number;
  title: string;
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
  /** height at which a video is 3x the channel median: the crest threshold */
  crestH: number;
}

export const WORLD = { w: 4.8, d: 3.0, amp: 0.95, skirt: 0.3 } as const;
export const GRID = { nx: 144, nz: 96 } as const;
export const SIGMA = { u: 0.0135, v: 0.075 } as const;
export const CREST_REL = 3;
export const CHANNEL = { name: 'Tidewater Workshop', note: 'a fictional boat-restoration channel' } as const;

export const PILLARS = [
  { name: 'Restorations', z: 0.2 },
  { name: 'Tool tests', z: 0.5 },
  { name: 'Shop life', z: 0.8 }
] as const;

const WEEKS = 78;
const COUNT = 64;
const START = Date.UTC(2025, 4, 4);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rng() * xs.length)] as T;
}

const POOLS = {
  boats: ['lapstrake skiff', 'cedar dory', 'plywood runabout', 'wooden canoe', 'sailing punt'],
  years: ['1949', '1958', '1962', '1971'],
  verbs: ['Raising', 'Rebuilding', 'Refastening', 'Rescuing'],
  parts: ['transom', 'garboard', 'stem', 'keel', 'ribs'],
  finds: ['rot', 'a hidden crack', 'old repairs', 'a bad scarf joint'],
  tools: ['block planes', 'Japanese saws', 'bevel gauges', 'spokeshaves', 'marking knives'],
  grades: ['cheap', 'expensive', 'vintage', 'hand-forged'],
  things: ['chisels', 'clamps', 'hand drills', 'mallets'],
  topics: ['steam bending', 'epoxy', 'lofting', 'varnish', 'bronze fastenings'],
  shop: ['a year of', 'the real cost of', 'what changed in', 'winter in']
} as const;

function makeTitle(pillar: number, rng: () => number): string {
  if (pillar === 0) {
    return rng() < 0.55
      ? `${pick(rng, POOLS.verbs)} a ${pick(rng, POOLS.years)} ${pick(rng, POOLS.boats)}`
      : `We found ${pick(rng, POOLS.finds)} behind the ${pick(rng, POOLS.parts)}`;
  }
  if (pillar === 1) {
    return rng() < 0.5
      ? `I tested ${3 + Math.floor(rng() * 5)} ${pick(rng, POOLS.tools)} so you do not have to`
      : `Are ${pick(rng, POOLS.grades)} ${pick(rng, POOLS.things)} worth it?`;
  }
  return rng() < 0.5
    ? `Shop tour: ${pick(rng, POOLS.shop)} an unheated workshop`
    : `Your questions about ${pick(rng, POOLS.topics)}`;
}

function build(): Video[] {
  const rng = mulberry32(20261028);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const outliers = new Map<number, number>([[11, 6.6], [26, 8.2], [43, 5.9], [57, 9.1]]);
  const pillarBase = [1.0, 0.78, 0.55];
  const raw: Omit<Video, 'rel' | 'amp' | 'crest'>[] = [];

  for (let i = 0; i < COUNT; i++) {
    const u = Math.min(0.985, Math.max(0.015, (i + 0.5 + (rng() - 0.5) * 0.7) / COUNT));
    const r = rng();
    const p = r < 0.46 ? 0 : r < 0.78 ? 1 : 2;
    const v = Math.min(0.96, Math.max(0.04, (PILLARS[p] as { z: number }).z + (rng() - 0.5) * 0.1));
    let views = 42000 * (pillarBase[p] as number) * (1 + 0.9 * u) * Math.exp(0.46 * gauss());
    const boost = outliers.get(i);
    if (boost) views *= boost * (0.92 + rng() * 0.16);
    const week = u * WEEKS;
    raw.push({
      id: `v${i}`,
      index: i,
      u,
      v,
      week,
      date: new Date(START + week * 7 * 864e5).toISOString().slice(0, 10),
      pillar: (PILLARS[p] as { name: string }).name,
      views: Math.round(views),
      title: makeTitle(p, rng)
    });
  }

  const sorted = raw.map(r => r.views).sort((a, b) => a - b);
  const median = ((sorted[COUNT / 2 - 1] as number) + (sorted[COUNT / 2] as number)) / 2;
  // The sample is curated for legibility, not measured: no video exceeds 11x the median,
  // so one freak result cannot flatten every other crest in the picture.
  const REL_CAP = 11;
  return raw.map(r => {
    const rel = Math.min(REL_CAP, r.views / median);
    return {
      ...r,
      views: Math.round(rel * median),
      rel,
      amp: Math.min(1.2, 0.19 * Math.pow(rel, 0.72)),
      crest: rel >= CREST_REL
    };
  });
}

export const VIDEOS: readonly Video[] = build();
export const CRESTS: readonly Video[] = VIDEOS.filter(v => v.crest).sort((a, b) => a.u - b.u);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? (s[(s.length - 1) / 2] as number) : ((s[s.length / 2 - 1] as number) + (s[s.length / 2] as number)) / 2;
}
const sortedViews = VIDEOS.map(v => v.views).sort((a, b) => a - b);

export const STATS = {
  count: VIDEOS.length,
  weeks: WEEKS,
  medianViews: Math.round(median(VIDEOS.map(v => v.views))),
  p90Views: sortedViews[Math.floor(0.9 * (sortedViews.length - 1))] as number,
  crestCount: CRESTS.length,
  uploadsPerWeek: Math.round((VIDEOS.length / WEEKS) * 10) / 10,
  topRel: Math.max(...VIDEOS.map(v => v.rel))
} as const;

function baseline(u: number, v: number): number {
  return Math.max(0.01, 0.045 + 0.03 * u + 0.03 * Math.sin(u * 11 + v * 4) + 0.02 * Math.sin(u * 27 - v * 9 + 1.3));
}

/** Gaussian-bump relief: one bump per video, plus a gentle baseline swell. */
export function buildField(nx: number = GRID.nx, nz: number = GRID.nz): Field {
  const raw = new Float32Array(nx * nz);
  let max = 0;
  for (let j = 0; j < nz; j++) {
    const v = j / (nz - 1);
    for (let i = 0; i < nx; i++) {
      const u = i / (nx - 1);
      let h = baseline(u, v);
      for (const m of VIDEOS) {
        const du = (u - m.u) / SIGMA.u;
        const dv = (v - m.v) / SIGMA.v;
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
  const crestAmp = 0.19 * Math.pow(CREST_REL, 0.72);
  return { nx, nz, h, gx, gz, crestH: (crestAmp + 0.07) / max };
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
export function nearestVideo(u: number, v: number, reach = 2.4): Video | null {
  let best: Video | null = null;
  let bestQ = reach * reach;
  for (const m of VIDEOS) {
    const du = (u - m.u) / SIGMA.u;
    const dv = (v - m.v) / SIGMA.v;
    const q = du * du + dv * dv;
    if (q < bestQ) { bestQ = q; best = m; }
  }
  return best;
}

export function formatViews(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
