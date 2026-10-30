// Rebuilds the enforcement inputs from a stored report (titles/views/tags as the model saw them)
// and adapts its old-format output into the new raw shape, so the enforcement layer can be run on
// real historical reports without a model call. Approximation: only the T/R videos were stored,
// so facts come from those ~40 videos, and the old output has no identity-fit/effort ratings
// (granted as "medium" so only the deterministic checks decide).
import { readFileSync } from 'node:fs';
import { computeFacts, SHORT_MAX_SECONDS } from '../../lib/analysis-facts.js';
import { computeCadence } from '../../lib/analysis.js';
import { tagsIn } from '../../lib/analysis-enforce.js';

export const REPLAY_NOW = Date.parse('2026-10-29T12:00:00Z');
const stored = JSON.parse(readFileSync(new URL('../fixtures/stored-replays.json', import.meta.url)));

export function loadReplay(key) {
  const r = stored[key];
  const tagMap = new Map();
  const videos = r.videos.map(([tag, title, viewCount, date, duration]) => {
    const v = { id: tag, title, viewCount, likeCount: 0, duration, publishedAt: `${date}T12:00:00Z` };
    tagMap.set(tag, v);
    return v;
  });
  const channel = { name: r.channel.name, subscriberCount: r.channel.subscriberCount, description: '', viewCountTotal: 0 };
  const facts = computeFacts(channel, videos, REPLAY_NOW);
  const top = videos.filter(v => v.id[0] === 'T'), recent = videos.filter(v => v.id[0] === 'R');
  const o = r.old;
  const rate = { identityFit: 'medium' };
  const raw = {
    channelType: r.channel.type, niche: r.channel.niche,
    hooks: { primaryPattern: o.hooks.primaryPattern, patternTags: o.hooks.examples, secondaryPatterns: o.hooks.secondaryPatterns },
    pillars: o.pillars.map(p => ({ name: p.name, description: p.description, tags: tagsIn(p.description) })),
    audience: {},
    monetization: { signals: o.monetization.signals, brandAffinities: [] },
    gaps: o.gaps.map(g => ({ ...g, tags: tagsIn(g.rationale), ...rate })),
    videoIdeas: o.videoIdeas.map(i => ({ title: i.title, rationale: i.rationale, tags: tagsIn(i.rationale), ...rate }))
  };
  return { key, channel, videos, top, recent, facts, tagMap, raw, old: o, ctx: { channel, facts, top, recent, tagMap, cadence: computeCadence(videos), now: REPLAY_NOW } };
}
export const REPLAYS = Object.keys(stored);
export { SHORT_MAX_SECONDS };
