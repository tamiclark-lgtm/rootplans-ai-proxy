export default function handler(req, res) {
  const allowed = new Set([
    "https://rootplans.com",
    "https://www.rootplans.com"
  ]);
  const origin = req.headers.origin || "";
  if (allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const { code } = req.body || {};
  if (code && code.toString().trim() === process.env.ACCESS_CODE) {
    return res.status(200).json({ ok: true });
  }
  return res.status(401).json({ ok: false });
}
