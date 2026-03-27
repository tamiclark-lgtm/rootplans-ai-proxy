// GET /api/subscription/status
// Returns the current user's entitlement — plan tier, limits, and status.

import { getSessionUser, setCors } from '../_lib/helpers.js';
import { getEntitlement, formatEntitlement } from '../_lib/entitlement.js';

export default async function handler(req, res) {
  setCors(req, res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const ent = await getEntitlement(user.id);
  return res.status(200).json(formatEntitlement(ent));
}
