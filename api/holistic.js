import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are RootPlans, an AI garden planning assistant for homeowners.

You help users design personalized planting plans based on their location, growing zone, sunlight, space, goals, style, and maintenance preferences.

You specialize in:
- residential garden planning
- native plants
- privacy landscaping
- edible and functional gardens
- attractive plant combinations
- easy-to-follow planting advice

Your responses should be practical, clear, homeowner-friendly, and aesthetically aware. Avoid medical advice or medical claims about plants; use language like "traditionally used".`;

export default async function handler(req, res) {
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

  try {
    const body = req.body || {};

    // Use the rich prompt built by the frontend if provided,
    // otherwise fall back to a simple prompt from zone/nativeOnly
    const userMessage = body.prompt || buildFallbackPrompt(body);

    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 3500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }]
    });

    const text = response.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("\n");

    return res.status(200).json({ text });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return res.status(e.status ?? 500).send(e.message);
    }
    return res.status(500).send("Proxy error");
  }
}

function buildFallbackPrompt({ zone = "7", nativeOnly = false, theme = "", holisticHealing = false, conditions = [] }) {
  const nativeLine = nativeOnly ? "only native plants" : "plants suitable for the zone";
  const themeLine = theme ? `Garden theme: ${theme}.` : "";
  const holisticLine = holisticHealing
    ? "Include a short traditional-use note for each plant using cautious, non-medical language."
    : "";
  const conditionLine = conditions.length
    ? `Functional focus: ${conditions.join(", ")}.`
    : "";

  return [
    `Create a practical home garden plan for USDA zone ${zone} using ${nativeLine}.`,
    themeLine,
    holisticLine,
    conditionLine,
    "Return: 1. Garden Concept  2. Recommended Plants  3. Simple Layout  4. Seasonal Care  5. Beginner Tips  6. Safety Note"
  ].filter(Boolean).join(" ");
}
