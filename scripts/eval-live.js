#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { computeFacts, NICHE_RPM } from '../lib/analysis-facts.js';
import { buildPrompt, SYSTEM_PROMPT, computeCadence, runAnalysis } from '../lib/analysis.js';
import { enforceAnalysis } from '../lib/analysis-enforce.js';

export const EVAL_NOW = Date.parse('2026-10-29T12:00:00Z');
const fixtureDir = new URL('../test/eval/fixtures/', import.meta.url);
export const fixtureNames = () => readdirSync(fixtureDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
export const loadFixture = name => {
  assert.ok(fixtureNames().includes(name), `Unknown fixture: ${name}`);
  return JSON.parse(readFileSync(new URL(`${name}.json`, fixtureDir), 'utf8'));
};
export function context(fixture, now = EVAL_NOW) {
  const { channel, videos } = fixture;
  const facts = computeFacts(channel, videos, now);
  return { channel, facts, top: facts.top20, recent: [...videos].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, 30), cadence: computeCadence(videos), now };
}
export function invariantChecks(a, ctx) {
  const tags = new Map([...ctx.top.map((v, i) => [`T${i + 1}`, v]), ...ctx.recent.map((v, i) => [`R${i + 1}`, v])]);
  const checks = {
    legacyKeys() {
      for (const key of ['hooks', 'thumbnails', 'cadence', 'audience', 'monetization', 'earningsEstimate']) {
        assert.ok(a[key] && typeof a[key] === 'object' && !Array.isArray(a[key]), key);
      }
      for (const key of ['pillars', 'gaps', 'videoIdeas']) assert.ok(Array.isArray(a[key]), key);
    },
    evidence() {
      for (const title of a.hooks.examples || []) assert.ok([...tags.values()].some(v => v.title === title), title);
      for (const signal of a.monetization.signals) {
        const match = signal.match(/^“(.*)” \(([TR]\d+)\)$/u);
        assert.ok(match, signal);
        assert.ok(tags.get(match[2])?.title.includes(match[1]), signal);
      }
      for (const idea of a.videoIdeas) {
        for (const match of idea.rationale.matchAll(/\b([TR]\d+) “([^”]+)”/gu)) assert.equal(tags.get(match[1])?.title, match[2]);
      }
    },
    pillarShares() {
      if (a.pillars.length) assert.equal(a.pillars.reduce((sum, p) => sum + p.percentage, 0), 100);
      for (const p of a.pillars) assert.ok(Number.isInteger(p.percentage) && p.percentage >= 0 && p.percentage <= 100);
    },
    forecasts() {
      for (const idea of a.videoIdeas) {
        // The appended citation lines and estimatedPerformance contain computed historical multiples.
        const modelProse = idea.rationale.split('Builds on ')[0];
        assert.doesNotMatch(idea.title + ' ' + modelProse, /\d[\d.,]*\s*[×%]\s*(?:(?:more|higher|the)\s+)*(?:growth|views?|subscribers?|engagement|revenue|median)\b/i);
        assert.doesNotMatch(idea.estimatedPerformance, /\d.*(?:will|forecast of|expected views)/i);
      }
    },
    unknowns() {
      assert.match(a.audience.estimatedAge, /^Unknown/i);
      assert.match(a.earningsEstimate.otherRevenue, /^Unknown/i);
      assert.deepEqual(a.thumbnails.characteristics, []);
      assert.match(a.thumbnails.formula, /Not analyzed/);
    },
    shortsRevenue() {
      const rpm = NICHE_RPM[a.quality.niche];
      if (!ctx.facts.shortsCount || !rpm || a.quality.channelType === 'brand') return;
      const numbers = a.earningsEstimate.totalEstimate.match(/^\$([\d,]+)–\$([\d,]+)\/month$/);
      assert.ok(numbers);
      const high = Number(numbers[2].replaceAll(',', ''));
      const blended = a.earningsEstimate.monthlyViewsRange[1] * rpm[1] / 1000;
      assert.ok(high < blended, `${high} must be below long-form blend ${blended}`);
    },
    serializable() {
      const json = JSON.stringify(a);
      assert.ok(Buffer.byteLength(json) < 30000);
      const visit = value => {
        if (typeof value === 'number') assert.ok(Number.isFinite(value));
        if (value && typeof value === 'object') Object.values(value).forEach(visit);
      };
      visit(a);
      assert.ok(JSON.parse(json));
    }
  };
  return Object.fromEntries(Object.entries(checks).map(([name, check]) => {
    try { check(); return [name, { pass: true }]; }
    catch (error) { return [name, { pass: false, message: error.message }]; }
  }));
}
export function scorecard(raw, analysis, dropped) {
  const rows = [];
  const count = value => Array.isArray(value) ? value.length : 0;
  const text = value => typeof value === 'string' ? value.trim() : '';
  const add = (section, proposed, kept) => rows.push({ section, proposed, kept, dropped: Math.max(0, proposed - kept) });
  add('hooks (patterns)', Number(Boolean(raw.hooks?.primaryPattern)) + count(raw.hooks?.secondaryPatterns), Number(Boolean(analysis.hooks.examples.length)) + analysis.hooks.secondaryPatterns.length);
  add('pillars', count(raw.pillars), analysis.pillars.length);
  add('audience (fields)', Number(Boolean(raw.audience?.primaryProfile)) + Number(Boolean(raw.audience?.viewerIntent)), Number(Boolean(raw.audience?.primaryProfile) && analysis.audience.primaryProfile === text(raw.audience.primaryProfile)) + Number(Boolean(raw.audience?.viewerIntent) && analysis.audience.viewerIntent === `${text(raw.audience.viewerIntent)} (inferred)`));
  add('monetization (signals)', count(raw.monetization?.signals), analysis.monetization.signals.length);
  add('gaps', count(raw.gaps), analysis.gaps.length);
  add('ideas (titles)', count(raw.videoIdeas), analysis.videoIdeas.length);
  return { sections: rows, diagnostics: dropped };
}

