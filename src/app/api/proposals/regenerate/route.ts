import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  assertCanFlagTaskRelevancy,
  checkProposalRegenRateLimit,
  getTaskProposalContext,
  getUpworkProfileSnapshot,
  insertProposalFeedback,
  setTaskProposalText,
} from "@/lib/data";
import { PROPOSAL_FEEDBACK_SET } from "@/lib/proposal-feedback-reasons";

// POST /api/proposals/regenerate
//
// Regenerate an improved proposal from agent feedback. Mirrors the manual
// evaluator (/api/relevancy/evaluate-task): resolve + preflight, rate-limit, then
// forward to the n8n `proposal-regenerate` webhook which re-runs the Claude Haiku
// proposal writer with the previous proposal + the agent's feedback injected. On
// success the new text is written back to the card's _proposal and the whole
// (original, feedback, regenerated) triple is captured in proposal_feedback.
//
// Body: { task_id: string, categories: string[], note?: string }
//
// Responses:
//   200 — { proposal, model, feedback_id, request_id }
//   400 — bad input
//   401 — unauthenticated
//   403 — not assigned to the task
//   404 — task_not_found | no_proposal | profile_snapshot_missing
//   429 — rate_limited (Retry-After header)
//   500 — token not configured
//   502 — n8n unreachable / returned error
//   504 — n8n timeout
// On 502/504 a status='regen_failed' row is still recorded so the attempt +
// feedback aren't lost, and the card's proposal is left untouched.

export const dynamic = "force-dynamic";

const N8N_WEBHOOK_BASE =
  process.env.N8N_WEBHOOK_BASE || "https://ikonicdev.app.n8n.cloud/webhook";
const REGEN_WEBHOOK_PATH = "proposal-regenerate";
const N8N_TIMEOUT_MS = 60_000;
const NOTE_MAX_LEN = 2000;
const MAX_CATEGORIES = 32;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

interface PostBody {
  task_id?: unknown;
  categories?: unknown;
  note?: unknown;
}

