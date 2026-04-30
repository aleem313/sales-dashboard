-- Migration 016: Per-profile connects purchase log.
-- Adds a write-once-per-purchase ledger so /connects and /my-connects can show
-- "X used / Y total" where Y is SUM(connects_count) of recorded purchases for
-- that profile, instead of the static 150 fallback in profiles.connects_budget.
--
-- profiles.connects_budget is NOT dropped — kept as legacy (never read or written
-- after this migration; documented in CLAUDE.md as unused).

CREATE TABLE IF NOT EXISTS connects_purchases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
  purchased_on    DATE NOT NULL,
  connects_count  INTEGER NOT NULL CHECK (connects_count > 0),
  amount_spent    NUMERIC(10,2) NOT NULL CHECK (amount_spent >= 0),
  notes           TEXT,
  created_by      UUID REFERENCES agents(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connects_purchases_profile      ON connects_purchases(profile_id);
CREATE INDEX IF NOT EXISTS idx_connects_purchases_purchased_on ON connects_purchases(purchased_on DESC);

-- Bust stats cache so the connects page recomputes immediately post-deploy.
DELETE FROM stats_cache;
