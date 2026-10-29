// Quiet section entrances for the marketing pages (never the hero, never the analyzer). Each block is
// visible from the start (85% opacity, 18px low) and settles once as it enters view. Opacity and
// transform only, so nothing moves the layout. Reduced motion, no IntersectionObserver, or a failed
// script all end with everything simply shown (see the failsafe in base.css).
const TARGETS = ['.band__head', '.labels .label', '.beta', '.doc > section', '.entry', '.rows'];

export function reveal(): void {
  const els = [...document.querySelectorAll<HTMLElement>(TARGETS.join(','))];
  document.documentElement.classList.add('rv-ready'); // cancels the CSS failsafe
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window);
  if (still) { els.forEach(e => e.classList.add('is-in')); return; }

  const seen = new Map<Element, number>();
  for (const e of els) { // stagger siblings 70ms apart, at most five steps
    const n = seen.get(e.parentElement!) ?? 0;
    e.style.setProperty('--i', String(Math.min(n, 5)));
    seen.set(e.parentElement!, n + 1);
  }
  const io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('is-in');
      io.unobserve(en.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
  els.forEach(e => io.observe(e));
}
