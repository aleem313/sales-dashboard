import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
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

  try {
    const task = await createTask({
      project_id: projectId,
      column_id: columnId,
      title: body.title.trim(),
      description: body.description ?? null,
      priority: body.priority ?? null,
      due_date: body.due_date ?? null,
      assignee_ids: body.assignee_ids ?? [],
      tag_ids: body.tag_ids ?? [],
      custom_fields: body.custom_fields ?? {},
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
