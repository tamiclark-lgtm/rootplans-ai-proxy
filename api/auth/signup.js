import { getDb } from '../_lib/db.js';
import { hashPassword, generateToken, setCors } from '../_lib/helpers.js';

export default async function handler(req, res) {
  setCors(req, res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, password, confirmPassword } = req.body || {};

  if (!name?.trim())
    return res.status(400).json({ error: 'Name is required', field: 'name' });
  if (!email?.trim())
    return res.status(400).json({ error: 'Email is required', field: 'email' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
    return res.status(400).json({ error: 'Please enter a valid email address', field: 'email' });
  if (!password)
    return res.status(400).json({ error: 'Password is required', field: 'password' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters', field: 'password' });
  if (confirmPassword !== undefined && password !== confirmPassword)
    return res.status(400).json({ error: 'Passwords do not match', field: 'confirmPassword' });

  const sql = getDb();
  try {
    const existing = await sql`SELECT id FROM lg_users WHERE email = ${email.toLowerCase().trim()}`;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists', field: 'email' });
    }

    const { hash, salt } = await hashPassword(password);
    const users = await sql`
      INSERT INTO lg_users (name, email, password_hash, password_salt)
      VALUES (${name.trim()}, ${email.toLowerCase().trim()}, ${hash}, ${salt})
      RETURNING id, name, email
    `;
    const user = users[0];

    const token = generateToken();
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await sql`INSERT INTO lg_sessions (user_id, token, expires_at) VALUES (${user.id}, ${token}, ${expires.toISOString()})`;

    return res.status(201).json({
      user: { id: user.id, name: user.name, email: user.email },
      token,
      subscription: null,
    });
  } catch (e) {
    console.error('signup error:', e);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
