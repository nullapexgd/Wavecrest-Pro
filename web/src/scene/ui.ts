import type { Inspector } from '../inspector';
import type { Video } from '../data/model';

/** Everything the scene needs from the DOM, behind one small interface. */
export interface SceneUI {
  show(v: Video, x: number, y: number, pinned: boolean): void;
  hide(): void;
  announce(text: string): void;
  ready(): void;
  lost(): void;
}

export function createUI(stage: HTMLElement, pin: HTMLElement, inspector: Inspector): SceneUI {
  const live = pin.querySelector<HTMLElement>('[data-live]')!;
  return {
    // the probe stands on the ground, so the card sits a little higher than for a flat mark
    show(v, x, y, pinned) { inspector.show(v, x, y - 16, pinned); },
    hide() { inspector.hide(); },
    announce(text) { live.textContent = text; },
    ready() { stage.classList.add('is-3d'); },
    lost() { stage.classList.remove('is-3d'); }
  };
}
