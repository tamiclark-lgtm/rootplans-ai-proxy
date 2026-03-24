import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.rootplans.com");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { email } = req.query;
  if (!email) return res.json({ active: false });

  try {
    const customers = await stripe.customers.list({ email: email.toLowerCase(), limit: 1 });
    if (!customers.data.length) return res.json({ active: false });

    const subs = await stripe.subscriptions.list({
      customer: customers.data[0].id,
      status: "active",
      limit: 1,
    });
    res.json({ active: subs.data.length > 0 });
  } catch (e) {
    res.json({ active: false });
  }
}
