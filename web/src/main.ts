import './styles/tokens.css';
import './styles/base.css';
import './styles/stage.css';
import { authNav } from './authNav';
import { CREATORS, byHandle, fromLive, fromSnapshot, randomCreator } from './data/creators';
import { captionText, crestLegend, crestListHtml, factsText, scatterPair } from './data/copy';
import type { Creator, Model } from './data/model';
import { ridgeSvg, scatterSvg } from './data/posters';
import { createInspector } from './inspector';

/*
  Boot. This file is the whole of the initial JavaScript; the 3D scene and Three.js are a
  separate chunk that loads only when the rules below allow it.

    auto-load   desktop-class pointer, WebGL2, no data-saver, no reduced-motion
    opt-in      WebGL2 is there but the context is constrained (touch, narrow, data-saver,
                reduced motion): the picture is already complete, and a button offers the 3D
    never       no WebGL2: the static chart is the experience, and it is a complete one

  The picture is real: one creator at a time, chosen at random (or by the visitor), drawn from
  public YouTube data. The HTML already contains one creator's picture, so nothing here is
  needed to see something; the script swaps in a random one and wires the controls.

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
const posters = q<HTMLElement>('.stage__posters')!;
const ridge = q<HTMLElement>('.poster--ridge')!;
const scatter = q<HTMLElement>('.poster--scatter')!;
const facts = q<HTMLElement>('[data-facts]')!;
const legendCrest = q<HTMLElement>('[data-legend-crest]')!;
const legendShort = q<HTMLElement>('[data-legend-short]')!;
const crestList = q<HTMLElement>('[data-crest-list]')!;
const picker = q<HTMLElement>('[data-picker]')!;
const select = q<HTMLSelectElement>('[data-pick-select]', picker)!;
const another = q<HTMLButtonElement>('[data-pick-another]', picker)!;
const inspector = createInspector(pin);

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

// ── the creator on screen ────────────────────────────────────────────────────
let model: Model | null = null;
let hint = '';
let handle: { setModel(m: Model): void; step(d: 1 | -1): void } | null = null;
let chartFocus = -1;

// The hosted single-file preview has no server behind it, so it never asks for live data.
const OFFLINE = typeof __INLINE_MODELS__ !== 'undefined' && __INLINE_MODELS__;

async function resolve(c: Creator): Promise<Model> {
  return (!OFFLINE && (await fromLive(c))) || fromSnapshot(c);
}

function render(m: Model) {
  model = m;
  chartFocus = -1;
  inspector.hide();
  inspector.setCreator(m.creator.name);
  ridge.innerHTML = ridgeSvg(m);
  scatter.innerHTML = scatterPair(scatterSvg(m, 'wide'), scatterSvg(m, 'tall'));
  caption.textContent = captionText(m, hint);
  facts.textContent = factsText(m);
  legendCrest.textContent = crestLegend(m);
  legendShort.hidden = m.stats.shorts === 0;
  crestList.innerHTML = crestListHtml(m);
  stage.dataset.creator = m.creator.handle;
  select.value = m.creator.handle;
  posters.classList.add('is-ready');
  handle?.setModel(m);
}

let busy = false;
async function choose(c: Creator) {
  if (busy) return;
  busy = true;
  picker.setAttribute('aria-busy', 'true');
  another.disabled = true;
  try { render(await resolve(c)); }
  finally { busy = false; another.disabled = false; picker.removeAttribute('aria-busy'); }
}

// picker
const group = (label: string, tier: Creator['tier']) => {
  const g = document.createElement('optgroup');
  g.label = label;
  for (const c of CREATORS.filter(x => x.tier === tier)) g.append(new Option(c.name, c.handle));
  return g;
};
select.append(group('Well known', 'known'), group('Smaller channels', 'niche'));
select.addEventListener('change', () => { const c = byHandle(select.value); if (c) void choose(c); });
another.addEventListener('click', () => void choose(randomCreator(model?.creator.handle)));
picker.hidden = false;

// ── chart hover: the flat chart explains itself the same way the 3D probe does ─────
function focusMark(i: number, pinned: boolean) {
  const g = [...scatter.querySelectorAll<SVGGElement>(`.mk[data-i="${i}"]`)].find(el => el.getBoundingClientRect().width > 0);
  const v = model?.videos[i];
  scatter.querySelectorAll('.mk.is-on').forEach(el => el.classList.remove('is-on'));
  if (!g || !v) { inspector.hide(); return; }
  g.classList.add('is-on');
  const r = g.getBoundingClientRect();
  const p = pin.getBoundingClientRect();
  inspector.show(v, r.left + r.width / 2 - p.left, r.top + r.height / 2 - p.top, pinned);
}
scatter.addEventListener('pointermove', e => {
  if (!stage.classList.contains('is-chart')) return;
  const g = (e.target as Element).closest<SVGGElement>('.mk');
  if (g) focusMark(Number(g.dataset.i), false);
  else if (e.pointerType === 'mouse') { inspector.hide(); scatter.querySelectorAll('.mk.is-on').forEach(el => el.classList.remove('is-on')); }
});
scatter.addEventListener('pointerdown', e => {
  if (!stage.classList.contains('is-chart') || e.pointerType === 'mouse') return;
  const g = (e.target as Element).closest<SVGGElement>('.mk');
  if (g) focusMark(Number(g.dataset.i), true);
  else { inspector.hide(); scatter.querySelectorAll('.mk.is-on').forEach(el => el.classList.remove('is-on')); }
});
scatter.addEventListener('pointerleave', e => {
  if (e.pointerType !== 'mouse') return;
  inspector.hide();
  scatter.querySelectorAll('.mk.is-on').forEach(el => el.classList.remove('is-on'));
});

/** Step through the crests, on whichever picture is showing. */
function step(dir: 1 | -1) {
  if (!stage.classList.contains('is-chart')) { handle?.step(dir); return; }
  const crests = model?.crests ?? [];
  if (!crests.length) return;
  chartFocus = (chartFocus + dir + crests.length) % crests.length;
  focusMark(crests[chartFocus]!.index, true);
}

