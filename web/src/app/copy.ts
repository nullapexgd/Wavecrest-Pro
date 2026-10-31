// Copy-to-clipboard with visible, accessible feedback. The Clipboard API can be unavailable or blocked (older
// browsers, embedded views, permission policy), so there is a select-and-copy fallback; when even that fails the
// field is left selected and the button says what to press, so the person is never left guessing.

const FLASH_MS = 1900;
const timers = new WeakMap<HTMLElement, number>();
const isMac = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

export async function copyText(text: string, field?: HTMLInputElement | HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    field?.select();
    return true;
  } catch { /* fall through to the older route */ }
  const el = field ?? Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
  if (!field) { el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'; document.body.append(el); }
  el.focus();
  el.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* ignore */ }
  if (!field) el.remove();
  return ok;
}

const TICK = '<svg class="copy-tick" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.5"/></svg>';

/** Swaps the button's content for a drawn check and "Copied" (or the fallback hint), then puts it back. */
export function flashCopied(btn: HTMLElement, ok: boolean): void {
  window.clearTimeout(timers.get(btn));
  if (btn.dataset.was === undefined) btn.dataset.was = btn.innerHTML;
  btn.dataset.copied = ok ? 'yes' : 'no';
  btn.innerHTML = ok
    ? `${TICK}<span>Copied</span>`
    : `<span>Press ${isMac ? '⌘C' : 'Ctrl+C'} to copy</span>`;
  timers.set(btn, window.setTimeout(() => {
    btn.innerHTML = btn.dataset.was ?? btn.innerHTML;
    delete btn.dataset.was;
    delete btn.dataset.copied;
  }, ok ? FLASH_MS : FLASH_MS * 2));
}
