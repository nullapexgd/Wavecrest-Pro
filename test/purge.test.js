// The 30-day statistics purge: every report shape our own enforcement produces comes out with no YouTube
// statistics left, the analysis text survives, and running it twice changes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { enforceAnalysis } from '../lib/analysis-enforce.js';
import { buildEvidence } from '../lib/analysis.js';
import { purgeAnalysis, isPurgeDue, isPurged, PURGE_AFTER_DAYS } from '../lib/purge.js';
import { context, loadFixture } from '../scripts/eval-live.js';

const casesDir = new URL('./eval/cases/', import.meta.url);
const cases = readdirSync(casesDir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(new URL(f, casesDir), 'utf8')));

// What a reader could take for a YouTube statistic: counts of views/likes, multiples of a median, money, rates.
const STAT = /\d[\d.,]*\s?[KMB]?\s+(?:views|likes|subscribers)|\d\s?×|×\s?\d|\$\s?\d|% of views|\bmedian [\d]/i;

function stored(c) {
  const ctx = context(loadFixture(c.fixture));
  const { analysis } = enforceAnalysis(structuredClone(c.raw), ctx);
  return { ...analysis, evidence: buildEvidence(ctx.top, ctx.recent, ctx.facts.medianViews) };
}

for (const c of cases) {
  test(`${c.fixture}: purge removes every statistic, keeps the text, and is idempotent`, () => {
    const a = stored(c);
    const p = purgeAnalysis(a, '2026-12-01T00:00:00Z');
    assert.ok(isPurged(p) && !isPurged(a), 'marked purged; input untouched');
    assert.equal(p.stats, undefined);
    assert.equal(p.earningsEstimate, undefined);
    assert.equal(p.evidence.medianViews, 0);
    assert.ok(p.evidence.videos.length > 0 && p.evidence.videos.every(v => v.views === 0 && v.likes === 0 && v.title && v.id));
    assert.deepEqual(p.videoIdeas.map(i => i.title), a.videoIdeas.map(i => i.title), 'idea titles survive');
    assert.equal(p.hooks.primaryPattern, a.hooks.primaryPattern, 'analysis text survives');
    assert.deepEqual(purgeAnalysis(p), p, 'second purge changes nothing');
    const left = JSON.stringify({ ...p, evidence: { ...p.evidence, videos: p.evidence.videos.map(({ title, ...v }) => v) } }).match(STAT);
    assert.equal(left, null, `a statistic survived the purge: ${left?.[0]}`);
  });
}

test('the 30-day boundary', () => {
  const now = Date.parse('2026-12-01T00:00:00Z'), day = 86_400_000;
  assert.equal(isPurgeDue(new Date(now - (PURGE_AFTER_DAYS - 0.01) * day), now), false);
  assert.equal(isPurgeDue(new Date(now - PURGE_AFTER_DAYS * day), now), true);
  assert.equal(isPurgeDue('not a date', now), false);
});

test('reports in older formats are purged of structured statistics without throwing', () => {
  const legacy = { hooks: { primaryPattern: 'x' }, earningsEstimate: { cpmRange: '$2-6', monthlyViewsEstimate: 1000 }, pillars: 'not an array' };
  const p = purgeAnalysis(legacy);
  assert.equal(p.earningsEstimate, undefined);
  assert.equal(p.hooks.primaryPattern, 'x');
  assert.equal(purgeAnalysis(null), null);
});
