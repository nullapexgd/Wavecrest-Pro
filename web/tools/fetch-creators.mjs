// Snapshots the latest public uploads of a few real creators from YouTube's public RSS
// feeds (no API key, no account, nothing private). Output: src/data/creators.json.
// Run by hand: `npm run creators`. The site reads the JSON, it never calls YouTube.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HANDLES = [
  // widely known
  ['mkbhd', 'known'], ['MrBeast', 'known'], ['veritasium', 'known'], ['kurzgesagt', 'known'],
  ['LinusTechTips', 'known'], ['MarkRober', 'known'], ['Vsauce', 'known'],
  // smaller or specialist
  ['clickspring', 'niche'], ['Posy', 'niche'], ['TechnologyConnections', 'niche'],
  ['PracticalEngineering', 'niche'], ['Wintergatan', 'niche'], ['LockPickingLawyer', 'niche'],
  ['SummoningSalt', 'niche'], ['AdamNeely', 'niche'], ['NileRed', 'niche']
];

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; WavecrestSnapshot/1.0)' };
const attr = (s, re) => (s.match(re) || [])[1];
const unesc = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function one([handle, tier]) {
  const page = await (await fetch(`https://www.youtube.com/@${handle}`, { headers: UA })).text();
  const id = attr(page, /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
  if (!id) throw new Error(`no channel id for @${handle}`);
  const xml = await (await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { headers: UA })).text();
  const name = unesc(attr(xml, /<\/author>[\s\S]*?<title>([^<]*)<\/title>|<title>([^<]*)<\/title>/) || handle);
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
    const e = m[1];
    return {
      id: attr(e, /<yt:videoId>([^<]+)</),
      title: unesc(attr(e, /<title>([^<]*)<\/title>/)),
      published: attr(e, /<published>([^<]+)</).slice(0, 10),
      views: Number(attr(e, /<media:statistics views="(\d+)"/) ?? 0),
      likes: Number(attr(e, /<media:starRating count="(\d+)"/) ?? 0),
      short: /\/shorts\//.test(attr(e, /<link rel="alternate" href="([^"]+)"/) ?? '')
    };
  }).filter(v => v.id && v.views > 0);
  if (videos.length < 8) throw new Error(`@${handle}: only ${videos.length} usable uploads`);
  return { handle, name, channelId: id, tier, videos: videos.sort((a, b) => a.published.localeCompare(b.published)) };
}

const out = [];
for (const h of HANDLES) {
  try { const c = await one(h); out.push(c); console.log('ok  ', c.name.padEnd(28), c.videos.length, c.videos[0].published, '→', c.videos.at(-1).published); }
  catch (e) { console.log('skip', h[0], e.message); }
}
const file = fileURLToPath(new URL('../src/data/creators.json', import.meta.url));
writeFileSync(file, JSON.stringify({ snapshot: new Date().toISOString().slice(0, 10), source: 'YouTube public RSS feeds', creators: out }));
// The server allowlist: the live-data endpoint only ever fetches these channels.
const list = fileURLToPath(new URL('../../lib/sample-creators.json', import.meta.url));
writeFileSync(list, JSON.stringify(Object.fromEntries(out.map(c => [c.handle, c.channelId])), null, 1) + '\n');
console.log(`wrote ${out.length} creators`);
