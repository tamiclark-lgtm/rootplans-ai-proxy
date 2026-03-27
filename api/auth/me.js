import { getSessionUser, getUserSubscription, formatSubscription, setCors } from '../_lib/helpers.js';

export default async function handler(req, res) {
  setCors(req, res, 'GET,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const sub = await getUserSubscription(user.id);
  return res.status(200).json({
    user: { id: user.id, name: user.name, email: user.email },
    subscription: formatSubscription(sub),
  });
}
