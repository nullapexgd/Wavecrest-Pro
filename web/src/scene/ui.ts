import { CRESTS, formatViews, type Video } from '../data/sample';

/** Everything the scene needs from the DOM, behind one small interface. */
export interface SceneUI {
  show(v: Video, x: number, y: number, pinned: boolean): void;
  hide(): void;
  place(items: { index: number; x: number; y: number }[]): void;
  announce(text: string): void;
  ready(): void;
  lost(): void;
}

export function createUI(stage: HTMLElement, pin: HTMLElement): SceneUI {
  const card = pin.querySelector<HTMLElement>('[data-inspector]')!;
  const title = card.querySelector<HTMLElement>('[data-i-title]')!;
  const meta = card.querySelector<HTMLElement>('[data-i-meta]')!;
  const rel = card.querySelector<HTMLElement>('[data-i-rel]')!;
  const views = card.querySelector<HTMLElement>('[data-i-views]')!;
  const live = pin.querySelector<HTMLElement>('[data-live]')!;
  const notesHost = pin.querySelector<HTMLElement>('[data-notes]')!;

  const notes = CRESTS.map(c => {
    const el = document.createElement('div');
    el.className = 'note';
    el.textContent = `${c.rel.toFixed(1)}x · ${formatViews(c.views)}`;
    notesHost.append(el);
    return el;
  });

  const sizes: number[] = [];
  let shownId = '';
  return {
    show(v, x, y, pinned) {
      if (v.id !== shownId) {
        shownId = v.id;
        title.textContent = v.title;
        meta.textContent = `${v.date}, ${v.pillar}`;
        rel.textContent = `${v.rel.toFixed(1)}x`;
        views.textContent = `${formatViews(v.views)} views (sample)`;
      }
      card.hidden = false;
      card.classList.toggle('is-crest', v.crest);
      card.dataset.pinned = pinned ? 'true' : 'false';
      const w = card.offsetWidth || 280;
      const h = card.offsetHeight || 120;
      // above the probe so the card does not hide the ground it describes; below if there is no room
      const px = Math.min(Math.max(8, x - w / 2), pin.clientWidth - w - 8);
      const above = y - h - 56;
      const py = above >= 72 ? above : Math.min(y + 36, pin.clientHeight - h - 8);
      card.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    },
    hide() { card.hidden = true; shownId = ''; },
    place(items) {
      // Greedy label placement: try the usual spot, then alternatives, so labels never overprint.
      const placed: { x: number; y: number; w: number; h: number }[] = [];
      for (const it of [...items].sort((a, b) => a.x - b.x)) {
        const el = notes[it.index];
        if (!el) continue;
        const w = (sizes[it.index] ??= el.offsetWidth || 100);
        const h = 28;
        const tries: [number, number][] = [[14, -34], [14, 12], [-w - 14, -34], [-w - 14, 12], [14, -66], [14, 44]];
        let best = tries[0]!;
        for (const t of tries) {
          const r = { x: it.x + t[0], y: it.y + t[1] };
          if (!placed.some(p => r.x < p.x + p.w + 6 && r.x + w + 6 > p.x && r.y < p.y + p.h + 4 && r.y + h + 4 > p.y)) { best = t; break; }
        }
        placed.push({ x: it.x + best[0], y: it.y + best[1], w, h });
        el.style.transform = `translate3d(${(it.x + best[0]).toFixed(1)}px, ${(it.y + best[1]).toFixed(1)}px, 0)`;
      }
    },
    announce(text) { live.textContent = text; },
    ready() { stage.classList.add('is-3d'); },
    lost() { stage.classList.remove('is-3d'); }
  };
}
