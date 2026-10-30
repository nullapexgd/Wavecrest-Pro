import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enforceAnalysis } from '../../lib/analysis-enforce.js';
import { buildEvidence } from '../../lib/analysis.js';
import { context, fixtureNames, loadFixture } from '../../scripts/eval-live.js';
import { loadReplay, REPLAYS } from '../helpers/replay.js';

// Mirror Analysis in web/src/app/types.ts. Every field is optional; extra fields
// are allowed (stats/quality and future extensions). Evidence mirrors evidence.ts.
const strings = names => Object.fromEntries(names.split(' ').map(name => [name, 'string']));
const numbers = names => Object.fromEntries(names.split(' ').map(name => [name, 'number']));
const contract = {
  hooks: { ...strings('primaryPattern frequency'), examples: ['string'], secondaryPatterns: ['string'] },
  thumbnails: { ...strings('formula textOverlayStyle'), characteristics: ['string'] },
  cadence: { ...strings('schedule consistency durationStrategy peakPerformanceWindow peakDay'), ...numbers('avgDaysBetweenVideos videosPerMonth avgDurationMinutes') },
  audience: strings('primaryProfile estimatedAge viewerIntent loyaltySignal'),
  pillars: [{ ...strings('name description'), percentage: 'number' }],
  monetization: { ...strings('primaryApproach brandAffinities'), signals: ['string'] },
  gaps: [strings('opportunity rationale')],
  earningsEstimate: { ...strings('cpmRPM cpmRange estimatedMonthlyAdRevenue otherRevenue totalEstimate'), monthlyViewsEstimate: 'number' },
  videoIdeas: [strings('title rationale estimatedPerformance')],
  evidence: { medianViews: 'number', computedAt: 'string', videos: [{ ...strings('id title publishedAt'), ...numbers('views likes duration'), short: 'boolean', tags: ['string'] }] }
};
function check(value, shape, path = 'analysis') {
  if (typeof shape === 'string') {
    assert.equal(typeof value, shape, path);
    if (shape === 'number') assert.ok(Number.isFinite(value), path);
  } else if (Array.isArray(shape)) {
    assert.ok(Array.isArray(value), path);
    value.forEach((item, i) => check(item, shape[0], `${path}[${i}]`));
  } else {
    assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), path);
    for (const [key, field] of Object.entries(shape)) if (value[key] !== undefined) check(value[key], field, `${path}.${key}`);
  }
}
function checkAnalysis(value) {
  check(value, contract);
  // Unlike Analysis fields, fields within a supplied Evidence are required.
  if (value.evidence !== undefined) {
    for (const key of ['medianViews', 'computedAt', 'videos']) assert.notEqual(value.evidence[key], undefined, `evidence.${key}`);
    for (const video of value.evidence.videos) for (const key of Object.keys(contract.evidence.videos[0])) assert.notEqual(video[key], undefined, `evidence.video.${key}`);
  }
}
const historical = JSON.parse(readFileSync(new URL('../fixtures/historical-reports.json', import.meta.url), 'utf8'));
for (const row of historical) test(`schema: historical ${row.version}`, () => checkAnalysis(row.report.analysis));
for (const name of fixtureNames()) test(`schema: enforced ${name}, with and without stored evidence`, () => {
  const ctx = context(loadFixture(name));
  const c = JSON.parse(readFileSync(new URL(`./cases/${name}.json`, import.meta.url), 'utf8'));
  const { analysis } = enforceAnalysis(c.raw, ctx);
  checkAnalysis(analysis);
  checkAnalysis(JSON.parse(JSON.stringify(analysis)));
  checkAnalysis({ ...analysis, evidence: buildEvidence(ctx.top, ctx.recent, ctx.facts.medianViews, new Date(ctx.now).toISOString()) });
});
for (const name of REPLAYS) test(`schema: stored replay ${name}`, () => {
  const r = loadReplay(name);
  checkAnalysis(enforceAnalysis(r.raw, r.ctx).analysis);
});
test('schema checker accepts optional fields and rejects wrong nested types', () => {
  for (const valid of [{}, { hooks: {} }, { earningsEstimate: { cpmRange: 'legacy' } }, { stats: { future: true } }]) checkAnalysis(valid);
  for (const invalid of [null, [], { hooks: [] }, { hooks: { examples: [7] } }, { audience: { estimatedAge: 21 } }, { cadence: { videosPerMonth: '4' } }, { pillars: [{ percentage: NaN }] }, { gaps: {} }, { videoIdeas: [{ title: false }] }, { evidence: {} }, { evidence: { medianViews: 1, computedAt: 'now', videos: [{}] } }]) assert.throws(() => checkAnalysis(invalid));
});
