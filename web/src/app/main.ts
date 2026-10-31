// The analyzer: sign-in state, the start form, a live run, and the report. One small module,
// no framework, no WebGL (the 3D scene belongs to the home page only).
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/page.css';
import '../styles/app.css';
import { authNav } from '../authNav.ts';
import '../settings.ts';
import { formatDate } from '../data/model.ts';
import * as api from './api.ts';
import { ApiError } from './api.ts';
import { citedBy, chip, drawerHtml, esc, renderReport } from './report.ts';
import { watchThumbs } from './thumbs.ts';
import { tagIndex } from './evidence.ts';
import type { Me, Report, ReportListItem } from './types.ts';

const root = document.querySelector<HTMLElement>('[data-app]')!;
let mode = document.body.dataset.mode ?? 'app'; // 'app' | 'sample'

const INLINE = __INLINE_MODELS__; // the single-file hosted preview: no server, no page loads
const PREVIEW = import.meta.env.DEV || INLINE;
const setUrl = (u: string) => { try { history.replaceState(null, '', u); } catch { /* sandboxed preview */ } };
const STEPS = ['Find the channel', 'Load its videos', 'Read the numbers', 'Analyse with AI', 'Save the report'];
const DOING = ['Finding the channel', 'Loading its videos', 'Reading the numbers', 'Analysing with AI', 'Saving your report'];
const arrow = `<span class="btn__go" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" focusable="false"><path d="M3 8h9M8.500 4l4 4-4 4" /></svg></span>`;

let me: Me | null = null;
let current: Report | null = null;
let drawer: HTMLDialogElement;
let spy: IntersectionObserver | undefined;

const monthReset = () => {
  const d = new Date(); d.setUTCMonth(d.getUTCMonth() + 1, 1);
  return formatDate(d.toISOString().slice(0, 10));
};
const setTitle = (t: string) => { document.title = `${t} · Wavecrest`; };
const swap = (html: string, focusSel = 'h1') => {
  spy?.disconnect();
  root.innerHTML = html;
  root.querySelector<HTMLElement>(focusSel)?.setAttribute('tabindex', '-1');
  root.querySelector<HTMLElement>(focusSel)?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
};

/* ───────────── small states ───────────── */

const skeleton = (label: string) => `
  <div class="state state--load" role="status" aria-live="polite">
    <h1 class="title">${esc(label)}</h1>
    <div class="skel" aria-hidden="true"><i></i><i></i><i></i></div>
  </div>`;

function failView(err: unknown, retry?: () => void): void {
  const e = err instanceof ApiError ? err : new ApiError(0, 'NETWORK', 'The connection dropped.');
  const known: Record<string, { h: string; p: string; action?: string }> = {
    AUTH_REQUIRED: { h: 'Sign in to continue', p: 'Analyses need a free account. The sample report is open to everyone.' },
    PLAN_LIMIT: { h: 'This month\'s free analysis is used', p: `The count resets on ${monthReset()} (UTC). Your earlier reports are still yours to open.` },
    IN_PROGRESS: { h: 'An analysis is already running', p: 'Only one can run at a time. Give it a minute, then check your reports.', action: 'Check again' },
    PREVIOUS_FAILED: { h: 'That attempt did not finish', p: 'It did not use your analysis. Start a new one.', action: 'Start again' },
    RATE_LIMITED: { h: 'Too many requests', p: 'Wait a little while and try again. Nothing was used.', action: 'Try again' },
    NOT_FOUND: { h: 'That report does not exist', p: 'It may be private, deleted, or the link may be wrong. Private reports only open for their owner.' },
    NETWORK: { h: 'The connection dropped', p: 'If the analysis finished, it is already in your reports. If not, it did not use your analysis.', action: 'Try again' }
  };
  const k = known[e.code] ?? { h: 'Something went wrong', p: `${e.message} This did not use your analysis.`, action: 'Try again' };
  const signIn = e.code === 'AUTH_REQUIRED' || e.status === 401;
  swap(`<div class="state state--fail" role="alert">
      <p class="eyebrow">${esc(e.code === 'NOT_FOUND' ? '404' : 'Could not continue')}</p>
      <h1 class="title">${esc(k.h)}</h1><p class="lead">${esc(k.p)}</p>
      <div class="actions">
        ${signIn ? `<a class="btn btn--primary" href="/login"><span>Sign in</span>${arrow}</a>` : k.action && retry ? `<button class="btn btn--primary" type="button" data-retry><span>${esc(k.action)}</span>${arrow}</button>` : ''}
        <a class="btn btn--ghost" href="/app">Back to start</a>
        ${mode === 'app' ? '<a class="btn btn--quiet" href="/sample">See the sample report</a>' : ''}
      </div></div>`);
  root.querySelector('[data-retry]')?.addEventListener('click', () => retry?.());
  setTitle(k.h);
}

