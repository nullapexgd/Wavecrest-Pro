import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { enforceAnalysis } from '../../lib/analysis-enforce.js';
import { context, loadFixture, fixtureNames, invariantChecks } from '../../scripts/eval-live.js';

const casesDir = new URL('./cases/', import.meta.url);
const cases = readdirSync(casesDir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(new URL(f, casesDir), 'utf8')));
test('all channel fixtures have an adversarial case', () => {
  assert.ok(cases.length >= 12);
  assert.deepEqual(cases.map(c => c.fixture).sort(), fixtureNames());
});
for (const c of cases) {
  test(`${c.fixture}: cited evidence, computed numbers, unknowns and legacy shape`, () => {
    const ctx = context(loadFixture(c.fixture));
    const before = JSON.stringify(c.raw);
    const { analysis: a, dropped } = enforceAnalysis(c.raw, ctx);
    assert.equal(JSON.stringify(c.raw), before, 'model input must not be mutated');
    for (const [name, result] of Object.entries(invariantChecks(a, ctx))) assert.ok(result.pass, `${name}: ${result.message || ''}`);
    // Positive controls prevent a drop-everything implementation passing the invariants.
    assert.deepEqual(a.hooks.examples, c.expected.hookExamples);
    assert.equal(a.pillars.length, 2);
    assert.deepEqual(a.videoIdeas.map(i => i.title), c.expected.ideaTitles);
    // The original cases proposed labels and generic gaps without corroborating wording.
    assert.deepEqual(a.gaps, []);
    assert.equal(a.quality.channelType, c.fixture === 'brand' ? 'brand' : 'unclear');
    assert.equal(a.quality.niche, 'Unclear');
    assert.equal(a.earningsEstimate.totalEstimate, 'unclear from data');
    assert.doesNotMatch(JSON.stringify(a.monetization), /PhantomCorp|expert explains/);
    assert.doesNotMatch(JSON.stringify(a.audience), /affluent|\bmen\b|\bwomen\b|18-34|income/i);
    assert.deepEqual(a.monetization.signals, c.raw.channelType === 'brand' ? [] : [`“${c.expected.signal}” (T3)`]);
    assert.ok(dropped.some(d => d.kind === 'hooks.tag'));
    assert.ok(dropped.some(d => d.kind === 'monetization.signal'));
    if (c.fixture === 'tiny') assert.equal(a.quality.confidence, 'low');
    if (c.fixture === 'viral-outlier') assert.match(a.quality.limits.join(' '), /single outlier/);
    if (c.fixture === 'dormant') assert.equal(ctx.facts.recentUploads, null);
    if (c.fixture === 'ambiguous') assert.equal(a.earningsEstimate.totalEstimate, 'unclear from data');
  });
}

// Reproductions from the independent evaluation, now active regressions.
const base = () => {
  const c = structuredClone(cases.find(c => c.fixture === 'mid'));
  return { c, ctx: context(loadFixture('mid')) };
};
test('forecasts in idea titles are removed', () => {
  const { c, ctx } = base();
  c.raw.videoIdeas = [{ title: 'Repair a gate for 300% growth', rationale: 'A practical workshop project', tags: ['T1'], identityFit: 'high', effort: 'low' }];
  const { analysis } = enforceAnalysis(c.raw, ctx);
  assert.ok(invariantChecks(analysis, ctx).forecasts.pass);
});
test('citations for a gap must support its identity fit', () => {
  const { c, ctx } = base();
  c.raw.gaps = [{ opportunity: 'Celebrity yacht gossip', rationale: 'Repair tutorials prove celebrity demand T1', tags: ['T1'], identityFit: 'high' }];
  assert.deepEqual(enforceAnalysis(c.raw, ctx).analysis.gaps, []);
});
test('duplicate proposed ideas are deduplicated against each other', () => {
  const { c, ctx } = base();
  c.raw.videoIdeas = [c.raw.videoIdeas[1], c.raw.videoIdeas[1]];
  const ideas = enforceAnalysis(c.raw, ctx).analysis.videoIdeas;
  assert.equal(new Set(ideas.map(i => i.title)).size, ideas.length);
});
test('plausible but wrong channel classification stays unknown', () => {
  const { c, ctx } = base();
  c.raw.channelType = 'brand';
  c.raw.niche = 'Insurance';
  const a = enforceAnalysis(c.raw, ctx).analysis;
  assert.equal(a.quality.channelType, 'unclear');
  assert.equal(a.quality.niche, 'Unclear');
});
test('monetization quotes must be verbatim, including punctuation', () => {
  const { c, ctx } = base();
  c.raw.monetization.signals = [{ quote: 'SHARPEN-a-hand-plane', tag: 'T3' }];
  assert.deepEqual(enforceAnalysis(c.raw, ctx).analysis.monetization.signals, []);
});

