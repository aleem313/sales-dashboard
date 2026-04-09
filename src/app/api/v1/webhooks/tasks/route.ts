import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import crypto from "crypto";
import {
  createTask,
  getProjectColumns,
  getDefaultProject,
} from "@/lib/task-data";

export async function POST(request: NextRequest) {
  // Bearer token auth — verify against webhook_configs.inbound_api_key_hash
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing Bearer token" }, { status: 401 });
  }

  const token = authHeader.slice(7);

  // Find a matching webhook config by checking bcrypt hash
  // For simplicity, we hash with SHA256 and compare (bcrypt would require an extra dependency)
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const configResult = await sql`
    SELECT wc.*, p.id AS proj_id
    FROM webhook_configs wc
    JOIN projects p ON p.id = wc.project_id
    WHERE wc.inbound_api_key_hash = ${tokenHash} AND wc.active = true
    LIMIT 1
  `;

  let projectId: string;

  if (configResult.rows.length > 0) {
    projectId = configResult.rows[0].proj_id as string;
  } else {
    // Fallback: use default project if no webhook config matches
    // This allows the webhook to work before configs are set up
    const defaultProject = await getDefaultProject();
    if (!defaultProject) {
      return NextResponse.json({ error: "Invalid API key and no default project" }, { status: 401 });
    }
    projectId = defaultProject.id;
  }

  // Idempotency check
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) {
    const existing = await sql`
      SELECT data FROM stats_cache
      WHERE cache_key = ${"webhook_idempotency_" + idempotencyKey}
        AND expires_at > NOW()
    `;
    if (existing.rows.length > 0) {
      return NextResponse.json(existing.rows[0].data, { status: 200 });
    }
  }

  const body = await request.json();

  // Validate required fields
  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    await logWebhookEvent(projectId, "inbound", "task_create", 422, body, "Missing title");
    return NextResponse.json({ error: "title is required" }, { status: 422 });
  }

  // Resolve column_id
  let columnId = body.column_id;
  if (!columnId) {
    const columns = await getProjectColumns(projectId);
    if (columns.length === 0) {
      await logWebhookEvent(projectId, "inbound", "task_create", 422, body, "No columns in project");
      return NextResponse.json({ error: "Project has no columns" }, { status: 422 });
    }
    columnId = columns[0].id;
  }

  // Validate priority
  const validPriorities = ["urgent", "high", "medium", "low"];
  if (body.priority && !validPriorities.includes(body.priority)) {
    await logWebhookEvent(projectId, "inbound", "task_create", 422, body, "Invalid priority");
    return NextResponse.json(
      { error: "Invalid priority. Must be: urgent, high, medium, low" },
      { status: 422 }
    );
  }

  // --- Auto-assign agent by name from custom_fields ---
  let assigneeIds: string[] = body.assignee_ids ?? [];
  const cf = body.custom_fields ?? {};
  const agentName = cf._assigned_agent as string | undefined;

  if (agentName && assigneeIds.length === 0) {
    const agentResult = await sql`
      SELECT a.id FROM agents a
      INNER JOIN project_members pm ON pm.agent_id = a.id AND pm.project_id = ${projectId}
      WHERE LOWER(a.name) = LOWER(${agentName}) AND a.active = true
      LIMIT 1
    `;
    if (agentResult.rows.length > 0) {
      assigneeIds = [agentResult.rows[0].id as string];
    }
  }

  // --- Auto-set due_date (24h from now) if not provided ---
  let dueDate = body.due_date ?? null;
  if (!dueDate && cf._source === "n8n") {
    dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }

  // --- Auto-create/find tags from profile_name + 'vollna-auto' ---
  let tagIds: string[] = body.tag_ids ?? [];
  if (tagIds.length === 0 && cf._source === "n8n") {
    const tagNames: string[] = [];
    if (cf._profile_name) tagNames.push(String(cf._profile_name));
    tagNames.push("vollna-auto");

    for (const tagName of tagNames) {
      // Find or create tag
      const existingTag = await sql`
        SELECT id FROM task_tags
        WHERE project_id = ${projectId} AND LOWER(name) = LOWER(${tagName})
        LIMIT 1
      `;
      if (existingTag.rows.length > 0) {
        tagIds.push(existingTag.rows[0].id as string);
      } else {
        const newTag = await sql`
          INSERT INTO task_tags (project_id, name, color)
          VALUES (${projectId}, ${tagName}, ${tagName === "vollna-auto" ? "#8b5cf6" : "#3b82f6"})
          RETURNING id
        `;
        tagIds.push(newTag.rows[0].id as string);
      }
    }
  }

  // --- Map n8n data to formal custom field definitions ---
  let finalCustomFields: Record<string, unknown> = { ...cf };
  if (cf._source === "n8n") {
    // Look up custom field definition IDs by name for this project
    const fieldDefs = await sql`
      SELECT id, LOWER(name) AS name_lower FROM custom_field_definitions
      WHERE project_id = ${projectId} AND archived = false
    `;
    const fieldMap: Record<string, string> = {};
    for (const row of fieldDefs.rows) {
      fieldMap[row.name_lower as string] = row.id as string;
    }

    // Map n8n underscore-prefixed data → formal field IDs
    const mapping: Record<string, unknown> = {
      "job link":     cf._job_url || "",
      "budget":       cf._budget ? String(cf._budget) : "Not specified",
      "skills":       Array.isArray(cf._skills) ? (cf._skills as string[]).join(", ") : "",
      "posted":       new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      "location":     cf._client_country || "Not specified",
      "rating":       cf._client_rating ? String(cf._client_rating) : "No rating yet",
      "total spent":  cf._client_spent ? `$${cf._client_spent}` : "New client",
      "past hires":   cf._client_hires ? String(cf._client_hires) : "No hires yet",
      "agent":        cf._assigned_agent || "",
      "profile":      cf._profile_name || "",
      "stack":        cf._stack || "",
      "job id":       cf._job_id ? String(cf._job_id) : "",
      "generated":    cf._generated || new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }),
      "proposal":     cf._proposal || "",
    };

    for (const [fieldName, value] of Object.entries(mapping)) {
      const fieldId = fieldMap[fieldName];
      if (fieldId && value) {
        finalCustomFields[fieldId] = value;
      }
    }
  }

  try {
    const task = await createTask({
      project_id: projectId,
      column_id: columnId,
      title: body.title.trim(),
      description: body.description ?? null,
      priority: body.priority ?? null,
      due_date: dueDate,
      assignee_ids: assigneeIds,
      tag_ids: tagIds,
      custom_fields: finalCustomFields,
    });

    const responsePayload = { ok: true, task_id: task.id, task };

    // Store idempotency record (24h TTL)
    if (idempotencyKey) {
      await sql`
        INSERT INTO stats_cache (cache_key, data, expires_at)
        VALUES (
          ${"webhook_idempotency_" + idempotencyKey},
          ${JSON.stringify(responsePayload)},
          NOW() + INTERVAL '24 hours'
        )
        ON CONFLICT (cache_key) DO NOTHING
      `;
    }

    await logWebhookEvent(projectId, "inbound", "task_create", 201, body, null);
    return NextResponse.json(responsePayload, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await logWebhookEvent(projectId, "inbound", "task_create", 500, body, message);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}

async function logWebhookEvent(
  projectId: string,
  direction: string,
  eventType: string,
  statusCode: number,
  payload: unknown,
  error: string | null
) {
  await sql`
    INSERT INTO webhook_event_log (project_id, direction, event_type, status_code, payload, error)
    VALUES (${projectId}, ${direction}, ${eventType}, ${statusCode}, ${JSON.stringify(payload)}, ${error})
  `;
}
