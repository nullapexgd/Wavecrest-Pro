// A stand-in for /api/* so the analyzer can be built, previewed and tested with no server, no
// database and no keys. Installed only by dev builds and the single-file preview (see main.ts);
// the production bundle never contains it. Scenario via ?mock= : default | out | limit | busy | error | slow
import { fixtureReport } from './fixture.ts';

const KEY = 'wc-mock';
const read = (): { signedIn: boolean; used: number; visibility: 'private' | 'link'; ran: boolean } => {
  try { return { signedIn: true, used: 0, visibility: 'private', ran: false, ...JSON.parse(sessionStorage.getItem(KEY) ?? '{}') }; }
  catch { return { signedIn: true, used: 0, visibility: 'private', ran: false }; }
};
const write = (s: ReturnType<typeof read>) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } };

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function installMock(): void {
  const scenario = new URLSearchParams(location.search).get('mock') ?? sessionStorage.getItem('wc-scenario') ?? 'default';
  try { sessionStorage.setItem('wc-scenario', scenario); } catch { /* ignore */ }
  const state = read();
  if (scenario === 'out') state.signedIn = false;
  if (scenario === 'limit') state.used = 1;
  write(state);
  const real = window.fetch.bind(window);

  const owned = () => ({ ...fixtureReport, reportId: 'fixture-run', visibility: read().visibility, isOwner: true, fixture: true });

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return real(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const s = read();
    await sleep(120);

    if (url.pathname === '/api/auth/me') {
      return s.signedIn
        ? reply(200, { user: { email: 'you@example.com', name: 'Preview User' }, entitlement: { plan: 'free', label: 'Free beta', limit: 1 }, usage: { used: s.used } })
        : reply(401, { error: 'Not signed in', code: 'UNAUTHENTICATED' });
    }
    if (url.pathname === '/api/auth/logout') { write({ ...s, signedIn: false }); return reply(200, { ok: true }); }
    if (url.pathname === '/api/reports') {
      if (!s.signedIn) return reply(401, { error: 'Sign in to see your reports', code: 'AUTH_REQUIRED' });
      const r = owned();
      return reply(200, { reports: s.ran ? [{ reportId: r.reportId, visibility: r.visibility, channel: r.channel, videoCount: r.videoCount, createdAt: new Date().toISOString() }] : [] });
    }
    if (url.pathname.startsWith('/api/report/')) {
      const id = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      if (id !== 'fixture-run' && id !== 'fixture-sample') return reply(404, { error: 'Report not found', code: 'NOT_FOUND' });
      if (method === 'PATCH') {
        const v = JSON.parse(String(init?.body ?? '{}')).visibility;
        write({ ...s, visibility: v });
        return reply(200, { reportId: id, visibility: v });
      }
      if (method === 'DELETE') { write({ ...s, ran: false }); return reply(200, { ok: true }); }
      return reply(200, id === 'fixture-run' ? owned() : fixtureReport);
    }
    if (url.pathname === '/api/analyze-stream') {
      if (!s.signedIn) return reply(401, { error: 'Sign in to run an analysis.', code: 'AUTH_REQUIRED' });
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (!/youtu|^@?[\w.-]{3,}$/i.test(String(body.url ?? ''))) return reply(400, { error: 'Paste a channel link like youtube.com/@handle, or a video link.', code: 'INVALID_INPUT' });
      if (s.used >= 1) return reply(429, { error: 'You’ve used this month’s free analysis.', code: 'PLAN_LIMIT', used: 1, limit: 1 });
      if (scenario === 'busy') return reply(409, { error: 'An analysis is already running for your account.', code: 'IN_PROGRESS' });
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        async start(c) {
          const send = (ev: string, d: unknown) => c.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`));
          const wait = scenario === 'slow' ? 4000 : 900;
          const steps = [[1, 'Fetching channel info'], [2, 'Found Technology Connections · loading videos (61)'], [3, 'Fetching video stats (61/100)'], [4, '100 videos loaded · running AI analysis'], [5, 'Saving report']] as const;
          for (const [n, label] of steps) {
            send('progress', { step: n, label });
            if (scenario === 'error' && n === 4) { await sleep(wait); send('fail', { message: 'The analysis service is busy. Try again in a moment.', code: 'UPSTREAM' }); return c.close(); }
            await sleep(n === 4 ? wait * 2 : wait);
          }
          write({ ...read(), used: 1, ran: true });
          send('done', owned());
          c.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return reply(404, { error: 'No mock for this route', code: 'NOT_FOUND' });
  };
}