export async function POST(req: NextRequest) {
  // 1. Auth.
  const session = await auth();
  if (!session?.user) return bad("unauthorized", 401);
  const requestedBy = session.user.id;
  if (!requestedBy) return bad("session_missing_user_id", 401);

  // 2. Parse + validate body.
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return bad("invalid_json");
  }
  const taskId = typeof body.task_id === "string" ? body.task_id.trim().toLowerCase() : "";
  if (!UUID_RE.test(taskId)) return bad("task_id must be a valid UUID");

  if (!Array.isArray(body.categories) || body.categories.length === 0) {
    return bad("categories must be a non-empty array of strings");
  }
  if (body.categories.length > MAX_CATEGORIES) {
    return bad(`too many categories (max ${MAX_CATEGORIES})`);
  }
  const categories = (body.categories as unknown[]).filter(
    (c): c is string => typeof c === "string" && PROPOSAL_FEEDBACK_SET.has(c)
  );
  if (categories.length === 0) return bad("no recognized categories");

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") return bad("note must be a string");
    const trimmed = body.note.trim();
    if (trimmed.length > NOTE_MAX_LEN) return bad(`note too long (max ${NOTE_MAX_LEN} chars)`);
    note = trimmed.length > 0 ? trimmed : null;
  }

  // 3. Permission gate (agent assigned to the task, or admin).
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
  const isAdminAuthor = gate.scope === "admin" && !gate.agentId;

  // 4. Resolve the card's proposal + profile (BEFORE rate-limit / n8n call so bad
  //    input doesn't burn budget).
  const ctx = await getTaskProposalContext(taskId);
  if (!ctx) return bad("task_not_found", 404);
  if (!ctx.proposal) return bad("no_proposal", 404);
  if (!ctx.profileId) return bad("profile_not_resolved", 404);

  const snapshot = await getUpworkProfileSnapshot(ctx.profileId);
  if (!snapshot) {
    return NextResponse.json(
      { error: "profile_snapshot_missing", profile_id: ctx.profileId },
      { status: 404 }
    );
  }

  // 5. Rate limit (regeneration is a full LLM run).
  const rl = await checkProposalRegenRateLimit({
    requestedBy,
    agentId: gate.agentId ?? null,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: "rate_limited",
        exceeded: rl.exceeded,
        hourly_count: rl.hourlyCount,
        daily_count: rl.dailyCount,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  // 6. Forward to the n8n proposal-regenerate webhook.
  const token = process.env.PROPOSAL_REGEN_TOKEN || process.env.RELEVANCY_MANUAL_EVAL_TOKEN;
  if (!token) return bad("proposal_regen_token_not_configured", 500);

  const requestId = randomUUID();
  const url = `${N8N_WEBHOOK_BASE}/${REGEN_WEBHOOK_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

  // Shared insert for the failure paths — capture the attempt + feedback so it's
  // never lost even when n8n is down. Best-effort: a logging failure must not mask
  // the original error.
  async function recordFailedAttempt() {
    try {
      await insertProposalFeedback({
        taskId,
        jobExternalId: ctx!.jobExternalId,
        profileId: ctx!.profileId,
        agentId: isAdminAuthor ? null : (gate.agentId ?? null),
        adminId: isAdminAuthor ? requestedBy : null,
        authorRole: isAdminAuthor ? "admin" : "agent",
        categories,
        note,
        originalProposal: ctx!.proposal,
        regeneratedProposal: null,
        model: null,
        status: "regen_failed",
        applied: false,
        requestId,
      });
    } catch {
      /* swallow */
    }
  }

  let verdict: Record<string, unknown> = {};
  try {
    const upstream = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        task_id: taskId,
        profile_id: ctx.profileId,
        original_proposal: ctx.proposal,
        feedback_categories: categories,
        feedback_note: note,
        requested_by: requestedBy,
        request_id: requestId,
      }),
    });
    const text = await upstream.text();
    try {
      verdict = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    } catch {
      verdict = { _raw: text };
    }
    if (!upstream.ok) {
      await recordFailedAttempt();
      return NextResponse.json(
        { error: "n8n_returned_error", status: upstream.status, verdict },
        { status: upstream.status >= 500 ? 502 : 422 }
      );
    }
  } catch (e) {
    const isAbort = (e as Error).name === "AbortError";
    await recordFailedAttempt();
    return NextResponse.json(
      { error: isAbort ? "n8n_timeout" : "n8n_unreachable", detail: (e as Error).message },
      { status: isAbort ? 504 : 502 }
    );
  } finally {
    clearTimeout(timer);
  }

  // 7. Extract the new proposal. n8n contract: { proposal: string, model?: string }.
  const newProposal =
    typeof verdict.proposal === "string" && verdict.proposal.trim().length > 0
      ? (verdict.proposal as string)
      : null;
  const model = typeof verdict.model === "string" ? (verdict.model as string) : null;

  if (!newProposal) {
    await recordFailedAttempt();
    return NextResponse.json(
      { error: "n8n_returned_no_proposal", verdict },
      { status: 502 }
    );
  }

  // 8. Persist the training triple + apply to the card.
  const result = await insertProposalFeedback({
    taskId,
    jobExternalId: ctx.jobExternalId,
    profileId: ctx.profileId,
    agentId: isAdminAuthor ? null : (gate.agentId ?? null),
    adminId: isAdminAuthor ? requestedBy : null,
    authorRole: isAdminAuthor ? "admin" : "agent",
    categories,
    note,
    originalProposal: ctx.proposal,
    regeneratedProposal: newProposal,
    model,
    status: "regenerated",
    applied: true,
    requestId,
  });

  await setTaskProposalText(taskId, newProposal);
  revalidatePath("/my-tasks");
  revalidatePath("/tasks");

  return NextResponse.json({
    proposal: newProposal,
    model,
    feedback_id: result.id,
    request_id: requestId,
  });
}
