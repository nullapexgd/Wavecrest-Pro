// Renders a report to HTML. Every string that came from the model or from YouTube goes through
// esc(); there is no innerHTML of anything unescaped. Provenance is decided here, from what the
// code knows about each field, never from anything the model says about itself.
import { formatDate, formatMultiple, formatViews } from '../data/model.ts';
import { performanceMap, pillarBar, rhythm } from './charts.ts';
import {
  type Evidence, type EvidenceVideo, type Provenance, type Strength,
  citedTags, isRealTitle, multiple, resolveCitations, strengthOf, tagIndex, thumbUrl, watchUrl
} from './evidence.ts';
import type { Analysis, Report } from './types.ts';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const PROV: Record<Provenance, string> = {
  observed: 'Observed', calculated: 'Calculated', inferred: 'Inferred', estimated: 'Estimated', unavailable: 'Unavailable'
};
const PROV_HELP: Record<Provenance, string> = {
  observed: 'Read directly from public YouTube data',
  calculated: 'Computed from observed data',
  inferred: 'A model reading of the evidence; it can be wrong',
  estimated: 'A range built on stated assumptions',
  unavailable: 'Private to the creator or not saved with this report'
};
export const chip = (k: Provenance, label = PROV[k]) =>
  `<span class="prov prov--${k}" title="${esc(PROV_HELP[k])}"><span class="glyph glyph--${k}" aria-hidden="true"></span>${esc(label)}</span>`;

const STRENGTH: Record<Strength, string> = {
  strong: 'Strong evidence', moderate: 'Some evidence', thin: 'Thin evidence', none: 'No cited evidence'
};
const pips = (s: Strength) => {
  const n = { strong: 3, moderate: 2, thin: 1, none: 0 }[s];
  return `<span class="pips pips--${s}" aria-hidden="true">${[0, 1, 2].map(i => `<i${i < n ? ' class="on"' : ''}></i>`).join('')}</span>`;
};
const strengthChip = (s: Strength, n: number, legacy: boolean) =>
  legacy
    ? `<span class="strength strength--none">${pips('none')}<span>Evidence not saved for this older report</span></span>`
    : `<span class="strength strength--${s}">${pips(s)}<span>${STRENGTH[s]}${n ? ` · ${n} cited video${n === 1 ? '' : 's'}` : ''}</span></span>`;

const day = (iso: string) => formatDate(iso.slice(0, 10));

/** Escapes text and turns resolvable citations like T3 into buttons that open that video. */
export function cite(text: unknown, ev: Evidence | undefined): string {
  const safe = esc(text);
  if (!ev) return safe;
  const idx = tagIndex(ev);
  return safe.replace(/\b([TR])(\d{1,3})\b/g, (m, a, b) => {
    const v = idx.get(`${a}${b}`);
    return v
      ? `<button type="button" class="cite" data-tag="${m}" aria-label="Show evidence ${m}: ${esc(v.title)}">${m}</button>`
      : m;
  });
}

const SECTIONS: { id: string; label: string; kinds: Provenance[] }[] = [
  { id: 'next', label: 'What to make next', kinds: ['inferred'] },
  { id: 'map', label: 'Performance map', kinds: ['observed', 'calculated'] },
  { id: 'hooks', label: 'Hooks', kinds: ['inferred'] },
  { id: 'thumbnails', label: 'Thumbnails', kinds: ['inferred'] },
  { id: 'cadence', label: 'Cadence', kinds: ['calculated', 'inferred'] },
  { id: 'audience', label: 'Audience', kinds: ['inferred'] },
  { id: 'pillars', label: 'Content pillars', kinds: ['inferred'] },
  { id: 'monetization', label: 'Monetization', kinds: ['inferred'] },
  { id: 'gaps', label: 'Gaps', kinds: ['inferred', 'calculated'] },
  { id: 'earnings', label: 'Earnings', kinds: ['estimated'] },
  { id: 'evidence', label: 'Evidence', kinds: ['observed'] }
];

