// The ONE place appearance and motion preferences are resolved. Everything else (CSS, the 3D hero, reveals,
// the settings panel) reads the result from here or from the attributes this file keeps on <html>:
//   data-theme="light|dark"   only when the visitor forced one (absent = follow the system; tokens.css already reads it)
//   data-motion="reduced|full"   always the EFFECTIVE value, so CSS needs a single selector, never a media query
// The same resolution runs before first paint in partials/head.html (no flash); this module then keeps it live.
export type ThemePref = 'system' | 'light' | 'dark';
export type MotionPref = 'system' | 'reduced' | 'full';

const KEY = { theme: 'wc-theme', motion: 'wc-motion' } as const;
const memory: Record<string, string> = {}; // used when localStorage is blocked, so the choice still holds for this visit

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return memory[key] ?? null; }
}
function write(key: string, value: string | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
  catch { if (value === null) delete memory[key]; else memory[key] = value; }
}

const darkMq = matchMedia('(prefers-color-scheme: dark)');
const reduceMq = matchMedia('(prefers-reduced-motion: reduce)');

export const getTheme = (): ThemePref => { const v = read(KEY.theme); return v === 'light' || v === 'dark' ? v : 'system'; };
export const getMotion = (): MotionPref => { const v = read(KEY.motion); return v === 'reduced' || v === 'full' ? v : 'system'; };

export const systemDark = () => darkMq.matches;
export const systemReduced = () => reduceMq.matches;
export const effectiveTheme = (): 'light' | 'dark' => { const t = getTheme(); return t === 'system' ? (systemDark() ? 'dark' : 'light') : t; };
/** True when nonessential motion should be minimised: forced Reduced, or System with Reduce Motion on. */
export const effectiveReduced = (): boolean => { const m = getMotion(); return m === 'reduced' || (m === 'system' && systemReduced()); };

type Listener = () => void;
const listeners = new Set<Listener>();
let lastReduced = effectiveReduced();

function apply(): void {
  const root = document.documentElement;
  const t = getTheme();
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  root.setAttribute('data-motion', effectiveReduced() ? 'reduced' : 'full');
  listeners.forEach(fn => fn());
  const now = effectiveReduced();
  if (now !== lastReduced) { lastReduced = now; motionListeners.forEach(fn => fn(now)); }
}

const motionListeners = new Set<(reduced: boolean) => void>();
/** Fires when the EFFECTIVE reduced-motion value changes (a setting changed, or the system did while on System). */
export function onMotionChange(fn: (reduced: boolean) => void): () => void { motionListeners.add(fn); return () => motionListeners.delete(fn); }
/** Fires after any preference or system change; used by the settings panel to refresh its status text. */
export function onPrefsChange(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }

export function setTheme(v: ThemePref): void { write(KEY.theme, v === 'system' ? null : v); apply(); }
export function setMotion(v: MotionPref): void { write(KEY.motion, v === 'system' ? null : v); apply(); }

darkMq.addEventListener('change', apply);   // live system appearance
reduceMq.addEventListener('change', apply); // live system Reduce Motion
addEventListener('storage', e => { if (e.key === KEY.theme || e.key === KEY.motion) apply(); }); // another tab changed it
apply();
