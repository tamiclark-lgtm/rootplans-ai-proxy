import Anthropic from "@anthropic-ai/sdk";
import { getSessionUser } from "./_lib/helpers.js";
import { getEntitlement, canAccess } from "./_lib/entitlement.js";

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

// Simple in-memory rate limiter (per-IP, resets on cold start)
const rateLimitMap = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 10;

function isRateLimited(ip, max = RATE_MAX) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count > max;
}

function sanitizeString(val, maxLen) {
  if (typeof val !== "string") return "";
  return val
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/\bignore\s+(?:previous|above|all|prior)\b/gi, "")
    .replace(/\bact\s+as\b/gi, "")
    .replace(/\bsystem\s*:/gi, "")
    .slice(0, maxLen);
}

function getIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

const APP_URL = process.env.APP_URL || "";

function setCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = new Set([APP_URL, "http://localhost:3000"].filter(Boolean));
  if (!APP_URL || allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  // ── Auth (optional — unauthenticated users get the free plan) ─────────────
  const user = await getSessionUser(req);
  const ent  = user ? await getEntitlement(user.id) : { isPremium: false, planTier: "free" };

  // ── Rate limiting (stricter for unauthenticated) ───────────────────────────
  const ip = getIp(req);
  if (isRateLimited(ip, user ? 10 : 3)) {
    return res.status(429).json({ error: "Too many requests. Please sign in for more plans." });
  }

  try {
    const body = req.body || {};
    const zone     = sanitizeString(String(body.zone || "7"), 10);
    const location = sanitizeString(String(body.location || ""), 100);

    // ── Enforce free prompt for non-premium users (server-side, not trustable from client) ──
    let userMessage;
    if (ent.isPremium) {
      const prompt = sanitizeString(body.prompt || "", 4000);
      userMessage = prompt || buildFallbackPrompt({ zone, location, isPremium: true });
    } else {
      userMessage = buildFreePlanPrompt(zone, location);
    }

    // ── Stream ────────────────────────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ planTier: ent.planTier })}\n\n`);

    const stream = client.messages.stream({
      model: "claude-haiku-4-5-20251001",
      max_tokens: ent.isPremium ? 3500 : 1200,
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

function buildFreePlanPrompt(zone = "7", location = "") {
  const locationLine = location ? `Location: ${location}.` : "";
  return `
You are RootPlans, a garden planning assistant.

Create a short starter garden plan for a beginner in USDA Zone ${zone}. ${locationLine}

STRICT RULES — follow exactly, no exceptions:
- Choose exactly 5 common, widely available beginner plants for Zone ${zone}
- DO NOT include pollinator icons (no 🐝 🦋 🐦 or any bee/butterfly/hummingbird references)
- DO NOT include pet safety, toxicity, or any safety warnings
- DO NOT include "Where to buy" links or any URLs
- DO NOT include holistic, medicinal, or wellness notes
- DO NOT include nutritional information
- DO NOT include a pest section
- DO NOT include a shopping list
- Keep each plant description to exactly 2 lines — nothing more

OUTPUT THIS EXACT FORMAT with no additions:

## 🌱 Your Starter Garden Plan

[2 sentences about what grows well in Zone ${zone}.]

## Recommended Plants

**[Plant Name]** [☀️ Full Sun | ⛅ Partial Shade | 🌑 Full Shade]
[One sentence: what it is and why it's easy to grow.]
**Good companions:** [Plant A, Plant B]

[repeat for all 5 plants, separated by ---]

## Basic Care Tips

- [Tip 1 for Zone ${zone}]
- [Tip 2]
- [Tip 3]
- [Tip 4]

---

> 🔒 **Upgrade to RootPlans Pro** for a full personalized plan — custom themes, rare varieties, detailed layout, seasonal calendar, pest guide, and shopping list.

After the plan output EXACTLY this block — no markdown fences, no extra text:
CALENDAR_JSON_START
[{"plant":"Plant Name","sow_start":0,"sow_end":0,"plant_start":4,"plant_end":5,"harvest_start":7,"harvest_end":9}]
CALENDAR_JSON_END
One entry per plant. Real month numbers for Zone ${zone}. sow_start/sow_end = 0 if not started indoors.
  `.trim();
}

function buildFallbackPrompt({ zone = "7", nativeOnly = false, theme = "", holisticHealing = false, conditions = [], isPremium = false }) {
  const nativeLine    = nativeOnly ? "only native plants" : "plants suitable for the zone";
  const themeLine     = theme ? `Garden theme: ${theme}.` : "";
  const holisticLine  = holisticHealing
    ? "Include a short traditional-use note for each plant using cautious, non-medical language."
    : "";
  const conditionLine = conditions.length ? `Functional focus: ${conditions.join(", ")}.` : "";
  const scopeLine     = isPremium
    ? "Include pest resistance notes and advanced companion planting."
    : "";

  return [
    `Create a practical home garden plan for USDA zone ${zone} using ${nativeLine}.`,
    themeLine,
    holisticLine,
    conditionLine,
    scopeLine,
    "Return: 1. Garden Concept  2. Recommended Plants  3. Simple Layout  4. Seasonal Care  5. Beginner Tips  6. Safety Note"
  ].filter(Boolean).join(" ");
}
