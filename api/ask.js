import Anthropic from "@anthropic-ai/sdk";
import { getSessionUser } from "./_lib/helpers.js";
import { getEntitlement } from "./_lib/entitlement.js";

const client = new Anthropic();

const SYSTEM_BASE = `You are RootPlans Garden Advisor — a friendly, knowledgeable expert on home gardening, plant care, pests, diseases, and organic growing.

When asked about a pest or disease, always structure your answer as:
## [Pest/Disease Name]
**Which plants are affected:** ...
**How to identify it:** ...
**Natural & Organic Solutions:** (bulleted list)
**Chemical Options:** (bulleted list with specific product types/active ingredients)
**Prevention Tips:** ...

When asked about health benefits or plant uses, be practical and specific. Always note that plant remedies are not medical advice.

Keep answers clear, actionable, and beginner-friendly.`;

const SYSTEM_FREE = SYSTEM_BASE + `

Note: This user is on the free plan. Provide helpful general gardening advice. For pest diagnosis, health/functional plant uses, and advanced companion planting analysis, let them know these are Premium features and encourage upgrading to RootPlans Premium.`;

const SYSTEM_PREMIUM = SYSTEM_BASE + `

This user has RootPlans Premium. Provide full, detailed answers including pest diagnosis, health and functional plant uses, advanced companion planting, and any other requested analysis.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Sign in to continue." });

  const ent = await getEntitlement(user.id);

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "Missing messages" });
  }

  // Detect if this message is asking about a premium feature
  const lastMsg = String(messages[messages.length - 1]?.content || '').toLowerCase();
  const isPremiumQuery =
    lastMsg.includes('pest') || lastMsg.includes('disease') || lastMsg.includes('bug') ||
    lastMsg.includes('health') || lastMsg.includes('medicin') || lastMsg.includes('remedy') ||
    lastMsg.includes('functional') || lastMsg.includes('diagnos');

  // Soft-gate: premium queries get a nudge in the system prompt for free users.
  // We don't block the request — the system prompt handles the upsell gracefully.
  const systemPrompt = ent.isPremium ? SYSTEM_PREMIUM : SYSTEM_FREE;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Send tier so client can show upgrade prompt if needed
  res.write(`data: ${JSON.stringify({ planTier: ent.planTier, isPremiumQuery })}\n\n`);

  try {
    const stream = client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: ent.isPremium ? 1024 : 512,
      system: systemPrompt,
      messages: messages.slice(-6).map(m => ({
        role:    m.role,
        content: String(m.content).slice(0, 2000),
      })),
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    const msg = err instanceof Anthropic.APIError ? err.message : "Advisor error";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
}
