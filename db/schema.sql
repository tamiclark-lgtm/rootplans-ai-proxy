-- Little Gem — Database Schema
-- Run once on your Neon PostgreSQL database before first deployment.
-- Safe to run multiple times (uses IF NOT EXISTS / ON CONFLICT DO NOTHING).

-- ── Users ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lg_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  email         TEXT        UNIQUE NOT NULL,
  password_hash TEXT        NOT NULL,
  password_salt TEXT        NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sessions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lg_sessions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES lg_users(id) ON DELETE CASCADE,
  token      TEXT        UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_token    ON lg_sessions (token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id  ON lg_sessions (user_id);

-- ── Subscriptions ─────────────────────────────────────────────────────────
-- status values: trialing | active | canceled | past_due | expired
-- plan values:   trial | monthly | annual
CREATE TABLE IF NOT EXISTS lg_subscriptions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID        REFERENCES lg_users(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT        UNIQUE,
  plan                   TEXT,
  status                 TEXT,
  trial_start            TIMESTAMPTZ,
  trial_end              TIMESTAMPTZ,
  current_period_start   TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN     DEFAULT FALSE,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subs_user_id  ON lg_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subs_customer ON lg_subscriptions (stripe_customer_id);

-- ── Password Resets ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lg_password_resets (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        REFERENCES lg_users(id) ON DELETE CASCADE,
  token      TEXT        UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN     DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resets_token ON lg_password_resets (token);

-- ── Admin flag ────────────────────────────────────────────────────────────
-- Grants unconditional premium entitlement via api/_lib/entitlement.js.
-- Flip manually in Neon, or via scripts/make-admin.mjs.
ALTER TABLE lg_users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Optional: Clean up expired sessions periodically ──────────────────────
-- Run this manually or via a cron job:
-- DELETE FROM lg_sessions WHERE expires_at < NOW();
-- DELETE FROM lg_password_resets WHERE expires_at < NOW() OR used = TRUE;
