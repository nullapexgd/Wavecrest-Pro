// Deterministic evaluation of the analysis enforcement layer: no model, no network.
// Each case feeds a flawed "model output" to enforceAnalysis and asserts what survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFacts } from '../lib/analysis-facts.js';
import { computeCadence, buildPrompt, SYSTEM_PROMPT, runAnalysis } from '../lib/analysis.js';
import { enforceAnalysis } from '../lib/analysis-enforce.js';
import { loadReplay } from './helpers/replay.js';

const NOW = Date.parse('2026-10-29T12:00:00Z'), DAY = 86400000;
const KEYS = ['hooks', 'thumbnails', 'cadence', 'audience', 'pillars', 'monetization', 'gaps', 'earningsEstimate', 'videoIdeas'];

function build(channel, n, { title, views = i => 20000 - i * 200, short = () => false, spacing = 3 }) {
  const videos = Array.from({ length: n }, (_, i) => ({
    id: `v${i}`, title: title(i), viewCount: views(i), likeCount: Math.round(views(i) / 30), duration: short(i) ? 45 : 600,
    publishedAt: new Date(NOW - (i + 1) * spacing * DAY).toISOString()
  }));
  const ch = { name: 'Test', description: '', subscriberCount: 500000, viewCountTotal: 5e7, publishedAt: '2019-01-01T00:00:00Z', ...channel };
  const facts = computeFacts(ch, videos, NOW);
  const recent = videos.slice(0, 30);
  const tag = id => { const t = facts.top20.findIndex(v => v.id === id), r = recent.findIndex(v => v.id === id); return [t >= 0 && `T${t + 1}`, r >= 0 && `R${r + 1}`].filter(Boolean); };
  return { videos, ctx: { channel: ch, facts, top: facts.top20, recent, cadence: computeCadence(videos), now: NOW }, tag };
}
const run = (raw, c) => enforceAnalysis(raw, c.ctx);
const money = s => (s.match(/\$([\d,]+)–\$([\d,]+)/) || []).slice(1).map(x => +x.replace(/,/g, ''));
const hasSchema = a => { for (const k of KEYS) assert.ok(a[k] && typeof a[k] === 'object', `missing ${k}`); assert.ok(Array.isArray(a.pillars) && Array.isArray(a.gaps) && Array.isArray(a.videoIdeas)); };

const TECH = ['iPhone 17 Pro Review', 'Galaxy S26 Ultra Review', 'Pixel 11 Review', 'Why I switched laptops', 'Desk setup tour', 'The best earbuds you can buy', 'MacBook Air M5 Review', 'Smart speaker showdown'];
const techTitle = i => `${TECH[i % TECH.length]}${i >= TECH.length ? ` ${2020 + (i % 6)}` : ''}`;

