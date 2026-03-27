import Stripe from 'stripe';
import { getSessionUser, setCors } from '../_lib/helpers.js';
import { getDb } from '../_lib/db.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const APP_URL = process.env.APP_URL || 'https://littlegem.com';

export default async function handler(req, res) {
  setCors(req, res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { plan } = req.body || {};
  if (!['trial', 'monthly', 'annual'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Choose: trial, monthly, or annual.' });
  }

  const priceId = plan === 'annual'
    ? process.env.STRIPE_ANNUAL_PRICE_ID
    : process.env.STRIPE_MONTHLY_PRICE_ID;

  if (!priceId) {
    return res.status(500).json({ error: 'Plan pricing is not configured. Please contact support.' });
  }

  const sql = getDb();
  try {
    // Find or create Stripe customer
    let customerId;
    const existing = await sql`
      SELECT stripe_customer_id FROM lg_subscriptions
      WHERE user_id = ${user.id} AND stripe_customer_id IS NOT NULL LIMIT 1
    `;
    if (existing.length > 0) {
      customerId = existing[0].stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
    }

    const params = {
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${APP_URL}/create.html?checkout=success&plan=${plan}`,
      cancel_url: `${APP_URL}/pricing.html?checkout=cancelled`,
      metadata: { userId: user.id, plan },
    };

    if (plan === 'trial') {
      params.subscription_data = {
        trial_period_days: 14,
        metadata: { userId: user.id, plan: 'trial' },
      };
    }

    const session = await stripe.checkout.sessions.create(params);
    return res.json({ url: session.url });
  } catch (e) {
    console.error('checkout error:', e);
    return res.status(500).json({ error: e.message });
  }
}
