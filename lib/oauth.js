// Which email an OAuth provider may vouch for (no case folding: keeps existing account matching).
//
// Accounts are linked by email (lib/auth.js upsertUser), so an email we have not seen
// the provider VERIFY must never reach it, or anyone could claim a victim's address on
// their own provider account and be logged in as the victim.

export function googleVerifiedEmail(info) {
  const verified = info?.email_verified === true || info?.email_verified === 'true';
  return verified && typeof info.email === 'string' && info.email ? info.email : null;
}

// Deliberately ignores the profile's public `email` field and never falls back to an
// arbitrary list entry: only an address GitHub says is verified, primary first.
export function githubVerifiedEmail(emails) {
  if (!Array.isArray(emails)) return null;
  const pick = emails.find(e => e?.primary && e?.verified) || emails.find(e => e?.verified);
  return typeof pick?.email === 'string' && pick.email ? pick.email : null;
}
