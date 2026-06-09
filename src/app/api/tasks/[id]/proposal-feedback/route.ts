import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  assertCanFlagTaskRelevancy,
  deleteProposalFeedback,
  getTaskProposalContext,
  insertProposalFeedback,
  listProposalFeedbackForTask,
} from "@/lib/data";
import { PROPOSAL_FEEDBACK_SET } from "@/lib/proposal-feedback-reasons";

// Agent/admin feedback on an AI-written proposal. Mirrors the relevancy-feedback
// route (same auth gate, same shapes) but writes to proposal_feedback instead of
// relevancy_overrides.
//
// GET    /api/tasks/[id]/proposal-feedback   → { feedback: ProposalFeedbackRow[] } (full history)
// POST   /api/tasks/[id]/proposal-feedback   → save a feedback-only row (status='feedback')
//          Body: { categories: string[], note?: string }
// DELETE /api/tasks/[id]/proposal-feedback   → remove a row
//          Body: { feedback_id: number }
//
// The Regenerate action lives in a separate route (/api/proposals/regenerate)
// because it makes an LLM call; this route is the "flag without regenerating" path.

export const dynamic = "force-dynamic";

const NOTE_MAX_LEN = 2000;
const MAX_CATEGORIES = 32;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

interface PostBody {
  categories?: unknown;
  note?: unknown;
}
interface DeleteBody {
  feedback_id?: unknown;
}

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

  const feedback = await listProposalFeedbackForTask(taskId);
  return NextResponse.json({ feedback });
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

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return bad("invalid_json");
  }

  if (!Array.isArray(body.categories)) {
    return bad("categories must be an array of strings");
  }
  if (body.categories.length === 0) {
    return bad("categories cannot be empty");
  }
  if (body.categories.length > MAX_CATEGORIES) {
    return bad(`too many categories (max ${MAX_CATEGORIES})`);
  }
  // Validate against the canonical vocabulary — drop anything unexpected.
  const categories = (body.categories as unknown[]).filter(
    (c): c is string => typeof c === "string" && PROPOSAL_FEEDBACK_SET.has(c)
  );
  if (categories.length === 0) {
    return bad("no recognized categories");
  }

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return bad("note must be a string");
    const trimmed = body.note.trim();
    if (trimmed.length > NOTE_MAX_LEN) return bad(`note too long (max ${NOTE_MAX_LEN} chars)`);
    note = trimmed.length > 0 ? trimmed : null;
  }

  // Admin without an agent row → admin author; everyone else (agents, admins with
  // an agent row) → agent author. Same split the relevancy route uses.
  const isAdminAuthor = gate.scope === "admin" && !gate.agentId;

  const ctx = await getTaskProposalContext(taskId);
  if (!ctx) return bad("task_not_found", 404);

  try {
    const result = await insertProposalFeedback({
      taskId,
      jobExternalId: ctx.jobExternalId,
      profileId: ctx.profileId,
      agentId: isAdminAuthor ? null : (gate.agentId ?? null),
      adminId: isAdminAuthor ? (session.user.id ?? null) : null,
      authorRole: isAdminAuthor ? "admin" : "agent",
      categories,
      note,
      originalProposal: ctx.proposal,
      regeneratedProposal: null,
      model: null,
      status: "feedback",
      applied: false,
      requestId: null,
    });
    revalidatePath("/my-tasks");
    revalidatePath("/tasks");
    return NextResponse.json(
      { feedback_id: result.id, created_at: result.created_at },
      { status: 201 }
    );
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

  try {
    const outcome = await deleteProposalFeedback({
      feedbackId,
      taskId,
      agentId: gate.agentId ?? null,
      isAdmin: gate.scope === "admin",
    });
    if (outcome === "deleted") {
      revalidatePath("/my-tasks");
      revalidatePath("/tasks");
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
