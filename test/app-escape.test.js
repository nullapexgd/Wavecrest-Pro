// app.html builds the report with innerHTML from model-written values. These four spots once
// interpolated them raw (a hostile channel could run script in a viewer's browser). A browser run
// with a hostile report proved the fix; this guard only stops the exact raw patterns coming back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../app.html', import.meta.url), 'utf8');

test('stat chips, pillar percentages and the avatar letter are never interpolated raw', () => {
  assert.ok(!html.includes('<strong>${c.val}</strong>'), 'chip value must go through esc()');
  assert.ok(!html.includes('${p.percentage}'), 'pillar percentage must be coerced to a clamped number');
  assert.ok(!html.includes("${(channel.name || '?')[0]}"), 'avatar letter must go through esc()');
  assert.ok(html.includes('<strong>${esc(String(c.val))}</strong>'));
  assert.equal((html.match(/Math\.min\(100, Math\.max\(0, Number\(p\.percentage\) \|\| 0\)\)/g) || []).length, 2);
});
