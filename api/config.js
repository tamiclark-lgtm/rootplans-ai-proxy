// GET /api/config
// Returns public (non-secret) client-side config values.
// Safe to call unauthenticated — never expose secret keys here.

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    rcIosApiKey: process.env.REVENUECAT_IOS_PUBLIC_KEY || '',
  });
}
