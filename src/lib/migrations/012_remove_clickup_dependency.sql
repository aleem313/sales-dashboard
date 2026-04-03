-- Migration 012: Remove ClickUp dependency
-- Renames clickup_status → status, adds task_id FK, makes clickup_user_id nullable
-- Idempotent — safe to re-run

-- 1. Rename clickup_status → status (skip if already renamed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'clickup_status'
  ) THEN
    ALTER TABLE jobs RENAME COLUMN clickup_status TO status;
  END IF;
END $$;

-- 2. Rename index
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_jobs_clickup_status') THEN
    ALTER INDEX idx_jobs_clickup_status RENAME TO idx_jobs_status;
  END IF;
END $$;

-- 3. Add task_id FK column
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_task_id ON jobs(task_id);

-- 4. Make clickup_user_id nullable (it may already be nullable)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'clickup_user_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE agents ALTER COLUMN clickup_user_id DROP NOT NULL;
  END IF;
END $$;
