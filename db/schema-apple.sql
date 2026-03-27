-- Apple IAP Subscriptions (managed via RevenueCat)
-- Run once on your Neon PostgreSQL database.
-- Safe to run multiple times (IF NOT EXISTS).
--
-- RevenueCat sets appUserID = lg_users.id (UUID) at login time,
-- so we can look up users directly from webhook payloads.

CREATE TABLE IF NOT EXISTS lg_apple_subscriptions (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES lg_users(id) ON DELETE CASCADE,
  revenuecat_user_id  TEXT        NOT NULL,          -- equals lg_users.id as text
  product_id          TEXT,                          -- e.g. com.rootplans.monthly
  entitlement_id      TEXT        NOT NULL DEFAULT 'premium',
  status              TEXT        NOT NULL DEFAULT 'active',  -- active | expired | revoked
  expires_at          TIMESTAMPTZ,                   -- null = lifetime/non-expiring
  purchase_date       TIMESTAMPTZ,
  environment         TEXT        NOT NULL DEFAULT 'production',  -- production | sandbox
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- One row per user; ON CONFLICT updates it in place.
CREATE UNIQUE INDEX IF NOT EXISTS idx_apple_subs_user_id
  ON lg_apple_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS idx_apple_subs_rc_user
  ON lg_apple_subscriptions (revenuecat_user_id);
