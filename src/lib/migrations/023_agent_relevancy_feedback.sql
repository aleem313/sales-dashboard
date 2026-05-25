-- Migration 023: Allow override_type='agent_feedback' on relevancy_overrides.
--
-- Background: migration 021 added override_type to partition agent_move (taskboard
-- column moves) from admin_audit (admin marking wrong rejects on /relevancy-audit).
-- A third use case has emerged 2026-05-22: agents flagging specific reasons inside
-- the AI Relevancy panel of a task card as wrong, with optional free-text comment.
-- These rows must be DISTINGUISHABLE from agent_move (which is auto-generated when
-- agents drag a card to a stage that contradicts the classifier) — they are
-- explicitly user-authored signal for criteria-keeper calibration.
--
-- This migration:
--   • Drops the old CHECK ('agent_move','admin_audit') and recreates it with
--     'agent_feedback' added (Postgres has no ALTER CONSTRAINT — drop+add).
--   • Adds a partial index for the common admin-review query: list latest
--     agent_feedback rows joined with tasks + agents, sorted newest first.
--
-- The existing override_reason TEXT[] column (added in migration 018) is reused
-- to store the list of LLM-emitted reasons the agent flagged as wrong. The note
-- column (added in 021) is reused for the agent's free-text comment.
--
-- Idempotent — re-running this migration is safe (drops constraint with IF EXISTS,
-- index uses IF NOT EXISTS).

ALTER TABLE relevancy_overrides
  DROP CONSTRAINT IF EXISTS relevancy_overrides_override_type_check;

ALTER TABLE relevancy_overrides
  ADD CONSTRAINT relevancy_overrides_override_type_check
  CHECK (override_type IN ('agent_move', 'admin_audit', 'agent_feedback'));

-- Partial index for admin review surface: list newest agent_feedback rows.
CREATE INDEX IF NOT EXISTS idx_overrides_feedback_agent
  ON relevancy_overrides (agent_id, created_at DESC)
  WHERE override_type = 'agent_feedback';

-- Race-safety: prevent two agent_feedback rows for the same (score, agent).
-- Application code does check-then-insert, which is racey under concurrent
-- POSTs; this index turns the race into a unique_violation that the API can
-- map back to the already_flagged 409 response.
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_unique_score_agent
  ON relevancy_overrides (score_id, agent_id)
  WHERE override_type = 'agent_feedback';

-- Housekeeping consistent with prior migrations.
DELETE FROM stats_cache;
