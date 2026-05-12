import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET(request: NextRequest) {
  // Protect with CRON_SECRET — supports header or query param
  const authHeader = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const migration = request.nextUrl.searchParams.get("v") || "006";

  if (migration !== "006" && migration !== "007" && migration !== "008" && migration !== "009" && migration !== "010" && migration !== "011" && migration !== "012" && migration !== "013" && migration !== "014" && migration !== "015" && migration !== "016" && migration !== "017" && migration !== "018" && migration !== "019" && migration !== "020" && migration !== "migrate-tasks") {
    return NextResponse.json({ error: "Unknown migration version" }, { status: 400 });
  }

  if (migration === "migrate-tasks") {
    const sourceBoard = request.nextUrl.searchParams.get("from") || "e8442ebd-afd3-4217-99c4-e55ee20d4bfa";
    const destBoard = request.nextUrl.searchParams.get("to") || "351494d8-918e-475e-b16c-2eee3232aefe";
    return runMigrateTasks(sourceBoard, destBoard);
  }

  if (migration === "020") {
    return run020();
  }

  if (migration === "019") {
    return run019();
  }

  if (migration === "018") {
    return run018();
  }

  if (migration === "017") {
    return run017();
  }

  if (migration === "016") {
    return run016();
  }

  if (migration === "015") {
    return run015();
  }

  if (migration === "014") {
    return run014();
  }

  if (migration === "013") {
    return run013();
  }

  if (migration === "012") {
    return run012();
  }

  if (migration === "011") {
    return run011();
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

async function run011() {
  const results: string[] = [];

  try {
    results.push("Migration 011: Fix profile-to-agent assignments to match n8n flow...");

    // n8n source of truth (from "Process Job" node PROFILES map):
    //   Sana   → Mubashir
    //   Laiba  → Muqadass
    //   Khansa → Shayan
    //   Saim   → Shayan
    //   Shayan → Abu Bakher
    //   Craig  → Mubashir
    const mappings = [
      { profile: "Sana",   agent: "Mubashir" },
      { profile: "Craig",  agent: "Mubashir" },
      { profile: "Laiba",  agent: "Muqadass" },
      { profile: "Khansa", agent: "Shayan" },
      { profile: "Saim",   agent: "Shayan" },
      { profile: "Shayan", agent: "Abu Bakher" },
    ];

    for (const m of mappings) {
      const agentResult = await sql`SELECT id FROM agents WHERE LOWER(name) = LOWER(${m.agent}) LIMIT 1`;
      if (agentResult.rows.length === 0) {
        results.push(`⚠ Agent "${m.agent}" not found — skipped profile "${m.profile}"`);
        continue;
      }
      const agentId = agentResult.rows[0].id;

      const updateResult = await sql`
        UPDATE profiles SET agent_id = ${agentId}
        WHERE LOWER(profile_name) = LOWER(${m.profile})
      `;
      if (updateResult.rowCount && updateResult.rowCount > 0) {
        results.push(`✓ ${m.profile} → ${m.agent}`);
      } else {
        results.push(`⚠ Profile "${m.profile}" not found`);
      }
    }

    return NextResponse.json({
      success: true,
      migration: "011_fix_profile_assignments",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "011_fix_profile_assignments",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run020() {
  const results: string[] = [];

  try {
    results.push("Migration 020: Extend criteria_versions.reason_enum with 3 soft-signal labels...");

    // Idempotent guard: only append if the new labels are not already present.
    const updateResult = await sql`
      UPDATE criteria_versions
      SET reason_enum = reason_enum || ARRAY[
        'Client already conducting an interview',
        'Short term job checks',
        'Red flag'
      ]::TEXT[]
      WHERE version = '0.2'
        AND NOT (reason_enum @> ARRAY['Client already conducting an interview']::TEXT[])
      RETURNING version, array_length(reason_enum, 1) AS reason_count
    `;

    if (updateResult.rowCount === 0) {
      results.push("✓ Soft-signal labels already present — no-op (idempotent)");
    } else {
      results.push(`✓ Appended 3 labels — reason_enum is now ${updateResult.rows[0].reason_count} entries`);
    }

    // Sanity check.
    const verifyResult = await sql`
      SELECT array_length(reason_enum, 1) AS reason_count
      FROM criteria_versions
      WHERE version = '0.2'
      LIMIT 1
    `;
    if (verifyResult.rowCount && verifyResult.rows[0].reason_count === 16) {
      results.push("✓ Verified: 16 rejection reasons");
    } else {
      results.push(`⚠ Verification surprising — reason_count=${verifyResult.rows[0]?.reason_count} (expected 16)`);
    }

    return NextResponse.json({
      success: true,
      migration: "020_reason_enum_soft_signals",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "020_reason_enum_soft_signals",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run019() {
  const results: string[] = [];

  try {
    results.push("Migration 019: Seed criteria_versions with PRD v0.2...");

    const insertResult = await sql`
      INSERT INTO criteria_versions (
        version,
        prd_changelog,
        thresholds,
        reason_enum,
        output_schema,
        prompt_versions,
        effective_at
      ) VALUES (
        '0.2',
        '2026-05-05 v0.2 — Added §6.7 reject example library, §6.8 proceed example library, and §16 Appendix C LLM-ready JSON example library with gate annotations. Additive only — no edits to v0.1 §1–§13 content.',
        ${JSON.stringify({
          "1": { name: "stack_match", type: "qualitative", rule: "Job primary skill must be in assigned profile stack bucket", reason_on_fail: "Out of stack", input: "Vollna pre-filter + agent eyeball check" },
          "2": { name: "job_freshness", type: "numeric", threshold_hours: 24, comparator: "<=", reason_on_fail: "Old job", input: "_generated (Upwork posting timestamp)" },
          "3": { name: "proposal_saturation", type: "numeric", threshold_count: 30, comparator: "<", buckets_accepted: ["Less than 5", "5–10", "10–15"], reason_on_fail: "Too many invites", input: "Upwork Proposals indicator" },
          "4": { name: "hourly_rate_floor", type: "numeric", threshold_usd_per_hour: 25, comparator: ">=", applies_when: "budget_type == 'hourly'", reason_on_fail: "Low Higher rate", input: "_budget (parsed)" },
          "5": { name: "client_spend_floor", type: "numeric", threshold_usd_lifetime: 1000, comparator: ">=", reason_on_fail: "Client Low spending", input: "_client_spent" },
          "6": { name: "client_rating_floor", type: "numeric", threshold_rating: 4.0, comparator: ">=", absent_when_new_client_ok: true, reason_on_fail: "Bad rating client", input: "_client_rating" },
          "7": { name: "job_availability", type: "qualitative", rule: "Posting still open; not filled or closed", reason_on_fail: ["Job unavailable", "Already hired"], input: "Upwork posting status" },
          "8": { name: "no_location_lockin", type: "qualitative", rule: "Job does not require freelancer to be in US (or any country we cannot field)", reason_on_fail: "Location loc", input: "Job description (Upwork badge U.S. only)" },
          "9": { name: "no_video_proposal", type: "qualitative", rule: "Job description does not require a recorded video pitch", reason_on_fail: "Video Proposal", input: "Job description scan" },
          "10": { name: "portfolio_match", type: "qualitative", rule: "Profile has at least one portfolio item that maps to the job stack", reason_on_fail: "Portfolio unavailable", input: "Profile portfolio knowledge" },
          "11": { name: "no_duplicate", type: "lookup", rule: "_job_id is not already tracked across active boards in the last 30 days", window_days: 30, reason_on_fail: "Duplicate", input: "Internal _job_id lookup against relevancy_scores + tasks history" }
        })}::jsonb,
        ARRAY[
          'Out of stack',
          'Old job',
          'Too many invites',
          'Low Higher rate',
          'Location loc',
          'Client Low spending',
          'Job unavailable',
          'Already hired',
          'Language barrier',
          'Bad rating client',
          'Video Proposal',
          'Duplicate',
          'Portfolio unavailable'
        ]::TEXT[],
        NULL,
        NULL,
        '2026-05-05 00:00:00+00'::TIMESTAMPTZ
      )
      ON CONFLICT (version) DO NOTHING
      RETURNING version
    `;

    if (insertResult.rowCount === 0) {
      results.push("✓ criteria_versions v0.2 already present — no-op (idempotent)");
    } else {
      results.push("✓ criteria_versions v0.2 seeded");
    }

    // Sanity check the row.
    const verifyResult = await sql`
      SELECT version, array_length(reason_enum, 1) AS reason_count, jsonb_object_keys(thresholds) AS gate_id
      FROM criteria_versions
      WHERE version = '0.2'
      LIMIT 1
    `;
    if (verifyResult.rowCount && verifyResult.rows[0].reason_count === 13) {
      results.push(`✓ Verified: 13 rejection reasons, 11 hard gates`);
    } else {
      results.push(`⚠ Verification surprising — reason_count=${verifyResult.rows[0]?.reason_count}`);
    }

    return NextResponse.json({
      success: true,
      migration: "019_criteria_versions_v0_2_seed",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "019_criteria_versions_v0_2_seed",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run018() {
  const results: string[] = [];

  try {
    results.push("Migration 018: Upwork Relevancy Scoring AI — operator controls + scoring tables...");

    // 1. system_settings + seed defaults
    await sql`
      CREATE TABLE IF NOT EXISTS system_settings (
        key          TEXT PRIMARY KEY,
        value        JSONB NOT NULL,
        description  TEXT,
        updated_by   TEXT,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_system_settings_updated ON system_settings (updated_at DESC)`;
    results.push("✓ system_settings table + index ensured");

    await sql`
      INSERT INTO system_settings (key, value, description) VALUES
        ('relevancy.classifier_mode', '"shadow"'::jsonb,
         'Global classifier routing mode. shadow = score only, no routing. active = AI decision drives routing.'),
        ('relevancy.min_score', '50'::jsonb,
         'Global minimum total_score threshold. proceed verdicts with total_score < this value are flipped to reject when classifier_mode=active.')
      ON CONFLICT (key) DO NOTHING
    `;
    results.push("✓ system_settings seeded (classifier_mode=shadow, min_score=50)");

    // 2. Per-profile operator controls
    await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS thresholds_overrides JSONB DEFAULT '{}'::jsonb`;
    await sql`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS classifier_enabled BOOLEAN NOT NULL DEFAULT TRUE`;
    await sql`
      ALTER TABLE profiles ADD COLUMN IF NOT EXISTS min_score_override INTEGER
        CHECK (min_score_override IS NULL OR (min_score_override >= 0 AND min_score_override <= 100))
    `;
    results.push("✓ profiles columns added (thresholds_overrides, classifier_enabled, min_score_override)");

    // 3. criteria_versions (immutable PRD-version registry)
    await sql`
      CREATE TABLE IF NOT EXISTS criteria_versions (
        version          TEXT PRIMARY KEY,
        prd_changelog    TEXT NOT NULL,
        thresholds       JSONB NOT NULL,
        reason_enum      TEXT[] NOT NULL,
        output_schema    JSONB,
        prompt_versions  TEXT[],
        effective_at     TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    results.push("✓ criteria_versions table ensured (starts empty — Phase 4 seeds v0.2)");

    // 4. relevancy_scores
    await sql`
      CREATE TABLE IF NOT EXISTS relevancy_scores (
        id                          BIGSERIAL PRIMARY KEY,
        task_id                     UUID REFERENCES tasks(id) ON DELETE SET NULL,
        job_external_id             TEXT,
        profile_id                  TEXT REFERENCES profiles(profile_id),
        decision                    TEXT NOT NULL CHECK (decision IN ('proceed','reject','review')),
        effective_decision          TEXT NOT NULL CHECK (effective_decision IN ('proceed','reject','review')),
        threshold_flipped           BOOLEAN NOT NULL DEFAULT FALSE,
        min_score_at_decision       INTEGER CHECK (min_score_at_decision IS NULL OR (min_score_at_decision BETWEEN 0 AND 100)),
        classifier_mode_at_decision TEXT NOT NULL CHECK (classifier_mode_at_decision IN ('shadow','active')),
        snapshot_id                 UUID,
        rejection_reasons           TEXT[],
        gates_passed                INTEGER[] CHECK (gates_passed <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11]),
        gates_failed                INTEGER[] CHECK (gates_failed <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11]),
        gates_evidence              JSONB,
        components                  JSONB,
        total_score                 INTEGER,
        tier                        TEXT,
        confidence                  NUMERIC(4,3),
        confidence_warnings         TEXT[],
        proposal_angles             TEXT[],
        evidence_panel              JSONB,
        summary                     TEXT,
        missing_signals             TEXT[],
        thresholds_used             JSONB,
        model                       TEXT NOT NULL,
        prompt_version              TEXT NOT NULL,
        prompt_mode                 TEXT NOT NULL CHECK (prompt_mode IN ('A_full','B_edge')),
        criteria_version            TEXT NOT NULL REFERENCES criteria_versions(version),
        evaluation_path             TEXT NOT NULL CHECK (evaluation_path IN ('deterministic','llm','llm_after_deterministic','manual_url','shadow')),
        request_id                  UUID,
        source                      TEXT CHECK (source IN ('auto','manual_url')),
        requested_by                TEXT,
        input_tokens                INTEGER,
        output_tokens               INTEGER,
        latency_ms                  INTEGER,
        evaluated_at                TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_effective  ON relevancy_scores (effective_decision, evaluated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_flipped    ON relevancy_scores (threshold_flipped, evaluated_at DESC) WHERE threshold_flipped = TRUE`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_mode       ON relevancy_scores (classifier_mode_at_decision, evaluated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_snapshot   ON relevancy_scores (snapshot_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_task       ON relevancy_scores (task_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_profile    ON relevancy_scores (profile_id, evaluated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_decision   ON relevancy_scores (decision)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_evaluated  ON relevancy_scores (evaluated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_source     ON relevancy_scores (source, evaluated_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_request    ON relevancy_scores (request_id)`;
    results.push("✓ relevancy_scores table + 10 indexes ensured");

    // 5. relevancy_scores_dlq
    await sql`
      CREATE TABLE IF NOT EXISTS relevancy_scores_dlq (
        id              BIGSERIAL PRIMARY KEY,
        payload         JSONB NOT NULL,
        error_detail    TEXT NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at     TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_rs_dlq_pending ON relevancy_scores_dlq (next_attempt_at) WHERE resolved_at IS NULL`;
    results.push("✓ relevancy_scores_dlq table + partial index ensured");

    // 6. manual_job_evaluations
    await sql`
      CREATE TABLE IF NOT EXISTS manual_job_evaluations (
        id            BIGSERIAL PRIMARY KEY,
        task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        profile_id    TEXT NOT NULL REFERENCES profiles(profile_id),
        score_id      BIGINT REFERENCES relevancy_scores(id),
        requested_by  TEXT NOT NULL,
        load_status   TEXT CHECK (load_status IN ('success','partial','failed')),
        load_error    TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_mje_profile ON manual_job_evaluations (profile_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mje_task    ON manual_job_evaluations (task_id, created_at DESC)`;
    results.push("✓ manual_job_evaluations table + 2 indexes ensured");

    // 7. relevancy_overrides
    await sql`
      CREATE TABLE IF NOT EXISTS relevancy_overrides (
        id                  BIGSERIAL PRIMARY KEY,
        score_id            BIGINT NOT NULL REFERENCES relevancy_scores(id),
        task_id             UUID NOT NULL REFERENCES tasks(id),
        classifier_decision TEXT NOT NULL,
        agent_action        TEXT NOT NULL,
        agent_id            UUID REFERENCES agents(id),
        override_reason     TEXT[],
        source              TEXT CHECK (source IN ('auto','manual_url')),
        created_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_overrides_score ON relevancy_overrides (score_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_overrides_task  ON relevancy_overrides (task_id, created_at DESC)`;
    results.push("✓ relevancy_overrides table + 2 indexes ensured");

    // 8. idempotency_keys
    await sql`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key             TEXT PRIMARY KEY,
        response_status INTEGER NOT NULL,
        response_body   JSONB,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_idempotency_expires ON idempotency_keys (expires_at)`;
    results.push("✓ idempotency_keys table + index ensured");

    // 9. Bust stats cache
    const cacheWipe = await sql`DELETE FROM stats_cache`;
    results.push(`✓ Cleared stats_cache: ${cacheWipe.rowCount} rows removed`);

    return NextResponse.json({
      success: true,
      migration: "018_relevancy_scoring",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "018_relevancy_scoring",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run017() {
  const results: string[] = [];

  try {
    results.push("Migration 017: Create upwork_profile_snapshots table + view...");

    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    results.push("✓ pg_trgm extension ensured");

    await sql`
      CREATE TABLE IF NOT EXISTS upwork_profile_snapshots (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id          TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
        extracted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_current          BOOLEAN NOT NULL DEFAULT TRUE,
        name                TEXT,
        title               TEXT,
        hourly_rate         NUMERIC(10,2),
        rating              NUMERIC(3,2),
        job_success_score   INTEGER,
        top_rated_status    TEXT,
        total_jobs_worked   INTEGER,
        total_hours         NUMERIC(10,2),
        last_worked_on      DATE,
        profile_url         TEXT,
        ciphertext          TEXT,
        skills_summary      TEXT,
        data                JSONB NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    results.push("✓ upwork_profile_snapshots table created");

    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_upwork_snapshot_current_per_profile
        ON upwork_profile_snapshots(profile_id) WHERE is_current = TRUE
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_profile      ON upwork_profile_snapshots(profile_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_extracted_at ON upwork_profile_snapshots(extracted_at DESC)`;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_top_rated ON upwork_profile_snapshots(top_rated_status)
        WHERE is_current = TRUE
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_skills_trgm ON upwork_profile_snapshots
        USING GIN (skills_summary gin_trgm_ops) WHERE is_current = TRUE
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_upwork_snapshot_skills_jsonb ON upwork_profile_snapshots
        USING GIN ((data->'skills')) WHERE is_current = TRUE
    `;
    results.push("✓ indexes ensured (1 unique partial + 5 lookup)");

    await sql`
      CREATE OR REPLACE VIEW upwork_profile_snapshots_current AS
        SELECT * FROM upwork_profile_snapshots WHERE is_current = TRUE
    `;
    results.push("✓ upwork_profile_snapshots_current view ensured");

    const cacheWipe = await sql`DELETE FROM stats_cache`;
    results.push(`✓ Cleared stats_cache: ${cacheWipe.rowCount} rows removed`);

    return NextResponse.json({
      success: true,
      migration: "017_upwork_profile_snapshots",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "017_upwork_profile_snapshots",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run016() {
  const results: string[] = [];

  try {
    results.push("Migration 016: Create connects_purchases ledger...");

    await sql`
      CREATE TABLE IF NOT EXISTS connects_purchases (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id      TEXT NOT NULL REFERENCES profiles(profile_id) ON DELETE CASCADE,
        purchased_on    DATE NOT NULL,
        connects_count  INTEGER NOT NULL CHECK (connects_count > 0),
        amount_spent    NUMERIC(10,2) NOT NULL CHECK (amount_spent >= 0),
        notes           TEXT,
        created_by      UUID REFERENCES agents(id) ON DELETE SET NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    results.push("✓ connects_purchases table created");

    await sql`CREATE INDEX IF NOT EXISTS idx_connects_purchases_profile ON connects_purchases(profile_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_connects_purchases_purchased_on ON connects_purchases(purchased_on DESC)`;
    results.push("✓ indexes ensured");

    const cacheWipe = await sql`DELETE FROM stats_cache`;
    results.push(`✓ Cleared stats_cache: ${cacheWipe.rowCount} rows removed`);

    return NextResponse.json({
      success: true,
      migration: "016_connects_purchases",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "016_connects_purchases",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run015() {
  const results: string[] = [];

  try {
    results.push("Migration 015: Make stage_entered_at the canonical status-change filter timestamp...");

    // Step 1: Backfill NULL stage_entered_at from received_at.
    // Safe — only touches rows that have never had a status change recorded.
    const backfill = await sql`
      UPDATE jobs SET stage_entered_at = received_at
      WHERE stage_entered_at IS NULL
    `;
    results.push(`✓ Backfilled stage_entered_at from received_at: ${backfill.rowCount} rows`);

    // Step 2: Set DEFAULT NOW() so future INSERTs get a non-NULL value automatically.
    await sql`ALTER TABLE jobs ALTER COLUMN stage_entered_at SET DEFAULT NOW()`;
    results.push("✓ jobs.stage_entered_at default set to NOW()");

    // Step 3: Index for date-range filtering on status-change date.
    await sql`CREATE INDEX IF NOT EXISTS idx_jobs_stage_entered_at ON jobs (stage_entered_at DESC)`;
    results.push("✓ idx_jobs_stage_entered_at index ensured");

    // Step 4: Wipe stats_cache so the 5-min TTL doesn't serve stale-meaning data
    // immediately post-deploy. Cache repopulates on next request.
    const cacheWipe = await sql`DELETE FROM stats_cache`;
    results.push(`✓ Cleared stats_cache: ${cacheWipe.rowCount} rows removed`);

    return NextResponse.json({
      success: true,
      migration: "015_stage_entered_at_filter",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "015_stage_entered_at_filter",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run014() {
  const results: string[] = [];

  try {
    results.push("Migration 014: Extend lifecycle milestone columns (proposal_viewed_at, in_chat_at, meeting_done_at)...");

    // 1. Add columns
    for (const col of ["proposal_viewed_at", "in_chat_at", "meeting_done_at"] as const) {
      const exists = await sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'jobs' AND column_name = ${col}
      `;
      if (exists.rows.length === 0) {
        if (col === "proposal_viewed_at") {
          await sql`ALTER TABLE jobs ADD COLUMN proposal_viewed_at TIMESTAMPTZ`;
        } else if (col === "in_chat_at") {
          await sql`ALTER TABLE jobs ADD COLUMN in_chat_at TIMESTAMPTZ`;
        } else {
          await sql`ALTER TABLE jobs ADD COLUMN meeting_done_at TIMESTAMPTZ`;
        }
        results.push(`✓ Added ${col} column`);
      } else {
        results.push(`⊘ ${col} column already exists`);
      }
    }

    // 2. Backfill proposal_viewed_at from activity_log
    const bfViewedAL = await sql`
      UPDATE jobs j SET proposal_viewed_at = sub.first_viewed
      FROM (
        SELECT j2.id AS job_id, MIN(al.created_at) AS first_viewed
        FROM jobs j2
        JOIN tasks t ON (t.id = j2.task_id OR t.custom_fields->>'_job_id' = j2.job_id)
        JOIN activity_log al ON al.task_id = t.id
        WHERE al.action_type = 'task_moved'
          AND al.field = 'column'
          AND LOWER(al.new_value) IN ('proposal views', 'proposal viewed', 'viewed')
          AND j2.proposal_viewed_at IS NULL
        GROUP BY j2.id
      ) sub
      WHERE j.id = sub.job_id
    `;
    results.push(`✓ Backfill proposal_viewed_at from activity_log: ${bfViewedAL.rowCount} rows`);

    const bfViewedFB = await sql`
      UPDATE jobs SET proposal_viewed_at = COALESCE(stage_entered_at, updated_at)
      WHERE proposal_viewed_at IS NULL
        AND LOWER(status) IN (
          'proposal views', 'proposal viewed',
          'in chat', 'meeting scheduled', 'meeting done', 'negotiation', 'won', 'lost'
        )
    `;
    results.push(`✓ Backfill proposal_viewed_at fallback: ${bfViewedFB.rowCount} rows`);

    // 3. Backfill in_chat_at from activity_log
    const bfChatAL = await sql`
      UPDATE jobs j SET in_chat_at = sub.first_chat
      FROM (
        SELECT j2.id AS job_id, MIN(al.created_at) AS first_chat
        FROM jobs j2
        JOIN tasks t ON (t.id = j2.task_id OR t.custom_fields->>'_job_id' = j2.job_id)
        JOIN activity_log al ON al.task_id = t.id
        WHERE al.action_type = 'task_moved'
          AND al.field = 'column'
          AND LOWER(al.new_value) IN ('in chat', 'following up')
          AND j2.in_chat_at IS NULL
        GROUP BY j2.id
      ) sub
      WHERE j.id = sub.job_id
    `;
    results.push(`✓ Backfill in_chat_at from activity_log: ${bfChatAL.rowCount} rows`);

    const bfChatFB = await sql`
      UPDATE jobs SET in_chat_at = COALESCE(stage_entered_at, updated_at)
      WHERE in_chat_at IS NULL
        AND LOWER(status) IN ('in chat', 'meeting scheduled', 'meeting done', 'negotiation', 'won', 'lost')
    `;
    results.push(`✓ Backfill in_chat_at fallback: ${bfChatFB.rowCount} rows`);

    // 4. Backfill meeting_done_at from activity_log
    const bfDoneAL = await sql`
      UPDATE jobs j SET meeting_done_at = sub.first_done
      FROM (
        SELECT j2.id AS job_id, MIN(al.created_at) AS first_done
        FROM jobs j2
        JOIN tasks t ON (t.id = j2.task_id OR t.custom_fields->>'_job_id' = j2.job_id)
        JOIN activity_log al ON al.task_id = t.id
        WHERE al.action_type = 'task_moved'
          AND al.field = 'column'
          AND LOWER(al.new_value) = 'meeting done'
          AND j2.meeting_done_at IS NULL
        GROUP BY j2.id
      ) sub
      WHERE j.id = sub.job_id
    `;
    results.push(`✓ Backfill meeting_done_at from activity_log: ${bfDoneAL.rowCount} rows`);

    const bfDoneFB = await sql`
      UPDATE jobs SET meeting_done_at = COALESCE(stage_entered_at, updated_at)
      WHERE meeting_done_at IS NULL
        AND LOWER(status) IN ('meeting done', 'negotiation', 'won', 'lost')
    `;
    results.push(`✓ Backfill meeting_done_at fallback: ${bfDoneFB.rowCount} rows`);

    // 5. Partial indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_jobs_proposal_viewed_at ON jobs(proposal_viewed_at) WHERE proposal_viewed_at IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_jobs_in_chat_at         ON jobs(in_chat_at)         WHERE in_chat_at         IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_jobs_meeting_done_at    ON jobs(meeting_done_at)    WHERE meeting_done_at    IS NOT NULL`;
    results.push("✓ Partial indexes created");

    return NextResponse.json({
      success: true,
      migration: "014_lifecycle_milestones_ext",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "014_lifecycle_milestones_ext",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run013() {
  const results: string[] = [];

  try {
    results.push("Migration 013: Add lifecycle milestone columns...");

    // 1. Add meeting_booked_at column
    const colCheck = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'jobs' AND column_name = 'meeting_booked_at'
    `;
    if (colCheck.rows.length === 0) {
      await sql`ALTER TABLE jobs ADD COLUMN meeting_booked_at TIMESTAMPTZ`;
      results.push("✓ Added meeting_booked_at column");
    } else {
      results.push("⊘ meeting_booked_at column already exists");
    }

    // 2. Backfill meeting_booked_at from activity_log (first time task entered meeting column)
    const backfillAL = await sql`
      UPDATE jobs j SET meeting_booked_at = sub.first_meeting
      FROM (
        SELECT j2.id AS job_id, MIN(al.created_at) AS first_meeting
        FROM jobs j2
        JOIN tasks t ON (t.id = j2.task_id OR t.custom_fields->>'_job_id' = j2.job_id)
        JOIN activity_log al ON al.task_id = t.id
        WHERE al.action_type = 'task_moved'
          AND al.field = 'column'
          AND LOWER(al.new_value) IN ('meeting scheduled', 'meeting done')
          AND j2.meeting_booked_at IS NULL
        GROUP BY j2.id
      ) sub
      WHERE j.id = sub.job_id
    `;
    results.push(`✓ Backfilled meeting_booked_at from activity_log: ${backfillAL.rowCount} rows`);

    // 3. Fallback backfill: jobs currently in meeting statuses with no activity_log match
    const backfillFallback = await sql`
      UPDATE jobs SET meeting_booked_at = COALESCE(stage_entered_at, updated_at)
      WHERE meeting_booked_at IS NULL
        AND LOWER(status) IN ('meeting scheduled', 'meeting done')
    `;
    results.push(`✓ Backfill fallback (current meeting status): ${backfillFallback.rowCount} rows`);

    // 4. Backfill proposal_sent_at from activity_log (first time task entered proposal column)
    const backfillPSA_AL = await sql`
      UPDATE jobs j SET proposal_sent_at = sub.first_proposal
      FROM (
        SELECT j2.id AS job_id, MIN(al.created_at) AS first_proposal
        FROM jobs j2
        JOIN tasks t ON (t.id = j2.task_id OR t.custom_fields->>'_job_id' = j2.job_id)
        JOIN activity_log al ON al.task_id = t.id
        WHERE al.action_type = 'task_moved'
          AND al.field = 'column'
          AND LOWER(al.new_value) IN ('proposal submitted', 'sent', 'submitted')
          AND j2.proposal_sent_at IS NULL
        GROUP BY j2.id
      ) sub
      WHERE j.id = sub.job_id
    `;
    results.push(`✓ Backfill proposal_sent_at from activity_log: ${backfillPSA_AL.rowCount} rows`);

    // 5. Fallback backfill proposal_sent_at for post-sent statuses still missing it
    const backfillPSA = await sql`
      UPDATE jobs SET proposal_sent_at = COALESCE(stage_entered_at, updated_at)
      WHERE proposal_sent_at IS NULL
        AND LOWER(status) IN ('proposal submitted', 'sent', 'submitted', 'following up',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'meeting scheduled', 'meeting done', 'negotiation', 'won', 'lost')
    `;
    results.push(`✓ Backfill proposal_sent_at fallback (current status): ${backfillPSA.rowCount} rows`);

    // 6. Create partial indexes for milestone date-range queries
    await sql`CREATE INDEX IF NOT EXISTS idx_jobs_meeting_booked_at ON jobs(meeting_booked_at) WHERE meeting_booked_at IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_jobs_proposal_sent_at ON jobs(proposal_sent_at) WHERE proposal_sent_at IS NOT NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_jobs_outcome_at ON jobs(outcome_at) WHERE outcome_at IS NOT NULL`;
    results.push("✓ Partial indexes created");

    return NextResponse.json({
      success: true,
      migration: "013_lifecycle_milestones",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "013_lifecycle_milestones",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function run012() {
  const results: string[] = [];

  try {
    results.push("Migration 012: Remove ClickUp dependency...");

    // 1. Rename clickup_status → status (skip if already renamed)
    const colCheck = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'jobs' AND column_name = 'clickup_status'
    `;
    if (colCheck.rows.length > 0) {
      await sql`ALTER TABLE jobs RENAME COLUMN clickup_status TO status`;
      results.push("✓ Renamed clickup_status → status");
    } else {
      results.push("⊘ clickup_status already renamed to status");
    }

    // 2. Rename index
    const idxCheck = await sql`SELECT indexname FROM pg_indexes WHERE indexname = 'idx_jobs_clickup_status'`;
    if (idxCheck.rows.length > 0) {
      await sql`ALTER INDEX idx_jobs_clickup_status RENAME TO idx_jobs_status`;
      results.push("✓ Renamed index → idx_jobs_status");
    } else {
      results.push("⊘ Index already renamed or does not exist");
    }

    // 3. Add task_id FK column
    const taskIdCheck = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'jobs' AND column_name = 'task_id'
    `;
    if (taskIdCheck.rows.length === 0) {
      await sql`ALTER TABLE jobs ADD COLUMN task_id UUID REFERENCES tasks(id) ON DELETE SET NULL`;
      results.push("✓ Added task_id column with FK to tasks");
    } else {
      results.push("⊘ task_id column already exists");
    }
    await sql`CREATE INDEX IF NOT EXISTS idx_jobs_task_id ON jobs(task_id)`;
    results.push("✓ idx_jobs_task_id index ensured");

    // 4. Make clickup_user_id nullable
    const nullableCheck = await sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'agents' AND column_name = 'clickup_user_id'
    `;
    if (nullableCheck.rows.length > 0 && nullableCheck.rows[0].is_nullable === 'NO') {
      await sql`ALTER TABLE agents ALTER COLUMN clickup_user_id DROP NOT NULL`;
      results.push("✓ Made clickup_user_id nullable");
    } else {
      results.push("⊘ clickup_user_id already nullable or does not exist");
    }

    return NextResponse.json({
      success: true,
      migration: "012_remove_clickup_dependency",
      steps: results,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "012_remove_clickup_dependency",
      steps: results,
      error: (error as Error).message,
    }, { status: 500 });
  }
}

async function runMigrateTasks(sourceProjectId: string, destProjectId: string) {
  const log: string[] = [];
  let totalSource = 0;
  let moved = 0;
  let skipped = 0;
  let errors = 0;

  try {
    log.push(`Migrating tasks from ${sourceProjectId} → ${destProjectId}`);

    // 1. Verify both boards exist
    const srcCheck = await sql`SELECT id, name FROM projects WHERE id = ${sourceProjectId}`;
    const dstCheck = await sql`SELECT id, name FROM projects WHERE id = ${destProjectId}`;
    if (srcCheck.rows.length === 0) {
      return NextResponse.json({ success: false, error: "Source board not found" }, { status: 400 });
    }
    if (dstCheck.rows.length === 0) {
      return NextResponse.json({ success: false, error: "Destination board not found" }, { status: 400 });
    }
    log.push(`✓ Source: "${srcCheck.rows[0].name}" | Dest: "${dstCheck.rows[0].name}"`);

    // 2. Get destination columns (for mapping)
    const destCols = await sql`
      SELECT id, name, LOWER(TRIM(name)) AS norm_name, position, color, is_done
      FROM columns WHERE project_id = ${destProjectId} ORDER BY position
    `;
    const destColMap = new Map<string, { id: string; name: string }>();
    for (const c of destCols.rows) {
      destColMap.set(c.norm_name as string, { id: c.id as string, name: c.name as string });
    }
    log.push(`✓ Destination has ${destCols.rows.length} columns: ${destCols.rows.map(c => c.name).join(", ")}`);

    // 3. Get source columns
    const srcCols = await sql`
      SELECT id, name, LOWER(TRIM(name)) AS norm_name, position, color, is_done
      FROM columns WHERE project_id = ${sourceProjectId} ORDER BY position
    `;
    log.push(`✓ Source has ${srcCols.rows.length} columns: ${srcCols.rows.map(c => c.name).join(", ")}`);

    // 4. Create any missing columns in destination
    const colIdMap = new Map<string, string>(); // source col id → dest col id
    for (const sc of srcCols.rows) {
      const normName = sc.norm_name as string;
      if (destColMap.has(normName)) {
        colIdMap.set(sc.id as string, destColMap.get(normName)!.id);
      } else {
        // Create column in destination
        const maxPos = await sql`
          SELECT COALESCE(MAX(position), 0) AS mp FROM columns WHERE project_id = ${destProjectId}
        `;
        const newPos = (maxPos.rows[0].mp as number) + 1000;
        const newCol = await sql`
          INSERT INTO columns (project_id, name, position, color, is_done)
          VALUES (${destProjectId}, ${sc.name}, ${newPos}, ${sc.color}, ${sc.is_done})
          ON CONFLICT (project_id, name) DO NOTHING
          RETURNING id
        `;
        if (newCol.rows.length > 0) {
          colIdMap.set(sc.id as string, newCol.rows[0].id as string);
          log.push(`  + Created column "${sc.name}" in destination`);
        } else {
          // ON CONFLICT hit — fetch existing
          const existing = await sql`
            SELECT id FROM columns WHERE project_id = ${destProjectId} AND LOWER(TRIM(name)) = ${normName}
          `;
          colIdMap.set(sc.id as string, existing.rows[0].id as string);
        }
      }
    }

    // 5. Get all source tasks with their column names
    const srcTasks = await sql`
      SELECT t.*, c.name AS column_name
      FROM tasks t
      JOIN columns c ON c.id = t.column_id
      WHERE t.project_id = ${sourceProjectId}
      ORDER BY c.position, t.position
    `;
    totalSource = srcTasks.rows.length;
    log.push(`✓ Found ${totalSource} tasks in source board`);

    // 6. Get existing destination task titles (normalized) for dedup
    const destTasks = await sql`
      SELECT id, LOWER(TRIM(title)) AS norm_title FROM tasks WHERE project_id = ${destProjectId}
    `;
    const existingTitles = new Set<string>();
    for (const dt of destTasks.rows) {
      existingTitles.add(dt.norm_title as string);
    }
    log.push(`✓ Destination already has ${destTasks.rows.length} tasks`);

    // 7. Get destination tags for mapping
    const destTags = await sql`
      SELECT id, LOWER(TRIM(name)) AS norm_name, name, color
      FROM task_tags WHERE project_id = ${destProjectId}
    `;
    const destTagMap = new Map<string, string>(); // normalized name → dest tag id
    for (const t of destTags.rows) {
      destTagMap.set(t.norm_name as string, t.id as string);
    }

    // 8. Migrate each task
    for (const srcTask of srcTasks.rows) {
      const normTitle = (srcTask.title as string).toLowerCase().trim();

      // Skip empty/null titles
      if (!normTitle) {
        log.push(`  ⚠ Skipped task with empty title (id: ${srcTask.id})`);
        skipped++;
        continue;
      }

      // Skip duplicates
      if (existingTitles.has(normTitle)) {
        skipped++;
        continue;
      }

      try {
        // Resolve destination column
        const destColId = colIdMap.get(srcTask.column_id as string);
        if (!destColId) {
          log.push(`  ✗ No column mapping for task "${srcTask.title}" (col: ${srcTask.column_id})`);
          errors++;
          continue;
        }

        // 8a. Insert the task
        const newTask = await sql`
          INSERT INTO tasks (project_id, column_id, title, description, priority, due_date, start_date, position, creator_id, custom_fields)
          VALUES (
            ${destProjectId},
            ${destColId},
            ${srcTask.title},
            ${srcTask.description},
            ${srcTask.priority},
            ${srcTask.due_date},
            ${srcTask.start_date},
            ${srcTask.position},
            ${srcTask.creator_id},
            ${JSON.stringify(srcTask.custom_fields ?? {})}
          )
          RETURNING id
        `;
        const newTaskId = newTask.rows[0].id as string;

        // 8b. Copy assignees
        const assignees = await sql`SELECT agent_id FROM task_assignees WHERE task_id = ${srcTask.id}`;
        for (const a of assignees.rows) {
          await sql`
            INSERT INTO task_assignees (task_id, agent_id) VALUES (${newTaskId}, ${a.agent_id})
            ON CONFLICT DO NOTHING
          `;
        }

        // 8c. Copy tags (create in dest project if missing)
        const taskTags = await sql`
          SELECT tt.name, tt.color, LOWER(TRIM(tt.name)) AS norm_name
          FROM task_tag_map ttm
          JOIN task_tags tt ON tt.id = ttm.tag_id
          WHERE ttm.task_id = ${srcTask.id}
        `;
        for (const tag of taskTags.rows) {
          let destTagId = destTagMap.get(tag.norm_name as string);
          if (!destTagId) {
            const newTag = await sql`
              INSERT INTO task_tags (project_id, name, color)
              VALUES (${destProjectId}, ${tag.name}, ${tag.color})
              RETURNING id
            `;
            destTagId = newTag.rows[0].id as string;
            destTagMap.set(tag.norm_name as string, destTagId);
          }
          await sql`
            INSERT INTO task_tag_map (task_id, tag_id) VALUES (${newTaskId}, ${destTagId})
            ON CONFLICT DO NOTHING
          `;
        }

        // 8d. Copy comments (preserve threading)
        const comments = await sql`
          SELECT * FROM comments WHERE task_id = ${srcTask.id} ORDER BY created_at ASC
        `;
        const commentIdMap = new Map<string, string>(); // old id → new id
        for (const c of comments.rows) {
          const newParentId = c.parent_id ? (commentIdMap.get(c.parent_id as string) ?? null) : null;
          const newComment = await sql`
            INSERT INTO comments (task_id, author_id, parent_id, body, created_at, updated_at, deleted_at)
            VALUES (${newTaskId}, ${c.author_id}, ${newParentId}, ${c.body}, ${c.created_at}, ${c.updated_at}, ${c.deleted_at})
            RETURNING id
          `;
          commentIdMap.set(c.id as string, newComment.rows[0].id as string);
        }

        // 8e. Copy checklist items
        const checklist = await sql`
          SELECT * FROM checklist_items WHERE task_id = ${srcTask.id} ORDER BY position
        `;
        for (const ci of checklist.rows) {
          await sql`
            INSERT INTO checklist_items (task_id, title, is_checked, position)
            VALUES (${newTaskId}, ${ci.title}, ${ci.is_checked}, ${ci.position})
          `;
        }

        // 8f. Copy file attachments
        const attachments = await sql`
          SELECT * FROM file_attachments WHERE task_id = ${srcTask.id}
        `;
        for (const att of attachments.rows) {
          await sql`
            INSERT INTO file_attachments (task_id, filename, url, blob_path, size_bytes, mime_type, thumbnail_url, uploader_id)
            VALUES (${newTaskId}, ${att.filename}, ${att.url}, ${att.blob_path}, ${att.size_bytes}, ${att.mime_type}, ${att.thumbnail_url}, ${att.uploader_id})
          `;
        }

        // 8g. Log migration activity on new task
        await sql`
          INSERT INTO activity_log (task_id, actor_id, actor_label, action_type, field, old_value, new_value, metadata)
          VALUES (${newTaskId}, NULL, 'System', 'task_migrated', 'project', ${sourceProjectId}, ${destProjectId}, '{"source": "board-migration"}')
        `;

        // Mark title as seen
        existingTitles.add(normTitle);
        moved++;
      } catch (taskErr) {
        log.push(`  ✗ Failed: "${srcTask.title}" — ${(taskErr as Error).message}`);
        errors++;
      }
    }

    log.push("");
    log.push("═══ MIGRATION SUMMARY ═══");
    log.push(`Source board: ${srcCheck.rows[0].name} (${sourceProjectId})`);
    log.push(`Dest board:   ${dstCheck.rows[0].name} (${destProjectId})`);
    log.push(`Total in source: ${totalSource}`);
    log.push(`Moved:           ${moved}`);
    log.push(`Skipped (dupes): ${skipped}`);
    log.push(`Errors:          ${errors}`);

    return NextResponse.json({
      success: errors === 0,
      migration: "migrate-tasks",
      summary: { totalSource, moved, skipped, errors },
      steps: log,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      migration: "migrate-tasks",
      summary: { totalSource, moved, skipped, errors },
      steps: [...log, `FATAL: ${(error as Error).message}`],
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
