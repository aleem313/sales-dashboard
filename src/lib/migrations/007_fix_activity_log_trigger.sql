-- Migration 007: Fix activity_log trigger
-- Problem: The append-only trigger blocks DELETE, preventing CASCADE deletes
--          from tasks and projects (board/task deletion fails).
-- Fix: Allow DELETE (needed for CASCADE), block only UPDATE (preserves audit integrity).
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION prevent_activity_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'activity_log is append-only: UPDATE operations are not allowed';
  END IF;
  -- Allow DELETE (needed for CASCADE from tasks/projects)
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Re-create trigger (idempotent via DROP IF EXISTS)
DROP TRIGGER IF EXISTS trg_activity_log_append_only ON activity_log;
CREATE TRIGGER trg_activity_log_append_only
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_activity_log_mutation();
