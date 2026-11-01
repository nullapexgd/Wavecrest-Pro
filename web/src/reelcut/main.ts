import '../page.ts';
import '../styles/app.css';
import '../styles/reelcut.css';
import { copyText, flashCopied } from '../app/copy';
import { checkDevice, currentEnv, readPrefill } from './gate';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const VIDEO = /\.(mp4|m4v|mov|mkv|webm)$/i;
const size = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

const gate = checkDevice(currentEnv());
const prefill = readPrefill(location.search);

const brief = $('[data-brief]');
if (prefill.url) {
  brief.hidden = false;
  $('[data-brief-url]').textContent = prefill.url;
  $('[data-brief-note]').textContent = prefill.instructions;
}

if (!gate.ok) {
  $('[data-tool]').hidden = true;
  const block = $('[data-blocked]');
  block.hidden = false;
  $('[data-blocked-msg]').textContent = gate.message;
  const page = location.href;
  // Phones get a way to carry the brief to a computer: copy the link, or mail it to themselves.
  $<HTMLAnchorElement>('[data-mail]').href = `mailto:?subject=${encodeURIComponent('Reelcut on my computer')}&body=${encodeURIComponent(page)}`;
  $('[data-copy-link]').addEventListener('click', async e => {
    const btn = e.currentTarget as HTMLElement;
    flashCopied(btn, await copyText(page));
  });
} else {
  void setupTool();
}