/* ───────────── start ───────────── */

async function home(): Promise<void> {
  if (!me) return signedOut();
  swap(skeleton('Loading your workspace'));
  const list: ReportListItem[] = await api.listReports().catch(() => []);
  const limit = me.entitlement.limit;
  const used = me.usage.used;
  const spent = limit !== null && used !== null && used >= limit;
  const left = limit === null ? null : used === null ? null : Math.max(0, limit - used);

  const quota = limit === null
    ? `<p class="quota"><b>Unlimited analyses</b> on your ${esc(me.entitlement.label)} plan.</p>`
    : used === null
      ? `<p class="quota">Free beta: ${limit} analysis a month. We could not read your usage just now.</p>`
      : `<p class="quota ${spent ? 'quota--spent' : ''}"><b>${left} of ${limit}</b> analysis left this month${spent ? `, resets ${esc(monthReset())} (UTC)` : ''}.</p>`;

  const history = list.length
    ? `<section class="history" aria-labelledby="hist"><h2 id="hist" class="h-small">Your reports</h2><ul class="hist">${list.map(r => `
        <li><a href="/app?r=${esc(r.reportId)}"><span class="hist__name">${esc(r.channel.name)}</span>
          <span class="meta">${esc(formatDate(r.createdAt.slice(0, 10)))} · ${esc(r.videoCount)} videos</span>
          <span class="hist__vis">${r.visibility === 'link' ? 'Shared' : 'Private'}</span></a></li>`).join('')}</ul></section>`
    : `<section class="history empty"><h2 class="h-small">Your reports</h2><p>Nothing here yet. Your first report will appear here, private to you.</p></section>`;

  swap(`
    <div class="home"><div>
    <div class="start">
      <p class="eyebrow">New analysis</p>
      <h1 class="display start__h">Which channel should we read?</h1>
      <form class="ask" data-form novalidate>
        <label class="ask__label" for="chan">YouTube channel link</label>
        <div class="ask__row">
          <input id="chan" name="url" type="text" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false"
                 placeholder="youtube.com/@channel" ${spent ? 'disabled' : ''} aria-describedby="chan-help chan-err" required>
          <button class="btn btn--primary" type="submit" ${spent ? 'disabled' : ''}><span>Analyse</span>${arrow}</button>
        </div>
        <p class="ask__help" id="chan-help">A channel link or @handle works. Any public channel with at least 3 videos.</p>
        <p class="ask__err" id="chan-err" role="alert" hidden></p>
      </form>
      ${quota}
      <p class="note">Takes about a minute. It reads public data only: titles, dates, views and likes, never private YouTube Studio numbers.</p>
    </div>
    ${history}</div>
    <aside class="peek" aria-labelledby="peek-h"><h2 id="peek-h">What the report gives you</h2><ul>
      <li><b>Next videos to make</b>Five ideas, each tied to the real videos it was built from.</li>
      <li><b>A map of the whole channel</b>Every upload against the channel's median, with the hits marked.</li>
      <li><b>Eight more readings</b>Hooks, thumbnails, cadence, audience, pillars, monetization, gaps and earnings, each labelled observed, calculated, inferred or estimated.</li>
      <li><a href="/sample">Open the sample report</a></li></ul></aside></div>`, 'h1');
  setTitle('New analysis');

  const form = root.querySelector<HTMLFormElement>('[data-form]')!;
  const input = form.querySelector<HTMLInputElement>('#chan')!;
  const err = form.querySelector<HTMLElement>('#chan-err')!;
  input.focus();
  form.addEventListener('submit', e => {
    e.preventDefault();
    const url = input.value.trim();
    if (!/youtu|^@?[\w.-]{3,}$/i.test(url)) {
      err.textContent = 'Paste a channel link like youtube.com/@handle, or a video link.';
      err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus();
      return;
    }
    run(url);
  });
  input.addEventListener('input', () => { err.hidden = true; input.removeAttribute('aria-invalid'); });
}