/** Marks markup this file built itself (already escaped) so fact() does not escape it twice. */
class Html {
  html: string;
  constructor(html: string) { this.html = html; }
}
const raw = (html: string) => new Html(html);
const list = (items: unknown[] | undefined, ev?: Evidence) =>
  items?.length ? raw(`<ul class="bul">${items.map(i => `<li>${cite(i, ev)}</li>`).join('')}</ul>`) : '';

const fact = (label: string, value: unknown, kind: Provenance, ev?: Evidence) => {
  const empty = value === undefined || value === null || value === '' || (value instanceof Html && !value.html);
  return `<div class="fact"><dt>${esc(label)} ${chip(empty ? 'unavailable' : kind)}</dt>` +
    `<dd>${empty ? '<span class="muted">Not in this report.</span>' : value instanceof Html ? value.html : cite(value, ev)}</dd></div>`;
};

function section(id: string, body: string, intro = ''): string {
  const s = SECTIONS.find(x => x.id === id)!;
  return `<section class="rs" id="s-${id}" aria-labelledby="h-${id}" data-section="${id}">
    <header class="rs__head"><h2 class="rs__title" id="h-${id}">${esc(s.label)}</h2><div class="rs__kinds">${s.kinds.map(k => chip(k)).join('')}</div></header>
    ${intro ? `<p class="rs__intro">${intro}</p>` : ''}${body}</section>`;
}

/* ───────────── what to make next ───────────── */

function ideas(a: Analysis, ev: Evidence | undefined): string {
  const list = (a.videoIdeas ?? []).filter(i => i && (i.title || i.rationale));
  if (!list.length) {
    return section('next', `<div class="empty"><p>This report has no video ideas.</p></div>`);
  }
  const cards = list.map((idea, n) => {
    const { videos, missing } = resolveCitations(idea.rationale, ev);
    const s = strengthOf(videos.length);
    const strip = videos.slice(0, 3).map(v => {
      const m = multiple(v, ev);
      return `<li><button type="button" class="vchip" data-video="${esc(v.id)}">
        <img src="${esc(thumbUrl(v.id))}" alt="" width="160" height="90" loading="lazy" decoding="async">
        <span class="vchip__txt"><b>${m ? `${formatMultiple(m)} median` : `${formatViews(v.views)} views`}</b><span>${esc(v.title)}</span></span></button></li>`;
    }).join('');
    return `<article class="idea" style="--i:${n}">
      <div class="idea__top"><span class="idea__n" aria-hidden="true">${n + 1}</span>
        <h3 class="idea__title">${esc(idea.title)}</h3>
        <button type="button" class="tool tool--text idea__copy" data-copy="${esc(idea.title)}"><span>Copy title</span></button></div>
      <p class="idea__why"><span class="idea__label">Why this</span> ${cite(idea.rationale, ev)}</p>
      ${strip ? `<ul class="idea__ev" aria-label="Videos this idea is based on">${strip}</ul>` : ''}
      <div class="idea__foot">${strengthChip(s, videos.length, !ev)}${missing.length ? `<span class="muted">${missing.length} cited tag${missing.length === 1 ? '' : 's'} not found in the saved evidence</span>` : ''}
        ${idea.estimatedPerformance ? `<span class="guess">${chip('inferred', 'Model guess')} ${esc(idea.estimatedPerformance)} <span class="muted">Not a forecast.</span></span>` : ''}</div>
    </article>`;
  }).join('');
  return section('next', `<div class="ideas">${cards}</div>`,
    'Ideas the model proposes from this channel\'s own history. Each one lists the videos it relied on; open any to check the numbers.');
}

/* ───────────── performance map ───────────── */

