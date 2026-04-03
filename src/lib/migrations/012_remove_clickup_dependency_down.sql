-- Rollback Migration 012: Restore ClickUp dependency columns
-- Idempotent — safe to re-run

-- 1. Rename status → clickup_status
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'status'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'clickup_status'
  ) THEN
    ALTER TABLE jobs RENAME COLUMN status TO clickup_status;
  END IF;
END $$;

-- 2. Rename index back
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_jobs_status') THEN
    ALTER INDEX idx_jobs_status RENAME TO idx_jobs_clickup_status;
  END IF;
END $$;

-- 3. Drop task_id column and index
DROP INDEX IF EXISTS idx_jobs_task_id;
ALTER TABLE jobs DROP COLUMN IF EXISTS task_id;

-- 4. Restore clickup_user_id NOT NULL (only if all values are non-null)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM agents WHERE clickup_user_id IS NULL
  ) THEN
    ALTER TABLE agents ALTER COLUMN clickup_user_id SET NOT NULL;
  END IF;
END $$;
