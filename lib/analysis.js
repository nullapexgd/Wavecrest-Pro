import { UpstreamError } from './errors.js';

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

const SHORT_MAX_SECONDS = 180;

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

export async function runAnalysis(channel, videos, groqKey, signal) {
  const cadence = computeCadence(videos);
  const byViews = [...videos].sort((a, b) => b.viewCount - a.viewCount);
  const top20 = byViews.slice(0, 20);
  const recent = videos.slice(0, 30);

  const videoList = (arr, prefix, includeStats = true) =>
    arr.map((v, i) => {
      const stats = includeStats
        ? ` | ${fmtNum(v.viewCount)} views | ${Math.round(v.duration / 60)}min`
        : ` | ${v.publishedAt.slice(0, 10)}`;
      return `${prefix}${i + 1}. "${v.title}"${stats}`;
    }).join('\n');

  const topViewsAvg = top20.reduce((a, v) => a + v.viewCount, 0) / top20.length;
  const allViewsAvg = videos.reduce((a, v) => a + v.viewCount, 0) / videos.length;
  const outperformers = top20.filter(v => v.viewCount > topViewsAvg * 1.5);
  const channelAgeMonths = channel.publishedAt
    ? Math.max(1, (Date.now() - new Date(channel.publishedAt)) / (1000 * 60 * 60 * 24 * 30))
    : 12;
  const estimatedMonthlyViews = Math.round(channel.viewCountTotal / channelAgeMonths);

  const prompt = `You are a creator intelligence analyst. Study the video titles and stats below. Return ONLY a JSON object — no other text.

CRITICAL RULES:
1. CITE SPECIFIC TITLES by their tag (e.g. "T3" from the top list or "R12" from the recent list). Never make generic statements.
2. GAPS must be topics appearing ZERO times in the title list.
3. MONETIZATION SIGNALS must be exact observations from titles/descriptions, not guesses.
4. HOOK PATTERNS must include verbatim word structures from actual titles.
5. Never state things obvious from the channel name alone.

CHANNEL: ${channel.name}${channel.handle ? ' (' + channel.handle + ')' : ''}
Subscribers: ${fmtNum(channel.subscriberCount)} | Total views: ${fmtNum(channel.viewCountTotal)}
Channel avg views: ${fmtNum(Math.round(allViewsAvg))} | Top 20 avg: ${fmtNum(Math.round(topViewsAvg))}
Description: ${channel.description}

TOP 20 VIDEOS BY VIEWS:
${videoList(top20, 'T')}

OUTPERFORMERS (>${fmtNum(Math.round(topViewsAvg * 1.5))} views):
${outperformers.map(v => `"${v.title}" | ${fmtNum(v.viewCount)} views`).join('\n') || 'None significantly above average'}

RECENT 30 VIDEOS:
${videoList(recent, 'R', false)}

CADENCE:
- Avg ${cadence.avgDaysBetweenVideos} days between uploads (~${cadence.videosPerMonth}/month)
- Peak day: ${cadence.peakDay} | Avg duration: ${cadence.avgDurationMinutes}min (range: ${cadence.shortestMinutes}–${cadence.longestMinutes}min)
- Estimated monthly views: ~${fmtNum(estimatedMonthlyViews)}

Return JSON with exactly these keys:
hooks: { primaryPattern: "Verbatim structural formula from actual titles", examples: ["3 real titles"], frequency: "X of top 20", secondaryPatterns: ["2nd", "3rd"] }
thumbnails: { formula: "Specific visual approach", characteristics: ["3 elements"], textOverlayStyle: "Text style" }
cadence: { schedule: "Specific pattern with numbers", consistency: "Erratic or clockwork", durationStrategy: "What the range reveals", peakPerformanceWindow: "When outperformers cluster" }
audience: { primaryProfile: "Specific psychographic", estimatedAge: "Range", viewerIntent: "One sentence", loyaltySignal: "Engagement observation" }
pillars: [3: { name: "Label", percentage: number (sum 100), description: "Which videos + performance" }]
monetization: { primaryApproach: "Model with evidence or 'No clear signals — likely AdSense'", signals: ["Evidence from titles only — omit if none"], brandAffinities: "Specific brands/categories" }
gaps: [3: { opportunity: "Topic appearing ZERO times in titles", rationale: "Cite video tags like T3 or R12" }]
earningsEstimate: { niche: "Pick one: Finance | Insurance | Legal | Real Estate | Health/Medical | Crypto | AI/Tech | B2B SaaS | Marketing | Education | Consumer Tech | Automotive | Food/Cooking | Beauty | Travel | DIY | Parenting | Gaming | Entertainment | Music", rpmLow: number (RPM $ low end for that niche), rpmHigh: number (RPM $ high end), otherRevenue: "Evidence-based or 'unclear from data'" }
videoIdeas: [5: { title: "Ready-to-publish title in creator's style", rationale: "Cite top performers by tag (T3, R12)", estimatedPerformance: "vs ${fmtNum(Math.round(allViewsAvg))} avg" }]`;

  const r = await fetch(GROQ_API, {
    method: 'POST',
    signal,
    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a creator intelligence analyst. Always respond with valid JSON only — no markdown, no explanation.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 4000,
      response_format: { type: 'json_object' }
    })
  });

  // Upstream detail goes to server logs only (UpstreamError.detail); clients get a fixed message.
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new UpstreamError('ai', r.status, body);
  }

  const data = await r.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new UpstreamError('ai', 502, 'empty response');

  let aiAnalysis;
  try {
    aiAnalysis = JSON.parse(text);
  } catch (e) {
    throw new UpstreamError('ai', 502, 'unparseable JSON');
  }
  if (!aiAnalysis || typeof aiAnalysis !== 'object' || Array.isArray(aiAnalysis)) {
    throw new UpstreamError('ai', 502, 'response was not an object');
  }
  // gaps are filtered below; a non-array here used to throw after the paid call.
  if (!Array.isArray(aiAnalysis.gaps)) aiAnalysis.gaps = [];

  // Earnings math is computed here, not by the model — asking an LLM to do arithmetic
  // in a string field is how you get "low=views*rpm/1000=..." leaking into the UI.
  const rpmLow = Number(aiAnalysis?.earningsEstimate?.rpmLow) || 0;
  const rpmHigh = Number(aiAnalysis?.earningsEstimate?.rpmHigh) || 0;
  const revLow = Math.round(estimatedMonthlyViews * rpmLow / 1000);
  const revHigh = Math.round(estimatedMonthlyViews * rpmHigh / 1000);
  const earningsEstimate = {
    monthlyViewsEstimate: estimatedMonthlyViews,
    cpmRPM: rpmLow && rpmHigh ? `${aiAnalysis?.earningsEstimate?.niche || 'Niche'} $${rpmLow}-${rpmHigh}` : 'unclear from data',
    estimatedMonthlyAdRevenue: rpmLow && rpmHigh ? `$${fmtNum(revLow)}–$${fmtNum(revHigh)}` : 'unclear from data',
    otherRevenue: aiAnalysis?.earningsEstimate?.otherRevenue || 'Unclear from data',
    totalEstimate: rpmLow && rpmHigh ? `$${revLow.toLocaleString()}–$${revHigh.toLocaleString()}/month` : 'unclear from data'
  };

  // Grounding check on gaps — the model is told gaps must be zero-mention topics, but
  // it doesn't reliably follow that, so verify against the same titles it was shown
  // rather than trust the claim outright. Checked at the phrase/bigram level, not by
  // lone word — a gap topic sharing one common word with an unrelated title (e.g.
  // "accessories") isn't evidence it's already covered.
  const titleCorpus = [...top20, ...recent].map(v => v.title).join(' \n ').toLowerCase();
  const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const isGenuineGap = opportunity => {
    const words = String(opportunity || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const wholePhrase = new RegExp(`\\b${words.map(escapeRegex).join('\\s+')}\\b`);
    if (wholePhrase.test(titleCorpus)) return false;
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = new RegExp(`\\b${escapeRegex(words[i])}\\s+${escapeRegex(words[i + 1])}\\b`);
      if (bigram.test(titleCorpus)) return false;
    }
    if (words.length === 1 && new RegExp(`\\b${escapeRegex(words[0])}\\b`).test(titleCorpus)) return false;
    return true;
  };
  const gaps = (aiAnalysis.gaps || []).filter(g => isGenuineGap(g.opportunity));

  const sortedViews = byViews.map(v => v.viewCount);
  const mid = Math.floor(sortedViews.length / 2);
  const medianViews = sortedViews.length % 2 ? sortedViews[mid] : Math.round((sortedViews[mid - 1] + sortedViews[mid]) / 2);

  return {
    ...aiAnalysis,
    gaps,
    earningsEstimate,
    evidence: buildEvidence(top20, recent, medianViews),
    cadence: {
      ...aiAnalysis.cadence,
      avgDaysBetweenVideos: cadence.avgDaysBetweenVideos,
      videosPerMonth: cadence.videosPerMonth,
      peakDay: cadence.peakDay,
      avgDurationMinutes: cadence.avgDurationMinutes
    }
  };
}
