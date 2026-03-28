// api/rp/auth/reset-password.js
import { getDb } from '../../_lib/db.js';
import { hashPassword, generateToken, setCors } from '../../_lib/helpers.js';
import { getEntitlement, formatEntitlement } from '../../_lib/entitlement.js';

export default async function handler(req, res) {
  setCors(req, res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, password } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Reset token is required' });
  if (!password || password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters', field: 'password' });

  const sql = getDb();
  try {
    const resets = await sql`
      SELECT id, user_id FROM lg_password_resets
      WHERE token = ${token} AND expires_at > NOW() AND used = FALSE
    `;
    if (!resets.length) {
      return res.status(400).json({ error: 'This reset link has expired or is invalid. Please request a new one.' });
    }

    const reset = resets[0];
    const { hash, salt } = await hashPassword(password);

    await sql`UPDATE lg_users SET password_hash = ${hash}, password_salt = ${salt} WHERE id = ${reset.user_id}`;
    await sql`UPDATE lg_password_resets SET used = TRUE WHERE id = ${reset.id}`;
    await sql`DELETE FROM lg_sessions WHERE user_id = ${reset.user_id}`;

    // Auto-login after reset
    const newToken = generateToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await sql`INSERT INTO lg_sessions (user_id, token, expires_at) VALUES (${reset.user_id}, ${newToken}, ${expires.toISOString()})`;

    const users = await sql`SELECT id, name, email FROM lg_users WHERE id = ${reset.user_id}`;
    const ent = await getEntitlement(reset.user_id);

    return res.status(200).json({
      user:         { id: users[0].id, name: users[0].name, email: users[0].email },
      token:        newToken,
      subscription: formatEntitlement(ent),
    });
  } catch (e) {
    console.error('rp reset-password error:', e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
