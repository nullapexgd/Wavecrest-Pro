// Report charts. Plain SVG strings: no canvas, no filters, no animation loop, so the analyzer
// costs nothing to keep open. Same mark language as the home chart: circle = video, diamond =
// Short, signal-filled = crest (2x the channel median or more).
import { formatDate, formatMonth, formatMultiple } from '../data/model.ts';
import type { Evidence, EvidenceVideo } from './evidence.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Pt { v: EvidenceVideo; x: number; y: number; rel: number }

/**
 * Every stored video as a point: x = publish date, y = views as a multiple of the channel
 * median (log scale). The median is the true one over every video fetched, taken from the
 * report, not recomputed from this (top-heavy) sample. `cited` rings the videos the
 * recommendations rely on, which is how a recommendation is tied to its evidence.
 */
export function performanceMap(ev: Evidence, cited: ReadonlySet<string>, layout: 'wide' | 'tall' = 'wide'): string {
  const tall = layout === 'tall';
  const W = tall ? 420 : 960, H = tall ? 540 : 440, L = tall ? 46 : 56, R = tall ? 16 : 24, T = 20, B = tall ? 40 : 44;
  const vids = ev.videos.filter(v => v.views > 0 && v.publishedAt);
  if (vids.length < 2 || ev.medianViews <= 0) return '';
  const t = vids.map(v => Date.parse(v.publishedAt));
  const t0 = Math.min(...t), t1 = Math.max(...t);
  const rels = vids.map(v => v.views / ev.medianViews);
  const lo = Math.min(0.25, Math.min(...rels) * 0.9);
  const hi = Math.max(4, Math.max(...rels) * 1.12);
  const ly = (r: number) => Math.log2(r);
  const X = (ms: number) => L + ((ms - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (r: number) => T + (1 - (ly(r) - ly(lo)) / (ly(hi) - ly(lo))) * (H - T - B);

  const ticks = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128].filter(k => k >= lo * 0.999 && k <= hi * 1.001);
  const grid = ticks.map(k =>
    `<line class="g${k === 1 ? ' g--median' : ''}" x1="${L}" x2="${W - R}" y1="${Y(k).toFixed(1)}" y2="${Y(k).toFixed(1)}"/>` +
    `<text class="ax" x="${L - 10}" y="${(Y(k) + 4).toFixed(1)}" text-anchor="end">${k === 1 ? 'median' : formatMultiple(k)}</text>`
  ).join('');

  const span = t1 - t0;
  const nT = tall ? 3 : span > 1000 * 86400000 ? 5 : 4;
  const xs = Array.from({ length: nT }, (_, i) => t0 + (span * i) / (nT - 1));
  const xAxis = xs.map((ms, i) =>
    `<text class="ax" x="${X(ms).toFixed(1)}" y="${H - 14}" text-anchor="${i === 0 ? 'start' : i === nT - 1 ? 'end' : 'middle'}">${formatMonth(ms)}</text>`
  ).join('');

  const pts: Pt[] = vids.map((v, i) => ({ v, x: X(t[i]!), y: Y(rels[i]!), rel: rels[i]! }));
  const mark = (p: Pt) => {
    const crest = p.rel >= 2;
    const r = crest ? 8 : 5.5;
    const shape = p.v.short
      ? `<path class="mk__s" d="M${p.x.toFixed(1)} ${(p.y - r - 1.5).toFixed(1)}l${r + 1.5} ${r + 1.5}l${-(r + 1.5)} ${r + 1.5}l${-(r + 1.5)} ${-(r + 1.5)}z"/>`
      : `<circle class="mk__s" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}"/>`;
    const ring = cited.has(p.v.id) ? `<circle class="mk__ring" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r + 5.5}"/>` : '';
    const label = `${p.v.title}, ${formatDate(p.v.publishedAt.slice(0, 10))}, ${formatMultiple(p.rel)} the channel median${cited.has(p.v.id) ? ', used as evidence in this report' : ''}`;
    return `<g class="mk${crest ? ' mk--crest' : ''}" data-id="${esc(p.v.id)}" tabindex="0" role="button" aria-label="${esc(label)}">` +
      `<circle class="mk__hit" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="16"/>${ring}${shape}</g>`;
  };
  // cited marks last so their rings are never covered
  const ordered = [...pts].sort((a, b) => Number(cited.has(a.v.id)) - Number(cited.has(b.v.id)));

  // Name the three biggest hits so the chart reads without hovering.
  const top = [...pts].sort((a, b) => b.rel - a.rel).slice(0, 3);
  const max = tall ? 22 : 30;
  const trunc = (t: string) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
  // Place sequentially; nudge a label down when it would sit on one already placed.
  const placed: number[] = [];
  const labels = top.slice(0, tall ? 2 : 3).filter(p => p.rel >= 1.2).map(p => {
    const left = p.x > W * (tall ? 0.45 : 0.62);
    let y = p.y + 4;
    while (placed.some(q => Math.abs(q - y) < 14)) y += 14;
    placed.push(y);
    return `<text class="lb" x="${(p.x + (left ? -14 : 14)).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${left ? 'end' : 'start'}">${esc(trunc(p.v.title))}</text>`;
  }).join('');

  return `<svg class="pmap pmap--${layout}" viewBox="0 0 ${W} ${H}" role="group" aria-label="Performance map: each mark is one video, placed by date and by views as a multiple of the channel median">` +
    `${grid}<line class="ax-line" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>${xAxis}${ordered.map(mark).join('')}${labels}</svg>`;
}

/** Upload rhythm: one tick per upload on a shared time axis; the longest gap is labelled. */
export function rhythm(dates: string[], narrow = false): string {
  const ms = dates.map(d => Date.parse(d)).filter(Number.isFinite).sort((a, b) => a - b);
  if (ms.length < 3) return '';
  const W = narrow ? 420 : 960, H = 112, L = 12, R = 12;
  const t0 = ms[0]!, t1 = ms[ms.length - 1]!;
  const X = (v: number) => L + ((v - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  let gi = 1;
  for (let i = 2; i < ms.length; i++) if (ms[i]! - ms[i - 1]! > ms[gi]! - ms[gi - 1]!) gi = i;
  const gapDays = Math.round((ms[gi]! - ms[gi - 1]!) / 86400000);
  const gx0 = X(ms[gi - 1]!), gx1 = X(ms[gi]!);
  const ticks = ms.map(v => `<line class="tk" x1="${X(v).toFixed(1)}" x2="${X(v).toFixed(1)}" y1="26" y2="62"/>`).join('');
  return `<svg class="rhythm ${narrow ? 'rhythm--narrow' : 'rhythm--wide'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Upload rhythm: ${ms.length} uploads between ${formatMonth(t0)} and ${formatMonth(t1)}. The longest gap is ${gapDays} days.">` +
    `<line class="ax-line" x1="${L}" x2="${W - R}" y1="62" y2="62"/>${ticks}` +
    `<path class="gap" d="M${gx0.toFixed(1)} 78v8h${(gx1 - gx0).toFixed(1)}v-8"/>` +
    `<text class="ax" x="${((gx0 + gx1) / 2).toFixed(1)}" y="106" text-anchor="middle">longest gap: ${gapDays} days</text>` +
    `<text class="ax" x="${L}" y="16">${formatMonth(t0)}</text><text class="ax" x="${W - R}" y="16" text-anchor="end">${formatMonth(t1)}</text></svg>`;
}

/** Content pillars as one proportional bar. Each segment is also named in the list beside it. */
export function pillarBar(pillars: { name?: string; percentage?: number }[]): string {
  const rows = pillars.map(p => ({ name: String(p.name ?? ''), pct: Math.max(0, Number(p.percentage) || 0) })).filter(p => p.pct > 0);
  const total = rows.reduce((a, p) => a + p.pct, 0);
  if (!rows.length || total <= 0) return '';
  let x = 0;
  const seg = rows.map((p, i) => {
    const w = (p.pct / total) * 100;
    const s = `<rect class="pb pb--${i % 5}" x="${x.toFixed(2)}" y="0" width="${Math.max(0, w - 0.5).toFixed(2)}" height="28" rx="3"/>`;
    x += w;
    return s;
  }).join('');
  return `<svg class="pbar" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="${esc(rows.map(p => `${p.name} ${p.pct}%`).join(', '))}">${seg}</svg>`;
}
