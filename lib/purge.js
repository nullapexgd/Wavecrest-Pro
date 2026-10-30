// YouTube API data policy: statistics retrieved without the channel owner's authorisation may not be stored
// for more than 30 days. After PURGE_AFTER_DAYS a stored report keeps its analysis text, but every YouTube
// statistic goes: views, likes, medians, subscriber count, revenue maths, and the sentences our own code
// generated around those numbers. A purged report is marked (`statsPurgedAt`) so it is never purged twice and
// the page can say what happened.
//
// Limit, stated plainly: the sentences our code generates are known templates and are scrubbed exactly. Prose the
// model wrote (hook patterns, pillar descriptions, audience notes) is kept as written; the enforcement layer
// blocks numeric performance claims in ideas, but this module does not rewrite free text.
export const PURGE_AFTER_DAYS = 30;
export const PURGED_NOTE = 'Statistics were removed after 30 days.';
const DAY = 86_400_000;

export const isPurgeDue = (createdAt, now = Date.now()) => {
  const t = new Date(createdAt).getTime();
  return Number.isFinite(t) && now - t >= PURGE_AFTER_DAYS * DAY;
};
export const isPurged = analysis => Boolean(analysis?.statsPurgedAt);

// Templates written by lib/analysis-enforce.js; if one changes, the test in test/purge.test.js fails.
const IDEA_STATS = / \([\d.,]+[KM]? views, [\d.]+× its (?:Shorts|long-form) median\)/g;
const DURATION_STATS = /; long-form median [\d.,]+[KM]? views, Shorts [\d.,]+[KM]?\./;
const CONCENTRATION_LIMIT = /of the top-20 views/;

export function purgeAnalysis(analysis, at = new Date().toISOString()) {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis) || isPurged(analysis)) return analysis;
  const out = JSON.parse(JSON.stringify(analysis));
  delete out.stats;
  delete out.earningsEstimate;
  if (out.hooks) delete out.hooks.medianMultiple;
  for (const p of out.pillars || []) delete p.medianMultiple;
  if (out.evidence) {
    out.evidence.medianViews = 0;
    for (const v of out.evidence.videos || []) { v.views = 0; v.likes = 0; }
  }
  for (const i of out.videoIdeas || []) {
    if (typeof i.rationale === 'string') i.rationale = i.rationale.replace(IDEA_STATS, '');
    if (i.estimatedPerformance) i.estimatedPerformance = PURGED_NOTE;
  }
  if (out.cadence?.durationStrategy) out.cadence.durationStrategy = out.cadence.durationStrategy.replace(DURATION_STATS, '.');
  if (out.audience?.loyaltySignal) out.audience.loyaltySignal = PURGED_NOTE;
  if (Array.isArray(out.quality?.limits)) out.quality.limits = out.quality.limits.filter(l => !CONCENTRATION_LIMIT.test(l));
  out.statsPurgedAt = at;
  return out;
}
