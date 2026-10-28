// Static fallbacks, generated from the SAME sample data as the 3D scene so they cannot
// disagree with it. Used when WebGL is unavailable, while the scene is still loading
// (something paints immediately), for reduced-motion visitors, and with JavaScript off.
// Colours are CSS variables, so both themes work with no extra files.
import { VIDEOS, CRESTS, STATS, WORLD, buildField, formatViews, CREST_REL } from '../src/data/sample.ts';

const r1 = n => Math.round(n * 10) / 10;

/** Ridgeline profile of the relief: the same landscape, drawn as a printed chart. */
export function ridgeSvg() {
  const f = buildField(144, 96);
  const W = 1200, H = 800, rows = 38, x0 = 70, xw = 980, yTop = 170, yStep = 13.4, ampPx = 150;
  const parts = [];
  for (let k = 0; k < rows; k++) {
    const j = Math.round((k / (rows - 1)) * (f.nz - 1));
    const yBase = yTop + k * yStep;
    const shift = (rows - k) * 0.0 + k * 1.1;
    let d = '';
    let crestD = '';
    let inCrest = false;
    const cols = [];
    for (let i = 0; i < f.nx; i += 3) cols.push(i);
    if (cols[cols.length - 1] !== f.nx - 1) cols.push(f.nx - 1); // always reach the right edge
    for (const i of cols) {
      const h = f.h[j * f.nx + i];
      const x = r1(x0 + shift + (i / (f.nx - 1)) * xw);
      const y = r1(yBase - h * ampPx);
      d += `${i === 0 ? 'M' : 'L'}${x} ${y}`;
      const hot = h >= f.crestH;
      if (hot) { crestD += `${inCrest ? 'L' : 'M'}${x} ${y}`; inCrest = true; } else { inCrest = false; }
    }
    const lastX = r1(x0 + shift + xw), firstX = r1(x0 + shift); // matches cols[0] and the final column
    // Fill (to hide the rows behind) and line are separate paths, so the fill's closing
    // edges are never stroked and no frame appears around the sheet.
    parts.push(`<path d="${d}L${lastX} ${H}L${firstX} ${H}Z" fill="var(--paper)"/>`);
    parts.push(`<path d="${d}" fill="none" stroke="var(--ink-soft)" stroke-width="1.15" stroke-linejoin="round"/>`);
    if (crestD) parts.push(`<path d="${crestD}" fill="none" stroke="var(--signal)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" focusable="false" aria-hidden="true">${parts.join('')}</svg>`;
}

/** The flat chart: every upload as a mark, height = multiple of the channel median (log scale). */
export function scatterSvg() {
  const W = 1200, H = 800, x0 = 90, x1 = 1110, y0 = 150, y1 = 650;
  const yFor = rel => {
    const t = (Math.log2(Math.max(rel, 0.25)) - Math.log2(0.25)) / (Math.log2(12) - Math.log2(0.25));
    return r1(y1 - t * (y1 - y0));
  };
  const xFor = u => r1(x0 + u * (x1 - x0));
  const out = [];
  for (const g of [0.5, 1, 2, 4, 8]) {
    const y = yFor(g);
    const med = g === 1;
    out.push(`<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="${med ? 1.6 : 1}" ${med ? '' : 'stroke-dasharray="2 5"'}/>`);
    out.push(`<text x="${x0 - 12}" y="${y + 4}" text-anchor="end" font-size="13" fill="var(--ink-soft)" font-family="ui-monospace, Menlo, monospace">${g === 1 ? 'median' : `${g}x`}</text>`);
  }
  const crestY = yFor(CREST_REL);
  out.push(`<line x1="${x0}" x2="${x1}" y1="${crestY}" y2="${crestY}" stroke="var(--signal)" stroke-width="1.4"/>`);
  // Left-aligned: a crest's stem can run through the right-hand end of this line.
  out.push(`<text x="${x0 + 8}" y="${crestY - 8}" text-anchor="start" font-size="13" fill="var(--ink)" font-family="ui-monospace, Menlo, monospace">crest line: ${CREST_REL}x the median</text>`);
  for (const v of VIDEOS) {
    const cx = xFor(v.u), cy = yFor(v.rel);
    if (v.crest) {
      out.push(`<line x1="${cx}" x2="${cx}" y1="${cy}" y2="${y1}" stroke="var(--signal)" stroke-width="1.2"/>`);
      out.push(`<path d="M${cx} ${cy - 12}l16 6l-16 6z" fill="var(--signal)"/>`);
      out.push(`<circle cx="${cx}" cy="${cy}" r="6.5" fill="var(--signal)" stroke="var(--paper)" stroke-width="2"/>`);
    } else {
      out.push(`<circle cx="${cx}" cy="${cy}" r="4" fill="var(--tide)" fill-opacity=".85"/>`);
    }
  }
  for (const c of CRESTS) {
    const cx = xFor(c.u), cy = yFor(c.rel);
    out.push(`<text x="${cx + 22}" y="${cy - 4}" font-size="14" fill="var(--ink)" font-family="ui-monospace, Menlo, monospace">${r1(c.rel)}x · ${formatViews(c.views)}</text>`);
  }
  out.push(`<text x="${x0}" y="${y1 + 36}" font-size="13" fill="var(--ink-soft)" font-family="ui-monospace, Menlo, monospace">${STATS.weeks} weeks of uploads, left to right</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">${out.join('')}</svg>`;
}

export { WORLD };
