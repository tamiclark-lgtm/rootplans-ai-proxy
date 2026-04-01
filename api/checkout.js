import Stripe from "stripe";
import { setCors, getSessionUser } from "./_lib/helpers.js";

const stripe  = new Stripe(process.env.STRIPE_SECRET_KEY);
const APP_URL = process.env.APP_URL || "https://www.rootplans.com";

const PLANS = {
  monthly: { amount: 499,   interval: "month", label: "RootPlans Premium — Monthly" },
  yearly:  { amount: 3900,  interval: "year",  label: "RootPlans Premium — Annual"  },
};

export default async function handler(req, res) {
  setCors(req, res, "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).end();

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });

  const plan = PLANS[req.body?.plan] ? req.body.plan : "monthly";
  const p    = PLANS[plan];

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: user.email,
      metadata: { user_id: String(user.id), plan },
      subscription_data: { metadata: { user_id: String(user.id), plan } },
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: p.label },
          unit_amount: p.amount,
          recurring: { interval: p.interval },
        },
        quantity: 1,
      }],
      success_url: `${APP_URL}/pricing.html?upgraded=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${APP_URL}/pricing.html`,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
