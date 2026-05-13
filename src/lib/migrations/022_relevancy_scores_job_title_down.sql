-- Rollback for migration 022.
ALTER TABLE relevancy_scores DROP COLUMN IF EXISTS job_title;
ALTER TABLE relevancy_scores DROP COLUMN IF EXISTS job_url;
