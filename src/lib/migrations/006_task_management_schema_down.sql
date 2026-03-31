-- Rollback Migration 006: Task Management Module Schema
-- Run this to completely remove the task management system.
-- Order matters: drop dependent tables first.

-- Drop triggers first
DROP TRIGGER IF EXISTS trg_project_updated_at ON projects;
DROP TRIGGER IF EXISTS trg_task_updated_at ON tasks;
DROP TRIGGER IF EXISTS trg_single_done_column ON columns;
DROP TRIGGER IF EXISTS trg_activity_log_append_only ON activity_log;

-- Drop trigger functions
DROP FUNCTION IF EXISTS update_task_timestamp();
DROP FUNCTION IF EXISTS enforce_single_done_column();
DROP FUNCTION IF EXISTS prevent_activity_log_mutation();

-- Drop tables (reverse dependency order)
DROP TABLE IF EXISTS custom_field_definitions CASCADE;
DROP TABLE IF EXISTS saved_views CASCADE;
DROP TABLE IF EXISTS notification_preferences CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS webhook_event_log CASCADE;
DROP TABLE IF EXISTS webhook_configs CASCADE;
DROP TABLE IF EXISTS file_attachments CASCADE;
DROP TABLE IF EXISTS checklist_items CASCADE;
DROP TABLE IF EXISTS activity_log CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TABLE IF EXISTS task_tag_map CASCADE;
DROP TABLE IF EXISTS task_tags CASCADE;
DROP TABLE IF EXISTS task_assignees CASCADE;
DROP TABLE IF EXISTS tasks CASCADE;
DROP TABLE IF EXISTS columns CASCADE;
DROP TABLE IF EXISTS project_members CASCADE;
DROP TABLE IF EXISTS projects CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
