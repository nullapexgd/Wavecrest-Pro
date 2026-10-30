import { UpstreamError } from './errors.js';
import { computeFacts, isShort, NICHE_RPM, SHORT_MAX_SECONDS } from './analysis-facts.js';
import { enforceAnalysis } from './analysis-enforce.js';

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

export function fmtNum(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

export function computeCadence(videos) {
  if (videos.length < 2) return {};
  const dates = videos.map(v => new Date(v.publishedAt)).filter(d => !isNaN(d)).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < dates.length; i++) gaps.push((dates[i] - dates[i - 1]) / 86400000);
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayCount = new Array(7).fill(0);
  dates.slice(-60).forEach(d => dayCount[d.getDay()]++);
  const peakDay = dayNames[dayCount.indexOf(Math.max(...dayCount))];
  const durations = videos.map(v => v.duration).filter(d => d > 0);
  const avgDurationSec = durations.reduce((a, b) => a + b, 0) / (durations.length || 1);
  return {
    avgDaysBetweenVideos: Math.round(avgGap * 10) / 10,
    videosPerMonth: Math.round((30 / avgGap) * 10) / 10,
    peakDay,
    avgDurationMinutes: Math.round(avgDurationSec / 60 * 10) / 10,
    shortestMinutes: Math.round(Math.min(...durations) / 60 * 10) / 10,
    longestMinutes: Math.round(Math.max(...durations) / 60 * 10) / 10
  };
}

// The videos the model was shown, kept with the report so every citation can be resolved
// later. Tags are unique per list (T = top by views, R = most recent), so "T3" and "R3"
// can never be confused. A video in both lists carries both tags.
export function buildEvidence(top, recent, medianViews, computedAt = new Date().toISOString()) {
  const byId = new Map();
  const add = (list, prefix) => list.forEach((v, i) => {
    const row = byId.get(v.id) || {
      id: v.id, title: v.title, publishedAt: v.publishedAt, views: v.viewCount,
      likes: v.likeCount || 0, duration: v.duration, short: v.duration > 0 && v.duration <= SHORT_MAX_SECONDS, tags: []
    };
    row.tags.push(`${prefix}${i + 1}`);
    byId.set(v.id, row);
  });
  add(top, 'T');
  add(recent, 'R');
  return { medianViews, computedAt, videos: [...byId.values()] };
}

export const SYSTEM_PROMPT = `You are a YouTube channel analyst. You see only titles, view counts, upload dates and durations: no thumbnails, descriptions, comments, analytics, revenue or demographics.
Standards:
1. Every claim cites the tags (T# top-by-views, R# recent) of videos that show it. Cite only videos that really contain the evidence.
2. Report what titles and stats show. If evidence is thin, say so or leave the item out. Never invent demographics, sponsors, revenue, thumbnail details, unannounced products or events.
3. Compare against medians, never averages. The system computes every number: do not write percentages, view counts, multiples, forecasts or revenue.
4. Shorts (<=${SHORT_MAX_SECONDS}s) and long-form are different games; do not compare across them.
5. Ideas must fit the channel's identity and the production level it has already shown, be new relative to existing titles, and name what makes them feasible. A topic the channel has not covered is a gap only if it suits the channel.
6. Output JSON only.`;

const NICHE_LIST = Object.keys(NICHE_RPM).join(' | ');

