// Sentences derived from the model. Shared by the build (which bakes the first picture into
// the HTML) and the browser (which redraws it for another creator), so both say the same thing.
import { formatDate, formatMultiple, formatViews, type Model } from './model.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const sourceName = (m: Model) => (m.source === 'api' ? 'YouTube Data API' : 'YouTube public feed');

export function captionText(m: Model, hint = ''): string {
  return `${m.creator.name}: latest ${m.stats.count} uploads, public YouTube data read ${formatDate(m.asOf)}. Not affiliated with Wavecrest.${hint}`;
}

export function factsText(m: Model): string {
  return `${m.creator.name}, ${m.stats.count} uploads from ${formatDate(m.stats.from)} to ${formatDate(m.stats.to)}. Median ${formatViews(m.stats.medianViews)} views. Source: ${sourceName(m)}, ${formatDate(m.asOf)}.`;
}

export function crestLegend(m: Model): string {
  return `Crest: ${formatMultiple(m.crestRel)} the median or more`;
}

/** A readable list of the crests, for people who cannot use the chart. */
export function crestListHtml(m: Model): string {
  return m.crests
    .map(c => `<li>${esc(c.title)}, ${formatDate(c.date)}: ${formatMultiple(c.rel)} the channel median, ${formatViews(c.views)} views</li>`)
    .join('');
}

/** Both chart layouts, so CSS can choose by screen width with no script. */
export function scatterPair(wide: string, tall: string): string {
  return `<div class="scat scat--wide">${wide}</div><div class="scat scat--tall">${tall}</div>`;
}
