import { getToken, setCors } from '../_lib/helpers.js';
import { getDb } from '../_lib/db.js';

export default async function handler(req, res) {
  setCors(req, res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = getToken(req);
  if (token) {
    try {
      const sql = getDb();
      await sql`DELETE FROM lg_sessions WHERE token = ${token}`;
    } catch { /* ignore */ }
  }
  return res.status(200).json({ ok: true });
}