// ── two-state story without a scroll listener ────────────────────────────────
const sentinel = document.createElement('div');
sentinel.setAttribute('aria-hidden', 'true');
sentinel.style.cssText = 'position:absolute;left:0;width:1px;height:1px;pointer-events:none';
stage.append(sentinel);

function placeSentinel() {
  const range = stage.offsetHeight - innerHeight;
  const top = Math.round(range / 2 + innerHeight * 0.5);
  sentinel.style.top = `${top}px`;
  // Cover the rest of the story so a large scroll step cannot skip the observed region.
  sentinel.style.height = `${Math.max(1, stage.offsetHeight - top)}px`;
}
new ResizeObserver(placeSentinel).observe(stage);
addEventListener('resize', placeSentinel, { passive: true });
placeSentinel();

let sceneOn = false;
let onState: (chart: boolean) => void = () => {};

function setChart(chart: boolean) {
  if (stage.classList.contains('is-chart') === chart) return;
  stage.classList.toggle('is-chart', chart); // takes the faded hero out of the tab order
  inspector.hide();
  scatter.querySelectorAll('.mk.is-on').forEach(el => el.classList.remove('is-on'));
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
  if (loading || sceneOn || !model) return;
  loading = true;
  exploreBtn.disabled = true;
  const label = q('[data-explore-label]', exploreBtn)!;
  const prevLabel = label.textContent;
  if (opts.fromButton) label.textContent = 'Loading 3D';
  try {
    const { mountScene } = await import('./scene/index');
    const h = await mountScene({
      canvas, stage, pin, base: import.meta.env.BASE_URL, staticMode: caps.reduced, model, inspector
    });
    handle = h;
    sceneOn = true;
    stage.dataset.scene = 'on';
    if (caps.reduced) stage.classList.add('is-static'); else stage.classList.remove('is-static');
    exploreBtn.hidden = true;
    hint = ' Drag to turn it.';
    if (model) caption.textContent = captionText(model, hint);

    tools.hidden = false;
    const pause = q<HTMLButtonElement>('[data-pause]', tools)!;
    const pauseLabel = q('[data-pause-label]', tools)!;
    if (caps.reduced) pause.hidden = true; // there is no motion to pause
    pause.addEventListener('click', () => {
      const on = pause.getAttribute('aria-pressed') !== 'true';
      pause.setAttribute('aria-pressed', String(on));
      pauseLabel.textContent = on ? 'Resume motion' : 'Pause motion';
      h.setPaused(on);
    });
    q<HTMLButtonElement>('[data-prev]', tools)!.addEventListener('click', () => step(-1));
    q<HTMLButtonElement>('[data-next]', tools)!.addEventListener('click', () => step(1));
    onState = chart => h.setState(chart ? 1 : 0);
    if (caps.reduced) h.setState(stage.classList.contains('is-chart') ? 1 : 0);
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

// ── go ───────────────────────────────────────────────────────────────────────
// Tools (prev/next crest, pause) only exist once a scene does; stepping works on the chart too.
const wanted = byHandle(new URLSearchParams(location.search).get('creator') ?? '');
void (async () => {
  render(await resolve(wanted ?? randomCreator()));
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
})();

authNav();
import { reveal } from './reveal';
reveal();
