// POST /api/billing-portal
//
// Creates a Stripe Customer Portal session for the authenticated user and
// returns the redirect URL.  The frontend (account.html) calls this when the
// user clicks "Manage Billing" and then redirects to the returned URL.
//
// Eligibility: the user must have an active Stripe subscription row in
// stripe_subscriptions (status = 'active').  RevenueCat/Apple subscribers
// manage their subscription via the App Store, not here.
//
// On success: { url: "https://billing.stripe.com/..." }
// On error:   HTTP 4xx/5xx with { error: "<code>" }

import Stripe from 'stripe';
import { getSessionUser } from './_lib/helpers.js';
import { getDb } from './_lib/db.js';

const APP_URL = process.env.APP_URL || 'https://rootplans.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  // ── Check for active Stripe subscription ──────────────────────────────────
  const sql = getDb();
  let stripeRecord;
  try {
    const rows = await sql`
      SELECT stripe_customer_id, stripe_subscription_id, status
      FROM stripe_subscriptions
      WHERE user_id = ${user.id}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    stripeRecord = rows[0] || null;
  } catch (err) {
    console.error('[billing-portal] DB lookup error', { userId: user.id, err: err.message });
    return res.status(500).json({ error: 'db_error' });
  }

  if (!stripeRecord || stripeRecord.status !== 'active') {
    console.log(`[billing-portal] user ${user.id} has no active Stripe subscription`);
    return res.status(403).json({ error: 'no_stripe_subscription' });
  }

  // ── Create Stripe Billing Portal session ──────────────────────────────────
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.error('[billing-portal] STRIPE_SECRET_KEY not configured');
    return res.status(500).json({ error: 'stripe_not_configured' });
  }

  const stripe = new Stripe(stripeSecretKey);

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   stripeRecord.stripe_customer_id,
      return_url: APP_URL + '/account.html',
    });

    console.log(`[billing-portal] created portal session for user=${user.id} customer=${stripeRecord.stripe_customer_id}`);
    return res.status(200).json({ url: portalSession.url });
  } catch (err) {
    console.error('[billing-portal] Stripe error', {
      userId:     user.id,
      customerId: stripeRecord.stripe_customer_id,
      error:      err.message,
      stack:      err.stack,
    });
    return res.status(502).json({ error: 'stripe_error' });
  }
}
