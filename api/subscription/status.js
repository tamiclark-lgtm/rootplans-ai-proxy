import { getSessionUser, getUserSubscription, setCors } from '../_lib/helpers.js';

export default async function handler(req, res) {
  setCors(req, res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const sub = await getUserSubscription(user.id);
  if (!sub) return res.json({ hasSubscription: false, canAccess: false });

  const now = new Date();
  const canAccess =
    sub.status === 'trialing' ||
    sub.status === 'active' ||
    (sub.status === 'canceled' && sub.current_period_end && new Date(sub.current_period_end) > now);

  return res.json({
    hasSubscription: true,
    canAccess,
    plan: sub.plan,
    status: sub.status,
    trialEnd: sub.trial_end,
    renewalDate: sub.current_period_end,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  });
}
