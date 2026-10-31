// Video thumbnails come from YouTube's image servers and can fail on their own (a hiccup, a blocked network, a
// removed video). One or two failures get a plain "Thumbnail unavailable" tile in the image's place, so the layout
// holds and nothing looks broken. Three or more means something systemic, so a single "Try again" panel appears
// and re-requests only the images that failed. Nothing here touches the report's data.

/** More distinct videos failing than this show the retry panel instead of treating each one as a one-off.
 *  (A video's picture appears in several sections, so failures are counted per video, not per element.) */
export const THUMB_TOLERANCE = 2;

const fallbacks = new WeakMap<HTMLElement, HTMLImageElement>();
let attempt = 0;

function tile(img: HTMLImageElement): HTMLElement {
  const box = img.getBoundingClientRect();
  const t = document.createElement('span');
  t.className = 'thumb-fail';
  t.setAttribute('role', 'img');
  t.setAttribute('aria-label', 'Thumbnail unavailable');
  t.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 16l5-4 4 3 3-2 6 4"/><path d="M4 4l16 16"/></svg><span>Thumbnail unavailable</span>';
  if (box.width) t.style.width = `${box.width}px`;
  if (box.height) t.style.height = `${box.height}px`;
  return t;
}

function restore(t: HTMLElement): void {
  const img = fallbacks.get(t);
  if (!img) return;
  delete img.dataset.failed;
  img.src = `${img.dataset.src ?? img.src}${(img.dataset.src ?? '').includes('?') ? '&' : '?'}retry=${++attempt}`;
  t.replaceWith(img);
}

/** Watches every <img data-thumb> inside `scope`. `host` is where the retry panel goes. */
export function watchThumbs(scope: HTMLElement, host: HTMLElement): void {
  let panel: HTMLElement | null = null;
  const failed = () => [...scope.querySelectorAll<HTMLElement>('.thumb-fail')].filter(t => fallbacks.has(t));

  const sync = () => {
    const bad = failed();
    const videos = new Set(bad.map(t => fallbacks.get(t)!.dataset.src)).size;
    if (videos > THUMB_TOLERANCE && !panel) {
      panel = document.createElement('div');
      panel.className = 'thumbwarn';
      panel.setAttribute('role', 'alert');
      panel.innerHTML = `<div><strong>Some thumbnails did not load.</strong>
        <p>That is usually a connection problem or a hiccup at YouTube, not a problem with your report. The analysis itself is complete.</p></div>
        <button type="button" class="btn btn--ghost"><span>Try again</span></button>`;
      panel.querySelector('button')!.addEventListener('click', () => {
        failed().forEach(restore);
        panel?.remove(); panel = null;
      });
      host.prepend(panel);
    } else if (videos <= THUMB_TOLERANCE && panel) {
      panel.remove(); panel = null;
    }
  };

  const fail = (img: HTMLImageElement) => {
    if (img.dataset.failed) return;
    img.dataset.failed = '1';
    if (!img.dataset.src) img.dataset.src = img.src.split('?')[0]!;
    const t = tile(img);
    fallbacks.set(t, img);
    img.replaceWith(t);
    sync();
  };

  // 'error' does not bubble, so listen in the capture phase.
  scope.addEventListener('error', e => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.hasAttribute('data-thumb')) fail(img);
  }, true);
  scope.addEventListener('load', e => {
    if (e.target instanceof HTMLImageElement && e.target.hasAttribute('data-thumb')) sync();
  }, true);
  // an image can fail before this ran (cached failure)
  scope.querySelectorAll<HTMLImageElement>('img[data-thumb]').forEach(i => { if (i.complete && i.naturalWidth === 0 && i.src) fail(i); });
}
