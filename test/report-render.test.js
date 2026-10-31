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

test('a purged report renders without zero views, NaN or invented numbers, and says what happened', () => {
  const purgedEv = { ...ev, medianViews: 0, videos: ev.videos.map(v => ({ ...v, views: 0, likes: 0 })) };
  const html = renderReport(report({
    statsPurgedAt: '2026-03-05T00:00:00Z', evidence: purgedEv,
    videoIdeas: [{ title: 'Idea', rationale: 'Builds on T1.', estimatedPerformance: 'Statistics were removed after 30 days.' }],
    hooks: { primaryPattern: 'kept text' }
  }, { channel: { name: 'Chan', subscriberCount: 0 } }));
  assert.match(html, /Statistics removed\./);
  assert.match(html, /kept text/, 'analysis text survives');
  assert.doesNotMatch(html, /NaN|Infinity|undefined/);
  assert.doesNotMatch(html, /\b0 views\b/, 'a purged count is never shown as zero');
  assert.match(html, /Removed after 30 days\./, 'sections built from statistics say so');
  assert.match(html, /Removed<\/span>/, 'subscribers and median show as removed, not unavailable');
});

test('a report that is not purged shows no purge notice', () => {
  assert.doesNotMatch(renderReport(report({ evidence: ev })), /Statistics removed/);
});

// "Clip these": long videos that clearly beat the channel median, chosen by arithmetic on stored evidence.
import { clipPicks } from '../web/src/app/evidence.ts';
import { reelcutLink } from '../web/src/app/report.ts';
const long = (id, title, views, extra = {}) => ({ id, title, publishedAt: '2026-02-01T00:00:00Z', views, likes: 10, duration: 900, short: false, tags: [id], ...extra });
const clipEv = { medianViews: 1000, computedAt: '2026-02-01T00:00:00Z', videos: [
  long('hit1', 'Big hit', 4000), long('hit2', 'Solid', 2000), long('meh', 'Below bar', 1200), long('tiny', 'Too short a video', 5000, { duration: 300 }),
  long('shortv', 'A Short', 9000, { short: true, duration: 40 }), long('noviews', 'No views', 0)] };

test('clip picks: long-form, 8+ minutes, at least 1.5x the median, best first, nothing invented', () => {
  const picks = clipPicks(clipEv, [{ title: 'Follow up the hit', rationale: 'Builds on hit1.' }, { title: 'Cited by tag', rationale: 'Builds on T2.' }]);
  assert.deepEqual(picks.map(p => p.video.id), ['hit1', 'hit2']);
  assert.deepEqual(picks.map(p => p.multiple), [4, 2]);
  assert.deepEqual(clipPicks(undefined), []);
  assert.deepEqual(clipPicks({ ...clipEv, medianViews: 0 }), [], 'a purged report (no median) has no picks');
  assert.equal(clipPicks(clipEv, [], 1).length, 1);
});
test('clip picks attach the first idea that cites the video', () => {
  const ev = { ...clipEv, videos: [long('aaa', 'Hit', 4000, { tags: ['T1'] }), long('bbb', 'Other', 3000, { tags: ['T2'] })] };
  const picks = clipPicks(ev, [{ title: 'Idea one', rationale: 'Builds on T1 and T2.' }, { title: 'Idea two', rationale: 'Builds on T2.' }]);
  assert.deepEqual(picks.map(p => p.idea), ['Idea one', 'Idea one']);
});
test('Send to Reelcut is a plain link carrying the video and a brief, escaped', () => {
  const link = new URL(reelcutLink('abc123', 'Say "hi" & <go>'));
  assert.equal(link.origin, 'http://127.0.0.1:3000');
  assert.equal(link.searchParams.get('url'), 'https://www.youtube.com/watch?v=abc123');
  assert.match(link.searchParams.get('instructions'), /Say "hi" & <go>/);
  assert.ok(link.searchParams.get('instructions').length < 400);
});
test('the report lists the picks with working links, and says so when there are none or the numbers were purged', () => {
  const idea = [{ title: 'Follow up', rationale: 'Builds on T1.' }];
  const ev = { ...clipEv, videos: [long('aaa', 'Hit <b>x</b>', 4000, { tags: ['T1'] }), long('bbb', 'Meh', 900, { tags: ['T2'] })] };
  const html = renderReport(report({ evidence: ev, videoIdeas: idea }));
  assert.match(html, /id="s-clips"/);
  assert.match(html, /href="http:\/\/127\.0\.0\.1:3000\/\?url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3Daaa/);
  assert.doesNotMatch(html, /<b>x<\/b>/, 'titles are escaped');
  assert.match(html, /Copy this list as JSON/);
  assert.match(renderReport(report({ evidence: { ...ev, videos: [long('bbb', 'Meh', 900)] } })), /No long video in this report clearly beat/);
  assert.match(renderReport(report({ hooks: {} })), /made before Wavecrest saved its video data/);
  assert.match(renderReport(report({ statsPurgedAt: '2026-03-05T00:00:00Z', evidence: { ...ev, medianViews: 0, videos: ev.videos.map(v => ({ ...v, views: 0 })) } })), /Removed after 30 days/);
});

test('hook examples stored as citation tags show the video they point to, not "Not matched"', () => {
  const html = renderReport(report({ evidence: ev, hooks: { primaryPattern: 'x', examples: ['T1', ' R1 ', 'T99', 'A real title that is not in the evidence'] } }));
  const hooks = html.slice(html.indexOf('id="s-hooks"'), html.indexOf('id="s-thumbnails"'));
  assert.match(hooks, /<q>Alpha video<\/q>[\s\S]*?Real title/, 'T1 resolves to its title');
  assert.match(hooks, /data-tag="T1"/, 'and keeps a button that opens the evidence');
  assert.equal((hooks.match(/Not matched to a saved title/g) ?? []).length, 2, 'only T99 and the unknown title stay unmatched');
  assert.doesNotMatch(hooks, /<q>T1<\/q>/);
});
