import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://www.rootplans.com");
  if (req.method === "OPTIONS") return res.status(204).end();

  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: "Missing session_id" });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    if (session.status === "complete" || session.payment_status === "paid") {
      const email = session.customer_details?.email || session.customer_email;
      res.json({ success: true, email });
    } else {
      res.status(400).json({ error: "Payment not complete" });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
