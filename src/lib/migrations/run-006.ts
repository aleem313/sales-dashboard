import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "@/lib/db";

async function run() {
  console.log("Running migration 006: task management schema...\n");

  // ---- WORKSPACES ----
  console.log("Creating workspaces table...");
  await sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      slug        TEXT UNIQUE NOT NULL,
      owner_id    UUID NOT NULL REFERENCES agents(id),
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("  ✓ workspaces");

  // ---- PROJECTS ----
  console.log("Creating projects table...");
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      description   TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("  ✓ projects");

  // ---- PROJECT_MEMBERS ----
  console.log("Creating project_members table...");
  await sql`
    CREATE TABLE IF NOT EXISTS project_members (
      project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      joined_at   TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (project_id, agent_id)
    )
  `;
  console.log("  ✓ project_members");

  // ---- COLUMNS ----
  console.log("Creating columns table...");
  await sql`
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
    )
  `;
  console.log("  ✓ columns");

  // ---- TASKS ----
  console.log("Creating tasks table...");
  await sql`
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
    )
  `;
  console.log("  ✓ tasks");

  // ---- TASK_ASSIGNEES ----
  console.log("Creating task_assignees table...");
  await sql`
    CREATE TABLE IF NOT EXISTS task_assignees (
      task_id   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id  UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, agent_id)
    )
  `;
  console.log("  ✓ task_assignees");

  // ---- TASK_TAGS ----
  console.log("Creating task_tags table...");
  await sql`
    CREATE TABLE IF NOT EXISTS task_tags (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      color       VARCHAR(7) DEFAULT '#6b7280'
    )
  `;
  console.log("  ✓ task_tags");

  // ---- TASK_TAG_MAP ----
  console.log("Creating task_tag_map table...");
  await sql`
    CREATE TABLE IF NOT EXISTS task_tag_map (
      task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      tag_id   UUID NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, tag_id)
    )
  `;
  console.log("  ✓ task_tag_map");

  // ---- COMMENTS ----
  console.log("Creating comments table...");
  await sql`
    CREATE TABLE IF NOT EXISTS comments (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author_id   UUID NOT NULL REFERENCES agents(id),
      parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,
      body        TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW(),
      deleted_at  TIMESTAMPTZ
    )
  `;
  console.log("  ✓ comments");

  // ---- ACTIVITY_LOG ----
  console.log("Creating activity_log table...");
  await sql`
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
    )
  `;
  console.log("  ✓ activity_log");

  // ---- CHECKLIST_ITEMS ----
  console.log("Creating checklist_items table...");
  await sql`
    CREATE TABLE IF NOT EXISTS checklist_items (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      is_checked  BOOLEAN DEFAULT false,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("  ✓ checklist_items");

  // ---- FILE_ATTACHMENTS ----
  console.log("Creating file_attachments table...");
  await sql`
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
    )
  `;
  console.log("  ✓ file_attachments");

  // ---- WEBHOOK_CONFIGS ----
  console.log("Creating webhook_configs table...");
  await sql`
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
    )
  `;
  console.log("  ✓ webhook_configs");

  // ---- WEBHOOK_EVENT_LOG ----
  console.log("Creating webhook_event_log table...");
  await sql`
    CREATE TABLE IF NOT EXISTS webhook_event_log (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      direction   TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      event_type  TEXT,
      status_code INTEGER,
      payload     JSONB,
      error       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("  ✓ webhook_event_log");

  // ---- NOTIFICATIONS ----
  console.log("Creating notifications table...");
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT,
      link        TEXT,
      read        BOOLEAN DEFAULT false,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("  ✓ notifications");

  // ---- NOTIFICATION_PREFERENCES ----
  console.log("Creating notification_preferences table...");
  await sql`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id           UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      notification_type TEXT NOT NULL,
      in_app            BOOLEAN DEFAULT true,
      email             BOOLEAN DEFAULT true,
      PRIMARY KEY (user_id, notification_type)
    )
  `;
  console.log("  ✓ notification_preferences");

  // ---- SAVED_VIEWS ----
  console.log("Creating saved_views table...");
  await sql`
    CREATE TABLE IF NOT EXISTS saved_views (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      owner_id    UUID NOT NULL REFERENCES agents(id),
      name        TEXT NOT NULL,
      filters     JSONB DEFAULT '{}',
      sort        JSONB DEFAULT '{}',
      shared      BOOLEAN DEFAULT false,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log("  ✓ saved_views");

  // ---- CUSTOM_FIELD_DEFINITIONS ----
  console.log("Creating custom_field_definitions table...");
  await sql`
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
    )
  `;
  console.log("  ✓ custom_field_definitions");

  // ---- INDEXES ----
  console.log("\nCreating indexes...");

  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_column_position ON tasks(column_id, position)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_custom_fields ON tasks USING GIN (custom_fields)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_creator_id ON tasks(creator_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE due_date IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS idx_activity_log_task ON activity_log(task_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_columns_project_position ON columns(project_id, position)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_checklist_task ON checklist_items(task_id, position)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_attachments_task ON file_attachments(task_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_webhook_events_project ON webhook_event_log(project_id, created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_saved_views_project ON saved_views(project_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_custom_fields_project ON custom_field_definitions(project_id, position)`;
  console.log("  ✓ all indexes created");

  // ---- TRIGGERS ----
  console.log("\nCreating triggers...");

  // Append-only activity_log
  await sql`
    CREATE OR REPLACE FUNCTION prevent_activity_log_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'activity_log is append-only: % operations are not allowed', TG_OP;
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`DROP TRIGGER IF EXISTS trg_activity_log_append_only ON activity_log`;
  await sql`
    CREATE TRIGGER trg_activity_log_append_only
      BEFORE UPDATE OR DELETE ON activity_log
      FOR EACH ROW
      EXECUTE FUNCTION prevent_activity_log_mutation()
  `;
  console.log("  ✓ activity_log append-only trigger");

  // Single is_done column per project
  await sql`
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
    $$ LANGUAGE plpgsql
  `;
  await sql`DROP TRIGGER IF EXISTS trg_single_done_column ON columns`;
  await sql`
    CREATE TRIGGER trg_single_done_column
      BEFORE INSERT OR UPDATE OF is_done ON columns
      FOR EACH ROW
      EXECUTE FUNCTION enforce_single_done_column()
  `;
  console.log("  ✓ single done column trigger");

  // Auto-update updated_at on tasks and projects
  await sql`
    CREATE OR REPLACE FUNCTION update_task_timestamp()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;
  await sql`DROP TRIGGER IF EXISTS trg_task_updated_at ON tasks`;
  await sql`
    CREATE TRIGGER trg_task_updated_at
      BEFORE UPDATE ON tasks
      FOR EACH ROW
      EXECUTE FUNCTION update_task_timestamp()
  `;
  await sql`DROP TRIGGER IF EXISTS trg_project_updated_at ON projects`;
  await sql`
    CREATE TRIGGER trg_project_updated_at
      BEFORE UPDATE ON projects
      FOR EACH ROW
      EXECUTE FUNCTION update_task_timestamp()
  `;
  console.log("  ✓ auto-update timestamps triggers");

  // ---- SEED DEFAULT WORKSPACE & PROJECT ----
  console.log("\nSeeding default workspace and project...");

  // Get first admin agent to be the owner
  const adminResult = await sql`
    SELECT id FROM agents WHERE role = 'admin' LIMIT 1
  `;

  if (adminResult.rows.length > 0) {
    const ownerId = adminResult.rows[0].id;

    // Create default workspace if not exists
    const wsResult = await sql`
      INSERT INTO workspaces (name, slug, owner_id)
      VALUES ('Rising Lion', 'rising-lion', ${ownerId})
      ON CONFLICT (slug) DO NOTHING
      RETURNING id
    `;

    let workspaceId: string;
    if (wsResult.rows.length > 0) {
      workspaceId = wsResult.rows[0].id;
    } else {
      const existing = await sql`SELECT id FROM workspaces WHERE slug = 'rising-lion'`;
      workspaceId = existing.rows[0].id;
    }

    // Create default project if not exists
    const projResult = await sql`
      INSERT INTO projects (workspace_id, name, description)
      SELECT ${workspaceId}, 'Task Board', 'Default task management board'
      WHERE NOT EXISTS (
        SELECT 1 FROM projects WHERE workspace_id = ${workspaceId} AND name = 'Task Board'
      )
      RETURNING id
    `;

    let projectId: string;
    if (projResult.rows.length > 0) {
      projectId = projResult.rows[0].id;
    } else {
      const existing = await sql`
        SELECT id FROM projects WHERE workspace_id = ${workspaceId} AND name = 'Task Board'
      `;
      projectId = existing.rows[0].id;
    }

    // Add all agents as project members
    const agents = await sql`SELECT id, role FROM agents WHERE active = true`;
    for (const agent of agents.rows) {
      await sql`
        INSERT INTO project_members (project_id, agent_id, role)
        VALUES (${projectId}, ${agent.id}, ${agent.role === 'admin' ? 'admin' : 'member'})
        ON CONFLICT (project_id, agent_id) DO NOTHING
      `;
    }
    console.log(`  ✓ added ${agents.rows.length} members to default project`);

    // Create default columns
    const defaultColumns = [
      { name: 'To Do', position: 1000, color: '#6b7280', is_done: false },
      { name: 'In Progress', position: 2000, color: '#3b82f6', is_done: false },
      { name: 'In Review', position: 3000, color: '#f59e0b', is_done: false },
      { name: 'Done', position: 4000, color: '#22c55e', is_done: true },
    ];

    for (const col of defaultColumns) {
      await sql`
        INSERT INTO columns (project_id, name, position, color, is_done)
        SELECT ${projectId}, ${col.name}, ${col.position}, ${col.color}, ${col.is_done}
        WHERE NOT EXISTS (
          SELECT 1 FROM columns WHERE project_id = ${projectId} AND name = ${col.name}
        )
      `;
    }
    console.log("  ✓ default columns created (To Do, In Progress, In Review, Done)");
  } else {
    console.log("  ⚠ No admin agent found — skipping seed data");
  }

  console.log("\n✓ Migration 006 complete!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
