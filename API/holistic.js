export default async function handler(req, res) {
  // ✅ CORS (lets your website call this endpoint)
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

  // ✅ Handle browser preflight
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const { zone = "7", nativeOnly = false } = req.body || {};

    const prompt =
      `Create a small garden in zone ${zone} using ${nativeOnly ? "only native plants" : "plants suitable for the zone"} ` +
      `that have holistic properties. Return a concise list. ` +
      `Format each line as: Plant (common + botanical) - power in 1 cautious sentence. ` +
      `Avoid medical advice or medical claims; use language like "traditionally used".`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-latest",
        max_tokens: 1200,
        temperature: 0.7,
        system: "You help garden users with holistic plant uses. Avoid medical advice; be cautious and clear.",
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(500).send(err);
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    return res.status(200).json({ text });
  } catch (e) {
    return res.status(500).send("Proxy error");
  }
}