export function buildPrompt(channel, facts, top, recent) {
  const line = (v, tag, stats) => `${tag}. "${v.title}" | ${v.publishedAt.slice(0, 10)}${stats ? ` | ${fmtNum(v.viewCount)} views` : ''} | ${isShort(v) ? 'SHORT' : Math.max(1, Math.round(v.duration / 60)) + 'min'}`;
  const fr = Object.entries(facts.featureRates).map(([k, r]) => `${k} ${r.top20}% vs ${r.rest}%`).join(', ');
  return `CHANNEL: ${channel.name}${channel.handle ? ' (' + channel.handle + ')' : ''} | ${fmtNum(channel.subscriberCount)} subscribers
Description: ${channel.description || '(none)'}
Sample: ${facts.n} videos (${facts.longCount} long-form, ${facts.shortsCount} Shorts). Median views ${fmtNum(facts.medianViews)}` +
  (facts.shortsCount && facts.longCount ? ` (long-form ${fmtNum(facts.medianLong)}, Shorts ${fmtNum(facts.medianShorts)})` : '') +
  `. ${facts.hitRate}% of videos reach 2x the median.${facts.momentum ? ` Newest ${facts.momentum.format} videos run ${facts.momentum.ratio}x the older median.` : ''}${fr ? `\nTitle features, top 20 vs rest: ${fr}.` : ''}

TOP BY VIEWS:
${top.map((v, i) => line(v, 'T' + (i + 1), true)).join('\n')}

RECENT:
${recent.map((v, i) => line(v, 'R' + (i + 1), true)).join('\n')}

Return JSON:
{
 "channelType": "creator | brand | media | unclear  (brand = a company's own channel)",
 "niche": "one of: ${NICHE_LIST} | Unclear",
 "hooks": { "primaryPattern": "title formula, variable parts in [brackets], fixed words verbatim", "patternTags": ["tags of every shown video using it"], "secondaryPatterns": ["up to 2, same style"] },
 "pillars": [ 2-4 x { "name": "label", "description": "what ties them", "tags": ["tags of videos in it; each video in one pillar"] } ],
 "audience": { "primaryProfile": "interests inferred from topics, no demographics", "viewerIntent": "one sentence" },
 "monetization": { "signals": [ { "quote": "exact words from a title", "tag": "T#/R#" } ], "brandAffinities": ["brands named in titles, if any"] },
 "gaps": [ up to 3 x { "opportunity": "topic with zero mentions in the titles", "rationale": "why it suits this channel, citing tags", "tags": ["T#/R# of the videos the rationale cites; at least one"], "identityFit": "high | medium | low" } ],
 "videoIdeas": [ 5 x { "title": "publishable title in this channel's voice", "rationale": "one sentence, no numbers", "tags": ["videos it builds on"], "identityFit": "high | medium | low", "effort": "low | medium | high" } ]
}`;
}

// A 429/503 from the provider is usually a per-minute budget, so wait (retry-after, jittered) and resend the
// SAME request, at most twice. It stays inside one run and one quota reservation, so a retry never charges
// again. A long retry-after (daily limit) or a 413 (one request too large) will not get better by waiting: fail fast.
const RETRYABLE = new Set([429, 503]);
const MAX_WAIT_S = 8;
async function postWithRetry(url, init) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, init);
    if (!RETRYABLE.has(r.status) || attempt >= 2) return r;
    const header = r.headers?.get?.('retry-after'), hinted = header == null ? NaN : Number(header);
    if (hinted > MAX_WAIT_S) return r;
    const waitMs = (Number.isFinite(hinted) ? hinted : 2 ** attempt * 2) * 1000 + Math.random() * 250;
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
}

// Upstream detail goes to server logs only (UpstreamError.detail); clients get a fixed message.
async function callGroq(prompt, key, signal) {
  const r = await postWithRetry(GROQ_API, {
    method: 'POST',
    signal,
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // llama-3.3-70b-versatile was retired by Groq (404 model_not_found); GROQ_MODEL overrides if it moves again
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 8000,
      response_format: { type: 'json_object' }
    })
  });
  if (!r.ok) throw new UpstreamError('ai', r.status, await r.text().catch(() => ''));
  return (await r.json()).choices?.[0]?.message?.content;
}

// Optional second provider (GEMINI_API_KEY). Used only after Groq fails, inside the same run and quota reservation.
async function callGemini(prompt, key, signal) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await postWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 16000, responseMimeType: 'application/json' }
    })
  });
  if (!r.ok) throw new UpstreamError('ai', r.status, await r.text().catch(() => ''));
  return (await r.json()).candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
}

export async function runAnalysis(channel, videos, groqKey, signal) {
  const facts = computeFacts(channel, videos);
  const cadence = computeCadence(videos);
  const top20 = facts.top20;
  const recent = [...videos].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 30);
  const prompt = buildPrompt(channel, facts, top20, recent);

  let text, provider = 'groq';
  try {
    text = await callGroq(prompt, groqKey, signal);
  } catch (e) {
    // only provider failures fall back; an aborted run (deadline) or a bug is rethrown
    if (!(e instanceof UpstreamError) || !process.env.GEMINI_API_KEY) throw e;
    console.warn(`analysis: groq failed (${e.upstreamStatus}), falling back to gemini`);
    provider = 'gemini';
    text = await callGemini(prompt, process.env.GEMINI_API_KEY, signal);
  }
  if (!text) throw new UpstreamError('ai', 502, 'empty response');

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new UpstreamError('ai', 502, 'unparseable JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UpstreamError('ai', 502, 'response was not an object');
  }

  const { analysis } = enforceAnalysis(raw, { channel, facts, top: top20, recent, cadence });
  analysis.quality = { ...analysis.quality, provider };
  return { ...analysis, evidence: buildEvidence(top20, recent, facts.medianViews) };
}
