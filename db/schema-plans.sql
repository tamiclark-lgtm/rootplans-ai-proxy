-- Garden Plans — tracks each user's created plans for limit enforcement.
-- Run once after schema.sql and schema-apple.sql.

CREATE TABLE IF NOT EXISTS garden_plans (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES lg_users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL DEFAULT 'My Garden',
  is_archived BOOLEAN     NOT NULL DEFAULT FALSE,
  metadata    JSONB,          -- optional: zone, location, theme, etc.
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_garden_plans_user ON garden_plans (user_id);
CREATE INDEX IF NOT EXISTS idx_garden_plans_active
  ON garden_plans (user_id) WHERE is_archived = FALSE;
