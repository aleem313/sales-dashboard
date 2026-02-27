-- Phase 3: New columns for cyberpunk dashboard
-- NOTE: The dashboard works without these columns (queries use safe fallbacks).
-- Running this migration will enable full functionality (connects tracking, priority, etc.)

-- jobs table
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS connects_used INTEGER DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'low';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(100);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ;

-- profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS niche VARCHAR(50);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS connects_budget INTEGER DEFAULT 150;

-- agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS bonus_earned DECIMAL(10,2) DEFAULT 0;

-- Backfill: niche from stack
UPDATE profiles SET niche = stack WHERE niche IS NULL AND stack IS NOT NULL;

-- Backfill: stage_entered_at from updated_at
UPDATE jobs SET stage_entered_at = updated_at WHERE stage_entered_at IS NULL;

-- Backfill: priority from budget_max
UPDATE jobs SET priority = CASE
  WHEN budget_max >= 5000 THEN 'high'
  WHEN budget_max >= 1000 THEN 'medium'
  ELSE 'low'
END WHERE priority = 'low' AND budget_max IS NOT NULL;
