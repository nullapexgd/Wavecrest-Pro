import type { Caption } from './render';
import type { TranscriptChunk } from './transcribe';

/** Stay under the server's 18,000 character cap for one clip search. */
export const PART_CHARS = 16500;
export const PART_SECONDS = 20 * 60;

/** Splits a transcript into consecutive parts that each fit one clip search. */
export function partsOf(chunks: TranscriptChunk[], maxChars = PART_CHARS): TranscriptChunk[][] {
  const parts: TranscriptChunk[][] = [];
  let cur: TranscriptChunk[] = [], n = 0;
  for (const c of chunks) {
    if (cur.length && n + c.text.length > maxChars) { parts.push(cur); cur = []; n = 0; }
    cur.push(c); n += c.text.length;
  }
  if (cur.length) parts.push(cur);
  return parts;
}

/** Caption lines for [start, end): each transcript line cut into short phrases, timed by their share of the line. */
export function captionsFor(chunks: TranscriptChunk[], start: number, end: number, words = 5): Caption[] {
  const out: Caption[] = [];
  for (const c of chunks) {
    if (c.end <= start || c.start >= end) continue;
    const w = c.text.split(/\s+/).filter(Boolean);
    const total = w.join(' ').length || 1;
    let used = 0;
    for (let i = 0; i < w.length; i += words) {
      const phrase = w.slice(i, i + words).join(' ');
      const a = c.start + ((c.end - c.start) * used) / total;
      used += phrase.length + 1;
      const b = c.start + ((c.end - c.start) * Math.min(used, total)) / total;
      if (b > start && a < end) out.push({ start: Math.max(a, start), end: Math.min(b, end), text: phrase });
    }
  }
  return out;
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
