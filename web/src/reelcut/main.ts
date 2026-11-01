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
  const input = $<HTMLInputElement>('[data-file]');
  const drop = $('[data-drop]');
  const status = $('[data-file-status]');
  const choose = (file?: File) => {
    if (!file) return;
    if (!(file.type.startsWith('video/') || VIDEO.test(file.name))) {
      status.textContent = 'That is not a video file. Choose an MP4, MOV, MKV or WebM.';
      status.dataset.state = 'error';
      return;
    }
    status.textContent = `${file.name} · ${size(file.size)}. The file stays on your computer.`;
    status.dataset.state = 'ok';
    $<HTMLButtonElement>('[data-go]').disabled = true; // rendering arrives in a later release
  };
  input.addEventListener('change', () => choose(input.files?.[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.dataset.over = 'yes'; });
  drop.addEventListener('dragleave', () => delete drop.dataset.over);
  drop.addEventListener('drop', e => {
    e.preventDefault();
    delete drop.dataset.over;
    choose(e.dataTransfer?.files?.[0]);
  });
}
