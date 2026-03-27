// POST /api/apple/verify
//
// Called by the iOS app (via iap.js) after a successful purchase or restore.
// We call the RevenueCat REST API to get the subscriber's current entitlement
// status, then upsert into lg_apple_subscriptions so the backend knows the
// user has an active Apple subscription.
//
// No body parameters needed — the user is identified via their session token,
// and we use their lg_users.id as the RevenueCat appUserID.

import { getSessionUser } from '../_lib/helpers.js';
import { getDb } from '../_lib/db.js';

const RC_API_BASE = 'https://api.revenuecat.com/v1';
const ENTITLEMENT_ID = 'premium';

function derivePlan(productId) {
  if (!productId) return 'monthly';
  const lower = productId.toLowerCase();
  if (lower.includes('annual') || lower.includes('yearly') || lower.includes('year')) return 'annual';
  return 'monthly';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const rcSecretKey = process.env.REVENUECAT_SECRET_KEY;
  if (!rcSecretKey) {
    console.error('[apple/verify] REVENUECAT_SECRET_KEY not set');
    return res.status(500).json({ error: 'Apple IAP not configured on server' });
  }

  // RevenueCat appUserID is the user's UUID (set by iap.js at login time)
  const rcAppUserId = user.id;

  let rcData;
  try {
    const rcRes = await fetch(
      `${RC_API_BASE}/subscribers/${encodeURIComponent(rcAppUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${rcSecretKey}`,
          'Content-Type': 'application/json',
          'X-Platform': 'ios',
        },
      }
    );

    if (!rcRes.ok) {
      const text = await rcRes.text();
      console.error('[apple/verify] RevenueCat API error', rcRes.status, text);
      return res.status(502).json({ error: 'Could not verify subscription with App Store' });
    }

    rcData = await rcRes.json();
  } catch (err) {
    console.error('[apple/verify] fetch error', err);
    return res.status(502).json({ error: 'Could not reach RevenueCat API' });
  }

  const subscriber = rcData?.subscriber;
  if (!subscriber) return res.status(502).json({ error: 'Invalid RevenueCat response' });

  const entitlement = subscriber.entitlements?.[ENTITLEMENT_ID];
  const now = new Date();

  const isActive =
    entitlement?.is_active === true ||
    (entitlement && (!entitlement.expires_date || new Date(entitlement.expires_date) > now));

  const productId    = entitlement?.product_identifier || null;
  const expiresAt    = entitlement?.expires_date ? new Date(entitlement.expires_date) : null;
  const purchaseDate = entitlement?.purchase_date ? new Date(entitlement.purchase_date) : now;
  const environment  = entitlement?.is_sandbox === true ? 'sandbox' : 'production';

  const sql = getDb();

  if (isActive) {
    await sql`
      INSERT INTO lg_apple_subscriptions
        (user_id, revenuecat_user_id, product_id, entitlement_id, status,
         expires_at, purchase_date, environment, updated_at)
      VALUES
        (${user.id}, ${String(rcAppUserId)}, ${productId}, ${ENTITLEMENT_ID},
         'active', ${expiresAt}, ${purchaseDate}, ${environment}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        revenuecat_user_id = EXCLUDED.revenuecat_user_id,
        product_id         = EXCLUDED.product_id,
        status             = 'active',
        expires_at         = EXCLUDED.expires_at,
        purchase_date      = EXCLUDED.purchase_date,
        environment        = EXCLUDED.environment,
        updated_at         = NOW()
    `;

    return res.status(200).json({
      active: true,
      plan: derivePlan(productId),
      expiresAt: expiresAt?.toISOString() || null,
    });
  }

  // Not currently entitled — mark expired if we have a stale record
  await sql`
    UPDATE lg_apple_subscriptions
    SET status = 'expired', updated_at = NOW()
    WHERE user_id = ${user.id}
  `;

  return res.status(200).json({ active: false });
}
