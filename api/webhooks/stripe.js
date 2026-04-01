// POST /api/webhooks/stripe
//
// Stripe sends events here on subscription lifecycle changes.
// Verifies the webhook signature then upserts stripe_subscriptions.
//
// ── RETRY BEHAVIOUR ────────────────────────────────────────────────────────
// Stripe retries webhook delivery (up to 3 days, exponential back-off) for
// any non-2xx response.  This handler returns HTTP 500 on DB errors so Stripe
// will retry automatically.  Ops teams should monitor:
//   • Vercel function logs for "[stripe-webhook] DB error" lines
//   • The Stripe Dashboard → Developers → Webhooks → event delivery failures
//   • Any sustained run of 500 responses (indicates a persistent DB outage)
// Signature failures return 400 (do NOT retry — the payload is invalid).
// Unknown event types return 200 (no retry needed — we just ignore them).

import Stripe from "stripe";
import { getDb } from "../_lib/db.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  httpClient: Stripe.createNodeHttpClient(),
});

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

  const sig    = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch (err) {
    console.error("[stripe-webhook] signature error:", err.message);
    return res.status(400).json({ error: "Webhook signature verification failed" });
  }

  const sql  = getDb();
  const type = event.type;

  // ── checkout.session.completed ─────────────────────────────────────────────
  if (type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode !== "subscription") return res.json({ ok: true });

    const userId = session.metadata?.user_id;
    if (!userId) {
      console.warn("[stripe-webhook] checkout.session.completed: no user_id in metadata", { sessionId: session.id });
      return res.json({ ok: true, note: "no user_id in metadata" });
    }

    console.log(`[stripe-webhook] processing type=checkout.session.completed user_id=${userId}`);

    let sub;
    try {
      sub = await stripe.subscriptions.retrieve(session.subscription);
    } catch (err) {
      console.error("[stripe-webhook] DB error", {
        type, userId,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({ error: "stripe_retrieve_error" });
    }

    const expiresAt = sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null;

    try {
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
    } catch (err) {
      console.error("[stripe-webhook] DB error", {
        type, userId,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({ error: "db_error" });
    }

    console.log(`[stripe-webhook] success type=checkout.session.completed user_id=${userId} status=active`);
    return res.json({ ok: true });
  }

  // ── invoice.paid (renewal) ─────────────────────────────────────────────────
  if (type === "invoice.paid") {
    const invoice = event.data.object;
    if (!invoice.subscription) return res.json({ ok: true });

    let sub;
    try {
      sub = await stripe.subscriptions.retrieve(invoice.subscription);
    } catch (err) {
      console.error("[stripe-webhook] DB error", {
        type, invoiceId: invoice.id,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({ error: "stripe_retrieve_error" });
    }

    const userId = sub.metadata?.user_id;
    if (!userId) {
      console.warn("[stripe-webhook] invoice.paid: no user_id in sub metadata", { subId: invoice.subscription });
      return res.json({ ok: true, note: "no user_id in sub metadata" });
    }

    console.log(`[stripe-webhook] processing type=invoice.paid user_id=${userId}`);

    const expiresAt = sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null;

    try {
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
    } catch (err) {
      console.error("[stripe-webhook] DB error", {
        type, userId,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({ error: "db_error" });
    }

    console.log(`[stripe-webhook] success type=invoice.paid user_id=${userId} status=active expires=${expiresAt}`);
    return res.json({ ok: true });
  }

  // ── customer.subscription.updated ─────────────────────────────────────────
  if (type === "customer.subscription.updated") {
    const sub    = event.data.object;
    const userId = sub.metadata?.user_id;
    if (!userId) {
      console.warn("[stripe-webhook] customer.subscription.updated: no user_id in sub metadata", { subId: sub.id });
      return res.json({ ok: true, note: "no user_id in sub metadata" });
    }

    console.log(`[stripe-webhook] processing type=customer.subscription.updated user_id=${userId}`);

    // past_due and trialing still get access; everything else is expired
    const status    = STRIPE_ACTIVE_STATUSES.has(sub.status) ? "active" : "expired";
    const expiresAt = sub.current_period_end
      ? new Date(sub.current_period_end * 1000)
      : null;

    try {
      await sql`
        UPDATE stripe_subscriptions
        SET status = ${status}, expires_at = ${expiresAt}, updated_at = NOW()
        WHERE user_id = ${userId}
      `;
    } catch (err) {
      console.error("[stripe-webhook] DB error", {
        type, userId,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({ error: "db_error" });
    }

    console.log(`[stripe-webhook] success type=customer.subscription.updated user_id=${userId} stripe_status=${sub.status} status=${status}`);
    return res.json({ ok: true });
  }

  // ── customer.subscription.deleted ─────────────────────────────────────────
  if (type === "customer.subscription.deleted") {
    const sub    = event.data.object;
    const userId = sub.metadata?.user_id;
    if (!userId) {
      console.warn("[stripe-webhook] customer.subscription.deleted: no user_id in sub metadata", { subId: sub.id });
      return res.json({ ok: true, note: "no user_id in sub metadata" });
    }

    console.log(`[stripe-webhook] processing type=customer.subscription.deleted user_id=${userId}`);

    try {
      // Clear expires_at so the account page doesn't show a stale future date
      await sql`
        UPDATE stripe_subscriptions
        SET status = 'expired', expires_at = NOW(), updated_at = NOW()
        WHERE user_id = ${userId}
      `;
    } catch (err) {
      console.error("[stripe-webhook] DB error", {
        type, userId,
        error: err.message,
        stack: err.stack,
      });
      return res.status(500).json({ error: "db_error" });
    }

    console.log(`[stripe-webhook] success type=customer.subscription.deleted user_id=${userId} status=expired`);
    return res.json({ ok: true });
  }

  // ── Unhandled event type ───────────────────────────────────────────────────
  console.log(`[stripe-webhook] unhandled type=${type}`);
  return res.json({ ok: true });
}
