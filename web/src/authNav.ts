// Pages are static, so ask the server once who is looking: a signed-in visitor does not need a
// "Sign in" link. The app pages draw their own nav state, so there only the footer link is handled.
// Any failure (offline, preview, dev) leaves the page exactly as built.
export function authNav(): void {
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then(r => r.ok && (r.headers.get('content-type') ?? '').includes('json')) // not a SPA fallback page
    .then(signedIn => {
      if (!signedIn) return;
      document.querySelectorAll('[data-footer-auth]').forEach(a => a.remove());
      if (!document.body.dataset.mode) {
        const nav = document.querySelector<HTMLAnchorElement>('[data-nav-auth]');
        if (nav) { nav.textContent = 'Open app'; nav.href = '/app'; }
      }
    })
    .catch(() => undefined);
}