test('MKBHD-like creator: citations verified, fabrications and demographics removed, numbers computed', () => {
  const c = build({ name: 'Tech Creator', subscriberCount: 19000000 }, 60, { title: techTitle });
  const rev = c.videos.filter(v => /Review/.test(v.title)).slice(0, 5), notRev = c.videos.find(v => /Desk/.test(v.title));
  const tags = vs => vs.flatMap(v => c.tag(v.id));
  const real = c.videos[0].title;
  const out = run({
    channelType: 'creator', niche: 'Consumer Tech',
    hooks: { primaryPattern: '[Product] Review', patternTags: [...tags(rev), ...tags([notRev]), 'R99'] },
    pillars: [{ name: 'Reviews', description: 'Product reviews', tags: tags(rev) }, { name: 'Setups', description: 'Desk tours', tags: tags(c.videos.filter(v => /Desk|laptops/.test(v.title)).slice(0, 4)) }],
    audience: { primaryProfile: 'Men 18-34 with high income', viewerIntent: 'Decide what to buy' },
    monetization: { signals: [{ quote: 'Sponsored by NordVPN', tag: 'T1' }, { quote: 'Smart speaker showdown', tag: tags(c.videos.filter(v => /speaker/.test(v.title)).slice(0, 1))[0] }], brandAffinities: ['Apple', 'NordVPN'] },
    gaps: [{ opportunity: 'Gaming', rationale: 'x T1', tags: ['T1'], identityFit: 'low' }, { opportunity: 'Smart home cameras', rationale: 'Adjacent to T2', tags: ['T2'], identityFit: 'high' }, { opportunity: 'Pixel 11 Review', rationale: 'T1', tags: ['T1'], identityFit: 'high' }],
    videoIdeas: [{ title: real, rationale: 'copy', tags: ['T1'], identityFit: 'high', effort: 'low' }, { title: 'Pixel 12 Review: worth waiting?', rationale: 'Follows the Pixel 11 Review (3.2x median)', tags: tags(rev.slice(2, 3)), identityFit: 'high', effort: 'low' }]
  }, c);
  const a = out.analysis;
  hasSchema(a);
  assert.deepEqual(a.hooks.examples.every(t => c.videos.some(v => v.title === t)), true);
  assert.ok(!a.hooks.examples.includes(notRev.title));
  assert.ok(out.dropped.some(d => d.kind === 'hooks.tag'));
  assert.equal(a.pillars.reduce((s, p) => s + p.percentage, 0), 100);
  assert.doesNotMatch(a.audience.primaryProfile, /18|income|Men/);
  assert.match(a.audience.estimatedAge, /Unknown/);
  assert.deepEqual(a.monetization.signals.length, 1);
  assert.doesNotMatch(JSON.stringify(a.monetization), /NordVPN/);
  assert.deepEqual(a.gaps.map(g => g.opportunity), ['Smart home cameras']); // kept as a hypothesis the model rates a strong fit
  assert.equal(a.gaps[0].kind, 'hypothesis');
  assert.match(a.gaps[0].rationale, /Adjacent to T2.*Hypothesis.*not measured/);
  assert.equal(a.videoIdeas.length, 1);
  assert.match(a.videoIdeas[0].estimatedPerformance, /benchmark, not a forecast/);
  assert.doesNotMatch(a.videoIdeas[0].rationale, /3\.2x/);
  assert.equal(a.thumbnails.characteristics.length, 0);
  const [lo, hi] = money(a.earningsEstimate.totalEstimate);
  assert.ok(lo > 0 && hi > lo);
});

test('small channel: tentative, no gaps, unrealistic budgets rejected', () => {
  const c = build({ subscriberCount: 900, viewCountTotal: 40000 }, 8, { title: i => `Weekend build ${i} with scrap wood`, views: i => 400 - i * 10 });
  const out = run({ niche: 'DIY', channelType: 'creator', gaps: [{ opportunity: 'Metalworking', rationale: 'T1', tags: ['T1'], identityFit: 'high' }],
    videoIdeas: [{ title: 'Building a $250,000 tiny mansion', tags: ['T1'], identityFit: 'high', rationale: 'T1' }, { title: 'Weekend build: scrap wood stool', tags: ['T1'], identityFit: 'high', rationale: 'T1', effort: 'low' }] }, c);
  assert.equal(out.analysis.gaps.length, 0);
  assert.equal(out.analysis.quality.confidence, 'low');
  assert.match(out.analysis.quality.limits.join(' '), /Only 8 videos/);
  assert.deepEqual(out.analysis.videoIdeas.map(i => i.title), ['Weekend build: scrap wood stool']);
});

test('Shorts-heavy channel: Shorts and long-form revenue are never blended', () => {
  const c = build({}, 80, { title: i => `Budget tip number ${i}`, short: i => i % 10 !== 0, views: i => 1e6 });
  const f = c.ctx.facts;
  assert.ok(f.shortsCount > 60 && f.shortsShare > 0.8);
  const a = run({ channelType: 'creator', niche: 'Finance' }, c).analysis;
  const [, hi] = money(a.earningsEstimate.totalEstimate);
  const blendedAtLongFormRate = a.earningsEstimate.monthlyViewsRange[1] * 25 / 1000;
  assert.ok(hi < blendedAtLongFormRate * 0.35, `${hi} should be well under ${blendedAtLongFormRate}`);
  assert.match(a.earningsEstimate.cpmRPM, /Shorts \$0\.02/);
  assert.match(a.cadence.durationStrategy, /Shorts/);
  assert.match(a.quality.limits.join(' '), /Shorts and long-form/);
});

