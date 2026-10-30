// Deterministic numbers for an analysis. The model never produces a statistic: everything
// quantitative in a report (medians, shares, momentum, traffic windows, RPM) comes from here.

export const SHORT_MAX_SECONDS = 180;
const DAY = 86400000;

export const median = a => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const quantile = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export const isShort = v => v.duration > 0 && v.duration <= SHORT_MAX_SECONDS;

// Generic long-form RPM assumptions (USD per 1,000 views, creator share). Public-benchmark
// ranges, not measurements: reports label them as assumptions. Shorts pay far less and are
// never blended with long-form.
export const NICHE_RPM = {
  Finance: [8, 25], Insurance: [10, 30], Legal: [8, 25], 'Real Estate': [6, 18], 'Health/Medical': [4, 12],
  Crypto: [5, 15], 'AI/Tech': [4, 12], 'B2B SaaS': [8, 22], Marketing: [5, 15], Education: [3, 10],
  'Consumer Tech': [2, 8], Automotive: [3, 9], 'Food/Cooking': [2, 7], Beauty: [2, 7], Travel: [2, 7],
  DIY: [2, 6], Parenting: [2, 6], Gaming: [1, 4], Entertainment: [1.5, 5], Music: [0.5, 3]
};
export const SHORTS_RPM = [0.02, 0.07];

const hasNumber = t => /\d/.test(t);
const features = {
  number: hasNumber,
  dollar: t => /\$/.test(t),
  question: t => /\?/.test(t),
  colonOrBracket: t => /[:|\[\(]/.test(t),
  allCapsWord: t => /\b[A-Z]{3,}\b/.test(t)
};

export function computeFacts(channel, videos, now = Date.now()) {
  const n = videos.length;
  const views = videos.map(v => v.viewCount);
  const shorts = videos.filter(isShort), long = videos.filter(v => !isShort(v));
  const med = median(views);
  const byViews = [...videos].sort((a, b) => b.viewCount - a.viewCount);
  const top20 = byViews.slice(0, 20);
  const totalTop = top20.reduce((a, v) => a + v.viewCount, 0) || 1;

  // Momentum: newest 10 vs older videos of the dominant format, both limited to videos at
  // least 14 days old so unfinished view curves don't read as decline.
  const dominant = shorts.length > long.length ? shorts : long;
  const settled = dominant.filter(v => now - new Date(v.publishedAt) >= 14 * DAY)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  let momentum = null;
  if (settled.length >= 16) {
    const recentMed = median(settled.slice(0, 10).map(v => v.viewCount));
    const olderMed = median(settled.slice(10).map(v => v.viewCount));
    if (olderMed > 0) momentum = { format: dominant === shorts ? 'shorts' : 'long-form', ratio: Math.round(recentMed / olderMed * 100) / 100 };
  }

  // Traffic window: complete coverage only (the fetched list is the newest uploads, so the
  // window can't reach past the oldest fetched video). Views are lifetime-to-date for videos
  // that are still accruing, so this is a floor for new-upload traffic and excludes the
  // back catalogue entirely.
  const dates = videos.map(v => new Date(v.publishedAt)).filter(d => !isNaN(d));
  const spanDays = dates.length ? (now - Math.min(...dates)) / DAY : 0;
  const windowDays = Math.floor(Math.min(90, spanDays));
  const inWindow = videos.filter(v => now - new Date(v.publishedAt) <= windowDays * DAY);
  const wLong = inWindow.filter(v => !isShort(v)).reduce((a, v) => a + v.viewCount, 0);
  const wShorts = inWindow.filter(isShort).reduce((a, v) => a + v.viewCount, 0);
  const perMonth = x => Math.round(x / (windowDays / 30));
  const ageMonths = channel.publishedAt ? Math.max(1, (now - new Date(channel.publishedAt)) / (30 * DAY)) : 12;
  const lifetimeMonthly = Math.round((channel.viewCountTotal || 0) / ageMonths);
  const allShortsShare = views.reduce((a, b) => a + b, 0) ? shorts.reduce((a, v) => a + v.viewCount, 0) / views.reduce((a, b) => a + b, 0) : 0;
  const windowOk = inWindow.length >= 5 && windowDays >= 28;
  const recentUploads = windowOk
    ? { longform: perMonth(wLong), shorts: perMonth(wShorts), windowDays, videos: inWindow.length } : null;
  const shortsShare = windowOk && wLong + wShorts ? wShorts / (wLong + wShorts) : allShortsShare;

  const rest = byViews.slice(20);
  const featureRates = {};
  if (rest.length >= 10) {
    for (const [k, f] of Object.entries(features)) {
      featureRates[k] = {
        top20: Math.round(top20.filter(v => f(v.title)).length / top20.length * 100),
        rest: Math.round(rest.filter(v => f(v.title)).length / rest.length * 100)
      };
    }
  }

  const sortedDates = [...dates].sort((a, b) => a - b);
  const gapDays = sortedDates.slice(1).map((d, i) => (d - sortedDates[i]) / DAY);
  const gm = gapDays.reduce((a, b) => a + b, 0) / (gapDays.length || 1);
  const gapCv = gapDays.length >= 5 && gm > 0 ? Math.round(Math.sqrt(gapDays.reduce((a, g) => a + (g - gm) ** 2, 0) / gapDays.length) / gm * 100) / 100 : null;
  const dayViews = Array.from({ length: 7 }, () => []);
  dominant.forEach(v => dayViews[new Date(v.publishedAt).getUTCDay()].push(v.viewCount));
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const eligible = dayViews.map((a, i) => [a.length >= 3 ? median(a) : -1, i]).sort((a, b) => b[0] - a[0]);
  const bestDay = eligible[0][0] > 0 && eligible[0][0] > (eligible[1]?.[0] ?? 0) * 1.25 ? dayNames[eligible[0][1]] : null;

  const likeRates = videos.filter(v => v.viewCount > 0 && v.likeCount > 0).map(v => v.likeCount / v.viewCount);

  return {
    n, shortsCount: shorts.length, longCount: long.length,
    medianViews: med, p25: quantile(views, 0.25), p75: quantile(views, 0.75),
    medianLong: median(long.map(v => v.viewCount)), medianShorts: median(shorts.map(v => v.viewCount)),
    hitRate: n ? Math.round(views.filter(v => v >= 2 * med).length / n * 100) : 0,
    topConcentration: Math.round(byViews[0]?.viewCount / totalTop * 100) || 0,
    momentum, recentUploads, gapCv, bestDay, lifetimeMonthly, shortsShare: Math.round(shortsShare * 100) / 100,
    featureRates, likeRate: likeRates.length >= 5 ? Math.round(median(likeRates.map(r => Math.round(r * 1e5))) / 10) / 100 : null,
    top20, byViews
  };
}
