import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }

const sql = neon(url);
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Split on semicolons, keep statements that have real SQL content
const statements = schema.split(';');

let ok = 0, fail = 0;
for (const stmt of statements) {
  // Strip comments and whitespace
  const clean = stmt.replace(/--[^\n]*/g, '').trim();
  if (!clean) continue;
  try {
    await sql.query(clean);
    console.log('✓', clean.slice(0, 70).replace(/\s+/g, ' '));
    ok++;
  } catch (e) {
    console.error('✗', e.message, '\n  →', clean.slice(0, 70).replace(/\s+/g, ' '));
    fail++;
  }
}
console.log(`\nDone: ${ok} succeeded, ${fail} failed.`);