test('live CLI: dry mode prints prompts without a key and validates fixture names', async () => {
  const { spawnSync } = await import('node:child_process');
  const env = { ...process.env };
  delete env.GROQ_API_KEY;
  const dry = spawnSync(process.execPath, ['scripts/eval-live.js', '--dry'], { encoding: 'utf8', env });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /rough chars\/4 estimate/);
  for (const name of fixtureNames()) assert.ok(dry.stdout.includes(`${name}: ~`));
  const absent = spawnSync(process.execPath, ['scripts/eval-live.js', '--fixtures', 'tiny'], { encoding: 'utf8', env });
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /GROQ_API_KEY is absent/);
  const unknown = spawnSync(process.execPath, ['scripts/eval-live.js', '--dry', '--fixtures', '../not-a-fixture'], { encoding: 'utf8', env });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown fixture/);
});
test('live CLI: mocked model yields scorecard and JSON without exposing credentials', async () => {
  const { spawnSync } = await import('node:child_process');
  const { rmSync } = await import('node:fs');
  const raw = cases.find(c => c.fixture === 'tiny').raw;
  const preload = `globalThis.fetch = async () => new Response(JSON.stringify(${JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] })}), {status: 200});`;
  const key = 'eval-test-secret-never-print';
  const out = new URL('./out/tiny.json', import.meta.url);
  try {
    const child = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, 'scripts/eval-live.js', '--fixtures', 'tiny'], { encoding: 'utf8', env: { ...process.env, GROQ_API_KEY: key } });
    assert.equal(child.status, 0, child.stderr);
    assert.doesNotMatch(child.stdout + child.stderr, new RegExp(key + '|Authorization|Bearer'));
    const saved = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(saved.scores.sections.length, 6);
    assert.ok(saved.scores.sections.some(s => s.kept > 0 && s.dropped > 0));
    assert.ok(Object.values(saved.invariants).every(i => i.pass));
    assert.ok(!JSON.stringify(saved).includes(key));
  } finally { rmSync(out, { force: true }); }
});

test('model numbers cannot override facts, pillar shares or performance benchmarks', () => {
  const { c, ctx } = base();
  c.raw.stats = { medianViews: 999999999 };
  c.raw.earningsEstimate = { totalEstimate: '$999999999/month' };
  c.raw.hooks.frequency = '999 of top 999';
  c.raw.pillars.forEach(p => { p.percentage = 999; });
  c.raw.videoIdeas[1].estimatedPerformance = '999M views guaranteed';
  const a = enforceAnalysis(c.raw, ctx).analysis;
  assert.equal(a.stats.medianViews, ctx.facts.medianViews);
  assert.equal(a.pillars.reduce((s, p) => s + p.percentage, 0), 100);
  assert.equal(a.hooks.frequency, '2 of top 20 by views; 2 of 20 titles shown');
  assert.doesNotMatch(JSON.stringify(a), /999/);
});
test('Shorts and long-form citation multiples use their own format medians', () => {
  const fixture = loadFixture('shorts-long');
  const ctx = context(fixture);
  const c = cases.find(c => c.fixture === 'shorts-long');
  const raw = structuredClone(c.raw);
  raw.videoIdeas = [{ title: 'Repair a circuit radio with spare parts', rationale: 'Reuses the repair format', tags: ['T1', 'T2'], identityFit: 'high', effort: 'low' }];
  const a = enforceAnalysis(raw, ctx).analysis;
  const median = values => {
    const v = values.sort((a, b) => a - b), half = v.length / 2;
    return Math.round((v[Math.floor(half)] + v[Math.ceil(half) - 1]) / 2);
  };
  for (const [i, v] of ctx.top.slice(0, 2).entries()) {
    const short = v.duration <= 180;
    const ownMedian = median(fixture.videos.filter(row => (row.duration <= 180) === short).map(row => row.viewCount));
    const ratio = Math.round(v.viewCount / ownMedian * 100) / 100;
    assert.ok(a.videoIdeas[0].rationale.includes(`T${i + 1} “${v.title}”`));
    assert.ok(a.videoIdeas[0].rationale.includes(`${ratio}× its ${short ? 'Shorts' : 'long-form'} median`));
  }
});

