-- RootPlans promo codes table
-- Run this in your Neon SQL console.

CREATE TABLE IF NOT EXISTS rp_promo_codes (
  code          TEXT        PRIMARY KEY,
  max_uses      INTEGER     DEFAULT NULL,   -- NULL = unlimited uses
  uses_count    INTEGER     DEFAULT 0,
  expires_at    TIMESTAMPTZ DEFAULT NULL,   -- NULL = never expires
  duration_days INTEGER     DEFAULT 365,    -- days of premium access granted
  note          TEXT        DEFAULT NULL,   -- internal label (e.g. "influencer promo")
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Example: insert a code
-- INSERT INTO rp_promo_codes (code, max_uses, duration_days, note)
-- VALUES ('ROOTPLANS2025', 100, 365, 'Launch promo — 1 year free');
