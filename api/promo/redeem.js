// api/promo/redeem.js
// POST /api/promo/redeem  { code }
// Validates a promo code and grants premium to the authenticated user.

import { getDb }          from '../_lib/db.js';
import { setCors, getSessionUser } from '../_lib/helpers.js';
import { getEntitlement, formatEntitlement } from '../_lib/entitlement.js';

export default async function handler(req, res) {
  setCors(req, res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // Must be logged in
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const code = (req.body?.code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'No code provided' });

  const sql = getDb();

  // ── Look up the promo code ──────────────────────────────────────────────────
  const [promo] = await sql`
    SELECT * FROM rp_promo_codes
    WHERE code = ${code}
  `;

  if (!promo) {
    return res.status(400).json({ error: 'Invalid code. Please check and try again.' });
  }

  // Check expiry
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return res.status(400).json({ error: 'This code has expired.' });
  }

  // Check usage limit
  if (promo.max_uses !== null && promo.uses_count >= promo.max_uses) {
    return res.status(400).json({ error: 'This code has already been used the maximum number of times.' });
  }

  // ── Grant premium ───────────────────────────────────────────────────────────
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (promo.duration_days || 365));

  await sql`
    INSERT INTO lg_apple_subscriptions
      (user_id, revenuecat_user_id, product_id, entitlement_id, status, expires_at, purchase_date, environment)
    VALUES
      (${user.id}, ${'promo:' + code}, 'promo', 'premium', 'active', ${expiresAt}, NOW(), 'production')
    ON CONFLICT (user_id) DO UPDATE SET
      revenuecat_user_id = EXCLUDED.revenuecat_user_id,
      product_id         = EXCLUDED.product_id,
      entitlement_id     = EXCLUDED.entitlement_id,
      status             = 'active',
      expires_at         = EXCLUDED.expires_at,
      purchase_date      = EXCLUDED.purchase_date,
      environment        = EXCLUDED.environment,
      updated_at         = NOW()
  `;

  // ── Increment usage count ───────────────────────────────────────────────────
  await sql`
    UPDATE rp_promo_codes
    SET uses_count = uses_count + 1, updated_at = NOW()
    WHERE code = ${code}
  `;

  // ── Return fresh entitlement ────────────────────────────────────────────────
  const ent = await getEntitlement(user.id);
  return res.status(200).json({
    ok:           true,
    message:      'Code applied! Premium is now active.',
    subscription: formatEntitlement(ent),
  });
}
