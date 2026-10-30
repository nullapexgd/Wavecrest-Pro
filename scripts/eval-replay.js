#!/usr/bin/env node
import { loadReplay, REPLAYS } from '../test/helpers/replay.js';
import { enforceAnalysis } from '../lib/analysis-enforce.js';

const rows = [];
for (const name of REPLAYS) {
  const r = loadReplay(name);
  const { analysis: a, dropped } = enforceAnalysis(r.raw, r.ctx);
  rows.push({ channel: r.channel.name, section: 'hook examples', old: r.old.hooks.examples.length, new: a.hooks.examples.length });
  for (const section of ['pillars', 'gaps', 'videoIdeas']) rows.push({ channel: r.channel.name, section, old: r.old[section].length, new: a[section].length });
  rows.push({ channel: r.channel.name, section: 'monetization signals', old: r.old.monetization.signals.length, new: a.monetization.signals.length });
  rows.push({ channel: r.channel.name, section: 'idea forecasts', old: r.old.videoIdeas.filter(i => /views|avg/.test(i.estimatedPerformance)).length, new: 0 });
  rows.push({ channel: r.channel.name, section: 'rejected claims', old: 'unvalidated', new: dropped.length });
}
console.table(rows);
console.log('Replay approximation: stored cited videos only; fit defaults to medium. No model or network calls.');
