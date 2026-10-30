// Validation layer between the model's JSON and what gets stored. The model proposes
// interpretations with citations; this file decides what survives, and computes every number.
// Output keeps the stored-report schema (all old keys, same types); new fields are optional.
import { median, isShort, NICHE_RPM, SHORTS_RPM } from './analysis-facts.js';

const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n));
const str = (x, max = 400) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const arr = x => (Array.isArray(x) ? x : []);
const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}$\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set('the and for with this that from your you are was how what why when who not but can its all our out new get has have will about into than then them their they'.split(' '));
const tokens = s => norm(s).split(' ').filter(t => t && !STOP.has(t) && (t.length >= 3 || /[\d$]/.test(t)));
const TAG = /\b([TR])(\d{1,2})\b/gi;
const NICHES = Object.keys(NICHE_RPM);
const FIT = new Set(['high', 'medium']);
// Cheap consistency check for the model's niche: some content wording must plausibly belong to it.
// Not a classifier; it rejects obvious mismatches (a Finance label on cooking titles).
const NICHE_HINTS = {
  Finance: 'money invest investing stock stocks budget savings retire tax debt credit', Insurance: 'insurance policy coverage claim',
  Legal: 'law legal lawyer attorney court sue', 'Real Estate': 'house home property mortgage rent apartment',
  'Health/Medical': 'health doctor medical disease symptoms fitness workout diet sleep mental', Crypto: 'crypto bitcoin ethereum blockchain nft token',
  'AI/Tech': 'ai gpt chatgpt claude llm coding programming software openai robot', 'B2B SaaS': 'saas software b2b startup crm api enterprise',
  Marketing: 'marketing seo ads brand growth copywriting', Education: 'learn lesson tutorial course explained study school math history science',
  'Consumer Tech': 'iphone android phone laptop mac macbook ipad watch review camera gadget pixel galaxy airpods tech tv headphones earbuds speaker ios',
  Automotive: 'car cars truck ev tesla engine motorcycle suv', 'Food/Cooking': 'recipe cook cooking food kitchen bake baking meal restaurant',
  Beauty: 'makeup skincare beauty hair nails cosmetics', Travel: 'travel trip hotel flight visit tour island city',
  DIY: 'diy build wood woodworking repair fix craft garage tools restore', Parenting: 'kids baby parenting mom dad toddler family',
  Gaming: 'game gaming minecraft fortnite playthrough speedrun gameplay roblox boss', Entertainment: 'challenge win prize vs giving race survive reaction funny last guess prank',
  Music: 'song album music cover concert remix guitar piano lyrics'
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const tagsIn = x => [...new Set((Array.isArray(x) ? x.join(' ') : String(x ?? '')).match(TAG)?.map(t => t.toUpperCase()) || [])];

// A claim is "supported" by a video when the claim's literal words (anything outside [brackets])
// appear in that video's title; at least half of them, so a paraphrase can't pass on one stopword.
export function supports(claim, video) {
  const lit = tokens(String(claim).replace(/\[[^\]]*\]/g, ' '));
  if (!lit.length) return false;
  const have = new Set(tokens(video.title));
  return lit.filter(t => have.has(t)).length >= Math.ceil(lit.length / 2);
}
const jaccard = (a, b) => {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  const i = [...A].filter(t => B.has(t)).length;
  return A.size + B.size - i ? i / (A.size + B.size - i) : 0;
};
// An idea "builds on" a video only if they share a topic word or both lean on a dollar figure.
const related = (a, b) => { const B = new Set(tokens(b)); return tokens(a).some(t => B.has(t) && t.length >= 4) || (/\$/.test(a) && /\$/.test(b)); };
// shortcut: explicit numeric performance claims only; expand with regression cases for new phrasings.
const FORECASTS = [
  /\b\d[\d.,]*\s*(?:%|×|x\b)\s*(?:(?:more|higher|extra|the|channel|monthly|ad|expected|projected|increase|in)\s+)*(?:growth|views?|subscribers?|followers?|engagement|reach|revenue|earnings|income|median|average|CTR)\b/i,
  /\b(?:growth|views?|subscribers?|followers?|engagement|reach|revenue|earnings|income|CTR)\s*(?:(?:of|by|up|will|grow|increase|to|at|least|is|:)\s*)*\d[\d.,]*\s*(?:%|×|x\b)/i,
  /\b(?:get|gain|earn|expect|guarantee[ds]?|generate|reach|deliver|predict|forecast)\s+(?:at\s+least\s+)?\d[\d.,]*\s*(?:[kmb]|thousand|million|billion)?\s*(?:views?|subscribers?|followers?|impressions)\b/i
];
const forecast = text => FORECASTS.some(pattern => pattern.test(text));

