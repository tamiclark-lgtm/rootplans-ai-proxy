import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const APP_URL = "https://www.rootplans.com";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", APP_URL);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { email } = req.body || {};
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: email || undefined,
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: "RootPlans Pro",
            description: "Unlimited garden plans · All plant varieties · PDF downloads · AI chat assistant",
          },
          unit_amount: 499,
          recurring: { interval: "month" },
        },
        quantity: 1,
      }],
      success_url: `${APP_URL}?upgraded=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}?upgraded=cancelled`,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
