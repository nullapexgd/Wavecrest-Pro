import './styles/tokens.css';
import './styles/base.css';
import './styles/stage.css';

/*
  Boot. This file is the whole of the initial JavaScript; the 3D scene and Three.js are a
  separate chunk that loads only when the rules below allow it.

    auto-load   desktop-class pointer, WebGL2, no data-saver, no reduced-motion
    opt-in      WebGL2 is there but the context is constrained (touch, narrow, data-saver,
                reduced motion): the picture is already complete, and a button offers the 3D
    never       no WebGL2: the static chart is the experience, and it is a complete one

  Nothing here listens to scroll. The two-state story (hero, chart) is driven by an
  IntersectionObserver; the scene scrubs it continuously only while it is running.
*/

const q = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);

const stage = q<HTMLElement>('[data-stage]')!;
const pin = q<HTMLElement>('[data-pin]')!;
const canvas = q<HTMLCanvasElement>('[data-canvas]')!;
const tools = q<HTMLElement>('[data-tools]')!;
const exploreBtn = q<HTMLButtonElement>('[data-explore]')!;
const caption = q<HTMLElement>('[data-caption]')!;

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // give the context back immediately
    return true;
  } catch { return false; }
}

const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
const caps = {
  webgl2: hasWebGL2(),
  saveData: !!nav.connection?.saveData,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  fine: matchMedia('(pointer: fine)').matches,
  wide: innerWidth >= 900
};
const auto = caps.webgl2 && !caps.saveData && !caps.reduced && caps.fine && caps.wide;

// Static mode swaps hero and chart with a short fade; motion mode scrubs them with scroll.
if (!auto) stage.classList.add('is-static');

// ── two-state story without a scroll listener ────────────────────────────────
const sentinel = document.createElement('div');
sentinel.setAttribute('aria-hidden', 'true');
sentinel.style.cssText = 'position:absolute;left:0;width:1px;height:1px;pointer-events:none';
stage.append(sentinel);

function placeSentinel() {
  const range = stage.offsetHeight - innerHeight;
  sentinel.style.top = `${Math.round(range / 2 + innerHeight * 0.5)}px`;
}
new ResizeObserver(placeSentinel).observe(stage);
addEventListener('resize', placeSentinel, { passive: true });
placeSentinel();

let sceneOn = false;
let onState: (chart: boolean) => void = () => {};

function setChart(chart: boolean) {
  if (stage.classList.contains('is-chart') === chart) return;
  stage.classList.toggle('is-chart', chart); // takes the faded hero out of the tab order
  if (!sceneOn || stage.classList.contains('is-static')) stage.style.setProperty('--p', chart ? '1' : '0');
  onState(chart);
}
new IntersectionObserver(
  ([en]) => { if (en) setChart(en.isIntersecting || en.boundingClientRect.top < 0); },
  { rootMargin: '0px 0px -50% 0px' }
).observe(sentinel);

// An observer only reports crossings. A jump that skips the whole story (an anchor link, a
// restored scroll position) crosses nothing, so re-read the position when those happen.
const resync = () => setChart(sentinel.getBoundingClientRect().top < innerHeight * 0.5);
addEventListener('hashchange', resync);
addEventListener('pageshow', resync);

// ── the 3D chunk ─────────────────────────────────────────────────────────────
let loading = false;

async function load3D(opts: { fromButton: boolean }) {
  if (loading || sceneOn) return;
  loading = true;
  exploreBtn.disabled = true;
  const label = q('[data-explore-label]', exploreBtn)!;
  const prevLabel = label.textContent;
  if (opts.fromButton) label.textContent = 'Loading 3D';
  try {
    const { mountScene } = await import('./scene/index');
    const handle = await mountScene({
      canvas, stage, pin, base: import.meta.env.BASE_URL, staticMode: caps.reduced
    });
    sceneOn = true;
    stage.dataset.scene = 'on';
    if (caps.reduced) stage.classList.add('is-static'); else stage.classList.remove('is-static');
    exploreBtn.hidden = true;
    caption.textContent = 'Illustrative sample: 64 uploads of a fictional channel. Drag to turn it. Not real creator data.';

    tools.hidden = false;
    const pause = q<HTMLButtonElement>('[data-pause]', tools)!;
    const pauseLabel = q('[data-pause-label]', tools)!;
    if (caps.reduced) pause.hidden = true; // there is no motion to pause
    pause.addEventListener('click', () => {
      const on = pause.getAttribute('aria-pressed') !== 'true';
      pause.setAttribute('aria-pressed', String(on));
      pauseLabel.textContent = on ? 'Resume motion' : 'Pause motion';
      handle.setPaused(on);
    });
    q<HTMLButtonElement>('[data-prev]', tools)!.addEventListener('click', () => handle.step(-1));
    q<HTMLButtonElement>('[data-next]', tools)!.addEventListener('click', () => handle.step(1));
    if (caps.reduced) onState = chart => handle.setState(chart ? 1 : 0);
    if (caps.reduced) handle.setState(stage.classList.contains('is-chart') ? 1 : 0);
  } catch (err) {
    console.warn('[wavecrest] 3D unavailable, keeping the static chart.', err);
    stage.classList.add('is-static');
    exploreBtn.hidden = true;
    label.textContent = prevLabel;
  } finally {
    exploreBtn.disabled = false;
    loading = false;
  }
}

if (auto) {
  // Show the page first; fetch the heavy chunk once the main thread is quiet.
  const go = () => load3D({ fromButton: false });
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1500 });
  else setTimeout(go, 400);
} else if (caps.webgl2) {
  exploreBtn.hidden = false;
  if (caps.reduced) q('[data-explore-label]', exploreBtn)!.textContent = 'Explore in 3D, no animation';
  exploreBtn.addEventListener('click', () => load3D({ fromButton: true }));
}
