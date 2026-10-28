import './page.ts';
import './styles/app.css';

// In dev and the single-file preview there is no OAuth server: pretend the sign-in worked.
if (import.meta.env.DEV || __INLINE_MODELS__) {
  document.querySelectorAll<HTMLAnchorElement>('[data-oauth]').forEach(a =>
    a.addEventListener('click', e => {
      e.preventDefault();
      try { sessionStorage.setItem('wc-mock', JSON.stringify({ signedIn: true })); } catch { /* ignore */ }
      location.href = '/app';
    }));
}
