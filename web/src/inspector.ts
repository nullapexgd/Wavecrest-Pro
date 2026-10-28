import { formatDate, formatMultiple, formatViews, type Video } from './data/model';

/** The card that describes one upload. The 3D probe and the flat chart both drive it. */
export interface Inspector {
  setCreator(name: string): void;
  show(v: Video, x: number, y: number, pinned: boolean): void;
  hide(): void;
}

export function createInspector(pin: HTMLElement): Inspector {
  const card = pin.querySelector<HTMLElement>('[data-inspector]')!;
  const tag = card.querySelector<HTMLElement>('[data-i-tag]')!;
  const title = card.querySelector<HTMLElement>('[data-i-title]')!;
  const meta = card.querySelector<HTMLElement>('[data-i-meta]')!;
  const rel = card.querySelector<HTMLElement>('[data-i-rel]')!;
  const views = card.querySelector<HTMLElement>('[data-i-views]')!;
  let shownId = '';

  return {
    setCreator(name) { tag.textContent = name; shownId = ''; },
    show(v, x, y, pinned) {
      if (v.id !== shownId) {
        shownId = v.id;
        title.textContent = v.title;
        meta.textContent = `${formatDate(v.date)}, ${v.short ? 'Short' : 'Video'}`;
        rel.textContent = formatMultiple(v.rel);
        const likes = v.likeRate === null ? '' : `, ${(v.likeRate * 100).toFixed(1)}% liked`;
        views.textContent = `${formatViews(v.views)} views${likes}`;
      }
      card.hidden = false;
      card.classList.toggle('is-crest', v.crest);
      card.dataset.pinned = pinned ? 'true' : 'false';
      const w = card.offsetWidth || 280;
      const h = card.offsetHeight || 120;
      // above the point so the card does not hide what it describes; below if there is no room
      const px = Math.min(Math.max(8, x - w / 2), pin.clientWidth - w - 8);
      const above = y - h - 40;
      const py = above >= 72 ? above : Math.min(y + 30, pin.clientHeight - h - 8);
      card.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    },
    hide() { card.hidden = true; shownId = ''; }
  };
}
