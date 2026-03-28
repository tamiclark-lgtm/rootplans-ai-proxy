import { getDb } from '../_lib/db.js';
import { verifyPassword, generateToken, setCors } from '../_lib/helpers.js';
import { getEntitlement, formatEntitlement } from '../_lib/entitlement.js';

export default async function handler(req, res) {
  setCors(req, res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password } = req.body || {};
  if (!email?.trim())
    return res.status(400).json({ error: 'Email is required', field: 'email' });
  if (!password)
    return res.status(400).json({ error: 'Password is required', field: 'password' });

  const sql = getDb();
  try {
    const users = await sql`
      SELECT id, name, email, password_hash, password_salt
      FROM lg_users WHERE email = ${email.toLowerCase().trim()}
    `;
    if (!users.length) {
      return res.status(401).json({ error: 'No account found with this email address', field: 'email' });
    }

    const user = users[0];
    const valid = await verifyPassword(password, user.password_hash, user.password_salt);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password. Please try again.', field: 'password' });
    }

    const token = generateToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await sql`INSERT INTO lg_sessions (user_id, token, expires_at) VALUES (${user.id}, ${token}, ${expires.toISOString()})`;

    const ent = await getEntitlement(user.id);
    return res.status(200).json({
      user: { id: user.id, name: user.name, email: user.email },
      token,
      subscription: formatEntitlement(ent),
    });
  } catch (e) {
    console.error('login error:', e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
