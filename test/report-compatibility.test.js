// Synthetic reports with the keys emitted by the historical prompts, not production data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderReport } from '../web/src/app/report.ts';
import { toClientReport } from '../lib/reports.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/historical-reports.json', import.meta.url)));
for (const { version, report } of fixtures) {
  test(`${version}: historical analysis survives the API mapping and renders without evidence`, () => {
    const before = structuredClone(report);
    const row = {
      id: report.reportId, channel_name: report.channel.name, channel_handle: report.channel.handle,
      subscriber_count: report.channel.subscriberCount, video_count: report.videoCount,
      analysis: report.analysis, created_at: report.createdAt, visibility: report.visibility, user_id: 'owner'
    };
    const mapped = toClientReport(row, null);
    assert.deepEqual(mapped.analysis, report.analysis, 'the API must not drop legacy keys');
    assert.equal(mapped.isOwner, false);
    assert.ok(!Object.hasOwn(mapped, 'user_id'));
    const html = renderReport(mapped);
    for (const section of ['next', 'map', 'hooks', 'thumbnails', 'cadence', 'audience', 'pillars', 'monetization', 'gaps', 'earnings', 'evidence']) {
      assert.ok(html.includes(`id="s-${section}"`), section);
    }
    for (const text of ['I tested a familiar assumption', 'Hands-on tests', 'Repair guide', 'Curious makers']) {
      assert.ok(html.includes(text), `${text} is preserved`);
    }
    assert.ok(html.includes('made before Wavecrest saved its evidence'));
    assert.ok(!html.includes('class="cite"'), 'old citations stay plain text');
    assert.ok(!html.includes('undefined') && !html.includes('NaN'));
    if (version === 'v0') {
      assert.ok(html.includes('This report has no video ideas.'));
      assert.ok(html.includes('There was not enough evidence for a revenue range'));
    } else {
      assert.ok(html.includes('I tested a repair method'));
      assert.ok(html.includes('video #3 and T1'));
      assert.ok(html.includes('Evidence not saved for this older report'));
      assert.ok(html.includes('Not a forecast'));
      assert.ok(html.includes(report.analysis.earningsEstimate.estimatedMonthlyAdRevenue));
    }
    assert.deepEqual(report, before, 'rendering must not rewrite stored analysis');
  });
}