function map(ev: Evidence | undefined, a: Analysis): string {
  if (!ev || ev.videos.length < 3) {
    return section('map', `<div class="empty"><p>The video data was not saved with this older report, so there is no map to draw. New analyses save it.</p></div>`);
  }
  const cited = new Set<string>();
  for (const i of a.videoIdeas ?? []) for (const v of resolveCitations(i.rationale, ev).videos) cited.add(v.id);
  const svg = performanceMap(ev, cited, 'wide') + performanceMap(ev, cited, 'tall');
  return section('map', `
    <div class="pmap-wrap">${svg}</div>
    <ul class="legend legend--inline" aria-label="Chart key">
      <li><span class="key key--crest" aria-hidden="true"></span>2x the median or more</li>
      <li><span class="key key--video" aria-hidden="true"></span>Video</li>
      <li><span class="key key--short" aria-hidden="true"></span>Short (3 minutes or less)</li>
      <li><span class="key key--ring" aria-hidden="true"></span>Used as evidence for an idea</li>
    </ul>
    <p class="note">Median of all videos fetched: <b>${formatViews(ev.medianViews)}</b> views. The map shows the 20 most-viewed and the 30 most recent uploads, not the whole channel, so it is tilted toward hits. Select a mark to inspect the video.</p>`,
    'Every stored video placed by date and by views as a multiple of the channel\'s median.');
}

/* ───────────── the other dimensions ───────────── */

function hooks(a: Analysis, ev: Evidence | undefined): string {
  const h = a.hooks;
  if (!h) return section('hooks', `<div class="empty"><p>No hook analysis in this report.</p></div>`);
  const examples = (h.examples ?? []).map(t => {
    const real = isRealTitle(t, ev);
    return `<li><q>${esc(t)}</q> ${ev ? (real ? chip('observed', 'Real title') : `<span class="muted">Not matched to a saved title</span>`) : ''}</li>`;
  }).join('');
  return section('hooks', `<dl class="facts">
    ${fact('Main pattern', h.primaryPattern, 'inferred', ev)}
    <div class="fact"><dt>Examples ${chip(h.examples?.length ? 'observed' : 'unavailable')}</dt><dd>${examples ? `<ul class="quotes">${examples}</ul>` : '<span class="muted">Not in this report.</span>'}</dd></div>
    ${fact('How often', h.frequency, 'inferred', ev)}
    ${fact('Other patterns', list(h.secondaryPatterns, ev), 'inferred')}
  </dl>`);
}

function thumbnails(a: Analysis, ev: Evidence | undefined): string {
  const t = a.thumbnails;
  const top = ev ? [...ev.videos].sort((x, y) => y.views - x.views).slice(0, 6) : [];
  const grid = top.length
    ? `<ul class="thumbs" aria-label="Thumbnails of the most-viewed videos">${top.map(v => `<li><button type="button" class="vchip vchip--big" data-video="${esc(v.id)}">
        <img src="${esc(thumbUrl(v.id))}" alt="Thumbnail: ${esc(v.title)}" width="320" height="180" loading="lazy" decoding="async">
        <span class="vchip__txt"><b>${(() => { const m = multiple(v, ev); return m ? `${formatMultiple(m)} median` : `${formatViews(v.views)} views`; })()}</b><span>${esc(v.title)}</span></span></button></li>`).join('')}</ul>`
    : '';
  const body = t
    ? `<dl class="facts">${fact('Formula', t.formula, 'inferred')}${fact('Elements', list(t.characteristics), 'inferred')}${fact('Text on the image', t.textOverlayStyle, 'inferred')}</dl>`
    : `<div class="empty"><p>No thumbnail analysis in this report.</p></div>`;
  return section('thumbnails', `<p class="notice"><b>Read this one with care.</b> The model reads video titles and numbers. It never sees an image, so everything below is a hypothesis about thumbnails, not something observed. The real thumbnails of the most-viewed videos are shown so you can judge it yourself.</p>${body}${grid}`);
}

