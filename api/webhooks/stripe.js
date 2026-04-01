// POST /api/webhooks/stripe
//
// Stripe sends events here on subscription lifecycle changes.
// Verifies the webhook signature then upserts stripe_subscriptions.

import Stripe from "stripe";
import { getDb } from "../_lib/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe statuses that still mean the user should have access
const STRIPE_ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("[webhooks/stripe] signature error:", err.message);
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }

  const sql = getDb();
  const type = event.type;

  try {
    if (type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.mode !== "subscription") return res.json({ ok: true });

      const userId = session.metadata?.user_id;
      if (!userId) return res.json({ ok: true, note: "no user_id in metadata" });

      const sub = await stripe.subscriptions.retrieve(session.subscription);
      const expiresAt = sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null;

      await sql`
        INSERT INTO stripe_subscriptions
          (user_id, stripe_customer_id, stripe_subscription_id, status, plan, expires_at, updated_at)
        VALUES
          (${userId}, ${session.customer}, ${session.subscription},
           'active', ${session.metadata?.plan || 'monthly'}, ${expiresAt}, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          stripe_customer_id      = EXCLUDED.stripe_customer_id,
          stripe_subscription_id  = EXCLUDED.stripe_subscription_id,
          status                  = 'active',
          plan                    = EXCLUDED.plan,
          expires_at              = EXCLUDED.expires_at,
          updated_at              = NOW()
      `;
      console.log(`[webhooks/stripe] activated user ${userId}`);

    } else if (type === "invoice.paid") {
      // Renewal — upsert so event ordering doesn't matter
      const invoice = event.data.object;
      if (!invoice.subscription) return res.json({ ok: true });

      const sub = await stripe.subscriptions.retrieve(invoice.subscription);
      const userId = sub.metadata?.user_id;
      if (!userId) return res.json({ ok: true, note: "no user_id in sub metadata" });

      const expiresAt = sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null;

      await sql`
        INSERT INTO stripe_subscriptions
          (user_id, stripe_customer_id, stripe_subscription_id, status, plan, expires_at, updated_at)
        VALUES
          (${userId}, ${invoice.customer}, ${invoice.subscription},
           'active', ${sub.metadata?.plan || 'monthly'}, ${expiresAt}, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          status      = 'active',
          expires_at  = EXCLUDED.expires_at,
          updated_at  = NOW()
      `;
      console.log(`[webhooks/stripe] renewed user ${userId} expires=${expiresAt}`);

    } else if (type === "customer.subscription.updated") {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      if (!userId) return res.json({ ok: true, note: "no user_id in sub metadata" });

      // past_due and trialing still get access; everything else is expired
      const status = STRIPE_ACTIVE_STATUSES.has(sub.status) ? "active" : "expired";
      const expiresAt = sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null;

      await sql`
        UPDATE stripe_subscriptions
        SET status = ${status}, expires_at = ${expiresAt}, updated_at = NOW()
        WHERE user_id = ${userId}
      `;
      console.log(`[webhooks/stripe] updated user ${userId} stripe_status=${sub.status} → ${status}`);

    } else if (type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const userId = sub.metadata?.user_id;
      if (!userId) return res.json({ ok: true, note: "no user_id in sub metadata" });

      // Clear expires_at so the account page doesn't show a stale future date
      await sql`
        UPDATE stripe_subscriptions
        SET status = 'expired', expires_at = NOW(), updated_at = NOW()
        WHERE user_id = ${userId}
      `;
      console.log(`[webhooks/stripe] cancelled user ${userId}`);
    }

  } catch (err) {
    console.error("[webhooks/stripe] DB error:", err);
    return res.status(500).json({ error: "DB error" });
  }

  return res.json({ ok: true });
}