test('ambiguous channel: unknown niche and type produce no invented revenue', () => {
  const c = build({}, 40, { title: i => `Thing ${i}` });
  const a = run({ channelType: 'wizard', niche: 'Mystical Arts', hooks: 'nonsense', pillars: 'x', gaps: null, videoIdeas: 7 }, c).analysis;
  hasSchema(a);
  assert.equal(a.quality.channelType, 'unclear');
  assert.equal(a.quality.niche, 'Unclear');
  assert.equal(a.earningsEstimate.totalEstimate, 'unclear from data');
  assert.equal(a.earningsEstimate.otherRevenue.startsWith('Unknown'), true);
});

test('contradictory evidence: a pattern that does not outperform is flagged, an outlier is disclosed', () => {
  const c = build({}, 40, { title: i => (i % 8 === 0 ? `Challenge: day ${i}` : `Regular upload ${i}`), views: i => (i === 0 ? 5e6 : i % 8 === 0 ? 2000 : 10000) });
  const ch = c.videos.filter(v => /^Challenge/.test(v.title)).flatMap(v => c.tag(v.id));
  const a = run({ hooks: { primaryPattern: 'Challenge: day [N]', patternTags: ch } }, c).analysis;
  assert.ok(a.hooks.caveat, 'caveat when pattern videos sit below the median');
  assert.equal(a.hooks.confidence, 'low');
  assert.ok(a.hooks.medianMultiple < 1);
  assert.match(a.quality.limits.join(' '), /single outlier/);
});

test('Apple report replay: invented products, future events and fake monetization are removed', () => {
  const r = loadReplay('apple');
  const { analysis: a, dropped } = enforceAnalysis(r.raw, r.ctx);
  hasSchema(a);
  const ideas = a.videoIdeas.map(i => i.title).join(' | ');
  assert.doesNotMatch(ideas, /2027|iPhone 19|Series 13|November 2026/);
  assert.equal(a.videoIdeas.length, 2);
  assert.deepEqual(a.gaps.map(g => g.opportunity), ['Gaming content']); // the other two cite nothing
  assert.equal(a.monetization.signals.length, 0);
  assert.match(a.monetization.primaryApproach, /Official brand channel/);
  assert.equal(a.quality.channelTypeBasis, 'corroborated by public wording');
  assert.equal(a.quality.niche, 'Consumer Tech'); // kept as an assumed category, but never priced for a brand
  assert.equal(a.earningsEstimate.totalEstimate, 'unclear from data');
  assert.ok(a.hooks.examples.every(t => r.videos.some(v => v.title === t)));
  assert.doesNotMatch(JSON.stringify(a), /~\d+M views/);
  assert.ok(dropped.length >= 5);
});

test('MrBeast report replay: tags become titles, mean-based forecasts and editorialised sponsorship are removed', () => {
  const r = loadReplay('mrbeast');
  const { analysis: a } = enforceAnalysis(r.raw, r.ctx);
  hasSchema(a);
  assert.ok(a.hooks.examples.length >= 2 && a.hooks.examples.every(t => !/^[TR]\d+$/.test(t) && r.videos.some(v => v.title === t)));
  assert.equal(a.monetization.signals.length, 0);
  assert.ok(a.videoIdeas.length >= 3);
  assert.ok(a.videoIdeas.every(i => !/avg|M views/.test(i.estimatedPerformance)));
  assert.match(a.earningsEstimate.cpmRPM, /^Assumed category: Entertainment/);
  assert.match(a.earningsEstimate.totalEstimate, /^\$[\d,]+–\$[\d,]+\/month$/);
  assert.match(a.earningsEstimate.disclaimer, /Not actual or business revenue/);
  assert.equal(a.quality.channelTypeBasis, 'model-inferred, not verified');
  assert.deepEqual(a.gaps.map(g => g.opportunity), ['Cooking tutorial videos', 'Makeup/beauty tutorials']);
  assert.ok(a.gaps.every(g => g.kind === 'hypothesis' && /demand is not measured/.test(g.rationale)));
  assert.notEqual(a.quality.confidence, 'low'); // an uncertain label no longer sinks the whole report
});

