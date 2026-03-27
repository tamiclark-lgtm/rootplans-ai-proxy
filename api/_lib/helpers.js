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
