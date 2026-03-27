// POST /api/webhooks/revenuecat
//
// RevenueCat sends an event here on every subscription lifecycle change:
// purchase, renewal, cancellation, expiry, billing issue, etc.
//
// Setup in RevenueCat Dashboard → Project → Integrations → Webhooks:
//   URL:           https://your-domain.com/api/webhooks/revenuecat
//   Authorization: <value of REVENUECAT_WEBHOOK_SECRET env var>
//
// We use lg_users.id as the RC appUserID, so we can resolve users directly
// from the app_user_id field in the event payload.

import { getDb } from '../_lib/db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RC event types that mean "subscription is now active"
const ACTIVE_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'PRODUCT_CHANGE',
  'SUBSCRIBER_ALIAS',
]);

// RC event types that mean "subscription has ended or been revoked"
const EXPIRED_TYPES = new Set([
  'EXPIRATION',
  'CANCELLATION',
  'REVOCATION',
  'BILLING_ISSUE',
]);


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verify shared secret (set in RevenueCat dashboard → Webhooks → Authorization)
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (secret && req.headers.authorization !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body;
  const event = body?.event;

  if (!event?.type) {
    return res.status(400).json({ error: 'Missing event' });
  }

  // Only process App Store events
  if (event.store !== 'APP_STORE') {
    return res.status(200).json({ ok: true, note: 'Non-App Store event, skipped' });
  }

  const {
    type,
    app_user_id,
    product_id,
    expiration_at_ms,
    purchased_at_ms,
    environment,
    entitlement_ids,
  } = event;

  // Resolve user — RC appUserID is set to lg_users.id UUID by iap.js
  if (!app_user_id || !UUID_RE.test(app_user_id)) {
    return res.status(200).json({ ok: true, note: 'app_user_id is not a UUID, skipped' });
  }

  const sql = getDb();

  let userExists;
  try {
    const rows = await sql`SELECT id FROM lg_users WHERE id = ${app_user_id} LIMIT 1`;
    userExists = rows.length > 0;
  } catch (err) {
    console.error('[webhooks/revenuecat] DB lookup error', err);
    return res.status(500).json({ error: 'DB error' });
  }

  if (!userExists) {
    return res.status(200).json({ ok: true, note: 'User not found, skipped' });
  }

  const purchaseDate = purchased_at_ms ? new Date(Number(purchased_at_ms)) : new Date();
  const expiresAt    = expiration_at_ms ? new Date(Number(expiration_at_ms)) : null;
  const env          = (environment || '').toLowerCase() === 'production' ? 'production' : 'sandbox';
  const entId        = (entitlement_ids && entitlement_ids[0]) || 'premium';

  let newStatus;
  if (ACTIVE_TYPES.has(type))   newStatus = 'active';
  if (EXPIRED_TYPES.has(type))  newStatus = 'expired';

  if (!newStatus) {
    return res.status(200).json({ ok: true, note: `Unhandled event type: ${type}` });
  }

  try {
    await sql`
      INSERT INTO lg_apple_subscriptions
        (user_id, revenuecat_user_id, product_id, entitlement_id, status,
         expires_at, purchase_date, environment, updated_at)
      VALUES
        (${app_user_id}, ${app_user_id}, ${product_id || null}, ${entId},
         ${newStatus}, ${expiresAt}, ${purchaseDate}, ${env}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        revenuecat_user_id = EXCLUDED.revenuecat_user_id,
        product_id         = EXCLUDED.product_id,
        entitlement_id     = EXCLUDED.entitlement_id,
        status             = EXCLUDED.status,
        expires_at         = EXCLUDED.expires_at,
        purchase_date      = EXCLUDED.purchase_date,
        environment        = EXCLUDED.environment,
        updated_at         = NOW()
    `;
  } catch (err) {
    console.error('[webhooks/revenuecat] DB upsert error', err);
    return res.status(500).json({ error: 'DB error' });
  }

  return res.status(200).json({ ok: true });
}
