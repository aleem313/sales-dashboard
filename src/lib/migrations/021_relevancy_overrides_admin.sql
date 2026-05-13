-- Migration 021: Extend relevancy_overrides to support admin audit-page overrides.
--
-- The existing table (migration 018) was modeled for AGENT taskboard moves:
--   • task_id NOT NULL  — admins reviewing rejects from /relevancy-audit have no task
--                         action; in Active mode the card never gets created.
--   • agent_action NOT NULL — phrased for taskboard column moves ('moved_to_na', etc.).
--   • agent_id UUID REFERENCES agents(id) — admins don't have rows in `agents`.
--
-- This migration adds:
--   • override_type ('agent_move' | 'admin_audit') — partitions the two flows.
--   • admin_id TEXT — session.user.id for admin overrides (no FK; admin auth is
--                     ADMIN_CREDENTIALS env-based, not a DB row).
--   • note TEXT — free-text calibration note from admin.
--
-- And relaxes:
--   • task_id  → nullable
--   • agent_action → nullable
--
-- Existing rows (none in prod as of 2026-05-13 — Phase 15 hasn't shipped) get
-- override_type='agent_move' from the column default. Idempotent — safe to re-run.

-- Add the three new columns. Default 'agent_move' so any existing rows keep
-- their semantics; new rows from /relevancy-audit set 'admin_audit' explicitly.
ALTER TABLE relevancy_overrides
  ADD COLUMN IF NOT EXISTS override_type TEXT NOT NULL DEFAULT 'agent_move'
    CHECK (override_type IN ('agent_move', 'admin_audit'));

ALTER TABLE relevancy_overrides
  ADD COLUMN IF NOT EXISTS admin_id TEXT;

ALTER TABLE relevancy_overrides
  ADD COLUMN IF NOT EXISTS note TEXT;

-- Relax NOT NULL constraints (admin overrides don't carry a task or agent action).
ALTER TABLE relevancy_overrides ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE relevancy_overrides ALTER COLUMN agent_action DROP NOT NULL;

-- Indexes: filter by type for audit-page queries; admin-scoped index for delete-own checks.
CREATE INDEX IF NOT EXISTS idx_overrides_type
  ON relevancy_overrides (override_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_overrides_admin
  ON relevancy_overrides (admin_id, created_at DESC)
  WHERE override_type = 'admin_audit';

-- Bust stats cache (matches the prior migrations' pattern, harmless if no row).
DELETE FROM stats_cache;