function signedOut(): void {
  swap(`<div class="start">
    <p class="eyebrow">Free beta</p>
    <h1 class="display start__h">Sign in to read a channel.</h1>
    <p class="lead">One free analysis a month with a Google or GitHub account. No card, nothing to buy. Not ready? The sample report is open to everyone.</p>
    <div class="actions"><a class="btn btn--primary" href="/login"><span>Sign in</span>${arrow}</a><a class="btn btn--ghost" href="/sample">See the sample report</a></div>
  </div>`);
  setTitle('Sign in');
}

/* ───────────── a live run ───────────── */

async function run(url: string): Promise<void> {
  const key = api.attemptKey(url);
  const started = Date.now();
  swap(`<div class="state state--run" role="status" aria-live="polite">
      <p class="eyebrow">Analysing</p><h1 class="title" data-run-title>Reading the channel</h1>
      <ol class="steps" data-steps>${STEPS.map((s, i) => `<li data-s="${i + 1}"><span class="steps__dot" aria-hidden="true"></span>${esc(s)}</li>`).join('')}</ol>
      <p class="run__detail" data-detail>Starting…</p>
      <p class="note" data-slow hidden>Still working. The AI step can take a little longer on big channels. Keep this tab open.</p>
    </div>`, '[data-run-title]');
  setTitle('Analysing');
  const li = (n: number) => root.querySelector<HTMLElement>(`[data-s="${n}"]`);
  const detail = root.querySelector<HTMLElement>('[data-detail]')!;
  const tick = window.setInterval(() => {
    if (Date.now() - started > 45_000) root.querySelector<HTMLElement>('[data-slow]')?.removeAttribute('hidden');
  }, 2000);

  try {
    const report = await api.analyze(url, key, {
      onProgress(step, label) {
        for (let i = 1; i <= STEPS.length; i++) {
          li(i)?.classList.toggle('done', i < step);
          li(i)?.classList.toggle('now', i === step);
        }
        detail.textContent = label;
        const h = root.querySelector('[data-run-title]');
        if (h) h.textContent = DOING[step - 1] ?? 'Analysing';
      }
    });
    api.forgetAttempt(url);
    if (me?.usage.used != null) me.usage.used += 1;
    current = report;
    if (report.reportId) setUrl(`/app?r=${encodeURIComponent(report.reportId)}`);
    show(report);
  } catch (e) {
    // A refused or failed run was refunded, so the next try starts fresh. A dropped connection
    // keeps the key: retrying the same channel replays the first run instead of charging twice.
    if (!(e instanceof ApiError) || e.code !== 'NETWORK' && e.code !== 'NO_RESULT' && e.code !== 'NO_STREAM') api.forgetAttempt(url);
    failView(e, () => void home());
  } finally {
    clearInterval(tick);
  }
}

/* ───────────── the report ───────────── */

function show(report: Report): void {
  current = report;
  swap(renderReport(report), 'h1');
  setTitle(`${report.channel.name} report`);
  actions(report);
  bindFeedback(report);
  watchThumbs(root, root.querySelector<HTMLElement>('.rp__main') ?? root);
  const rail = root.querySelectorAll<HTMLAnchorElement>('[data-spy]');
  const secs = [...root.querySelectorAll<HTMLElement>('[data-section]')];
  spy = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      rail.forEach(a => {
        if (a.dataset.spy === (en.target as HTMLElement).dataset.section) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      });
    }
  }, { rootMargin: '-25% 0px -65% 0px' });
  secs.forEach(s => spy!.observe(s));
}