function cadence(a: Analysis, ev: Evidence | undefined): string {
  const c = a.cadence;
  if (!c) return section('cadence', `<div class="empty"><p>No cadence analysis in this report.</p></div>`);
  const recent = (ev?.videos ?? []).filter(v => v.tags.some(t => t.startsWith('R'))).map(v => v.publishedAt);
  const stat = (label: string, v: unknown, unit = '') =>
    `<div class="stat"><dt>${esc(label)}</dt><dd>${v === undefined || v === null || v === '' ? '<span class="muted">Unavailable</span>' : `${esc(v)}<small>${unit}</small>`}</dd></div>`;
  const chart = recent.length >= 3 ? `<div class="rhythm-wrap">${rhythm(recent)}${rhythm(recent, true)}<p class="note">Upload rhythm of the ${recent.length} most recent uploads.</p></div>` : '';
  return section('cadence', `
    <dl class="stats">${stat('Days between uploads', c.avgDaysBetweenVideos)}${stat('Uploads per month', c.videosPerMonth)}${stat('Most common day', c.peakDay)}${stat('Average length', c.avgDurationMinutes, ' min')}</dl>
    ${chart}
    <dl class="facts">${fact('Schedule', c.schedule, 'inferred', ev)}${fact('Consistency', c.consistency, 'inferred', ev)}${fact('Length strategy', c.durationStrategy, 'inferred', ev)}${fact('When hits cluster', c.peakPerformanceWindow, 'inferred', ev)}</dl>`,
    'The four numbers are calculated from upload dates and lengths. The text beneath is the model\'s reading of them.');
}

function audience(a: Analysis, ev: Evidence | undefined): string {
  const u = a.audience;
  if (!u) return section('audience', `<div class="empty"><p>No audience analysis in this report.</p></div>`);
  return section('audience', `<dl class="facts">${fact('Who watches', u.primaryProfile, 'inferred', ev)}${fact('Age range', u.estimatedAge, 'inferred')}${fact('What they want', u.viewerIntent, 'inferred', ev)}${fact('Loyalty signal', u.loyaltySignal, 'inferred', ev)}
    <div class="fact"><dt>Viewer demographics ${chip('unavailable')}</dt><dd><span class="muted">Real age, country and watch time are private to the creator in YouTube Studio. Any age range above is a guess from content.</span></dd></div></dl>`);
}

function pillars(a: Analysis, ev: Evidence | undefined): string {
  const p = (a.pillars ?? []).filter(x => x && x.name);
  if (!p.length) return section('pillars', `<div class="empty"><p>No content pillars in this report.</p></div>`);
  return section('pillars', `${pillarBar(p)}<ol class="pillars">${p.map((x, i) =>
    `<li><span class="pb-key pb--${i % 5}" aria-hidden="true"></span><div><h3>${esc(x.name)} <b>${esc(x.percentage ?? '')}%</b></h3><p>${cite(x.description, ev)}</p></div></li>`).join('')}</ol>`,
    'How the uploads divide into themes. The shares are the model\'s estimate; the cited videos let you check them.');
}

function monetization(a: Analysis, ev: Evidence | undefined): string {
  const m = a.monetization;
  if (!m) return section('monetization', `<div class="empty"><p>No monetization analysis in this report.</p></div>`);
  const sig = (m.signals ?? []).filter(Boolean);
  return section('monetization', `<dl class="facts">${fact('Approach', m.primaryApproach, 'inferred', ev)}
    <div class="fact"><dt>Signals found ${chip(sig.length ? 'inferred' : 'observed', sig.length ? 'Inferred' : 'None found')}</dt><dd>${sig.length ? `<ul class="bul">${sig.map(s => `<li>${cite(s, ev)}</li>`).join('')}</ul>` : '<span class="muted">No sponsors, products or affiliate cues appeared in the titles and descriptions. That is a result, not a gap in the report.</span>'}</dd></div>
    ${fact('Brand fit', m.brandAffinities, 'inferred', ev)}</dl>`);
}

function gaps(a: Analysis, ev: Evidence | undefined): string {
  const g = (a.gaps ?? []).filter(x => x && x.opportunity);
  if (!g.length) return section('gaps', `<div class="empty"><p>No topic passed the check for being absent from the titles, so none is listed. That is the check working, not a failure.</p></div>`);
  return section('gaps', `<ul class="gaps">${g.map(x => `<li><h3>${esc(x.opportunity)}</h3><p>${cite(x.rationale, ev)}</p></li>`).join('')}</ul>`,
    'Topics the model proposed that appear in none of the titles it was shown. Each one passed an automatic check against those titles before it was kept.');
}

