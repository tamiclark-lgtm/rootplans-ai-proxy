import Anthropic from "@anthropic-ai/sdk";
import { validTokens } from "./auth.js";

const client = new Anthropic();

const SYSTEM = `You are RootPlans Garden Advisor — a friendly, knowledgeable expert on home gardening, plant care, pests, diseases, and organic growing.

When asked about a pest or disease, always structure your answer as:
## [Pest/Disease Name]
**Which plants are affected:** ...
**How to identify it:** ...
**Natural & Organic Solutions:** (bulleted list)
**Chemical Options:** (bulleted list with specific product types/active ingredients)
**Prevention Tips:** ...

When asked about health benefits or plant uses, be practical and specific. Always note that plant remedies are not medical advice.

Keep answers clear, actionable, and beginner-friendly.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const token = req.headers["x-session-token"] || "";
  if (!validTokens().has(token)) return res.status(401).json({ error: "Unauthorized" });

  const { messages } = req.body || {};
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: "Missing messages" });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stream = await client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM,
      messages: messages.slice(-6).map(m => ({
        role: m.role,
        content: String(m.content).slice(0, 2000)
      }))
    });

    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta?.type === "text_delta") {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}
