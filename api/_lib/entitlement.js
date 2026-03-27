// api/_lib/entitlement.js
// Single source of truth for subscription entitlement.
//
// Reads from the lg_apple_subscriptions table, which is kept current by:
//   • RevenueCat webhooks  → POST /api/webhooks/revenuecat
//   • Post-purchase sync   → POST /api/apple/verify
//
// Returns a normalized entitlement object used by ALL backend endpoints
// and the frontend session.  Never call Stripe or Apple IAP directly here.

import { getDb } from './db.js';

// ── Pricing constants ─────────────────────────────────────────────────────────
export const PRICING = {
  monthly: { amount: 4.99, currency: 'USD', period: 'month', productId: 'com.rootplans.monthly' },
  yearly:  { amount: 39.00, currency: 'USD', period: 'year',  productId: 'com.rootplans.yearly'  },
  // lifetime is one-time; no expiry
  lifetime: { amount: 99.00, currency: 'USD', period: null,   productId: 'com.rootplans.lifetime' },
};

// ── Plan limits ───────────────────────────────────────────────────────────────
export const PLAN_LIMITS = {
  free:    1,
  premium: 7,
};

// ── Feature flags ─────────────────────────────────────────────────────────────
// Maps feature identifiers to the minimum tier required.
const FEATURE_TIERS = {
  basicAI:          'free',
  advancedAI:       'premium',
  pestDiagnosis:    'premium',
  healthFunctional: 'premium',
  fullPlantLibrary: 'premium',
  multiplePlans:    'premium',  // creating plan #2+
  largeBuilder:     'premium',
};

// ── RC entitlement identifier ─────────────────────────────────────────────────
// Must match the Identifier field of your entitlement in the RC dashboard.
export const RC_ENTITLEMENT_ID = 'premium';

// ── Internal DB read ──────────────────────────────────────────────────────────
async function _getRcRecord(userId) {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT * FROM lg_apple_subscriptions
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    return rows[0] || null;
  } catch { return null; }
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * Returns the normalized entitlement for a user.
 *
 * {
 *   planTier:           "free" | "premium"
 *   subscriptionStatus: "active" | "inactive" | "expired"
 *   subscriptionSource: "revenuecat" | "none"
 *   planLimit:          1 | 7
 *   isPremium:          boolean  (shorthand)
 * }
 */
export async function getEntitlement(userId) {
  const rec = await _getRcRecord(userId);
  const now = new Date();

  const isActive =
    rec &&
    rec.status === 'active' &&
    (!rec.expires_at || new Date(rec.expires_at) > now);

  const planTier = isActive ? 'premium' : 'free';

  let subscriptionStatus = 'inactive';
  if (isActive)                         subscriptionStatus = 'active';
  else if (rec?.status === 'expired')   subscriptionStatus = 'expired';

  return {
    planTier,
    subscriptionStatus,
    subscriptionSource: rec ? 'revenuecat' : 'none',
    planLimit:          PLAN_LIMITS[planTier],
    isPremium:          planTier === 'premium',
    expiresAt:          rec?.expires_at || null,
    productId:          rec?.product_id || null,
  };
}

/**
 * Returns true if the user can access a named feature.
 * Usage: canAccess(entitlement, 'advancedAI')
 */
export function canAccess(entitlement, feature) {
  const required = FEATURE_TIERS[feature];
  if (!required || required === 'free') return true;
  return entitlement.isPremium;
}

/**
 * Formats entitlement for inclusion in API responses and the client session.
 */
export function formatEntitlement(ent) {
  return {
    planTier:           ent.planTier,
    subscriptionStatus: ent.subscriptionStatus,
    subscriptionSource: ent.subscriptionSource,
    planLimit:          ent.planLimit,
    isPremium:          ent.isPremium,
    expiresAt:          ent.expiresAt,
    // Legacy shape — keeps canAccessCreator() in auth.js working
    status:             ent.subscriptionStatus === 'active' ? 'active' : ent.subscriptionStatus,
    source:             ent.subscriptionSource,
  };
}
