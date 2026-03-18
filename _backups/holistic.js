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
    const userMessage = body.prompt || buildFallbackPrompt(body);

    // Stream the response using SSE so the connection stays alive
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const stream = client.messages.stream({
      model: "claude-haiku-4-5",
      max_tokens: 2500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }]
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
        if (res.flush) res.flush();
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? e.message : "Proxy error";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
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
