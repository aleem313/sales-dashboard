-- Migration 006: Task Management Module Schema
-- Adds all tables required for the Kanban board / task management system.
-- Coexists with existing agents, profiles, jobs, sync_log, stats_cache, alerts tables.
-- The agents table is reused for user identity.

-- ============================================================
-- WORKSPACES — top-level organization containers
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT UNIQUE NOT NULL,
  owner_id    UUID NOT NULL REFERENCES agents(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROJECTS — Kanban boards within a workspace
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROJECT_MEMBERS — who has access to a project
-- ============================================================
CREATE TABLE IF NOT EXISTS project_members (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, agent_id)
);

-- ============================================================
-- COLUMNS — status columns within a project board
-- ============================================================
CREATE TABLE IF NOT EXISTS columns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  color       VARCHAR(7) DEFAULT '#6b7280',
  is_done     BOOLEAN DEFAULT false,
  wip_limit   INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, name)
);

-- ============================================================
-- TASKS — core task entity
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  column_id     UUID NOT NULL REFERENCES columns(id),
  title         TEXT NOT NULL,
  description   TEXT,
  priority      TEXT CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  due_date      TIMESTAMPTZ,
  start_date    TIMESTAMPTZ,
  position      INTEGER NOT NULL DEFAULT 0,
  creator_id    UUID REFERENCES agents(id),
  custom_fields JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TASK_ASSIGNEES — many-to-many tasks <-> agents
-- ============================================================
CREATE TABLE IF NOT EXISTS task_assignees (
  task_id   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id  UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, agent_id)
);

-- ============================================================
-- TASK_TAGS — tag definitions per project
-- ============================================================
CREATE TABLE IF NOT EXISTS task_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       VARCHAR(7) DEFAULT '#6b7280'
);

-- ============================================================
-- TASK_TAG_MAP — many-to-many tasks <-> tags
-- ============================================================
CREATE TABLE IF NOT EXISTS task_tag_map (
  task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id   UUID NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);

-- ============================================================
-- COMMENTS — task comments with 1-level threading
-- ============================================================
CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES agents(id),
  parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

-- ============================================================
-- ACTIVITY_LOG — append-only audit trail for task changes
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id     UUID REFERENCES agents(id),
  actor_label  TEXT DEFAULT 'System',
  action_type  TEXT NOT NULL,
  field        TEXT,
  old_value    TEXT,
  new_value    TEXT,
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CHECKLIST_ITEMS — sub-tasks within a task
-- ============================================================
CREATE TABLE IF NOT EXISTS checklist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  is_checked  BOOLEAN DEFAULT false,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FILE_ATTACHMENTS — files attached to tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS file_attachments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  url             TEXT NOT NULL,
  blob_path       TEXT,
  size_bytes      INTEGER,
  mime_type       TEXT,
  thumbnail_url   TEXT,
  uploader_id     UUID REFERENCES agents(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WEBHOOK_CONFIGS — n8n integration settings per project
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_configs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  inbound_api_key_hash  TEXT,
  field_map             JSONB DEFAULT '{}',
  outbound_url          TEXT,
  outbound_secret       TEXT,
  outbound_events       TEXT[] DEFAULT '{}',
  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- WEBHOOK_EVENT_LOG — inbound/outbound webhook event history
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_event_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  event_type  TEXT,
  status_code INTEGER,
  payload     JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS — in-app notifications for users
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  read        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATION_PREFERENCES — per-user per-type settings
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id           UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  in_app            BOOLEAN DEFAULT true,
  email             BOOLEAN DEFAULT true,
  PRIMARY KEY (user_id, notification_type)
);

-- ============================================================
-- SAVED_VIEWS — named filter/sort presets
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES agents(id),
  name        TEXT NOT NULL,
  filters     JSONB DEFAULT '{}',
  sort        JSONB DEFAULT '{}',
  shared      BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CUSTOM_FIELD_DEFINITIONS — per-project custom field schemas
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  field_type    TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'dropdown', 'multi_select', 'date', 'boolean')),
  options       JSONB,
  required      BOOLEAN DEFAULT false,
  position      INTEGER NOT NULL DEFAULT 0,
  archived      BOOLEAN DEFAULT false,
  show_on_card  BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Tasks
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_column_position ON tasks(column_id, position);
CREATE INDEX IF NOT EXISTS idx_tasks_custom_fields ON tasks USING GIN (custom_fields);
CREATE INDEX IF NOT EXISTS idx_tasks_creator_id ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE due_date IS NOT NULL;

-- Activity log
CREATE INDEX IF NOT EXISTS idx_activity_log_task ON activity_log(task_id, created_at DESC);

-- Comments
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- Columns
CREATE INDEX IF NOT EXISTS idx_columns_project_position ON columns(project_id, position);

-- Checklist items
CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id, position);

-- File attachments
CREATE INDEX IF NOT EXISTS idx_attachments_task ON file_attachments(task_id);

-- Webhook event log
CREATE INDEX IF NOT EXISTS idx_webhook_events_project ON webhook_event_log(project_id, created_at DESC);

-- Saved views
CREATE INDEX IF NOT EXISTS idx_saved_views_project ON saved_views(project_id);

-- Custom field definitions
CREATE INDEX IF NOT EXISTS idx_custom_fields_project ON custom_field_definitions(project_id, position);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Enforce append-only on activity_log (prevent updates and deletes)
CREATE OR REPLACE FUNCTION prevent_activity_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'activity_log is append-only: % operations are not allowed', TG_OP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_activity_log_append_only ON activity_log;
CREATE TRIGGER trg_activity_log_append_only
  BEFORE UPDATE OR DELETE ON activity_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_activity_log_mutation();

-- Enforce only one is_done column per project
CREATE OR REPLACE FUNCTION enforce_single_done_column()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_done = true THEN
    IF EXISTS (
      SELECT 1 FROM columns
      WHERE project_id = NEW.project_id AND is_done = true AND id != NEW.id
    ) THEN
      RAISE EXCEPTION 'Only one column per project can be marked as done';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_single_done_column ON columns;
CREATE TRIGGER trg_single_done_column
  BEFORE INSERT OR UPDATE OF is_done ON columns
  FOR EACH ROW
  EXECUTE FUNCTION enforce_single_done_column();

-- Auto-update updated_at on tasks
CREATE OR REPLACE FUNCTION update_task_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_updated_at ON tasks;
CREATE TRIGGER trg_task_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_task_timestamp();

-- Auto-update updated_at on projects
DROP TRIGGER IF EXISTS trg_project_updated_at ON projects;
CREATE TRIGGER trg_project_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_task_timestamp();
