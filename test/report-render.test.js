// The analyzer's report renderer and evidence rules (web/src/app). These run in Node because
// they are plain functions of data: no DOM, no server, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citedTags, resolveCitations, strengthOf, isRealTitle, multiple } from '../web/src/app/evidence.ts';
import { renderReport, cite } from '../web/src/app/report.ts';

const vid = (id, title, views, tags) => ({ id, title, publishedAt: '2026-01-0' + id.length + 'T00:00:00Z', views, likes: 10, duration: 600, short: false, tags });
const ev = { medianViews: 1000, computedAt: '2026-02-01T00:00:00Z', videos: [vid('aaa', 'Alpha video', 4000, ['T1']), vid('bbbb', 'Beta video', 2000, ['T2', 'R1']), vid('ccccc', 'Gamma', 500, ['T3'])] };
const report = (analysis, extra = {}) => ({
  reportId: 'r1', channel: { name: 'Chan', handle: '@chan', subscriberCount: 1234 }, videoCount: 3,
  analysis, createdAt: '2026-02-01T00:00:00Z', visibility: 'private', isOwner: true, ...extra
});

test('citations resolve to stored videos; unknown tags are reported, not invented', () => {
  assert.deepEqual(citedTags('see T1, then R1 and T1 again, also T99'), ['T1', 'R1', 'T99']);
  const r = resolveCitations('based on T1 and T2 and T99', ev);
  assert.deepEqual(r.videos.map(v => v.id), ['aaa', 'bbbb']);
  assert.deepEqual(r.missing, ['T99']);
  assert.equal(resolveCitations('T1', undefined).videos.length, 0);
});

test('evidence strength comes from counted citations only', () => {
  assert.equal(strengthOf(0), 'none');
  assert.equal(strengthOf(1), 'thin');
  assert.equal(strengthOf(2), 'moderate');
  assert.equal(strengthOf(3), 'strong');
  assert.equal(strengthOf(9), 'strong');
});

test('a quoted title is "real" only if it matches a stored title', () => {
  assert.equal(isRealTitle('Alpha video', ev), true);
  assert.equal(isRealTitle('  alpha   VIDEO!', ev), true);
  assert.equal(isRealTitle('Alpha videos', ev), false);
  assert.equal(isRealTitle('Alpha video', undefined), false);
  assert.equal(multiple({ views: 4000 }, ev), 4);
});

test('model and YouTube text is escaped everywhere it is rendered', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const html = renderReport(report({
    evidence: { ...ev, videos: [{ ...ev.videos[0], title: evil }, ...ev.videos.slice(1)] },
    hooks: { primaryPattern: evil, examples: [evil], secondaryPatterns: [evil] },
    pillars: [{ name: evil, percentage: 100, description: evil }],
    gaps: [{ opportunity: evil, rationale: evil }],
    videoIdeas: [{ title: evil, rationale: `${evil} T1`, estimatedPerformance: evil }],
    audience: { primaryProfile: evil }, monetization: { primaryApproach: evil, signals: [evil], brandAffinities: evil },
    cadence: { schedule: evil }, thumbnails: { formula: evil, characteristics: [evil], textOverlayStyle: evil },
    earningsEstimate: { totalEstimate: '$1', estimatedMonthlyAdRevenue: evil, cpmRPM: evil, otherRevenue: evil, monthlyViewsEstimate: 5 }
  }, { channel: { name: evil, handle: evil, thumbnailUrl: 'https://x/"onerror="alert(3)' } }));
  assert.ok(!html.includes('<script'), 'no raw script tag');
  assert.ok(!html.includes('<img src=x'), 'no raw injected img');
  assert.ok(!/ onerror="alert\(3\)/.test(html), 'attribute values are escaped');
  assert.ok(html.includes('&lt;img src=x'), 'the text is still shown, escaped');
});

test('an older report with no stored evidence renders cleanly and says why', () => {
  const html = renderReport(report({
    hooks: { primaryPattern: 'A pattern', examples: ['Some title'] },
    videoIdeas: [{ title: 'An idea', rationale: 'Because of video #3 and T1', estimatedPerformance: 'maybe' }]
  }));
  assert.ok(html.includes('Evidence not saved for this older report'));
  assert.ok(html.includes('made before Wavecrest saved its evidence'));
  assert.ok(!html.includes('class="cite"'), 'no citation buttons without evidence');
  assert.ok(html.includes('video #3'), 'old-style citations stay as plain text');
  assert.equal(cite('see T1', undefined), 'see T1');
});

test('a report with nothing in it still renders every section as an honest empty state', () => {
  const html = renderReport(report({}, { channel: { name: 'Empty' } }));
  for (const id of ['next', 'map', 'hooks', 'thumbnails', 'cadence', 'audience', 'pillars', 'monetization', 'gaps', 'earnings', 'evidence']) {
    assert.ok(html.includes(`id="s-${id}"`), `section ${id} present`);
  }
  assert.ok(html.includes('Unavailable'));
});

test('recommendations carry their evidence, strength and the not-a-forecast caveat', () => {
  const html = renderReport(report({
    evidence: ev,
    videoIdeas: [{ title: 'Do the thing', rationale: 'Built on T1, T2 and T3.', estimatedPerformance: 'about 10k' }]
  }));
  assert.ok(html.includes('Strong evidence'));
  assert.ok(html.includes('3 cited videos'));
  assert.ok(html.includes('Not a forecast'));
  assert.ok(html.includes('data-video="aaa"'));
});

test('list-valued fields render as real lists, not escaped markup', () => {
  const html = renderReport(report({
    hooks: { primaryPattern: 'p', secondaryPatterns: ['one', 'two'] },
    thumbnails: { formula: 'f', characteristics: ['a', 'b'] }
  }));
  assert.ok(!html.includes('&lt;ul'), 'no literal <ul> text');
  assert.ok(html.includes('<li>one</li>') && html.includes('<li>b</li>'));
});
