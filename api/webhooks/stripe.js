import Stripe from 'stripe';
import { getDb } from '../_lib/db.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Disable Vercel's body parser so we can verify Stripe signature
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Stripe webhook signature verification failed:', e.message);
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }

  const sql = getDb();

  try {
    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated'
    ) {
      const sub = event.data.object;
      const userId = sub.metadata?.userId || sub.metadata?.user_id;
      if (!userId) {
        console.warn('Stripe webhook: subscription has no userId in metadata', sub.id);
        return res.json({ received: true });
      }

      const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
      const plan = sub.metadata?.plan || (interval === 'year' ? 'annual' : 'monthly');

      await sql`
        INSERT INTO lg_subscriptions (
          user_id, stripe_customer_id, stripe_subscription_id,
          plan, status, trial_start, trial_end,
          current_period_start, current_period_end, cancel_at_period_end, updated_at
        ) VALUES (
          ${userId}, ${sub.customer}, ${sub.id}, ${plan}, ${sub.status},
          ${sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null},
          ${sub.trial_end   ? new Date(sub.trial_end   * 1000).toISOString() : null},
          ${sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString() : null},
          ${sub.current_period_end   ? new Date(sub.current_period_end   * 1000).toISOString() : null},
          ${sub.cancel_at_period_end || false}, NOW()
        )
        ON CONFLICT (stripe_subscription_id) DO UPDATE SET
          status                = EXCLUDED.status,
          plan                  = EXCLUDED.plan,
          trial_start           = EXCLUDED.trial_start,
          trial_end             = EXCLUDED.trial_end,
          current_period_start  = EXCLUDED.current_period_start,
          current_period_end    = EXCLUDED.current_period_end,
          cancel_at_period_end  = EXCLUDED.cancel_at_period_end,
          updated_at            = NOW()
      `;
    } else if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await sql`
        UPDATE lg_subscriptions SET status = 'canceled', updated_at = NOW()
        WHERE stripe_subscription_id = ${sub.id}
      `;
    } else if (event.type === 'invoice.payment_failed') {
      const inv = event.data.object;
      await sql`
        UPDATE lg_subscriptions SET status = 'past_due', updated_at = NOW()
        WHERE stripe_customer_id = ${inv.customer}
        AND status NOT IN ('canceled', 'expired')
      `;
    }

    return res.json({ received: true });
  } catch (e) {
    console.error('Webhook handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}
