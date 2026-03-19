import Anthropic from "@anthropic-ai/sdk";
import { validTokens } from "./auth.js";

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

function isRateLimited(ip) {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);
  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count > RATE_MAX;
}

function sanitizeString(val, maxLen) {
  if (typeof val !== "string") return "";
  // Strip control characters and known injection sequences
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

const ALLOWED_ORIGINS = new Set([
  "https://rootplans.com",
  "https://www.rootplans.com"
]);

function setCors(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Session-Token");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  // ── Token validation ──────────────────────────────────────────────────────
  const token = (req.headers["x-session-token"] || "").trim();
  if (!token || !validTokens().has(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const ip = getIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests" });
  }

  try {
    const body = req.body || {};

    // ── Input sanitization ────────────────────────────────────────────────
    const prompt = sanitizeString(body.prompt || "", 4000);
    const zone = sanitizeString(String(body.zone || "7"), 10);
    const location = sanitizeString(String(body.location || ""), 100);
    const theme = sanitizeString(String(body.theme || ""), 60);
    const nativeOnly = body.nativeOnly === true;
    const holisticHealing = body.holisticHealing === true;
    const conditions = Array.isArray(body.conditions)
      ? body.conditions
          .slice(0, 10)
          .map(c => sanitizeString(String(c), 60))
          .filter(Boolean)
      : [];

    const userMessage = prompt || buildFallbackPrompt({ zone, location, nativeOnly, theme, holisticHealing, conditions });

    // ── Stream the response ───────────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const stream = client.messages.stream({
      model: "claude-haiku-4-5",
      max_tokens: 3500,
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