async function main(args) {
  let names = fixtureNames(), dry = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry') dry = true;
    else if (args[i] === '--fixtures' && args[i + 1]) names = args[++i].split(',');
    else throw new Error('Usage: node scripts/eval-live.js [--fixtures a,b] [--dry]');
  }
  const fixtures = names.map(name => ({ name, fixture: loadFixture(name) }));
  if (!dry && !process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is absent. Set it in the process environment or use --dry.');
  let failed = false;
  for (const { name, fixture } of fixtures) {
    const ctx = context(fixture, dry ? EVAL_NOW : Date.now());
    if (dry) {
      const prompt = `${SYSTEM_PROMPT}\n\n${buildPrompt(ctx.channel, ctx.facts, ctx.top, ctx.recent)}`;
      console.log(`\n${name}: ~${Math.ceil(prompt.length / 4)} input tokens (rough chars/4 estimate)\n${prompt}`);
      continue;
    }
    // Capture only the response JSON so runAnalysis stays the production entry point.
    // Neither request options nor upstream error bodies are logged or saved.
    const originalFetch = globalThis.fetch;
    let raw;
    let analysis;
    try {
      globalThis.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (response.ok) {
          const body = await response.clone().json();
          raw = JSON.parse(body.choices[0].message.content);
        }
        return response;
      };
      analysis = await runAnalysis(fixture.channel, fixture.videos, process.env.GROQ_API_KEY, AbortSignal.timeout(120000));
    } catch {
      throw new Error(`Live evaluation failed for ${name}; check model availability and credentials. Upstream details suppressed.`);
    } finally { globalThis.fetch = originalFetch; }
    const { dropped } = enforceAnalysis(raw, ctx);
    const scores = scorecard(raw, analysis, dropped);
    const invariants = invariantChecks(analysis, ctx);
    console.log(`\n${name}`);
    console.table(scores.sections);
    console.table(Object.entries(invariants).map(([invariant, result]) => ({ invariant, result: result.pass ? 'PASS' : 'FAIL' })));
    const out = new URL('../test/eval/out/', import.meta.url);
    mkdirSync(out, { recursive: true });
    writeFileSync(new URL(`${name}.json`, out), JSON.stringify({ fixture: name, evaluatedAt: new Date().toISOString(), analysis, scores, invariants }, null, 2) + '\n');
    failed ||= Object.values(invariants).some(result => !result.pass);
  }
  if (failed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
