// api/rp/auth/forgot-password.js
import { getDb } from '../../_lib/db.js';
import { generateToken, setCors } from '../../_lib/helpers.js';

const APP_URL = process.env.APP_URL || 'https://rootplans.com';

async function sendResetEmail(email, name, resetUrl) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[DEV] RootPlans password reset link for ${email}: ${resetUrl}`);
    return;
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `Root Plans <onboarding@resend.dev>`,
      to: email,
      subject: 'Reset your Root Plans password',
      html: `
        <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;background:#f4faf6;">
          <img src="${APP_URL}/rootplans.png" alt="Root Plans" style="height:60px;margin-bottom:24px;" />
          <h2 style="color:#1a2e1e;font-size:20px;margin:0 0 8px;">Reset your password</h2>
          <p style="color:#5a7360;line-height:1.6;margin:0 0 24px;">Hi ${name}, click below to reset your password. This link expires in 1 hour.</p>
          <a href="${resetUrl}" style="display:inline-block;background:#2d6a4f;color:#fff;text-decoration:none;padding:14px 28px;border-radius:10px;font-weight:600;font-size:15px;">Reset My Password</a>
          <p style="color:#94A3B8;font-size:13px;margin:24px 0 0;">If you didn't request this, you can safely ignore this email.</p>
        </div>`,
    }),
  });
}

export default async function handler(req, res) {
  setCors(req, res, 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email?.trim()) return res.status(400).json({ error: 'Email is required' });

  const sql = getDb();
  try {
    const users = await sql`SELECT id, name FROM lg_users WHERE email = ${email.toLowerCase().trim()}`;
    if (!users.length) return res.status(200).json({ ok: true });

    const user = users[0];
    const token = generateToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await sql`
      INSERT INTO lg_password_resets (user_id, token, expires_at)
      VALUES (${user.id}, ${token}, ${expires.toISOString()})
    `;

    const resetUrl = `${APP_URL}/rp-reset-password.html?token=${token}`;
    await sendResetEmail(email.toLowerCase().trim(), user.name, resetUrl);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('rp forgot-password error:', e);
    return res.status(200).json({ ok: true });
  }
}