function earnings(a: Analysis): string {
  const e = a.earningsEstimate;
  const none = !e || /unclear/i.test(String(e.totalEstimate ?? 'unclear'));
  const body = none
    ? `<div class="empty"><p>There was not enough evidence for a revenue range, so none is shown.</p></div>`
    : `<div class="calc" role="group" aria-label="How the estimate is built">
        <div><small>Views per month</small><b>${e!.monthlyViewsEstimate ? formatViews(e!.monthlyViewsEstimate) : '—'}</b></div><span aria-hidden="true">×</span>
        <div><small>Assumed RPM</small><b>${esc(String(e!.cpmRPM ?? '').replace(/^.*?(\$)/, '$1') || '—')}</b></div><span aria-hidden="true">=</span>
        <div class="calc__out"><small>Ad revenue</small><b>${esc(e!.estimatedMonthlyAdRevenue)}</b><small>per month</small></div></div>
      <dl class="facts">${fact('Niche assumed', String(e!.cpmRPM ?? '').split(' $')[0], 'estimated')}${fact('Other revenue', e!.otherRevenue, 'estimated')}</dl>`;
  return section('earnings', `<p class="notice">${chip('estimated')} Views per month are lifetime views divided by channel age. The RPM range is the model's pick for the niche. A creator's real RPM and revenue are private to YouTube Studio, so treat this as a rough range, not income.</p>${body}`);
}

function evidenceTable(ev: Evidence | undefined): string {
  if (!ev) {
    return section('evidence', `<div class="empty"><p>This report was made before Wavecrest saved its evidence, so its citations cannot be opened. Run a new analysis to get a fully traceable report.</p></div>`);
  }
  const rows = [...ev.videos].sort((a, b) => b.views - a.views).map(v => {
    const m = multiple(v, ev);
    return `<tr><td><button type="button" class="cite" data-video="${esc(v.id)}">${esc(v.tags.join(' · '))}</button></td>
      <th scope="row"><button type="button" class="linklike" data-video="${esc(v.id)}">${esc(v.title)}</button></th>
      <td>${day(v.publishedAt)}</td><td class="num">${formatViews(v.views)}</td><td class="num">${m ? formatMultiple(m) : '—'}</td><td>${v.short ? 'Short' : 'Video'}</td></tr>`;
  }).join('');
  return section('evidence', `<div class="tablewrap"><table class="etable"><thead><tr><th>Tag</th><th>Video</th><th>Published</th><th class="num">Views</th><th class="num">× median</th><th>Format</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">${ev.videos.length} videos the analysis was based on, read ${day(ev.computedAt)} from the YouTube Data API. Tags: T = rank by views, R = rank by recency. Views and likes are public counts at that time.</p>`,
    'Every video behind the citations above, with its numbers.');
}

/* ───────────── the report ───────────── */

export function renderReport(r: Report): string {
  const a = r.analysis ?? {};
  const ev = a.evidence;
  const ch = r.channel;
  const median = ev?.medianViews;
  const metric = (label: string, value: string, kind: Provenance) =>
    `<div class="metric"><dt>${esc(label)} ${chip(kind)}</dt><dd>${value}</dd></div>`;
  const subs = ch.subscriberCount ? formatViews(ch.subscriberCount) : '<span class="muted">Unavailable</span>';

  const avatar = ch.thumbnailUrl
    ? `<img class="avatar" src="${esc(ch.thumbnailUrl)}" alt="" width="64" height="64" referrerpolicy="no-referrer">`
    : `<span class="avatar avatar--letter" aria-hidden="true">${esc((ch.name || '?').slice(0, 1).toUpperCase())}</span>`;

  const rail = SECTIONS.map(s => `<li><a href="#s-${s.id}" data-spy="${s.id}">${esc(s.label)}</a></li>`).join('');

  return `
  ${r.fixture ? `<p class="ribbon" role="note"><b>Illustrative example.</b> The videos, dates and view counts are real public data. The analysis text was written by hand to show what a report looks like; it is not the output of a real run.</p>` : ''}
  <div class="rp" data-report="${esc(r.reportId)}">
    <header class="rp__head">
      <div class="rp__id">${avatar}<div><h1 class="rp__name">${esc(ch.name)}</h1>
        <p class="meta">${esc(ch.handle ?? '')}${ch.handle ? ' · ' : ''}${esc(r.videoCount)} videos analysed · ${day(r.createdAt)}</p></div></div>
      <dl class="metrics">
        ${metric('Subscribers', subs, ch.subscriberCount ? 'observed' : 'unavailable')}
        ${metric('Videos analysed', esc(r.videoCount), 'observed')}
        ${metric('Median views', median ? formatViews(median) : '<span class="muted">Unavailable</span>', median ? 'calculated' : 'unavailable')}
        ${metric('Uploads a month', a.cadence?.videosPerMonth ? esc(a.cadence.videosPerMonth) : '<span class="muted">Unavailable</span>', a.cadence?.videosPerMonth ? 'calculated' : 'unavailable')}
      </dl>
      <div class="rp__actions" data-actions></div>
    </header>
    <div class="rp__body">
      <nav class="rail" aria-label="Report sections"><ol>${rail}</ol></nav>
      <div class="rp__main">
        ${ideas(a, ev)}${map(ev, a)}${hooks(a, ev)}${thumbnails(a, ev)}${cadence(a, ev)}${audience(a, ev)}${pillars(a, ev)}${monetization(a, ev)}${gaps(a, ev)}${earnings(a)}${evidenceTable(ev)}
      </div>
    </div>
  </div>`;
}

