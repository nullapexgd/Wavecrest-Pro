// Static pictures drawn from the SAME model as the 3D scene: the ridgeline poster (the
// relief as a printed plate) and the flat chart. They show while the scene loads, when WebGL
// is missing or declined, under reduced motion, and with JavaScript off. Colours are CSS
// variables, so both themes work with no extra files. Pure functions, so Node can bake the
// first one into the HTML and the browser can redraw them when the creator changes.
import { formatMonth, formatMultiple, formatViews, type Model } from './model.ts';

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Ridgeline profile of the relief: the same landscape, drawn as a printed chart. */
export function ridgeSvg(m: Model): string {
  const f = m.field;
  const W = 1200, H = 800, rows = 38, x0 = 70, xw = 980, yTop = 170, yStep = 13.4, ampPx = 150;
  const parts: string[] = [];
  for (let k = 0; k < rows; k++) {
    const j = Math.round((k / (rows - 1)) * (f.nz - 1));
    const yBase = yTop + k * yStep;
    const shift = k * 1.1;
    let d = '';
    let crestD = '';
    let inCrest = false;
    const cols: number[] = [];
    for (let i = 0; i < f.nx; i += 3) cols.push(i);
    if (cols[cols.length - 1] !== f.nx - 1) cols.push(f.nx - 1); // always reach the right edge
    for (const i of cols) {
      const h = f.h[j * f.nx + i] as number;
      const x = r1(x0 + shift + (i / (f.nx - 1)) * xw);
      const y = r1(yBase - h * ampPx);
      d += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
      if (h >= f.crestH) { crestD += `${inCrest ? 'L' : 'M'}${x} ${y}`; inCrest = true; } else { inCrest = false; }
    }
    const lastX = r1(x0 + shift + xw), firstX = r1(x0 + shift);
    // Fill (to hide the rows behind) and line are separate paths, so no frame is stroked.
    parts.push(`<path d="${d}L${lastX} ${H}L${firstX} ${H}Z" fill="var(--paper)"/>`);
    parts.push(`<path d="${d}" fill="none" stroke="var(--ink-soft)" stroke-width="1.15" stroke-linejoin="round"/>`);
    if (crestD) parts.push(`<path d="${crestD}" fill="none" stroke="var(--signal)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" focusable="false" aria-hidden="true">${parts.join('')}</svg>`;
}

export type ChartLayout = 'wide' | 'tall';

const LAYOUTS = {
  wide: { W: 1200, H: 800, x0: 108, x1: 1130, y0: 138, y1: 648, fs: 15, title: 26, maxTitle: 30 },
  tall: { W: 600, H: 680, x0: 70, x1: 568, y0: 130, y1: 560, fs: 16, title: 22, maxTitle: 18 }
} as const;

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}...`;
}

interface Box { x: number; y: number; w: number; h: number }
const hit = (a: Box, b: Box, gap = 6) => a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/**
 * The flat chart. x = when the upload went out, y = views as a multiple of the channel
 * median (log scale, so a 20x hit does not squash everything else). Shape says Short or
 * not, colour says crest or not; neither is carried by colour alone.
 */
export function scatterSvg(m: Model, layout: ChartLayout = 'wide'): string {
  const L = LAYOUTS[layout];
  const { W, H, x0, x1, y0, y1, fs } = L;
  const lo = Math.log2(m.minRel < 0.25 ? 0.125 : 0.25);
  const hi = Math.log2(Math.max(4, 2 ** Math.ceil(Math.log2(m.maxRel * 1.02))));
  const yFor = (rel: number) => r1(y1 - ((Math.log2(Math.max(rel, 2 ** lo)) - lo) / (hi - lo)) * (y1 - y0));
  const xFor = (u: number) => r1(x0 + u * (x1 - x0));
  const mono = 'ui-monospace, Menlo, monospace';
  const out: string[] = [];

  out.push(`<rect x="${x0 - 74}" y="${y0 - 70}" width="${x1 - x0 + 98}" height="${y1 - y0 + 148}" rx="22" fill="var(--paper-2)" fill-opacity=".72" stroke="var(--line)" stroke-opacity=".6"/>`);
  out.push(`<text x="${x0 - 52}" y="${y0 - 34}" font-size="${fs}" fill="var(--ink-soft)" font-family="${mono}">views vs the channel median, log scale</text>`);

  for (let g = 2 ** Math.ceil(lo); g <= 2 ** hi; g *= 2) {
    const y = yFor(g);
    const med = g === 1;
    out.push(`<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="${med ? 1.8 : 1}" ${med ? '' : 'stroke-dasharray="2 6"'}/>`);
    out.push(`<text x="${x0 - 12}" y="${y + 5}" text-anchor="end" font-size="${fs}" fill="${med ? 'var(--ink)' : 'var(--ink-soft)'}" font-family="${mono}">${med ? 'median' : `${g}x`}</text>`);
  }
  const cy = yFor(m.crestRel);
  out.push(`<line x1="${x0}" x2="${x1}" y1="${cy}" y2="${cy}" stroke="var(--signal)" stroke-width="1.5"/>`);

  // time axis
  const t0 = Date.parse(m.stats.from), t1 = Date.parse(m.stats.to);
  for (let k = 0; k < 4; k++) {
    const f = k / 3;
    const x = xFor(0.045 + 0.91 * f);
    const anchor = k === 0 ? 'start' : k === 3 ? 'end' : 'middle';
    out.push(`<line x1="${x}" x2="${x}" y1="${y1}" y2="${y1 + 8}" stroke="var(--ink-soft)"/>`);
    out.push(`<text x="${x}" y="${y1 + 30}" text-anchor="${anchor}" font-size="${fs}" fill="var(--ink-soft)" font-family="${mono}">${formatMonth(t0 + (t1 - t0) * f)}</text>`);
  }
  out.push(`<line x1="${x0}" x2="${x1}" y1="${y1}" y2="${y1}" stroke="var(--ink-soft)" stroke-width="1.2"/>`);

  // marks
  const pts = m.videos.map(v => ({ v, x: xFor(v.u), y: yFor(v.rel) }));
  const mark = (p: { v: typeof m.videos[number]; x: number; y: number }) => {
    const v = p.v;
    const r = v.crest ? 10 : 6;
    const fill = v.crest ? 'var(--signal)' : 'var(--tide)';
    const shape = v.short
      ? `<path d="M${p.x} ${p.y - r * 1.3}L${p.x + r * 1.3} ${p.y}L${p.x} ${p.y + r * 1.3}L${p.x - r * 1.3} ${p.y}Z" fill="${fill}" stroke="var(--paper-2)" stroke-width="2"/>`
      : `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}" fill-opacity="${v.crest ? 1 : 0.88}" stroke="var(--paper-2)" stroke-width="2"/>`;
    const stem = v.crest ? `<line x1="${p.x}" x2="${p.x}" y1="${p.y + r}" y2="${y1}" stroke="var(--signal)" stroke-opacity=".55" stroke-width="1.4"/>` : '';
    return `<g class="mk" data-i="${v.index}" style="--i:${v.index}">${stem}<circle cx="${p.x}" cy="${p.y}" r="18" fill="transparent"/>${shape}</g>`;
  };
  for (const p of pts) if (!p.v.crest) out.push(mark(p));
  for (const p of pts) if (p.v.crest) out.push(mark(p));

  // labels for the strongest crests, placed so they never overprint each other or a mark
  const placed: Box[] = [];
  const dots: Box[] = pts.map(p => ({ x: p.x - 10, y: p.y - 10, w: 20, h: 20 }));
  const bounds = { x: x0 - 40, y: y0 - 24, w: x1 - x0 + 70, h: y1 - y0 + 22 };
  for (const v of [...m.labelled].sort((a, b) => b.rel - a.rel)) {
    const p = pts[v.index]!;
    const t = clip(v.title, L.maxTitle);
    const sub = `${formatMultiple(v.rel)}, ${formatViews(v.views)} views`;
    const w = Math.max(t.length * fs * 0.6, sub.length * fs * 0.62), h = fs * 2.5;
    const tries: [number, number][] = [
      [16, -h / 2], [-w - 16, -h / 2], [-w / 2, -h - 16], [-w / 2, 18], [16, -h - 8], [-w - 16, -h - 8], [16, 10], [-w - 16, 10], [16, -h * 1.6], [-w - 16, -h * 1.6]
    ];
    let best: Box | null = null;
    let bestScore = Infinity;
    for (const [dx, dy] of tries) {
      const b: Box = { x: p.x + dx, y: p.y + dy, w, h };
      let score = 0;
      if (b.x < bounds.x || b.x + b.w > bounds.x + bounds.w || b.y < bounds.y || b.y + b.h > bounds.y + bounds.h) score += 1000;
      score += placed.filter(q => hit(b, q)).length * 100 + dots.filter((q, i) => i !== v.index && hit(b, q, 2)).length * 8;
      if (score < bestScore) { bestScore = score; best = b; }
      if (score === 0) break;
    }
    const b = best!;
    placed.push(b);
    const anchorStart = b.x >= p.x;
    const tx = anchorStart ? b.x : b.x + b.w;
    out.push(`<g class="lb" style="--i:${v.index}" text-anchor="${anchorStart ? 'start' : 'end'}">`
      + `<text x="${r1(tx)}" y="${r1(b.y + fs)}" font-size="${fs}" font-weight="600" fill="var(--ink)" class="halo">${esc(t)}</text>`
      + `<text x="${r1(tx)}" y="${r1(b.y + fs * 2.25)}" font-size="${fs - 1}" fill="var(--ink-soft)" font-family="${mono}" class="halo">${esc(sub)}</text></g>`);
  }

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">${out.join('')}</svg>`;
}
