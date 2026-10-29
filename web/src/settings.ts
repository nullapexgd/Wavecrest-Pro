// The Appearance & motion panel: reads and writes src/prefs.ts, nothing else. Visitors do not need an account.
// The markup lives in partials/nav.html; the gear stays hidden until this script runs, so without JavaScript
// the site simply follows the system.
import './styles/settings.css';
import { getMotion, getTheme, onPrefsChange, setMotion, setTheme, systemDark, systemReduced, type MotionPref, type ThemePref } from './prefs';

function init(): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-settings]');
  const open = document.querySelector<HTMLButtonElement>('[data-settings-open]');
  if (!dialog || !open || typeof dialog.showModal !== 'function') return;

  const status = (k: 'theme' | 'motion') => dialog.querySelector<HTMLElement>(`[data-status="${k}"]`)!;
  const radios = (name: string) => [...dialog.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)];

  function paint(): void {
    const t = getTheme(), m = getMotion();
    radios('theme').forEach(r => { r.checked = r.value === t; });
    radios('motion').forEach(r => { r.checked = r.value === m; });
    status('theme').textContent =
      t === 'system' ? `Following system \u00b7 ${systemDark() ? 'Dark' : 'Light'} appearance` : `Always ${t}`;
    status('motion').textContent =
      m === 'system' ? `Following system \u00b7 ${systemReduced() ? 'Reduced motion enabled' : 'Full motion'}`
      : m === 'reduced' ? 'Reduced \u00b7 nonessential animation is minimised'
      : `Full \u00b7 normal motion${systemReduced() ? ', overriding your system\u2019s Reduce Motion' : ''}`;
  }

  dialog.addEventListener('change', e => {
    const el = e.target as HTMLInputElement;
    if (el.name === 'theme') setTheme(el.value as ThemePref);
    else if (el.name === 'motion') setMotion(el.value as MotionPref);
  });
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }); // click outside the panel
  open.addEventListener('click', () => { paint(); dialog.showModal(); });
  onPrefsChange(paint); // system changes while the panel is open
  open.hidden = false;
  paint();
}
init();
