// Decides whether this browser can render clips on-device. Pure: everything it reads comes in through `Env`, so it
// is easy to test. Phones are excluded on purpose (weak hardware, and the long source video is rarely on the phone).

export interface Env {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  mobileHint?: boolean; // navigator.userAgentData?.mobile
  secure: boolean;
  has: { VideoEncoder: boolean; VideoDecoder: boolean; AudioEncoder: boolean; AudioDecoder: boolean };
}

export type Gate = { ok: true } | { ok: false; reason: 'phone' | 'insecure' | 'unsupported'; message: string };

const MESSAGES = {
  phone: 'Reelcut renders clips on your own computer, so it needs a desktop or laptop.',
  insecure: 'This page needs a secure (https) connection to work with video.',
  unsupported: 'This browser cannot process video here. Use a current Chrome or Edge on a computer.'
} as const;

const fail = (reason: keyof typeof MESSAGES): Gate => ({ ok: false, reason, message: MESSAGES[reason] });

export function checkDevice(env: Env): Gate {
  const phoneUa = /Android|iPhone|iPod|Mobile/i.test(env.userAgent);
  // iPadOS reports a Mac platform; a touch screen on a "Mac" is a tablet.
  const tablet = /iPad/i.test(env.userAgent) || (/Mac/i.test(env.platform) && env.maxTouchPoints > 1);
  if (env.mobileHint || phoneUa || tablet) return fail('phone');
  if (!env.secure) return fail('insecure');
  const { VideoEncoder, VideoDecoder, AudioEncoder, AudioDecoder } = env.has;
  if (!(VideoEncoder && VideoDecoder && AudioEncoder && AudioDecoder)) return fail('unsupported');
  return { ok: true };
}

export function currentEnv(): Env {
  const w = window as unknown as Record<string, unknown>;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform || '',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    mobileHint: (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile,
    secure: window.isSecureContext,
    has: {
      VideoEncoder: typeof w.VideoEncoder === 'function',
      VideoDecoder: typeof w.VideoDecoder === 'function',
      AudioEncoder: typeof w.AudioEncoder === 'function',
      AudioDecoder: typeof w.AudioDecoder === 'function'
    }
  };
}

/** The prefill from a report ("Send to Reelcut"): only a YouTube watch link and a short brief are accepted. */
export function readPrefill(search: string): { url: string; instructions: string } {
  const p = new URLSearchParams(search);
  let url = '';
  try {
    const u = new URL(p.get('url') ?? '');
    const host = u.hostname.replace(/^www\./, '');
    if (u.protocol === 'https:' && (host === 'youtube.com' || host === 'youtu.be')) url = u.href;
  } catch { /* not a URL */ }
  return { url, instructions: (p.get('instructions') ?? '').slice(0, 600) };
}
