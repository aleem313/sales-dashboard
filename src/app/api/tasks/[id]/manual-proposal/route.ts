import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  assertCanFlagTaskRelevancy,
  getTaskProposalContext,
  insertProposalFeedback,
} from "@/lib/data";

// Record an agent's own hand-written proposal on a card. Record-only: this does
// NOT touch the card's _proposal — it writes a status='manual' row to
// proposal_feedback so admins can view it and it joins the training corpus as a
// human-written target.
//
// POST /api/tasks/[id]/manual-proposal
//   Body: { proposal_text: string, note?: string }
//   → { feedback_id, created_at } (201)
//
// Reads (GET) and deletes (DELETE) of these rows go through the shared
// /api/tasks/[id]/proposal-feedback route — manual rows live in the same table.

export const dynamic = "force-dynamic";

const NOTE_MAX_LEN = 2000;
const PROPOSAL_MAX_LEN = 20000;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

interface PostBody {
  proposal_text?: unknown;
  note?: unknown;
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

  if (typeof body.proposal_text !== "string") {
    return bad("proposal_text must be a string");
  }
  const proposalText = body.proposal_text.trim();
  if (proposalText.length === 0) return bad("proposal_text cannot be empty");
  if (proposalText.length > PROPOSAL_MAX_LEN) {
    return bad(`proposal_text too long (max ${PROPOSAL_MAX_LEN} chars)`);
  }

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return bad("note must be a string");
    const trimmed = body.note.trim();
    if (trimmed.length > NOTE_MAX_LEN) return bad(`note too long (max ${NOTE_MAX_LEN} chars)`);
    note = trimmed.length > 0 ? trimmed : null;
  }

  // Admin without an agent row → admin author; everyone else → agent author.
  // Same split the proposal-feedback route uses.
  const isAdminAuthor = gate.scope === "admin" && !gate.agentId;

  // Resolve card context. The task must exist; a missing proposal is fine — an
  // agent may write their own where the AI produced none (original_proposal=null).
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
      categories: [],
      note,
      originalProposal: ctx.proposal,
      regeneratedProposal: proposalText,
      model: null,
      status: "manual",
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
