import { Color } from 'three';

/** The scene reads its colours from the same CSS tokens as the page, so the two cannot drift. */
export interface Palette {
  dark: boolean;
  paper: Color;
  paper2: Color;
  ink: Color;
  inkSoft: Color;
  line: Color;
  tide: Color;
  signal: Color;
  /** derived for shading */
  lit: Color;
  shade: Color;
  metalLo: Color;
  metalHi: Color;
  shadow: Color;
}

function token(name: string): Color {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(v || '#888888');
}

export function readPalette(): Palette {
  const paper = token('--paper');
  const paper2 = token('--paper-2');
  const ink = token('--ink');
  const tide = token('--tide');
  const dark = 0.2126 * paper.r + 0.7152 * paper.g + 0.0722 * paper.b < 0.2;
  return {
    dark,
    paper, paper2, ink, tide,
    inkSoft: token('--ink-soft'),
    line: token('--line'),
    signal: token('--signal'),
    // Light: lit faces are the raised paper, shadow faces lean toward tide (cool shadows).
    // Dark: lit faces lift a little toward ink, shadow faces sink below the paper.
    lit: dark ? paper2.clone().lerp(ink, 0.1) : paper2.clone(),
    shade: dark ? paper.clone().multiplyScalar(0.55) : paper.clone().lerp(tide, 0.52),
    metalLo: dark ? paper.clone().multiplyScalar(0.8) : ink.clone(),
    metalHi: dark ? ink.clone() : paper2.clone(),
    shadow: dark ? new Color('#02080b') : ink.clone()
  };
}

/** Calls back when the system appearance or the QA data-theme hook changes. */
export function watchPalette(cb: () => void): () => void {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-contrast'] });
  mq.addEventListener('change', cb);
  return () => { mo.disconnect(); mq.removeEventListener('change', cb); };
}