const dollars = s => [...String(s).matchAll(/\$\s?([\d,]+(?:\.\d+)?)\s?([kmb])?/gi)].map(m =>
  parseFloat(m[1].replace(/,/g, '')) * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1));

export function enforceAnalysis(raw, ctx) {
  const { channel, facts, top, recent, now = Date.now() } = ctx;
  const dropped = [];
  const drop = (kind, why) => dropped.push({ kind, why });
  const vmap = ctx.tagMap || new Map();
  if (!ctx.tagMap) {
    top.forEach((v, i) => vmap.set(`T${i + 1}`, v));
    recent.forEach((v, i) => vmap.set(`R${i + 1}`, v));
  }
  const byTitle = new Map([...vmap].reverse().map(([t, v]) => [norm(v.title), [t, v]]));
  const resolve = x => {
    const out = new Map(tagsIn(x).map(t => [t, vmap.get(t)]).filter(([, v]) => v));
    for (const s of arr(x)) { const hit = typeof s === 'string' && byTitle.get(norm(s)); if (hit) out.set(hit[0], hit[1]); }
    return [...out];
  };
  const corpusTitles = [...new Map([...top, ...recent].map(v => [v.id, v.title])).values()];
  const corpus = norm(corpusTitles.join(' \n '));
  const allText = norm(corpus + ' ' + (channel.description || '') + ' ' + channel.name);
  const description = norm(channel.description);
  const mentions = (text, phrase) => (` ${text} `).includes(` ${norm(phrase)} `);
  const name = norm(channel.name);
  // Channel type is the model's label; public wording can corroborate it but nothing here verifies
  // ownership, so every non-corroborated label is reported as inferred.
  const brandWording = (mentions(description, 'official') && mentions(description, name) && /\b(company|brand|products?)\b/.test(description))
    || (name && corpusTitles.filter(t => mentions(norm(t), name) && /\b(introducing|new|welcome)\b/i.test(t)).length >= 2);
  const type = brandWording ? 'brand' : ['creator', 'brand', 'media'].includes(raw.channelType) ? raw.channelType : 'unclear';
  const typeBasis = brandWording ? 'corroborated by public wording' : type === 'unclear' ? 'unknown' : 'model-inferred, not verified';
  // Niche: kept when it is an allowed category and some content wording is consistent with it.
  const textWords = new Set(allText.split(' ').flatMap(w => [w, w.replace(/s$/, '')]));
  const nicheOk = NICHES.includes(raw.niche) && ((NICHE_HINTS[raw.niche] || '') + ' ' + norm(raw.niche)).split(' ').some(w => w && textWords.has(w));
  const niche = nicheOk ? raw.niche : null;
  if (raw.niche && raw.niche !== 'Unclear' && !niche) drop('classification.niche', `"${raw.niche}" is not an allowed category or nothing in the content is consistent with it`);
  const small = facts.n < 15;
  const med = facts.medianViews || 1;
  // Performance is always relative to the video's own format (Shorts vs long-form), falling back
  // to the overall median when a format has too few videos to have one.
  const medFor = v => (isShort(v) ? (facts.shortsCount >= 5 && facts.medianShorts) : (facts.longCount >= 5 && facts.medianLong)) || med;
  const rel = v => Math.round(v.viewCount / medFor(v) * 100) / 100;
  const line = ([t, v]) => `${t} “${v.title}” (${fmt(v.viewCount)} views, ${rel(v)}× its ${isShort(v) ? 'Shorts' : 'long-form'} median)`;

  // ---- hooks -------------------------------------------------------------------------
  const h = raw.hooks || {};
  const pattern = str(h.primaryPattern, 200);
  const cited = resolve([h.patternTags, h.examples]);
  // A pattern made only of [placeholders] has no wording to check; accept three or more resolved citations, at low confidence.
  const structural = Boolean(pattern) && !tokens(pattern.replace(/\[[^\]]*\]/g, ' ')).length;
  const matched = !pattern ? [] : structural ? (cited.length >= 3 ? cited : []) : cited.filter(([, v]) => supports(pattern, v));
  const lost = cited.length - matched.length;
  if (lost) drop('hooks.tag', `${lost} cited video(s) don't contain the pattern`);
  const hooks = { secondaryPatterns: arr(h.secondaryPatterns).map(s => str(s, 160)).filter(s => s && corpusTitles.some(t => supports(s, { title: t }))).slice(0, 3) };
  if (matched.length >= 2) {
    const topN = matched.filter(([t]) => t.startsWith('T')).length;
    const mRel = median(matched.map(([, v]) => Math.round(rel(v) * 100))) / 100;
    hooks.primaryPattern = pattern;
    hooks.examples = [...matched].sort((a, b) => b[1].viewCount - a[1].viewCount).slice(0, 3).map(([, v]) => v.title);
    hooks.frequency = `${topN} of top ${top.length} by views; ${matched.length} of ${corpusTitles.length} titles shown`;
    hooks.medianMultiple = mRel;
    hooks.confidence = matched.length >= 4 && mRel >= 1 && !structural ? 'medium' : 'low';
    if (structural) hooks.caveat = 'Structural pattern: its wording cannot be machine-checked, only that the cited videos exist.';
    if (mRel < 1 && !structural) hooks.caveat = 'Videos using this pattern do not beat the channel median, so it describes style, not what works.';
  } else {
    drop('hooks.pattern', matched.length ? 'only one video verifiably shows it' : 'no verifiable examples');
    Object.assign(hooks, { primaryPattern: 'No repeated title pattern could be verified in the titles shown.', examples: [], frequency: 'insufficient evidence', confidence: 'low' });
  }

  // ---- pillars: model labels videos, code counts them --------------------------------
  const seen = new Set();
  const groups = [];
  for (const p of arr(raw.pillars).slice(0, 4)) {
    const name = str(p?.name, 60);
    const vids = resolve([p?.tags, p?.description]).filter(([, v]) => !seen.has(v.id));
    vids.forEach(([, v]) => seen.add(v.id));
    if (name && vids.length >= (small ? 1 : 2)) groups.push({ name, description: str(p.description, 300), vids });
    else drop('pillar', `"${name}" has under ${small ? 1 : 2} verified video(s)`);
  }
  const useRecent = groups.reduce((a, g) => a + g.vids.filter(([t]) => t[0] === 'R').length, 0) >= 5;
  const weight = g => (useRecent ? g.vids.filter(([t]) => t[0] === 'R').length : g.vids.length);
  let pillars = [];
  if (groups.length >= 2) {
    const total = groups.reduce((a, g) => a + weight(g), 0) || 1;
    const raws = groups.map(g => weight(g) / total * 100), pct = raws.map(Math.floor);
    raws.map((r, i) => [r - pct[i], i]).sort((a, b) => b[0] - a[0]).slice(0, 100 - pct.reduce((a, b) => a + b, 0)).forEach(([, i]) => pct[i]++);
    pillars = groups.map((g, i) => {
      const rv = g.vids.filter(([t]) => t[0] === 'R').map(([, v]) => Math.round(rel(v) * 100));
      const out = { name: g.name, percentage: pct[i], description: `${g.description} (${g.vids.length} videos; share of ${useRecent ? 'recent uploads' : 'videos shown'}).`.trim() };
      if (rv.length >= 2) out.medianMultiple = median(rv) / 100;
      return out;
    });
  } else if (groups.length) drop('pillars', 'fewer than two verifiable pillars');

  // ---- audience: nothing demographic is knowable here ---------------------------------
  const a = raw.audience || {};
  const DEMOGRAPHIC = /\b(\d{2}\s?[-–]\s?\d{2}|\d{2}\+|male|female|men|women|boys|girls|millennial|gen[ -]?z|teen\w*|students?|parents?|income|affluent)\b/i;
  const profile = str(a.primaryProfile, 220);
  const profileOk = profile && !DEMOGRAPHIC.test(profile);
  if (profile && !profileOk) drop('audience.profile', 'contained demographic claims');
  const audience = {
    primaryProfile: profileOk ? profile : `Viewers interested in ${pillars.map(p => p.name.toLowerCase()).join(', ') || 'this channel’s topics'} (inferred from titles only).`,
    estimatedAge: 'Unknown — age data is not public',
    viewerIntent: str(a.viewerIntent, 220) && !DEMOGRAPHIC.test(a.viewerIntent) ? `${str(a.viewerIntent, 220)} (inferred)` : 'Not determinable from titles.',
    loyaltySignal: [facts.likeRate != null ? `Median like rate ${facts.likeRate}% of views.` : null,
      facts.momentum ? `Newest ${facts.momentum.format} videos run at ${facts.momentum.ratio}× the older median.` : null].filter(Boolean).join(' ') || 'Not enough data.'
  };

  // ---- monetization: only quotable evidence ------------------------------------------
  const m = raw.monetization || {};
  const signals = [];
  for (const s of arr(m.signals).slice(0, 4)) {
    const q = str(typeof s === 'string' ? s.replace(/\s*\(?\b[TR]\d+\b\)?/gi, '') : s?.quote, 120), vids = resolve(s?.tag ?? s);
    const hit = q.length >= 6 && vids.find(([, v]) => v.title.includes(q));
    if (hit) signals.push(`“${q}” (${hit[0]})`);
    else drop('monetization.signal', 'quote not found in the cited title');
  }
  const affinities = arr(m.brandAffinities).map(b => str(b, 40)).filter(b => b && allText.includes(norm(b))).slice(0, 5);
  const monetization = {
    primaryApproach: type === 'brand' ? `${brandWording ? 'Official brand channel' : 'Appears to be a brand-owned channel (inferred, not verified)'}: creator revenue models do not apply and its business revenue is not determinable from public data.`
      : signals.length ? 'Titles mention possible product or sponsor tie-ins (unverified; nothing here confirms a sponsorship).'
        : 'No monetization signals in the titles shown; the revenue model is not determinable from public data.',
    signals: type === 'brand' ? [] : signals,
    brandAffinities: affinities.length ? affinities.join(', ') : 'None evidenced in titles or channel description.'
  };

  // ---- gaps: absent from titles AND fit the channel ----------------------------------
  const words = o => norm(o).split(' ').filter(Boolean);
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const present = o => {
    const w = words(o);
    if (!w.length) return true;
    if (new RegExp(`\\b${w.map(esc).join('\\s+')}\\b`).test(corpus)) return true;
    for (let i = 0; i < w.length - 1; i++) if (new RegExp(`\\b${esc(w[i])}\\s+${esc(w[i + 1])}\\b`).test(corpus)) return true;
    return w.length === 1 && new RegExp(`\\b${esc(w[0])}\\b`).test(corpus);
  };
  const gaps = [];
  for (const g of arr(raw.gaps)) {
    const opp = str(g?.opportunity, 160), vids = resolve([g?.tags, g?.rationale]);
    if (!opp) continue;
    if (facts.n < 10) { drop('gap', 'too few videos to suggest a gap'); continue; }
    if (present(opp)) { drop('gap', `"${opp}" already appears in titles`); continue; }
    if (!FIT.has(g?.identityFit)) { drop('gap', `"${opp}" doesn't fit the channel`); continue; }
    if (!vids.length) { drop('gap', `"${opp}" cites no video`); continue; }
    // Shared wording is not required: citing two or more videos is a contrast set ("these are what the
    // channel does instead"). A single citation with no shared wording is unrelated evidence unless the
    // model rates the fit as high.
    const basis = vids.filter(([, v]) => tokens(opp).some(word => word.length >= 4 && /\p{L}/u.test(word) && tokens(v.title).includes(word)));
    const contrast = new Set(vids.map(([, v]) => v.id)).size >= 2;
    if (!basis.length && !contrast && g.identityFit !== 'high') { drop('gap', `"${opp}" cites videos unrelated to it`); continue; }
    const why = str(g.rationale, 260).replace(TAG, t => (vmap.has(t.toUpperCase()) ? t.toUpperCase() : '')).replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
    if (gaps.length < 3) gaps.push({
      opportunity: opp,
      rationale: `${why && !forecast(why) ? why.replace(/[.\s]*$/, '.') + ' ' : ''}Hypothesis: absent from the sampled titles; audience demand is not measured.`,
      kind: 'hypothesis', fit: g.identityFit, confidence: 'low', support: basis.length ? 'cited videos share topic wording' : contrast ? 'cited contrast set' : 'single cited video'
    });
  }

  // ---- ideas: novel, feasible, identity-fit, no invented facts ------------------------
  const maxSeen = Math.max(0, ...corpusTitles.flatMap(dollars));
  const entityMax = new Map();
  const ENTITY = /([A-Za-z][\w+]*(?:\s[A-Z][\w+]*)?)\s(\d{1,3})\b/g;
  for (const t of corpusTitles) for (const e of t.matchAll(ENTITY)) entityMax.set(e[1], Math.max(entityMax.get(e[1]) || 0, +e[2]));
  const year = new Date(now).getUTCFullYear();
  const problem = title => {
    const d = Math.max(0, ...dollars(title));
    if (maxSeen && d > maxSeen * 5) return `$${fmt(d)} is far beyond anything this channel has shown`;
    if (!maxSeen && d > 10000 && (channel.subscriberCount || 0) < 100000) return 'prize or budget unrealistic for a channel this size';
    if (type === 'brand') { // a company's own channel can't announce what it hasn't released
      for (const e of title.matchAll(ENTITY)) {
        const seenMax = entityMax.get(e[1]);
        if (seenMax && +e[2] > seenMax) return `“${e[0]}” is a product the channel never announced`;
      }
      const when = [...title.matchAll(/(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+)?\b(20\d\d)\b/g)];
      if (when.some(([, mo, y]) => +y > year || (+y === year && mo && MONTHS.indexOf(mo) > new Date(now).getUTCMonth()))) return 'refers to a future date or release';
    }
    return null;
  };
  const videoIdeas = [];
  for (const i of arr(raw.videoIdeas)) {
    const title = str(i?.title, 140);
    if (!title) continue;
    const near = corpusTitles.find(t => jaccard(t, title) >= 0.75);
    const repeated = videoIdeas.find(idea => norm(idea.title) === norm(title) || jaccard(idea.title, title) >= 0.75);
    const why = near || repeated ? `duplicates “${near || repeated.title}”` : forecast(title) ? 'contains an unsupported numeric performance claim' : !FIT.has(i?.identityFit) ? "doesn't fit the channel's identity" : problem(title);
    if (why) { drop('idea', `"${title}" ${why}`); continue; }
    const basis = resolve([i?.tags, i?.rationale]).filter(([, v]) => related(title, v.title));
    const lines = basis.slice(0, 2).map(line);
    const modelText = str(i.rationale, 260);
    const numeric = forecast(modelText);
    const effort = ['low', 'medium', 'high'].includes(i.effort) ? i.effort : 'unknown';
    videoIdeas.push({
      title,
      rationale: [numeric ? '' : modelText.replace(/[.\s]*$/, '.'), lines.length ? `Builds on ${lines.join('; ')}.` : 'Not tied to a specific video in the data.'].filter(Boolean).join(' '),
      estimatedPerformance: basis.length
        ? `Comparable videos ran ${[...new Set([Math.min(...basis.map(([, v]) => rel(v))), Math.max(...basis.map(([, v]) => rel(v)))])].join('–')}× the median for their format. A benchmark, not a forecast.`
        : 'No benchmark: no supporting video.',
      effort, fit: i.identityFit, confidence: basis.length ? 'medium' : 'low'
    });
    if (videoIdeas.length === 5) break;
  }

  // ---- earnings: windowed traffic x assumed RPM, Shorts separate ----------------------
  const ru = facts.recentUploads;
  const lowViews = ru ? ru.longform + ru.shorts : facts.lifetimeMonthly;
  const highViews = Math.max(lowViews, facts.lifetimeMonthly);
  const split = v => ({ l: v * (1 - facts.shortsShare), s: v * facts.shortsShare });
  const rpm = niche && type !== 'brand' ? NICHE_RPM[niche] : null;
  const lo = split(lowViews), hi = split(highViews);
  const revLow = rpm ? Math.round(lo.l * rpm[0] / 1000 + lo.s * SHORTS_RPM[0] / 1000) : 0;
  const revHigh = rpm ? Math.round(hi.l * rpm[1] / 1000 + hi.s * SHORTS_RPM[1] / 1000) : 0;
  const brand = type === 'brand';
  const earningsEstimate = {
    monthlyViewsEstimate: lowViews,
    monthlyViewsRange: [lowViews, highViews],
    cpmRPM: brand ? 'Not applicable (brand channel)' : rpm ? `Assumed category: ${niche}. $${rpm[0]}–${rpm[1]} long-form, Shorts $${SHORTS_RPM[0]}–${SHORTS_RPM[1]} per 1,000 views (assumptions, not measured)` : 'unavailable: no suitable category',
    estimatedMonthlyAdRevenue: brand || !rpm ? 'unclear from data' : `$${fmt(revLow)}–$${fmt(revHigh)}`,
    otherRevenue: 'Unknown — not determinable from public data',
    totalEstimate: brand || !rpm ? 'unclear from data' : `$${revLow.toLocaleString()}–$${revHigh.toLocaleString()}/month`,
    basis: ru ? `Low: views from the ${ru.videos} uploads of the last ${ru.windowDays} days, per month (floor; excludes back catalogue and still-accruing views). High: lifetime views ÷ channel age.`
      : 'Lifetime views ÷ channel age (too few recent uploads for a window).',
    category: rpm ? { name: niche, label: 'Assumed category', confidence: 'low' } : null,
    disclaimer: brand ? 'Ad revenue is not modelled for brand channels.' : 'Modelled from public views × assumed RPM. Not actual or business revenue.',
    confidence: 'low'
  };

  // ---- cadence / thumbnails: computed or declared unavailable -------------------------
  const c = ctx.cadence || {};
  const cv = facts.gapCv;
  const cadence = {
    schedule: c.videosPerMonth ? `About ${c.videosPerMonth} uploads per month (one every ${c.avgDaysBetweenVideos} days across the last ${facts.n} videos).` : 'Not enough uploads to describe a schedule.',
    consistency: cv == null ? 'Not enough data.' : cv < 0.5 ? 'Regular: upload gaps vary little.' : cv < 1.2 ? 'Moderately regular.' : 'Irregular: upload gaps vary widely.',
    durationStrategy: facts.shortsCount && facts.longCount ? `${Math.round(facts.shortsCount / facts.n * 100)}% Shorts (≤3 min) and ${Math.round(facts.longCount / facts.n * 100)}% long-form; long-form median ${fmt(facts.medianLong)} views, Shorts ${fmt(facts.medianShorts)}.`
      : facts.shortsCount ? 'Shorts-only channel.' : `Long-form only; average ${c.avgDurationMinutes ?? '?'} min.`,
    peakPerformanceWindow: facts.bestDay ? `${facts.bestDay} uploads have the highest median views (at least 3 videos each).` : 'Not enough videos per weekday to say.',
    avgDaysBetweenVideos: c.avgDaysBetweenVideos, videosPerMonth: c.videosPerMonth, peakDay: c.peakDay, avgDurationMinutes: c.avgDurationMinutes
  };
  const thumbnails = { formula: 'Not analyzed: Wavecrest reads titles and statistics, not thumbnail images.', characteristics: [], textOverlayStyle: 'Unavailable' };

  // ---- quality summary ---------------------------------------------------------------
  const limits = [];
  if (type !== 'unclear' && !brandWording) limits.push('Channel type is model-inferred and not verified.');
  if (gaps.length) limits.push('Gaps are hypotheses: absent from the sampled titles, demand not measured.');
  if (small) limits.push(`Only ${facts.n} videos: patterns and gaps are tentative.`);
  if (facts.shortsCount && facts.longCount) limits.push('Shorts and long-form are benchmarked separately; their revenue is not blended.');
  if (facts.topConcentration >= 40) limits.push(`One video holds ${facts.topConcentration}% of the top-20 views; patterns may reflect a single outlier.`);
  if (!ru) limits.push('Too few recent uploads for a traffic window; revenue uses the lifetime average.');
  if (type === 'brand') limits.push('Brand-owned channel: creator revenue and sponsorship reasoning does not apply.');
  if (!niche) limits.push('No suitable category: no RPM assumption applied.');
  const confidence = small ? 'low' : 'medium';
  const stats = {
    medianViews: facts.medianViews, p25Views: facts.p25, p75Views: facts.p75, medianLongForm: facts.medianLong, medianShorts: facts.medianShorts,
    shortsShare: facts.shortsShare, hitRatePct: facts.hitRate, topConcentrationPct: facts.topConcentration, momentum: facts.momentum
  };

  return {
    analysis: {
      hooks, thumbnails, cadence, audience, pillars, monetization, gaps, earningsEstimate, videoIdeas, stats,
      quality: { version: 2, channelType: type, channelTypeBasis: typeBasis, niche: niche || 'Unclear', nicheBasis: niche ? 'Assumed category' : 'unavailable', confidence, limits, dropped: dropped.length,
        sections: { hooks: hooks.confidence, pillars: small ? 'low' : 'medium', gaps: 'low', ideas: videoIdeas.some(i => i.confidence === 'medium') ? 'medium' : 'low', earnings: 'low', classification: 'low' } }
    },
    dropped
  };
}
