// Plans and entitlements: the single place that says what a user may do.
//
// There is NO payment provider. Today the only source of an entitlement is
// users.plan, set by hand through POST /api/admin/set-plan. Every user without a
// paid plan is on the Free beta: one analysis per month, no card.
//
// Billing contract (so a provider can be added later without touching the app):
// a provider adapter's only job is to translate its events into
//   UPDATE users SET plan = $planKey WHERE id = $userId
// Quota (lib/quota.js), the analyze handler and the UI all read entitlementFor(); none
// of them know what a provider is. Nothing here activates, simulates or sells a plan.
//
// Starter/Pro/Team exist for entitlements that were granted manually. They are not for
// sale and the public site must not advertise them as available.

export const PLANS = {
  // reelcutParts: how many 20-minute parts of one video Reelcut will search for clips (clip-search calls per run).
  // Free is one part plus one retry; longer videos are for manually granted plans only, never advertised.
  free:    { label: 'Free beta', analysesPerMonth: 1,        reelcutParts: 2, purchasable: false },
  starter: { label: 'Starter',   analysesPerMonth: 25,       reelcutParts: 6, purchasable: false },
  pro:     { label: 'Pro',       analysesPerMonth: 100,      reelcutParts: 6, purchasable: false },
  team:    { label: 'Team',      analysesPerMonth: Infinity, reelcutParts: 6, purchasable: false }
};

// Own-property check: a plain `PLANS[x]` is truthy for '__proto__', 'constructor', etc.
export const isPlanKey = key => typeof key === 'string' && Object.hasOwn(PLANS, key);

export function planFor(user) {
  return isPlanKey(user?.plan) ? PLANS[user.plan] : PLANS.free;
}

// What the quota engine and the UI need. `limit` is null when unlimited (JSON-safe).
export function entitlementFor(user) {
  const plan = planFor(user);
  const key = isPlanKey(user?.plan) ? user.plan : 'free';
  return {
    plan: key,
    label: plan.label,
    analysesPerMonth: plan.analysesPerMonth,
    limit: Number.isFinite(plan.analysesPerMonth) ? plan.analysesPerMonth : null
  };
}
