// scripts/make-admin.mjs
// Creates (or updates) a user as an admin. Admins get unconditional
// premium entitlement via api/_lib/entitlement.js.
//
// Usage:
//   node scripts/make-admin.mjs <email> <password> [name]
//
// Requires DATABASE_URL env var.
// Safe to re-run: upserts on email, overwrites password + flips is_admin=true.

import { neon } from '@neondatabase/serverless';
import crypto from 'crypto';
import { promisify } from 'util';

const pbkdf2 = promisify(crypto.pbkdf2);

async function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = (await pbkdf2(password, salt, 100000, 64, 'sha512')).toString('hex');
  return { hash, salt };
}

const [, , emailArg, passwordArg, nameArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error('Usage: node scripts/make-admin.mjs <email> <password> [name]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL env var is not set');
  process.exit(1);
}

const email = emailArg.toLowerCase().trim();
const name  = (nameArg || email.split('@')[0]).trim();
const sql   = neon(process.env.DATABASE_URL);

try {
  const { hash, salt } = await hashPassword(passwordArg);

  const existing = await sql`SELECT id FROM lg_users WHERE email = ${email}`;
  let userId;

  if (existing.length) {
    userId = existing[0].id;
    await sql`
      UPDATE lg_users
      SET password_hash = ${hash},
          password_salt = ${salt},
          is_admin = TRUE
      WHERE id = ${userId}
    `;
    console.log(`Updated existing user ${email} (id=${userId}) → admin, password reset.`);
  } else {
    const rows = await sql`
      INSERT INTO lg_users (name, email, password_hash, password_salt, is_admin)
      VALUES (${name}, ${email}, ${hash}, ${salt}, TRUE)
      RETURNING id
    `;
    userId = rows[0].id;
    console.log(`Created new admin user ${email} (id=${userId}).`);
  }

  console.log('Done. Log in normally at /rp-login.html — admin bypass grants full premium access.');
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}