/** Which parts of the report cite each video, for the evidence drawer. */
export function citedBy(a: Analysis): Map<string, string[]> {
  const ev = a.evidence;
  const out = new Map<string, string[]>();
  const add = (text: unknown, label: string) => {
    for (const t of citedTags(text)) {
      const v = tagIndex(ev).get(t);
      if (!v) continue;
      const list = out.get(v.id) ?? [];
      if (!list.includes(label)) list.push(label);
      out.set(v.id, list);
    }
  };
  (a.videoIdeas ?? []).forEach(i => add(i.rationale, `Idea: ${i.title ?? ''}`));
  (a.gaps ?? []).forEach(g => add(g.rationale, `Gap: ${g.opportunity ?? ''}`));
  (a.pillars ?? []).forEach(p => add(p.description, `Pillar: ${p.name ?? ''}`));
  (a.hooks?.secondaryPatterns ?? []).forEach(p => add(p, 'Hooks'));
  add(a.cadence?.peakPerformanceWindow, 'Cadence');
  add(a.audience?.loyaltySignal, 'Audience');
  return out;
}

export function drawerHtml(v: EvidenceVideo, ev: Evidence | undefined, by: string[]): string {
  const m = multiple(v, ev);
  const rate = v.likes > 0 && v.views > 0 ? `${((v.likes / v.views) * 100).toFixed(1)}%` : null;
  return `<img class="drawer__img" src="${esc(thumbUrl(v.id))}" alt="Thumbnail: ${esc(v.title)}" width="320" height="180" loading="lazy" decoding="async">
    <p class="drawer__tag">${esc(v.tags.join(' · '))} ${chip('observed')}</p>
    <h2 class="drawer__title" id="drawer-title">${esc(v.title)}</h2>
    <dl class="drawer__facts">
      <div><dt>Published</dt><dd>${day(v.publishedAt)}</dd></div>
      <div><dt>Views</dt><dd>${v.views.toLocaleString('en-US')}</dd></div>
      <div><dt>Versus channel median ${chip('calculated')}</dt><dd>${m ? `${formatMultiple(m)}` : '—'}</dd></div>
      <div><dt>Likes per view</dt><dd>${rate ?? 'Not public'}</dd></div>
      <div><dt>Format</dt><dd>${v.short ? 'Short (3 minutes or less)' : 'Video'}</dd></div>
    </dl>
    ${by.length ? `<p class="drawer__by"><b>Used in this report by</b></p><ul class="bul">${by.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : '<p class="muted">Not cited by name; it is part of the evidence set.</p>'}
    <a class="btn btn--ghost" href="${esc(watchUrl(v.id))}" target="_blank" rel="noopener noreferrer"><span>Open on YouTube</span></a>`;
}
