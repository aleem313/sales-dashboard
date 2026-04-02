import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

export async function GET(request: NextRequest) {
  // Protect with CRON_SECRET — supports header or query param
  const authHeader = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const migration = request.nextUrl.searchParams.get("v") || "006";

  if (migration !== "006" && migration !== "007" && migration !== "008" && migration !== "009" && migration !== "010") {
    return NextResponse.json({ error: "Unknown migration version" }, { status: 400 });
  }

  if (migration === "010") {
    return run010();
  }

  if (migration === "009") {
    return run009();
  }

  if (migration === "008") {
    return run008();
  }

  if (migration === "007") {
    return run007();
  }

  const results: string[] = [];

  try {
    // ---- Tables ----
    results.push("Creating tables...");

    await sql`CREATE TABLE IF NOT EXISTS workspaces (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, owner_id UUID NOT NULL REFERENCES agents(id), created_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ workspaces");

    await sql`CREATE TABLE IF NOT EXISTS projects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ projects");

    await sql`CREATE TABLE IF NOT EXISTS project_members (project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')), joined_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (project_id, agent_id))`;
    results.push("✓ project_members");

    await sql`CREATE TABLE IF NOT EXISTS columns (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, color VARCHAR(7) DEFAULT '#6b7280', is_done BOOLEAN DEFAULT false, wip_limit INTEGER, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE (project_id, name))`;
    results.push("✓ columns");

    await sql`CREATE TABLE IF NOT EXISTS tasks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, column_id UUID NOT NULL REFERENCES columns(id), title TEXT NOT NULL, description TEXT, priority TEXT CHECK (priority IN ('urgent', 'high', 'medium', 'low')), due_date TIMESTAMPTZ, start_date TIMESTAMPTZ, position INTEGER NOT NULL DEFAULT 0, creator_id UUID REFERENCES agents(id), custom_fields JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ tasks");

    await sql`CREATE TABLE IF NOT EXISTS task_assignees (task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE, PRIMARY KEY (task_id, agent_id))`;
    results.push("✓ task_assignees");

    await sql`CREATE TABLE IF NOT EXISTS task_tags (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, color VARCHAR(7) DEFAULT '#6b7280')`;
    results.push("✓ task_tags");

    await sql`CREATE TABLE IF NOT EXISTS task_tag_map (task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, tag_id UUID NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE, PRIMARY KEY (task_id, tag_id))`;
    results.push("✓ task_tag_map");

    await sql`CREATE TABLE IF NOT EXISTS comments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, author_id UUID NOT NULL REFERENCES agents(id), parent_id UUID REFERENCES comments(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ)`;
    results.push("✓ comments");

    await sql`CREATE TABLE IF NOT EXISTS activity_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, actor_id UUID REFERENCES agents(id), actor_label TEXT DEFAULT 'System', action_type TEXT NOT NULL, field TEXT, old_value TEXT, new_value TEXT, metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ activity_log");

    await sql`CREATE TABLE IF NOT EXISTS checklist_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL, is_checked BOOLEAN DEFAULT false, position INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ checklist_items");

    await sql`CREATE TABLE IF NOT EXISTS file_attachments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, filename TEXT NOT NULL, url TEXT NOT NULL, blob_path TEXT, size_bytes INTEGER, mime_type TEXT, thumbnail_url TEXT, uploader_id UUID REFERENCES agents(id), created_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ file_attachments");

    await sql`CREATE TABLE IF NOT EXISTS webhook_configs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, inbound_api_key_hash TEXT, field_map JSONB DEFAULT '{}', outbound_url TEXT, outbound_secret TEXT, outbound_events TEXT[] DEFAULT '{}', active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ webhook_configs");

    await sql`CREATE TABLE IF NOT EXISTS webhook_event_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')), event_type TEXT, status_code INTEGER, payload JSONB, error TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ webhook_event_log");

    await sql`CREATE TABLE IF NOT EXISTS notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT, link TEXT, read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ notifications");

    await sql`CREATE TABLE IF NOT EXISTS notification_preferences (user_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE, notification_type TEXT NOT NULL, in_app BOOLEAN DEFAULT true, email BOOLEAN DEFAULT true, PRIMARY KEY (user_id, notification_type))`;
    results.push("✓ notification_preferences");

    await sql`CREATE TABLE IF NOT EXISTS saved_views (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, owner_id UUID NOT NULL REFERENCES agents(id), name TEXT NOT NULL, filters JSONB DEFAULT '{}', sort JSONB DEFAULT '{}', shared BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ saved_views");

    await sql`CREATE TABLE IF NOT EXISTS custom_field_definitions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'dropdown', 'multi_select', 'date', 'boolean')), options JSONB, required BOOLEAN DEFAULT false, position INTEGER NOT NULL DEFAULT 0, archived BOOLEAN DEFAULT false, show_on_card BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`;
    results.push("✓ custom_field_definitions");

    // ---- Indexes ----
    results.push("Creating indexes...");
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
    results.push("✓ all indexes");

    // ---- Triggers ----
    results.push("Creating triggers...");

    await sql`CREATE OR REPLACE FUNCTION prevent_activity_log_mutation() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'activity_log is append-only'; RETURN NULL; END; $$ LANGUAGE plpgsql`;
    await sql`DROP TRIGGER IF EXISTS trg_activity_log_append_only ON activity_log`;
    await sql`CREATE TRIGGER trg_activity_log_append_only BEFORE UPDATE OR DELETE ON activity_log FOR EACH ROW EXECUTE FUNCTION prevent_activity_log_mutation()`;
    results.push("✓ activity_log append-only");

    await sql`CREATE OR REPLACE FUNCTION enforce_single_done_column() RETURNS TRIGGER AS $$ BEGIN IF NEW.is_done = true THEN IF EXISTS (SELECT 1 FROM columns WHERE project_id = NEW.project_id AND is_done = true AND id != NEW.id) THEN RAISE EXCEPTION 'Only one is_done column per project'; END IF; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`;
    await sql`DROP TRIGGER IF EXISTS trg_single_done_column ON columns`;
    await sql`CREATE TRIGGER trg_single_done_column BEFORE INSERT OR UPDATE OF is_done ON columns FOR EACH ROW EXECUTE FUNCTION enforce_single_done_column()`;
    results.push("✓ single done column");

    await sql`CREATE OR REPLACE FUNCTION update_task_timestamp() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql`;
    await sql`DROP TRIGGER IF EXISTS trg_task_updated_at ON tasks`;
    await sql`CREATE TRIGGER trg_task_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_task_timestamp()`;
    await sql`DROP TRIGGER IF EXISTS trg_project_updated_at ON projects`;
    await sql`CREATE TRIGGER trg_project_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_task_timestamp()`;
    results.push("✓ auto-update timestamps");

    // ---- Seed default workspace + project ----
    results.push("Seeding defaults...");

    const adminResult = await sql`SELECT id FROM agents WHERE role = 'admin' LIMIT 1`;
    if (adminResult.rows.length > 0) {
      const ownerId = adminResult.rows[0].id;

      const wsResult = await sql`INSERT INTO workspaces (name, slug, owner_id) VALUES ('Rising Lion', 'rising-lion', ${ownerId}) ON CONFLICT (slug) DO NOTHING RETURNING id`;
      let workspaceId: string;
      if (wsResult.rows.length > 0) {
        workspaceId = wsResult.rows[0].id;
      } else {
        const existing = await sql`SELECT id FROM workspaces WHERE slug = 'rising-lion'`;
        workspaceId = existing.rows[0].id;
      }

      const projResult = await sql`INSERT INTO projects (workspace_id, name, description) SELECT ${workspaceId}, 'Task Board', 'Default task management board' WHERE NOT EXISTS (SELECT 1 FROM projects WHERE workspace_id = ${workspaceId} AND name = 'Task Board') RETURNING id`;
      let projectId: string;
      if (projResult.rows.length > 0) {
        projectId = projResult.rows[0].id;
      } else {
        const existing = await sql`SELECT id FROM projects WHERE workspace_id = ${workspaceId} AND name = 'Task Board'`;
        projectId = existing.rows[0].id;
      }

      // Add all active agents as members
      const agents = await sql`SELECT id, role FROM agents WHERE active = true`;
      for (const agent of agents.rows) {
        await sql`INSERT INTO project_members (project_id, agent_id, role) VALUES (${projectId}, ${agent.id}, ${agent.role === 'admin' ? 'admin' : 'member'}) ON CONFLICT (project_id, agent_id) DO NOTHING`;
      }
      results.push(`✓ ${agents.rows.length} members added`);

      // Default columns
      const cols = [
        { name: 'To Do', pos: 1000, color: '#6b7280', done: false },
        { name: 'In Progress', pos: 2000, color: '#3b82f6', done: false },
        { name: 'In Review', pos: 3000, color: '#f59e0b', done: false },
        { name: 'Done', pos: 4000, color: '#22c55e', done: true },
      ];
      for (const c of cols) {
        await sql`INSERT INTO columns (project_id, name, position, color, is_done) SELECT ${projectId}, ${c.name}, ${c.pos}, ${c.color}, ${c.done} WHERE NOT EXISTS (SELECT 1 FROM columns WHERE project_id = ${projectId} AND name = ${c.name})`;
      }
      results.push("✓ default columns created");
    } else {
      results.push("⚠ No admin agent found — skipped seeding");
    }

    return NextResponse.json({
      success: true,
      migration: "006_task_management_schema",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "006_task_management_schema",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run009() {
  const results: string[] = [];

  try {
    results.push("Migration 009: Create default custom field definitions for n8n job data...");

    // Find the target project (same as migration 008)
    const targetProjectId = "351494d8-918e-475e-b16c-2eee3232aefe";
    const projectCheck = await sql`SELECT id FROM projects WHERE id = ${targetProjectId}`;
    let projectId: string;
    if (projectCheck.rows.length > 0) {
      projectId = targetProjectId;
    } else {
      const fallback = await sql`SELECT id FROM projects ORDER BY created_at ASC LIMIT 1`;
      if (fallback.rows.length === 0) {
        return NextResponse.json({
          success: false,
          migration: "009_custom_field_definitions",
          steps: [...results, "✗ No projects found"],
          error: "No projects exist",
        }, { status: 400 });
      }
      projectId = fallback.rows[0].id as string;
    }

    // Define all fields with stable IDs (deterministic UUIDs based on name)
    // Using a fixed prefix so they can be referenced by the webhook
    const fields = [
      // ── Job Details ──
      { name: "Job Link",     field_type: "text", position: 1,  show_on_card: false, group: "job" },
      { name: "Budget",       field_type: "text", position: 2,  show_on_card: true,  group: "job" },
      { name: "Skills",       field_type: "text", position: 3,  show_on_card: true,  group: "job" },
      { name: "Posted",       field_type: "text", position: 4,  show_on_card: false, group: "job" },
      // ── Client Info ──
      { name: "Location",     field_type: "text", position: 5,  show_on_card: false, group: "client" },
      { name: "Rating",       field_type: "text", position: 6,  show_on_card: false, group: "client" },
      { name: "Total Spent",  field_type: "text", position: 7,  show_on_card: false, group: "client" },
      { name: "Past Hires",   field_type: "text", position: 8,  show_on_card: false, group: "client" },
      // ── Routing Info ──
      { name: "Agent",        field_type: "text", position: 9,  show_on_card: true,  group: "routing" },
      { name: "Profile",      field_type: "text", position: 10, show_on_card: true,  group: "routing" },
      { name: "Stack",        field_type: "text", position: 11, show_on_card: false, group: "routing" },
      { name: "Job ID",       field_type: "text", position: 12, show_on_card: false, group: "routing" },
      { name: "Generated",    field_type: "text", position: 13, show_on_card: false, group: "routing" },
      // ── Connects ──
      { name: "Boosted Connects", field_type: "number", position: 14, show_on_card: false, group: "connects" },
      // ── Proposal ──
      { name: "Proposal",     field_type: "text", position: 15, show_on_card: false, group: "proposal" },
    ];

    const createdIds: Record<string, string> = {};

    for (const f of fields) {
      // Skip if field already exists for this project
      const existing = await sql`
        SELECT id FROM custom_field_definitions
        WHERE project_id = ${projectId} AND LOWER(name) = LOWER(${f.name})
        LIMIT 1
      `;
      if (existing.rows.length > 0) {
        createdIds[f.name] = existing.rows[0].id as string;
        results.push(`⊘ "${f.name}" already exists (${existing.rows[0].id})`);
        continue;
      }

      const inserted = await sql`
        INSERT INTO custom_field_definitions (project_id, name, field_type, position, show_on_card, required, archived)
        VALUES (${projectId}, ${f.name}, ${f.field_type}, ${f.position}, ${f.show_on_card}, false, false)
        RETURNING id
      `;
      createdIds[f.name] = inserted.rows[0].id as string;
      results.push(`✓ Created "${f.name}" (${inserted.rows[0].id})`);
    }

    // Log the field ID mapping for reference
    results.push("");
    results.push("Field ID mapping (use in webhook custom_fields):");
    for (const [name, id] of Object.entries(createdIds)) {
      results.push(`  ${name} → ${id}`);
    }

    return NextResponse.json({
      success: true,
      migration: "009_custom_field_definitions",
      steps: results,
      fieldIds: createdIds,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "009_custom_field_definitions",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run008() {
  const results: string[] = [];

  try {
    results.push("Migration 008: Add n8n board webhook config...");

    // SHA256('n8n-board-sync') = 454ed665bfe2f9dcd05093f13ec700bfce53fad6e9ead95b17823ae0c94c7504
    const tokenHash = "454ed665bfe2f9dcd05093f13ec700bfce53fad6e9ead95b17823ae0c94c7504";
    const targetProjectId = "351494d8-918e-475e-b16c-2eee3232aefe";

    // Verify project exists
    const projectCheck = await sql`SELECT id, name FROM projects WHERE id = ${targetProjectId}`;
    if (projectCheck.rows.length === 0) {
      // Fallback: use default project
      const fallback = await sql`SELECT id, name FROM projects ORDER BY created_at ASC LIMIT 1`;
      if (fallback.rows.length === 0) {
        return NextResponse.json({
          success: false,
          migration: "008_webhook_config",
          steps: [...results, "✗ No projects found"],
          error: "No projects exist in the database",
        }, { status: 400 });
      }
      const projectId = fallback.rows[0].id;
      const projectName = fallback.rows[0].name;

      await sql`
        INSERT INTO webhook_configs (project_id, inbound_api_key_hash, field_map, active)
        VALUES (${projectId}, ${tokenHash}, '{"source": "n8n"}', true)
        ON CONFLICT DO NOTHING
      `;
      results.push(`✓ Webhook config created for fallback project "${projectName}" (${projectId})`);
    } else {
      const projectName = projectCheck.rows[0].name;

      // Remove any existing config with same hash to avoid duplicates
      await sql`DELETE FROM webhook_configs WHERE inbound_api_key_hash = ${tokenHash}`;

      await sql`
        INSERT INTO webhook_configs (project_id, inbound_api_key_hash, field_map, active)
        VALUES (${targetProjectId}, ${tokenHash}, '{"source": "n8n"}', true)
      `;
      results.push(`✓ Webhook config created for project "${projectName}" (${targetProjectId})`);
    }

    results.push("✓ Bearer token: n8n-board-sync → SHA256 hash mapped to target project");

    return NextResponse.json({
      success: true,
      migration: "008_webhook_config",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "008_webhook_config",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run010() {
  const results: string[] = [];

  try {
    results.push("Migration 010: Add platform column to profiles...");

    await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'Upwork'`;
    results.push("✓ Added platform column");

    await sql`UPDATE profiles SET platform = 'Upwork' WHERE platform IS NULL`;
    results.push("✓ Backfilled existing profiles with 'Upwork'");

    return NextResponse.json({
      success: true,
      migration: "010_profile_platform",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "010_profile_platform",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run007() {
  const results: string[] = [];

  try {
    results.push("Migration 007: Fix activity_log trigger...");

    // Replace the trigger function: allow DELETE, block only UPDATE
    await sql`
      CREATE OR REPLACE FUNCTION prevent_activity_log_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          RAISE EXCEPTION 'activity_log is append-only: UPDATE operations are not allowed';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `;
    results.push("✓ Updated prevent_activity_log_mutation() — allows DELETE, blocks UPDATE");

    // Re-create trigger
    await sql`DROP TRIGGER IF EXISTS trg_activity_log_append_only ON activity_log`;
    await sql`
      CREATE TRIGGER trg_activity_log_append_only
        BEFORE UPDATE OR DELETE ON activity_log
        FOR EACH ROW
        EXECUTE FUNCTION prevent_activity_log_mutation()
    `;
    results.push("✓ Re-created trg_activity_log_append_only trigger");

    return NextResponse.json({
      success: true,
      migration: "007_fix_activity_log_trigger",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "007_fix_activity_log_trigger",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}
