import crypto from 'crypto';
import { promisify } from 'util';
import { getDb } from './db.js';

const pbkdf2 = promisify(crypto.pbkdf2);

// ── CORS ────────────────────────────────────────────────────────────────────
const DEV_ORIGINS = new Set(['http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:5500']);

export function setCors(req, res, methods = 'GET,POST,OPTIONS') {
  const origin = req.headers.origin || '';
  const appUrl  = process.env.APP_URL || '';
  const allowed = new Set([appUrl, ...DEV_ORIGINS].filter(Boolean));
  if (!appUrl || allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// ── PASSWORD HASHING ─────────────────────────────────────────────────────────
export async function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = (await pbkdf2(password, salt, 100000, 64, 'sha512')).toString('hex');
  return { hash, salt };
}

export async function verifyPassword(password, storedHash, salt) {
  const hash = (await pbkdf2(password, salt, 100000, 64, 'sha512')).toString('hex');
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── TOKENS ───────────────────────────────────────────────────────────────────
export function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function getToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

// ── SESSION ──────────────────────────────────────────────────────────────────
export async function getSessionUser(req) {
  const token = getToken(req);
  if (!token) return null;
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT u.id, u.name, u.email
      FROM lg_sessions s
      JOIN lg_users u ON u.id = s.user_id
      WHERE s.token = ${token} AND s.expires_at > NOW()
    `;
    return rows[0] || null;
  } catch { return null; }
}

// ── SUBSCRIPTION ─────────────────────────────────────────────────────────────

function _derivePlan(productId) {
  if (!productId) return 'monthly';
  const lower = productId.toLowerCase();
  if (lower.includes('annual') || lower.includes('yearly') || lower.includes('year')) return 'annual';
  return 'monthly';
}

async function _getStripeSub(userId) {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT * FROM lg_subscriptions
      WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 1
    `;
    return rows[0] || null;
  } catch { return null; }
}

async function _getAppleSub(userId) {
  const sql = getDb();
  try {
    const rows = await sql`
      SELECT * FROM lg_apple_subscriptions
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC LIMIT 1
    `;
    return rows[0] || null;
  } catch { return null; }
}

/**
 * Returns the best active subscription for the user, checking Stripe first
 * then Apple IAP.  Apple subs are normalized to match the shape that
 * ask.js / holistic.js and formatSubscription() already expect.
 */
export async function getUserSubscription(userId) {
  const now = new Date();

  const [stripeSub, appleSub] = await Promise.all([
    _getStripeSub(userId),
    _getAppleSub(userId),
  ]);

  const stripeActive = stripeSub && (
    stripeSub.status === 'trialing' ||
    stripeSub.status === 'active' ||
    (stripeSub.status === 'canceled' &&
      stripeSub.current_period_end &&
      new Date(stripeSub.current_period_end) > now)
  );

  if (stripeActive) return stripeSub;

  const appleActive = appleSub &&
    appleSub.status === 'active' &&
    (!appleSub.expires_at || new Date(appleSub.expires_at) > now);

  if (appleActive) {
    // Normalize Apple sub into the shape existing gateway code expects
    return {
      ...appleSub,
      plan: _derivePlan(appleSub.product_id),
      current_period_end: appleSub.expires_at,
      trial_end: null,
      cancel_at_period_end: false,
      _source: 'apple',
    };
  }

  // Neither active — return Stripe record (may be expired/null) for display
  return stripeSub;
}

export function formatSubscription(sub) {
  if (!sub) return null;
  return {
    plan: sub.plan,
    status: sub.status,
    trialEnd: sub.trial_end,
    renewalDate: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    source: sub._source || 'stripe',
  };
}
