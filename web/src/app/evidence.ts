// Evidence for a report: resolves the tags the model cites (T3 = third in the top-by-views
// list, R12 = twelfth most recent) to real videos, and derives confidence from counts the
// code can check. Nothing here is asked of the model. Erasable TypeScript, so Node tests can
// import it directly.

export interface EvidenceVideo {
  id: string;
  title: string;
  publishedAt: string;
  views: number;
  likes: number;
  duration: number;
  short: boolean;
  tags: string[];
}

export interface Evidence {
  medianViews: number;
  computedAt: string;
  videos: EvidenceVideo[];
}

export type Provenance = 'observed' | 'calculated' | 'inferred' | 'estimated' | 'unavailable';
export type Strength = 'strong' | 'moderate' | 'thin' | 'none';

const TAG = /\b([TR])(\d{1,3})\b/g;

/** Tags in the order the text cites them, each once. */
export function citedTags(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  const out: string[] = [];
  for (const m of text.matchAll(TAG)) {
    const tag = `${m[1]}${m[2]}`;
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

export function tagIndex(ev: Evidence | undefined): Map<string, EvidenceVideo> {
  const map = new Map<string, EvidenceVideo>();
  for (const v of ev?.videos ?? []) for (const t of v.tags) map.set(t, v);
  return map;
}

/** The videos behind a piece of text. `missing` are cited tags that match nothing stored. */
export function resolveCitations(text: unknown, ev: Evidence | undefined) {
  const idx = tagIndex(ev);
  const videos: EvidenceVideo[] = [];
  const missing: string[] = [];
  for (const t of citedTags(text)) {
    const v = idx.get(t);
    if (!v) missing.push(t);
    else if (!videos.includes(v)) videos.push(v);
  }
  return { videos, missing };
}

/** How much checkable evidence backs a claim: counts only, never the model's own confidence. */
export function strengthOf(resolved: number): Strength {
  if (resolved >= 3) return 'strong';
  if (resolved === 2) return 'moderate';
  if (resolved === 1) return 'thin';
  return 'none';
}

export const multiple = (v: { views: number }, ev: Evidence | undefined): number | null =>
  ev && ev.medianViews > 0 ? v.views / ev.medianViews : null;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** True when a title the model quoted is a real title in the evidence set (hooks examples). */
export function isRealTitle(quoted: unknown, ev: Evidence | undefined): boolean {
  if (typeof quoted !== 'string' || !ev) return false;
  const q = norm(quoted);
  return q.length > 0 && ev.videos.some(v => norm(v.title) === q);
}

/** "7 of top 20" -> 7. Null when the model wrote it some other way. */
export function parseFrequency(text: unknown): number | null {
  const m = typeof text === 'string' ? text.match(/(\d{1,2})\s*(?:of|\/|out of)\s*(?:the\s*)?(?:top\s*)?(\d{1,2})/i) : null;
  return m ? Number(m[1]) : null;
}

export const thumbUrl = (id: string) => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