function bindFeedback(r: Report): void {
  const box = root.querySelector<HTMLElement>('[data-feedback]');
  const form = box?.querySelector<HTMLFormElement>('[data-feedback-form]');
  if (!box || !form) return;
  const send = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const label = send.querySelector<HTMLElement>('[data-send-label]')!;
  const status = form.querySelector<HTMLElement>('[data-feedback-status]')!;
  const text = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const count = form.querySelector<HTMLElement>('[data-feedback-count]')!;
  const choices = [...form.querySelectorAll<HTMLButtonElement>('[data-useful]')];
  let useful: 'yes' | 'no' | null = null;
  choices.forEach(b => b.addEventListener('click', () => {
    useful = b.dataset.useful as 'yes' | 'no';
    choices.forEach(c => c.setAttribute('aria-pressed', String(c === b)));
    send.disabled = false;
    status.textContent = ''; status.removeAttribute('data-error');
  }));
  text.addEventListener('input', () => {
    count.textContent = text.value ? `${text.value.length} / ${text.maxLength}` : '';
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!useful || send.hasAttribute('data-loading')) return;
    send.setAttribute('data-loading', ''); send.setAttribute('aria-busy', 'true');
    label.textContent = 'Sending'; status.textContent = ''; status.removeAttribute('data-error');
    try {
      await api.sendFeedback(useful, text.value, r.reportId);
      box.classList.add('is-sent');
      box.querySelector<HTMLElement>('[data-feedback-done]')!.hidden = false;
      box.querySelector<HTMLElement>('[data-feedback-sr]')!.textContent = 'Feedback sent. Thank you.';
      form.querySelectorAll<HTMLElement>('button, textarea').forEach(el => el.setAttribute('disabled', ''));
    } catch {
      status.textContent = 'Could not send that. Try again in a moment.';
      status.setAttribute('data-error', '');
      send.removeAttribute('data-loading'); send.removeAttribute('aria-busy'); label.textContent = 'Send feedback';
    }
  });
}

function actions(r: Report): void {
  const host = root.querySelector<HTMLElement>('[data-actions]')!;
  const link = (id: string) => `${location.origin}/app?r=${id}`;
  if (r.fixture && mode === 'sample') {
    host.innerHTML = `<a class="btn btn--primary" href="${me ? '/app' : '/login'}"><span>Analyse your own channel</span>${arrow}</a>`;
    return;
  }
  if (!r.isOwner) {
    host.innerHTML = `<a class="btn btn--primary" href="${me ? '/app' : '/login'}"><span>Run your own analysis</span>${arrow}</a>`;
    return;
  }
  const shared = r.visibility === 'link';
  host.innerHTML = `
    <a class="btn btn--primary" href="/app"><span>New analysis</span>${arrow}</a>
    <button class="btn btn--ghost" type="button" data-share aria-pressed="${shared}" ${r.reportId ? '' : 'disabled'}><span>${shared ? 'Shared by link' : 'Private'}</span></button>
    <button class="btn btn--quiet" type="button" data-print><span>Print</span></button>
    <button class="btn btn--quiet" type="button" data-delete ${r.reportId ? '' : 'disabled'}><span>Delete</span></button>
    <div class="sharebox" data-sharebox ${shared ? '' : 'hidden'}>
      <input readonly aria-label="Share link" value="${esc(r.reportId ? link(r.reportId) : '')}" data-link>
      <button class="btn btn--ghost" type="button" data-copylink><span>Copy link</span></button>
    </div>
    ${r.reportId ? '' : '<p class="muted">This report could not be saved, so it cannot be shared. It will not be in your history.</p>'}`;
  host.querySelector('[data-print]')?.addEventListener('click', () => window.print());
  host.querySelector('[data-share]')?.addEventListener('click', async e => {
    const btn = e.currentTarget as HTMLButtonElement;
    const next = r.visibility === 'link' ? 'private' : 'link';
    btn.disabled = true;
    try {
      const res = await api.setVisibility(r.reportId, next);
      r.visibility = res.visibility;
      actions(r);
      root.querySelector<HTMLElement>('[data-share]')?.focus();
    } catch (er) { btn.disabled = false; toast(er instanceof Error ? er.message : 'Could not change sharing'); }
  });
  host.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!confirm('Delete this report? This cannot be undone, and the analysis it used will not be refunded.')) return;
    try { await api.deleteReport(r.reportId); setUrl('/app'); await home(); }
    catch (er) { toast(er instanceof Error ? er.message : 'Could not delete'); }
  });
}

/* ───────────── drawer, copy, tooltip ───────────── */

function toast(msg: string): void {
  const live = document.querySelector<HTMLElement>('[data-toast]')!;
  live.textContent = msg; live.hidden = false;
  window.setTimeout(() => { live.hidden = true; }, 3200);
}

function openVideo(find: (ev: NonNullable<Report['analysis']['evidence']>) => ReturnType<ReturnType<typeof tagIndex>['get']>): void {
  const ev = current?.analysis.evidence;
  if (!current || !ev) return;
  const v = find(ev);
  if (!v) return;
  drawer.querySelector('[data-drawer-body]')!.innerHTML = drawerHtml(v, ev, citedBy(current.analysis).get(v.id) ?? []);
  drawer.showModal();
}

