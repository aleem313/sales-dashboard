-- Rollback for migration 023. Drops the partial index and removes 'agent_feedback'
-- from the override_type CHECK. DANGER: any existing rows with
-- override_type='agent_feedback' must be purged first or the new CHECK will fail.

DROP INDEX IF EXISTS idx_overrides_feedback_agent;
DROP INDEX IF EXISTS idx_feedback_unique_score_agent;

-- Purge agent_feedback rows so the restored CHECK can be applied.
DELETE FROM relevancy_overrides WHERE override_type = 'agent_feedback';

ALTER TABLE relevancy_overrides
  DROP CONSTRAINT IF EXISTS relevancy_overrides_override_type_check;

ALTER TABLE relevancy_overrides
  ADD CONSTRAINT relevancy_overrides_override_type_check
  CHECK (override_type IN ('agent_move', 'admin_audit'));
