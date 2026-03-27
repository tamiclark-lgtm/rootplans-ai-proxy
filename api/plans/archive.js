// POST /api/plans/archive
// Body: { planId, archive: true|false }
// Toggles the is_archived flag on a plan.
// Archived plans don't count toward the active-plan limit.

import { getSessionUser } from '../_lib/helpers.js';
import { getDb } from '../_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { planId, archive = true } = req.body || {};
  if (!planId) return res.status(400).json({ error: 'planId is required' });

  const sql = getDb();

  // Verify the plan belongs to this user
  const rows = await sql`
    UPDATE garden_plans
    SET is_archived = ${!!archive}, updated_at = NOW()
    WHERE id = ${planId} AND user_id = ${user.id}
    RETURNING id, name, is_archived
  `;

  if (!rows.length) return res.status(404).json({ error: 'Plan not found' });

  return res.status(200).json({ plan: rows[0] });
}
