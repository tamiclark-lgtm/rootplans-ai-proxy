import crypto from "crypto";

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

// Daily rotating session token derived from the access code + UTC date.
// Valid for today and yesterday to handle timezone edge cases.
export function validTokens() {
  const secret = process.env.ACCESS_CODE || "";
  const make = (date) =>
    crypto.createHmac("sha256", secret).update(date).digest("hex").slice(0, 40);
  const d = new Date();
  const today = d.toISOString().slice(0, 10);
  d.setDate(d.getDate() - 1);
  const yesterday = d.toISOString().slice(0, 10);
  return new Set([make(today), make(yesterday)]);
}

export default function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const { code } = req.body || {};
  if (
    typeof code === "string" &&
    code.trim() === (process.env.ACCESS_CODE || "")
  ) {
    // Issue a daily session token the client must send with every AI request
    const secret = process.env.ACCESS_CODE || "";
    const today = new Date().toISOString().slice(0, 10);
    const token = crypto
      .createHmac("sha256", secret)
      .update(today)
      .digest("hex")
      .slice(0, 40);
    return res.status(200).json({ ok: true, token });
  }
  return res.status(401).json({ ok: false });
}
