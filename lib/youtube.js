import { UserFacingError, UpstreamError } from './errors.js';

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const VIDEO_ID = /^[\w-]{11}$/;
const HANDLE = /^[\w.-]{3,30}$/;

// Single parser for everything a user may paste. Returns null for anything we cannot
// resolve, so unsupported links are rejected BEFORE a run is reserved or an API is called.
//   { kind: 'handle' | 'channelId' | 'videoId' | 'legacy' | 'custom', value }
export function parseYouTubeInput(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!s || s.length > 200) return null;

  const bare = s.replace(/^@/, '');
  if (!/[/?]/.test(s) && HANDLE.test(bare) && !/^(www\.|m\.)?(youtube\.com|youtu\.be)$/i.test(bare)) {
    return { kind: 'handle', value: bare };
  }

  const m = s.match(/^(?:https?:\/\/)?(?:www\.|m\.)?(youtube\.com|youtu\.be)\/(\S+)$/i);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const rest = m[2];

  if (host === 'youtu.be') {
    const id = rest.split(/[/?#]/)[0];
    return VIDEO_ID.test(id) ? { kind: 'videoId', value: id } : null;
  }

  let x;
  if ((x = rest.match(/^@([\w.-]+)/))) return { kind: 'handle', value: x[1] };
  if ((x = rest.match(/^channel\/(UC[\w-]{20,})/))) return { kind: 'channelId', value: x[1] };
  if ((x = rest.match(/^(?:shorts|live|embed|v)\/([\w-]{11})(?:[/?#]|$)/))) return { kind: 'videoId', value: x[1] };
  if ((x = rest.match(/^watch\?(?:\S*&)?v=([\w-]{11})(?:[&#]|$)/))) return { kind: 'videoId', value: x[1] };
  if ((x = rest.match(/^user\/([\w.-]+)/))) return { kind: 'legacy', value: x[1] };
  if ((x = rest.match(/^c\/([\w.-]+)/))) return { kind: 'custom', value: x[1] };
  return null;
}

export function looksLikeYouTubeInput(input) {
  return parseYouTubeInput(input) !== null;
}

export async function ytFetch(endpoint, apiKey, signal) {
  const r = await fetch(`${YOUTUBE_API}/${endpoint}&key=${apiKey}`, { signal });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    let reason = null;
    try { reason = JSON.parse(text).error?.errors?.[0]?.reason || null; } catch {}
    const err = new UpstreamError('youtube', r.status, `${endpoint.split('?')[0]} ${reason || ''}`);
    err.reason = reason;
    err.endpoint = endpoint.split('?')[0];
    throw err;
  }
  return r.json();
}

const CHANNEL_PARTS = 'channels?part=snippet,statistics,contentDetails';

async function channelBy(query, apiKey, signal) {
  const r = await ytFetch(`${CHANNEL_PARTS}&${query}`, apiKey, signal);
  return r.items?.length ? extractChannelInfo(r.items[0]) : null;
}

export async function resolveChannel(input, apiKey, signal) {
  const parsed = parseYouTubeInput(input);
  if (!parsed) {
    throw new UserFacingError('Paste a channel link like youtube.com/@handle, or a video link.');
  }
  const notFound = new UserFacingError('We could not find that channel.', 'NOT_FOUND', 404);
  let channel = null;

  if (parsed.kind === 'channelId') {
    channel = await channelBy(`id=${parsed.value}`, apiKey, signal);
  } else if (parsed.kind === 'handle') {
    channel = await channelBy(`forHandle=${encodeURIComponent('@' + parsed.value)}`, apiKey, signal);
  } else if (parsed.kind === 'videoId') {
    const v = await ytFetch(`videos?part=snippet&id=${parsed.value}`, apiKey, signal);
    const channelId = v.items?.[0]?.snippet?.channelId;
    if (!channelId) throw new UserFacingError('We could not find that video.', 'NOT_FOUND', 404);
    channel = await channelBy(`id=${channelId}`, apiKey, signal);
  } else if (parsed.kind === 'legacy') {
    channel = await channelBy(`forUsername=${encodeURIComponent(parsed.value)}`, apiKey, signal);
  } else if (parsed.kind === 'custom') {
    // /c/Name custom URLs are not searchable for free; most match the channel's @handle.
    channel = await channelBy(`forHandle=${encodeURIComponent('@' + parsed.value)}`, apiKey, signal);
    if (!channel) {
      throw new UserFacingError('That /c/ link could not be resolved. Paste the channel’s @handle instead.', 'NOT_FOUND', 404);
    }
  }
  if (!channel) throw notFound;
  return channel;
}

function extractChannelInfo(item) {
  return {
    id: item.id,
    name: item.snippet?.title || '',
    handle: item.snippet?.customUrl || '',
    description: (item.snippet?.description || '').slice(0, 500),
    subscriberCount: parseInt(item.statistics?.subscriberCount || 0, 10),
    videoCountTotal: parseInt(item.statistics?.videoCount || 0, 10),
    viewCountTotal: parseInt(item.statistics?.viewCount || 0, 10),
    thumbnailUrl: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || '',
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || '',
    publishedAt: item.snippet?.publishedAt || ''
  };
}

export async function fetchVideos(playlistId, apiKey, maxVideos = 100, onProgress = () => {}, signal) {
  if (!playlistId) throw new UserFacingError('That channel has no public uploads to analyze.', 'NO_UPLOADS', 422);
  const videoIds = [];
  let pageToken = '';
  while (videoIds.length < maxVideos) {
    const perPage = Math.min(50, maxVideos - videoIds.length);
    let ep = `playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${perPage}`;
    if (pageToken) ep += `&pageToken=${encodeURIComponent(pageToken)}`;
    const r = await ytFetch(ep, apiKey, signal);
    if (!r.items?.length) break;
    for (const item of r.items) { const vid = item.snippet?.resourceId?.videoId; if (vid) videoIds.push(vid); }
    onProgress({ phase: 'listing', count: videoIds.length });
    pageToken = r.nextPageToken || '';
    if (!pageToken || videoIds.length >= maxVideos) break;
  }
  const videos = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50).join(',');
    const r = await ytFetch(`videos?part=snippet,statistics,contentDetails&id=${ids}`, apiKey, signal);
    if (r.items) videos.push(...r.items);
    onProgress({ phase: 'stats', count: videos.length, total: videoIds.length });
  }
  return videos.map(v => ({
    id: v.id,
    title: v.snippet?.title || '',
    description: (v.snippet?.description || '').slice(0, 400),
    publishedAt: v.snippet?.publishedAt || '',
    viewCount: parseInt(v.statistics?.viewCount || 0, 10),
    likeCount: parseInt(v.statistics?.likeCount || 0, 10),
    commentCount: parseInt(v.statistics?.commentCount || 0, 10),
    duration: parseDuration(v.contentDetails?.duration || 'PT0S'),
    thumbnailUrl: v.snippet?.thumbnails?.maxres?.url || v.snippet?.thumbnails?.high?.url || ''
  }));
}

function parseDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
}
