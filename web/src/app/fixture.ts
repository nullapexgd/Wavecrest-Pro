// An ILLUSTRATIVE report. The video facts (titles, dates, views, likes) are real public data
// for one channel from the home-page snapshot. The AI-style sections were written by hand to
// show the report's shape and are NOT the output of a real analysis, so the report carries
// `fixture: true` and the page says so. It is replaced by a stored, real report once the
// owner approves running one (docs/wavecrest-3/PROGRESS.md).
import snapshot from '../data/creators.json';
import type { Creator } from '../data/model.ts';
import type { Evidence } from './evidence.ts';
import type { Report } from './types.ts';

const creator = (snapshot.creators as Creator[]).find(c => c.handle === 'TechnologyConnections')!;
const vids = creator.videos;

const byViews = [...vids].sort((a, b) => b.views - a.views);
const byDate = [...vids].sort((a, b) => b.published.localeCompare(a.published));
const sortedViews = vids.map(v => v.views).sort((a, b) => a - b);
const medianViews = sortedViews[(sortedViews.length - 1) / 2]!;

const evidence: Evidence = {
  medianViews,
  computedAt: `${snapshot.snapshot}T00:00:00.000Z`,
  videos: vids.map(v => ({
    id: v.id, title: v.title, publishedAt: v.published, views: v.views, likes: v.likes, duration: 0, short: v.short,
    tags: [`T${byViews.indexOf(v) + 1}`, `R${byDate.indexOf(v) + 1}`]
  }))
};

// Cadence is arithmetic on the real dates, the same as lib/analysis.js computeCadence.
const ms = vids.map(v => Date.parse(v.published)).sort((a, b) => a - b);
const gaps = ms.slice(1).map((m, i) => (m - ms[i]!) / 86400000);
const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
const dayCount = new Array(7).fill(0);
ms.forEach(m => dayCount[new Date(m).getUTCDay()]++);
const peakDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dayCount.indexOf(Math.max(...dayCount))]!;

// Earnings use the same formula as the server: views per month x an RPM range the model chose.
const months = Math.max(1, (ms[ms.length - 1]! - ms[0]!) / (30 * 86400000));
const monthlyViewsEstimate = Math.round(vids.reduce((a, v) => a + v.views, 0) / months);
const [rpmLow, rpmHigh] = [3, 8];
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const low = (monthlyViewsEstimate * rpmLow) / 1000, high = (monthlyViewsEstimate * rpmHigh) / 1000;

export const fixtureReport: Report = {
  reportId: 'fixture-sample',
  fixture: true,
  channel: { name: creator.name, handle: `@${creator.handle}`, thumbnailUrl: '', subscriberCount: 0 },
  videoCount: vids.length,
  createdAt: evidence.computedAt,
  visibility: 'link',
  isOwner: false,
  analysis: {
    evidence,
    hooks: {
      primaryPattern: 'A plain, slightly contrarian claim about an ordinary machine, stated as a finished sentence rather than a question.',
      examples: [
        'Nobody understands the point of hybrid cars',
        'You are being misled about renewable energy technology.',
        'I was right about dishwasher pods, and now I can prove it'
      ],
      frequency: '4 of top 5',
      secondaryPatterns: [
        'Nostalgia for technology that faded (T5, T15).',
        'Personal ownership: "My water heater is cooler than yours" (T10), "My car charger can boil water really fast" (T12).'
      ]
    },
    thumbnails: {
      formula: 'The device under discussion as a single clear subject, with the title doing the explaining.',
      characteristics: ['One appliance or part as the subject', 'Very little text on the image', 'A consistent look from upload to upload'],
      textOverlayStyle: 'Minimal. The title carries the argument, not the image.'
    },
    cadence: {
      schedule: 'About one upload a month, faster in autumn 2025 (8 uploads in four months) and slower through 2026.',
      consistency: 'Irregular: bursts of two or three uploads close together, then gaps of five to nine weeks.',
      peakPerformanceWindow: 'The strongest uploads (T1, T2, T3) are spread across eight months, so no calendar window stands out.',
      avgDaysBetweenVideos: Math.round(avgGap * 10) / 10,
      videosPerMonth: Math.round((30 / avgGap) * 10) / 10,
      peakDay
    },
    audience: {
      primaryProfile: 'Curious generalists who like understanding why ordinary machines are built the way they are.',
      estimatedAge: '25 to 45',
      viewerIntent: 'To learn how a familiar device works and whether a common belief about it is wrong.',
      loyaltySignal: 'Likes per view stay between about 2% and 6% across all fifteen uploads, highest on T1.'
    },
    pillars: [
      { name: 'Everyday machines explained', percentage: 55, description: 'Household and vehicle systems: T2 ceiling fans, T10 water heaters, T7 dehumidifiers, T9 catalytic converters, T8 oil pressure.' },
      { name: 'Contrarian takes on technology narratives', percentage: 25, description: 'T1 renewable energy, T4 hybrid cars, T3 dishwasher pods.' },
      { name: 'Nostalgia and audio-visual technology', percentage: 20, description: 'T5 video projectors, T15 the cassette player built into an 8-track cartridge, T11 audible alerts.' }
    ],
    monetization: {
      primaryApproach: 'No clear signals from titles: likely AdSense.',
      signals: [],
      brandAffinities: 'None visible in the titles.'
    },
    gaps: [
      { opportunity: 'Refrigerators and freezers', rationale: 'No title covers cold storage, although household-system explainers perform well (T2, T3).' },
      { opportunity: 'Smart-home and connected devices', rationale: 'Zero mentions. T11 shows interest in how devices communicate with their owners.' },
      { opportunity: 'Cordless tools and batteries', rationale: 'No title covers battery technology; T8 and T9 show appetite for hidden components.' }
    ],
    earningsEstimate: {
      monthlyViewsEstimate,
      cpmRPM: `Consumer Tech $${rpmLow}-${rpmHigh}`,
      estimatedMonthlyAdRevenue: `${money(low)}–${money(high)}`,
      otherRevenue: 'Unclear from data',
      totalEstimate: `${money(low)}–${money(high)}/month`
    },
    videoIdeas: [
      {
        title: 'The refrigerator is the most misunderstood machine in your kitchen',
        rationale: 'Refrigeration is absent from every title while household-system explainers sit above the median (T2, T3). Uses the plain declarative frame of T4.',
        estimatedPerformance: 'Likely near T2 and T3.'
      },
      {
        title: 'Nobody understands the point of smart thermostats',
        rationale: 'Takes the exact structure of T4 and the contrarian angle of T1 to the smart-home gap, which no title covers.',
        estimatedPerformance: 'Could approach T4 if the argument is as clear.'
      },
      {
        title: 'I was wrong about induction cooktops, and now I can prove it',
        rationale: 'Borrows the first-person "receipts" format of T3, one of the top three, on a topic the channel has not touched.',
        estimatedPerformance: 'In the range of T3.'
      },
      {
        title: 'Camcorders used to be ridiculously cool',
        rationale: 'Repeats the nostalgia hook of T5, which beat the median, and avoids the narrower cassette angle that did not (T15).',
        estimatedPerformance: 'Between T5 and T15.'
      },
      {
        title: 'Why your cordless tool battery dies in the cold',
        rationale: 'Fills the battery gap and pairs with the hidden-component appeal of T8 and T9.',
        estimatedPerformance: 'Uncertain: no title covers batteries yet.'
      }
    ]
  }
};
