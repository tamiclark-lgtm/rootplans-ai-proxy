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

  const sql = getDb();
  try {
    const subs = await sql`
      SELECT stripe_customer_id FROM lg_subscriptions
      WHERE user_id = ${user.id} AND stripe_customer_id IS NOT NULL LIMIT 1
    `;
    if (!subs.length) {
      return res.status(404).json({ error: 'No billing account found. Please subscribe first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: subs[0].stripe_customer_id,
      return_url: `${APP_URL}/account.html`,
    });
    return res.json({ url: session.url });
  } catch (e) {
    console.error('portal error:', e);
    return res.status(500).json({ error: e.message });
  }
}
