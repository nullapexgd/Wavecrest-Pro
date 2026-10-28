import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCadence, fmtNum } from '../lib/analysis.js';

const vid = (publishedAt, duration = 600) => ({ publishedAt, duration });

test('computeCadence returns empty object for fewer than 2 videos', () => {
  assert.deepEqual(computeCadence([]), {});
  assert.deepEqual(computeCadence([vid('2026-01-01T12:00:00Z')]), {});
});

test('computeCadence computes weekly cadence', () => {
  const videos = [
    vid('2026-01-05T12:00:00Z'),  // Mondays, 7 days apart
    vid('2026-01-12T12:00:00Z'),
    vid('2026-01-19T12:00:00Z'),
    vid('2026-01-26T12:00:00Z')
  ];
  const c = computeCadence(videos);
  assert.equal(c.avgDaysBetweenVideos, 7);
  assert.equal(c.videosPerMonth, 4.3);
  assert.equal(c.peakDay, 'Mon');
});

test('computeCadence duration stats in minutes', () => {
  const videos = [
    vid('2026-01-01T00:00:00Z', 300),   // 5 min
    vid('2026-01-03T00:00:00Z', 900)    // 15 min
  ];
  const c = computeCadence(videos);
  assert.equal(c.avgDurationMinutes, 10);
  assert.equal(c.shortestMinutes, 5);
  assert.equal(c.longestMinutes, 15);
});

test('computeCadence ignores invalid dates and zero durations', () => {
  const videos = [
    vid('2026-01-01T00:00:00Z', 0),
    vid('not-a-date', 600),
    vid('2026-01-08T00:00:00Z', 600)
  ];
  const c = computeCadence(videos);
  assert.equal(c.avgDaysBetweenVideos, 7);
  assert.equal(c.avgDurationMinutes, 10);
});

test('fmtNum formats counts', () => {
  assert.equal(fmtNum(999), '999');
  assert.equal(fmtNum(21_000_000), '21.0M');
  assert.equal(fmtNum(4_500), '5K');
});

import { buildEvidence } from '../lib/analysis.js';

test('buildEvidence tags each list uniquely and merges a video that is in both', () => {
  const v = (id, viewCount, duration = 600) => ({ id, title: `t-${id}`, publishedAt: '2026-01-01T00:00:00Z', viewCount, likeCount: 5, duration });
  const top = [v('a', 900), v('b', 500, 45)];
  const recent = [v('b', 500, 45), v('c', 10)];
  const ev = buildEvidence(top, recent, 400, '2026-02-01T00:00:00Z');
  assert.equal(ev.videos.length, 3);
  const byId = Object.fromEntries(ev.videos.map(x => [x.id, x]));
  assert.deepEqual(byId.b.tags, ['T2', 'R1']);
  assert.deepEqual(byId.a.tags, ['T1']);
  assert.equal(byId.b.short, true);
  assert.equal(byId.a.short, false);
  assert.equal(ev.medianViews, 400);
});