async function setupTool() {
  const { api, ReelcutError } = await import('./api');
  const { PART_SECONDS, partsOf, captionsFor, clock } = await import('./flow');
  const input = $<HTMLInputElement>('[data-file]');
  const drop = $('[data-drop]');
  const status = $('[data-file-status]');
  const go = $<HTMLButtonElement>('[data-go]');
  const range = $('[data-range]');
  const startMin = $<HTMLInputElement>('[data-start]');
  const length = $<HTMLSelectElement>('[data-length]');
  const work = $('[data-work]');
  const bar = $<HTMLProgressElement>('[data-bar]');
  const msg = $('[data-work-msg]');
  const cancel = $<HTMLButtonElement>('[data-cancel]');
  const errBox = $('[data-error]');
  const list = $('[data-clips]');
  let file: File | null = null;
  let duration = 0;
  let abort: (() => void) | null = null;
  let busy = false;

  const fail = (text: string, link?: [string, string]) => {
    errBox.replaceChildren(text);
    if (link) { errBox.append(' '); const a = document.createElement('a'); a.href = link[0]; a.textContent = link[1]; errBox.append(a); }
    errBox.hidden = false;
  };
  const progress = (v: number, text: string) => { bar.value = v; msg.textContent = text; };

  const choose = async (f?: File) => {
    if (!f || busy) return;
    if (!(f.type.startsWith('video/') || VIDEO.test(f.name))) {
      status.textContent = 'That is not a video file. Choose an MP4, MOV, MKV or WebM.';
      status.dataset.state = 'error';
      return;
    }
    file = f; duration = 0; range.hidden = true; list.replaceChildren(); errBox.hidden = true;
    status.textContent = `${f.name} · ${size(f.size)}. The file stays on your computer.`;
    status.dataset.state = 'ok';
    go.disabled = false;
    try {
      const { audioDuration } = await import('./audio');
      duration = await audioDuration(f);
      if (file !== f) return;
      status.textContent += ` ${clock(duration)} long.`;
      if (duration > PART_SECONDS) {
        $('[data-range-note]').textContent = `Reelcut searches about 20 minutes at a time. Choose where to start (minute 0 is the beginning).`;
        startMin.max = String(Math.max(0, Math.floor(duration / 60) - 1));
        range.hidden = false;
      }
    } catch { /* not decodable in this browser: the run reports it when it starts */ }
  };

  const run = async () => {
    if (!file || busy) return;
    const f = file;
    busy = true; go.disabled = true; errBox.hidden = true; list.replaceChildren(); work.hidden = false;
    let runId = '', cancelled = false, haveClips = false;
    abort = () => { cancelled = true; };
    try {
      progress(0, 'Starting');
      const started = await api.start();
      runId = started.runId;
      const from = Math.min(Math.max(0, Math.floor(+startMin.value || 0) * 60), Math.max(0, duration - 30));
      const windowSec = Math.max(1, started.parts - 1) * PART_SECONDS;
      progress(0.02, 'Loading the speech model (first time only, then it is cached)');
      const { transcribe } = await import('./transcribe');
      const t = transcribe(f, {
        range: duration ? { start: from, end: from + windowSec } : undefined,
        onProgress: (stage, v) => progress(stage === 'model' ? 0.02 + v * 0.18 : 0.2 + v * 0.65,
          stage === 'model' ? 'Loading the speech model' : 'Listening to the video on your computer')
      });
      abort = () => { cancelled = true; t.cancel(); };
      const { chunks } = await t.result;
      if (!chunks.length) throw new ReelcutError('No speech was found in that part of the video.', 'NO_SPEECH', 0);
      progress(0.88, 'Picking the best moments');
      const parts = partsOf(chunks).slice(0, Math.max(1, started.parts - 1));
      const picked = [];
      let lastErr: unknown;
      for (const part of parts) {
        if (cancelled) throw new Error('Cancelled');
        try { picked.push(...await api.pick(runId, part, prefill.instructions, ...(length.value.split('-').map(Number) as [number, number]))); } catch (e) { lastErr = e; if (e instanceof ReelcutError && e.code !== 'NO_CLIPS') break; }
      }
      if (!picked.length) throw lastErr ?? new ReelcutError('No clips came out of that video.', 'NO_CLIPS', 0);
      haveClips = true;
      progress(1, 'Done');
      work.hidden = true;
      picked.sort((a, b) => a.start - b.start).forEach(c => list.append(clipCard(f, c, chunks)));
    } catch (e) {
      if (runId && !haveClips) await api.refund(runId); // nothing useful came out, so the run is given back
      if (cancelled) fail('Cancelled. This did not use one of your videos.');
      else if (e instanceof ReelcutError && e.code === 'AUTH_REQUIRED') fail('Sign in to use Reelcut.', ['/login', 'Sign in']);
      else if (e instanceof ReelcutError && e.code === 'QUOTA_EXCEEDED') fail(`You have used this week's videos. They reset ${e.resetsAt ? new Date(e.resetsAt).toLocaleDateString() : 'on Monday'}.`);
      else if (e instanceof ReelcutError) fail(`${e.message} This did not use one of your videos.`);
      else fail('Reelcut could not read that video in this browser. This did not use one of your videos.');
    } finally {
      busy = false; abort = null; go.disabled = false; work.hidden = true;
    }
  };

  function clipCard(f: File, c: { start: number; end: number; title: string; hook: string; reason: string }, chunks: { start: number; end: number; text: string }[]) {
    const li = document.createElement('li'); li.className = 'clipcard';
    const h = document.createElement('h2'); h.textContent = c.title;
    const meta = document.createElement('p'); meta.className = 'fine'; meta.textContent = `${clock(c.start)} to ${clock(c.end)} · ${Math.round(c.end - c.start)} s`;
    const hook = document.createElement('p'); hook.textContent = `\u201c${c.hook}\u201d`;
    const why = document.createElement('p'); why.className = 'fine'; why.textContent = c.reason;
    const actions = document.createElement('div'); actions.className = 'clipcard__actions';
    const render = document.createElement('button'); render.type = 'button'; render.className = 'btn'; render.innerHTML = '<span>Make this clip</span>';
    const note = document.createElement('span'); note.className = 'fine'; note.setAttribute('role', 'status');
    actions.append(render, note);
    li.append(h, meta, hook, why, actions);
    render.addEventListener('click', async () => {
      render.disabled = true; note.textContent = 'Rendering on your computer';
      try {
        const { renderClip } = await import('./render');
        const out = await renderClip(f, { start: c.start, duration: c.end - c.start, layout: 'blur', captions: captionsFor(chunks, c.start, c.end), onProgress: v => { note.textContent = `Rendering ${Math.round(v * 100)}%`; } });
        const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: 'video/mp4' }));
        const v = document.createElement('video'); v.src = url; v.controls = true; v.playsInline = true;
        const dl = document.createElement('a'); dl.className = 'btn'; dl.href = url; dl.download = `${c.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 50) || 'clip'}.mp4`; dl.innerHTML = '<span>Download</span>';
        const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn btn--ghost'; copy.innerHTML = '<span>Copy title</span>';
        copy.addEventListener('click', async e => flashCopied(e.currentTarget as HTMLElement, await copyText(c.title)));
        render.remove(); note.textContent = '';
        li.insertBefore(v, actions); actions.append(dl, copy);
      } catch {
        render.disabled = false; note.textContent = 'That clip could not be made. Try again.';
      }
    });
    return li;
  }

  input.addEventListener('change', () => void choose(input.files?.[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.dataset.over = 'yes'; });
  drop.addEventListener('dragleave', () => delete drop.dataset.over);
  drop.addEventListener('drop', e => { e.preventDefault(); delete drop.dataset.over; void choose(e.dataTransfer?.files?.[0]); });
  go.addEventListener('click', () => void run());
  cancel.addEventListener('click', () => abort?.());
}