test('creative quantities survive, while explicit performance promises do not', () => {
  const { c, ctx } = base();
  const titles = ['Repair a gate for 300% growth', 'Woodworking with 2× higher engagement', 'Repair videos: views will increase by 300%', 'Get 1M views from chair repairs'];
  const creative = ['Build a 100% recycled chair', 'Repair a 2×4 garden frame', 'Test a 3x camera zoom', 'Build 12 shelves for $50', 'Phone 8 camera lighting experiments'];
  const idea = title => ({ title, rationale: 'Use 100% reclaimed wood and 2×4 offcuts', tags: ['T1'], identityFit: 'high', effort: 'low' });
  c.raw.videoIdeas = [...titles, ...creative].map(idea);
  const { analysis } = enforceAnalysis(c.raw, ctx);
  assert.deepEqual(analysis.videoIdeas.map(i => i.title), creative);
  assert.ok(analysis.videoIdeas.every(i => i.rationale.includes('100% reclaimed wood')));
  assert.ok(invariantChecks(analysis, ctx).forecasts.pass);
});
test('forecast rationale is scrubbed without losing the creative title or computed benchmark', () => {
  const { c, ctx } = base();
  c.raw.videoIdeas = [{ title: 'Repair a garden gate using reclaimed hinges', rationale: 'Expect 3.2x the median and 80% growth', tags: ['T1'], identityFit: 'high', effort: 'low' }];
  const idea = enforceAnalysis(c.raw, ctx).analysis.videoIdeas[0];
  assert.equal(idea.title, c.raw.videoIdeas[0].title);
  assert.doesNotMatch(idea.rationale, /Expect|3\.2x|80%/);
  assert.match(idea.rationale, /Builds on T1/);
  assert.match(idea.estimatedPerformance, /benchmark, not a forecast/);
});
test('gap candidates keep literal topic links but abstain from semantic demand claims', () => {
  const { c, ctx } = base();
  ctx.top[1] = { ...ctx.top[1], title: 'Repair a wooden table for $50' };
  c.raw.gaps = [
    { opportunity: 'Chair maintenance checklist', rationale: 'T1 proves enormous audience demand', tags: ['T1', 'T99'], identityFit: 'high' },
    { opportunity: 'Chair joinery guide', rationale: 'Another claim T99', tags: ['T99'], identityFit: 'high' },
    { opportunity: 'Sharpen a hand plane', rationale: 'Already covered T3', tags: ['T3'], identityFit: 'high' },
    { opportunity: '$100 sponsorship', rationale: 'A dollar sign is not topic support T2', tags: ['T2'], identityFit: 'high' }
  ];
  const { analysis, dropped } = enforceAnalysis(c.raw, ctx);
  assert.deepEqual(analysis.gaps.map(g => g.opportunity), ['Chair maintenance checklist']);
  assert.equal(analysis.gaps[0].confidence, 'low');
  assert.match(analysis.gaps[0].rationale, /Identity fit and audience demand are unverified/);
  assert.match(analysis.gaps[0].rationale, /T1 “Repair a wooden chair”/);
  assert.doesNotMatch(analysis.gaps[0].rationale, /proves|enormous|T99/);
  assert.ok(dropped.some(d => /already appears/.test(d.why)));
  assert.ok(dropped.some(d => /cites no video/.test(d.why)));
});
test('proposals are deduplicated for punctuation and case without merging distinct projects', () => {
  const { c, ctx } = base();
  const title = c.raw.videoIdeas[1].title;
  c.raw.videoIdeas = [title, title.toUpperCase() + '!', title + ' today', 'Restore a cabinet using milk paint', 'Build a modular folding workbench'].map(title => ({ title, rationale: 'Workshop project', tags: ['T1'], identityFit: 'high', effort: 'low' }));
  assert.deepEqual(enforceAnalysis(c.raw, ctx).analysis.videoIdeas.map(i => i.title), [title, 'Restore a cabinet using milk paint', 'Build a modular folding workbench']);
});
test('exact Unicode quotes and legacy tagged strings survive; altered or misattributed quotes do not', () => {
  const { c, ctx } = base();
  ctx.top[2] = { ...ctx.top[2], title: 'Café tools: “Sharp” blades — 手工具' };
  c.raw.monetization.signals = [
    { quote: 'Café tools: “Sharp” blades — 手工具', tag: 'T3' },
    'Café tools T3',
    { quote: 'café tools', tag: 'T3' },
    { quote: 'Café tools', tag: 'T1' }
  ];
  assert.deepEqual(enforceAnalysis(c.raw, ctx).analysis.monetization.signals, ['“Café tools: “Sharp” blades — 手工具” (T3)', '“Café tools” (T3)']);
});
test('unsupported type and niche independently abstain and never select the proposed RPM', () => {
  for (const change of [{ channelType: 'brand' }, { channelType: 'media' }, { niche: 'Insurance' }]) {
    const { c, ctx } = base();
    Object.assign(c.raw, change);
    const { analysis, dropped } = enforceAnalysis(c.raw, ctx);
    assert.equal(analysis.quality.channelType, 'unclear');
    assert.equal(analysis.quality.niche, 'Unclear');
    assert.equal(analysis.earningsEstimate.totalEstimate, 'unclear from data');
    assert.equal(analysis.quality.confidence, 'low');
    assert.ok(dropped.some(d => d.kind === 'classification.niche'));
  }
});
test('corroborated labels stay tentative; supported RPM still separates Shorts revenue', () => {
  for (const name of ['shorts-only', 'shorts-long']) {
    const fixture = loadFixture(name);
    fixture.channel.description = 'Personal creator sharing Education tutorials';
    const ctx = context(fixture);
    const raw = structuredClone(cases.find(c => c.fixture === name).raw);
    raw.niche = 'Education';
    const a = enforceAnalysis(raw, ctx).analysis;
    assert.equal(a.quality.channelType, 'creator');
    assert.equal(a.quality.niche, 'Education');
    assert.notEqual(a.earningsEstimate.totalEstimate, 'unclear from data');
    assert.ok(invariantChecks(a, ctx).shortsRevenue.pass);
    assert.notEqual(a.quality.confidence, 'high');
    assert.match(a.quality.limits.join(' '), /not verified/);
  }
});
test('classification requires whole phrases, rejects name-only inference, and preserves media/brand safeguards', () => {
  const { c } = base();
  const fixture = loadFixture('mid');
  fixture.channel.description = 'A media company covering Music';
  c.raw.channelType = 'media';
  c.raw.niche = 'Music';
  const media = enforceAnalysis(c.raw, context(fixture)).analysis;
  assert.equal(media.quality.channelType, 'media');
  assert.equal(media.quality.niche, 'Music');
  fixture.channel.name = 'Insurance';
  fixture.channel.description = 'Official personal creator discussing musical woodworking';
  c.raw.niche = 'Music';
  c.raw.channelType = 'brand';
  const unknown = enforceAnalysis(c.raw, context(fixture)).analysis;
  assert.equal(unknown.quality.channelType, 'unclear');
  assert.equal(unknown.quality.niche, 'Unclear');
  const brand = loadFixture('brand');
  brand.channel.description += ' Consumer Tech';
  const raw = structuredClone(cases.find(c => c.fixture === 'brand').raw);
  const a = enforceAnalysis(raw, context(brand)).analysis;
  assert.equal(a.quality.channelType, 'brand');
  assert.equal(a.quality.niche, 'Consumer Tech');
  assert.deepEqual(a.videoIdeas.map(i => i.title), ['Phone camera lighting experiments']);
  assert.equal(a.earningsEstimate.totalEstimate, 'unclear from data');
});

test('brand safeguards cannot be bypassed by a conflicting model type', () => {
  const fixture = loadFixture('brand');
  fixture.channel.description += ' Consumer Tech';
  const raw = structuredClone(cases.find(c => c.fixture === 'brand').raw);
  raw.channelType = 'creator';
  const a = enforceAnalysis(raw, context(fixture)).analysis;
  assert.equal(a.quality.channelType, 'brand');
  assert.equal(a.earningsEstimate.totalEstimate, 'unclear from data');
  assert.deepEqual(a.monetization.signals, []);
  assert.deepEqual(a.videoIdeas.map(i => i.title), ['Phone camera lighting experiments']);
});
