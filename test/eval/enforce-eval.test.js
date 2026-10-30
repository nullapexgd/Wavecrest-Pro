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
    assert.deepEqual(a.gaps.map(g => g.opportunity), c.expected.gapOpportunities);
    assert.equal(a.quality.channelType, c.expected.channelType);
    assert.equal(a.quality.niche, c.expected.niche);
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

// These express desired guarantees that the current layer does not enforce.
// Ownership requires Claude to fix lib/; keep the failing reproductions executable.
const base = () => {
  const c = structuredClone(cases.find(c => c.fixture === 'mid'));
  return { c, ctx: context(loadFixture('mid')) };
};
test('TODO: forecasts in idea titles are removed', { todo: true }, () => {
  const { c, ctx } = base();
  c.raw.videoIdeas = [{ title: 'Repair a gate for 300% growth', rationale: 'A practical workshop project', tags: ['T1'], identityFit: 'high', effort: 'low' }];
  const { analysis } = enforceAnalysis(c.raw, ctx);
  assert.ok(invariantChecks(analysis, ctx).forecasts.pass);
});
test('TODO: citations for a gap must support its identity fit', { todo: true }, () => {
  const { c, ctx } = base();
  c.raw.gaps = [{ opportunity: 'Celebrity yacht gossip', rationale: 'Repair tutorials prove celebrity demand T1', tags: ['T1'], identityFit: 'high' }];
  assert.deepEqual(enforceAnalysis(c.raw, ctx).analysis.gaps, []);
});
test('TODO: duplicate proposed ideas are deduplicated against each other', { todo: true }, () => {
  const { c, ctx } = base();
  c.raw.videoIdeas = [c.raw.videoIdeas[1], c.raw.videoIdeas[1]];
  const ideas = enforceAnalysis(c.raw, ctx).analysis.videoIdeas;
  assert.equal(new Set(ideas.map(i => i.title)).size, ideas.length);
});
test('TODO: plausible but wrong channel classification stays unknown', { todo: true }, () => {
  const { c, ctx } = base();
  c.raw.channelType = 'brand';
  c.raw.niche = 'Insurance';
  const a = enforceAnalysis(c.raw, ctx).analysis;
  assert.equal(a.quality.channelType, 'unclear');
  assert.equal(a.quality.niche, 'Unclear');
});
test('TODO: monetization quotes must be verbatim, including punctuation', { todo: true }, () => {
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
