// GET /api/auth/me
// Returns authenticated user + entitlement (plan tier, limits, status).

import { getSessionUser, setCors } from '../_lib/helpers.js';
import { getEntitlement, formatEntitlement } from '../_lib/entitlement.js';

export default async function handler(req, res) {
  setCors(req, res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const ent = await getEntitlement(user.id);
  const formatted = formatEntitlement(ent);

  return res.status(200).json({
    user:         { id: user.id, name: user.name, email: user.email },
    subscription: formatted,   // legacy key — keeps auth.js session working
    entitlement:  formatted,   // explicit key for new code
  });
}
