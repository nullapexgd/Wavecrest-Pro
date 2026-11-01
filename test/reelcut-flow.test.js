import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partsOf, captionsFor, clock, PART_CHARS } from '../web/src/reelcut/flow.ts';

const line = (s, e, text) => ({ start: s, end: e, text });

test('a transcript is split into parts that each fit one clip search, in order, losing nothing', () => {
  const chunks = Array.from({ length: 50 }, (_, i) => line(i * 10, i * 10 + 10, 'x'.repeat(1000)));
  const parts = partsOf(chunks);
  assert.ok(parts.length >= 3);
  for (const p of parts) assert.ok(p.reduce((n, c) => n + c.text.length, 0) <= PART_CHARS);
  assert.deepEqual(parts.flat(), chunks);
  assert.deepEqual(partsOf([]), []);
  assert.equal(partsOf([line(0, 1, 'x'.repeat(PART_CHARS + 5))]).length, 1); // one huge line is kept whole, the server will refuse it
});

test('captions are short phrases inside the clip, timed within their line', () => {
  const caps = captionsFor([line(10, 20, 'one two three four five six seven eight nine ten')], 12, 18);
  assert.ok(caps.length >= 1);
  for (const c of caps) { assert.ok(c.start >= 12 && c.end <= 18 && c.end > c.start); assert.ok(c.text.split(' ').length <= 5); }
  assert.deepEqual(captionsFor([line(0, 5, 'before the clip')], 10, 20), []);
  assert.deepEqual(captionsFor([line(30, 40, 'after the clip')], 10, 20), []);
});

test('clock formats seconds', () => { assert.equal(clock(65), '1:05'); assert.equal(clock(3605), '60:05'); });