test('prompts stay concise and benchmark on medians, not averages', () => {
  const c = build({}, 40, { title: techTitle });
  const p = buildPrompt(c.ctx.channel, c.ctx.facts, c.ctx.top, c.ctx.recent);
  assert.ok(SYSTEM_PROMPT.length < 1700, `system prompt ${SYSTEM_PROMPT.length} chars`);
  assert.match(p, /Median views/);
  assert.doesNotMatch(p + SYSTEM_PROMPT, /\bavg\b|channel average/i);
  assert.doesNotMatch(p, /Estimated monthly views/);
});

test('runAnalysis: garbage model output still yields the full stored schema plus evidence', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{}' } }] }) });
  try {
    const c = build({}, 25, { title: techTitle });
    const a = await runAnalysis(c.ctx.channel, c.videos, 'k', AbortSignal.timeout(5000));
    hasSchema(a);
    assert.ok(a.evidence.videos.length > 0 && a.evidence.medianViews > 0);
  } finally { globalThis.fetch = real; }
});

test('small creator: assumed category and estimate are kept, with low sample confidence and no gaps', () => {
  const c = build({ subscriberCount: 900, viewCountTotal: 40000 }, 8, { title: i => `Weekend build ${i} with scrap wood`, views: i => 400 - i * 10 });
  const a = run({ channelType: 'creator', niche: 'DIY', gaps: [{ opportunity: 'Metalworking', rationale: 'T1', tags: ['T1', 'T2'], identityFit: 'high' }] }, c).analysis;
  assert.equal(a.quality.nicheBasis, 'Assumed category');
  assert.match(a.earningsEstimate.cpmRPM, /^Assumed category: DIY/);
  assert.match(a.earningsEstimate.disclaimer, /Not actual or business revenue/);
  assert.equal(a.gaps.length, 0); // 8 videos cannot support even a hypothesis
  assert.equal(a.quality.confidence, 'low'); // the sample is the reason, not the label
});

test('Shorts-heavy channel with a niche its content contradicts: category unavailable, not guessed', () => {
  const c = build({}, 80, { title: i => `Pasta recipe number ${i}`, short: i => i % 10 !== 0, views: i => 1e6 });
  const { analysis: a, dropped } = run({ channelType: 'creator', niche: 'Finance' }, c);
  assert.equal(a.quality.niche, 'Unclear');
  assert.equal(a.earningsEstimate.totalEstimate, 'unclear from data');
  assert.ok(dropped.some(d => d.kind === 'classification.niche'));
  assert.equal(run({ channelType: 'creator', niche: 'Food/Cooking' }, c).analysis.quality.niche, 'Food/Cooking');
  assert.notEqual(a.quality.confidence, 'low');
});

test('live-run regressions: gap citations may sit in the rationale; structural hook patterns are kept at low confidence', () => {
  const c = build({}, 40, { title: techTitle });
  const [t1, t2, t3] = c.videos.filter(v => /Review/.test(v.title)).slice(0, 3).map(v => c.tag(v.id)[0]);
  const a = run({
    hooks: { primaryPattern: '[Product] [Noun] [Word]', patternTags: [t1, t2, t3] },
    gaps: [{ opportunity: 'Smart home cameras', rationale: `Adjacent to ${t1} and ${t2}`, tags: [], identityFit: 'high' }]
  }, c).analysis;
  assert.deepEqual(a.gaps.map(g => g.opportunity), ['Smart home cameras']);
  assert.equal(a.hooks.examples.length, 3);
  assert.equal(a.hooks.confidence, 'low');
  assert.match(a.hooks.caveat, /Unverified structural pattern/);
  assert.match(a.hooks.primaryPattern, /\(unverified structural pattern\)$/); // visible even where caveats aren't rendered
  assert.equal(a.hooks.verified, false);
  const few = run({ hooks: { primaryPattern: '[Product] [Noun]', patternTags: [t1, t2] } }, c).analysis;
  assert.deepEqual(few.hooks.examples, []); // two citations are not enough to trust a wording-free pattern
});