function wire(): void {
  drawer = document.querySelector<HTMLDialogElement>('[data-drawer]')!;
  drawer.querySelector('[data-drawer-close]')!.addEventListener('click', () => drawer.close());
  watchThumbs(drawer, drawer.querySelector<HTMLElement>('[data-drawer-body]')!); // the drawer's picture gets the same fallback
  drawer.addEventListener('click', e => { if (e.target === drawer) drawer.close(); });

  root.addEventListener('click', async e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tag], [data-video], [data-copy], [data-copylink], .mk');
    if (!t) return;
    if (t.dataset.tag) openVideo(ev => tagIndex(ev).get(t.dataset.tag!));
    else if (t.dataset.video) openVideo(ev => ev.videos.find(v => v.id === t.dataset.video));
    else if (t.classList.contains('mk')) openVideo(ev => ev.videos.find(v => v.id === t.getAttribute('data-id')));
    else if (t.dataset.copy || t.dataset.copylink) {
      const text = t.dataset.copy ?? root.querySelector<HTMLInputElement>('[data-link]')?.value ?? '';
      try { await navigator.clipboard.writeText(text); toast(t.dataset.copy ? (t.dataset.copymsg ?? 'Title copied') : 'Link copied'); }
      catch { toast('Copy is blocked here. Select and copy it manually.'); }
    }
  });
  root.addEventListener('keydown', e => {
    const k = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && k.classList?.contains('mk')) { e.preventDefault(); k.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  // hover card for the chart marks
  const tip = document.querySelector<HTMLElement>('[data-tip]')!;
  root.addEventListener('pointerover', e => {
    const m = (e.target as HTMLElement).closest<SVGGElement>('.mk');
    if (!m || (e as PointerEvent).pointerType === 'touch') return;
    tip.textContent = m.getAttribute('aria-label')?.replace(/, used as evidence.*$/, '') ?? '';
    const r = m.getBoundingClientRect();
    tip.style.transform = `translate(${Math.min(innerWidth - 300, Math.max(8, r.left - 40))}px, ${r.top - 52 + scrollY}px)`;
    tip.hidden = false;
  });
  root.addEventListener('pointerout', e => { if ((e.target as HTMLElement).closest('.mk')) tip.hidden = true; });
}

/* ───────────── boot ───────────── */

async function loadReport(id: string): Promise<void> {
  swap(skeleton('Opening report'));
  try { show(await api.getReport(id)); } catch (e) { failView(e, () => loadReport(id)); }
}

function navAuth(): void {
  const a = document.querySelector<HTMLAnchorElement>('[data-nav-auth]');
  if (!a) return;
  a.textContent = me ? 'Sign out' : 'Sign in';
  a.href = me ? '#' : '/login';
  if (a.dataset.bound) return;
  a.dataset.bound = '1';
  a.addEventListener('click', async e => {
    if (!me) return; // plain link to /login
    e.preventDefault();
    e.stopImmediatePropagation();
    await api.logout().catch(() => undefined);
    if (INLINE) { me = null; navAuth(); return void route('/app'); }
    location.href = '/';
  });
}

/** In the single-file preview there are no page loads: internal links switch views in place. */
async function route(path: string): Promise<void> {
  if (path === '/sample') { mode = 'sample'; const { fixtureReport } = await import('./fixture.ts'); return show(fixtureReport); }
  mode = 'app';
  if (path === '/login') { try { sessionStorage.setItem('wc-mock', JSON.stringify({ signedIn: true })); } catch { /* ignore */ } me = await api.me().catch(() => null); navAuth(); }
  return void home();
}

async function boot(): Promise<void> {
  if (PREVIEW) await import('./mock.ts').then(m => m.installMock());
  wire();
  try { me = await api.me(); } catch { me = null; }
  navAuth();
  if (INLINE) {
    document.addEventListener('click', e => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="/"]');
      if (!a) return;
      e.preventDefault();
      const p = a.getAttribute('href')!;
      if (p === '/sample' || p === '/login' || p === '/app' || p === '/') void route(p === '/' ? '/app' : p);
      else toast('That page is not part of this preview.');
    });
  }

  if (mode === 'sample') {
    const { fixtureReport } = await import('./fixture.ts');
    return show(fixtureReport);
  }
  const id = new URLSearchParams(location.search).get('r');
  if (id) return void loadReport(id);
  return void home();
}

authNav();
void boot();
