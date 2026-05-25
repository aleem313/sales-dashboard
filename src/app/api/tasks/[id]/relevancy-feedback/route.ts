import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  assertCanFlagTaskRelevancy,
  createAgentFeedbackOverride,
  deleteAgentFeedback,
  deleteAgentFeedbackAsAdmin,
  getAgentFeedbackForTask,
} from "@/lib/data";

// POST /api/tasks/[id]/relevancy-feedback
// Body: { score_id: number, override_reason: string[], note?: string }
// Auth: admin OR agent assigned to the task (or task unassigned).
//
// DELETE /api/tasks/[id]/relevancy-feedback
// Body: { feedback_id: number }
// Auth: same row owner OR admin.

export const dynamic = "force-dynamic";

const NOTE_MAX_LEN = 2000;
const MAX_REASONS = 32;

interface PostBody {
  score_id?: unknown;
  override_reason?: unknown;
  note?: unknown;
}

interface DeleteBody {
  feedback_id?: unknown;
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return bad("unauthorized", 401);

  const { id: taskId } = await params;

  const gate = await assertCanFlagTaskRelevancy({
    taskId,
    sessionUserId: session.user.id,
    sessionRole: session.user.role,
    sessionAgentId: session.user.agentId,
  });
  if (!gate.ok) {
    if (gate.code === "unauthorized") return bad("unauthorized", 401);
    if (gate.code === "task_not_found") return bad("task_not_found", 404);
    return bad("not_assigned", 403);
  }

  // For admins without an agent row, we still need an agent_id to satisfy the
  // FK on relevancy_overrides.agent_id. Block — admins should use the admin
  // audit flow on /relevancy-audit instead. (The user-facing "Mark wrong" button
  // is still primarily an agent affordance even though admins can see the page.)
  if (gate.scope === "admin" && !gate.agentId) {
    return bad("admin_use_audit_flow", 400);
  }
  const agentId = gate.agentId!;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return bad("invalid_json");
  }

  const scoreId = Number(body.score_id);
  if (!Number.isFinite(scoreId) || !Number.isInteger(scoreId) || scoreId <= 0) {
    return bad("score_id must be a positive integer");
  }

  // override_reason: list of strings. The UI sends the LLM's emitted reasons
  // the agent ticked + (optionally) the sentinel string '__decision__' for the
  // "Overall decision was wrong" checkbox.
  if (!Array.isArray(body.override_reason)) {
    return bad("override_reason must be an array of strings");
  }
  const overrideReasonRaw = body.override_reason as unknown[];
  if (overrideReasonRaw.length === 0) {
    return bad("override_reason cannot be empty");
  }
  if (overrideReasonRaw.length > MAX_REASONS) {
    return bad(`override_reason too long (max ${MAX_REASONS})`);
  }
  if (!overrideReasonRaw.every((s) => typeof s === "string" && s.length > 0 && s.length <= 200)) {
    return bad("override_reason entries must be non-empty strings");
  }
  const overrideReason = overrideReasonRaw as string[];

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return bad("note must be a string");
    const trimmed = body.note.trim();
    if (trimmed.length > NOTE_MAX_LEN) {
      return bad(`note too long (max ${NOTE_MAX_LEN} chars)`);
    }
    note = trimmed.length > 0 ? trimmed : null;
  }

  try {
    const result = await createAgentFeedbackOverride({
      scoreId,
      agentId,
      taskId,
      overrideReason,
      note,
    });
    if ("error" in result) {
      if (result.error === "score_not_found") return bad("score_not_found", 404);
      if (result.error === "already_flagged") {
        return NextResponse.json(
          { error: "already_flagged", feedback_id: result.feedback_id },
          { status: 409 }
        );
      }
    } else {
      revalidatePath("/my-tasks");
      revalidatePath("/tasks");
      revalidatePath("/relevancy-audit");
      return NextResponse.json(result, { status: 201 });
    }
    return bad("unknown", 500);
  } catch (e) {
    return NextResponse.json(
      { error: "insert_failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return bad("unauthorized", 401);

  const { id: taskId } = await params;

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return bad("invalid_json");
  }
  const feedbackId = Number(body.feedback_id);
  if (!Number.isFinite(feedbackId) || !Number.isInteger(feedbackId) || feedbackId <= 0) {
    return bad("feedback_id must be a positive integer");
  }

  // Permission gate identical to POST: admins always allowed; agents must be
  // assigned (or task unassigned). The deeper row-owner check happens inside
  // deleteAgentFeedback so an agent can't delete another agent's row even on
  // a shared-unassigned task.
  const gate = await assertCanFlagTaskRelevancy({
    taskId,
    sessionUserId: session.user.id,
    sessionRole: session.user.role,
    sessionAgentId: session.user.agentId,
  });
  if (!gate.ok) {
    if (gate.code === "unauthorized") return bad("unauthorized", 401);
    if (gate.code === "task_not_found") return bad("task_not_found", 404);
    return bad("not_assigned", 403);
  }

  try {
    let outcome: "deleted" | "not_found" | "forbidden";
    if (gate.scope === "admin") {
      const adminOutcome = await deleteAgentFeedbackAsAdmin({ feedbackId, taskId });
      outcome = adminOutcome;
    } else {
      outcome = await deleteAgentFeedback({ feedbackId, agentId: gate.agentId, taskId });
    }
    if (outcome === "deleted") {
      revalidatePath("/my-tasks");
      revalidatePath("/tasks");
      revalidatePath("/relevancy-audit");
      return new NextResponse(null, { status: 204 });
    }
    if (outcome === "not_found") return bad("not_found", 404);
    return bad("forbidden", 403);
  } catch (e) {
    return NextResponse.json(
      { error: "delete_failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}

// GET /api/tasks/[id]/relevancy-feedback — returns the caller's existing
// feedback row for this task (null if not flagged yet). Used by the UI to
// initialize the form in edit mode on first render.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return bad("unauthorized", 401);

  const { id: taskId } = await params;

  const gate = await assertCanFlagTaskRelevancy({
    taskId,
    sessionUserId: session.user.id,
    sessionRole: session.user.role,
    sessionAgentId: session.user.agentId,
  });
  if (!gate.ok) {
    if (gate.code === "unauthorized") return bad("unauthorized", 401);
    if (gate.code === "task_not_found") return bad("task_not_found", 404);
    return bad("not_assigned", 403);
  }
  if (!gate.agentId) {
    // Admin without agent_id has no row to return — return null.
    return NextResponse.json({ feedback: null });
  }

  const row = await getAgentFeedbackForTask({ taskId, agentId: gate.agentId });
  return NextResponse.json({ feedback: row });
}
