// GET  /api/plans  — list the current user's garden plans
// POST /api/plans  — create a new plan (enforces tier plan limit)

import { getSessionUser } from '../_lib/helpers.js';
import { getEntitlement, PLAN_LIMITS } from '../_lib/entitlement.js';
import { getDb } from '../_lib/db.js';

export default async function handler(req, res) {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  if (req.method === 'GET') return listPlans(user, req, res);
  if (req.method === 'POST') return createPlan(user, req, res);
  return res.status(405).end();
}

// ── List ──────────────────────────────────────────────────────────────────────
async function listPlans(user, req, res) {
  const sql = getDb();
  const rows = await sql`
    SELECT id, name, is_archived, metadata, created_at, updated_at
    FROM garden_plans
    WHERE user_id = ${user.id}
    ORDER BY created_at DESC
  `;

  const active   = rows.filter(r => !r.is_archived);
  const archived = rows.filter(r => r.is_archived);

  const ent = await getEntitlement(user.id);

  return res.status(200).json({
    plans:       { active, archived },
    planLimit:   ent.planLimit,
    planCount:   active.length,
    canCreateNew: active.length < ent.planLimit,
  });
}

// ── Create ────────────────────────────────────────────────────────────────────
async function createPlan(user, req, res) {
  const sql  = getDb();
  const ent  = await getEntitlement(user.id);

  // Count active (non-archived) plans
  const countRows = await sql`
    SELECT COUNT(*) AS n FROM garden_plans
    WHERE user_id = ${user.id} AND is_archived = FALSE
  `;
  const activeCount = Number(countRows[0]?.n || 0);

  if (activeCount >= ent.planLimit) {
    if (ent.isPremium) {
      // Premium users at their 7-plan cap
      return res.status(403).json({
        error:    'plan_limit_reached',
        isPremium: true,
        message:  'You already have 7 active gardens. Archive one to create a new plan.',
        planLimit: PLAN_LIMITS.premium,
      });
    } else {
      // Free users at their 1-plan cap
      return res.status(403).json({
        error:     'plan_limit_reached',
        isPremium: false,
        message:   'Free users can create 1 garden. Upgrade to Premium to create up to 7 active gardens.',
        planLimit: PLAN_LIMITS.free,
      });
    }
  }

  const { name = 'My Garden', metadata = null } = req.body || {};
  const safeName = String(name).slice(0, 80) || 'My Garden';

  const rows = await sql`
    INSERT INTO garden_plans (user_id, name, metadata)
    VALUES (${user.id}, ${safeName}, ${metadata ? JSON.stringify(metadata) : null})
    RETURNING id, name, is_archived, created_at
  `;

  return res.status(201).json({ plan: rows[0] });
}
