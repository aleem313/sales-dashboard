import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import {
  checkManualEvalRateLimit,
  getUpworkProfileSnapshot,
  insertManualJobEvaluation,
} from "@/lib/data";
import { sql } from "@/lib/db";

// Phase 5 of plan v3.3.
//
// POST /api/relevancy/evaluate-task
//
// Front door for the manual evaluator (admin-only). Accepts either a raw
// Task Board card URL or a bare task UUID, validates the snapshot exists,
// rate-limits (60/hr + 300/day per admin), then forwards to the n8n
// `job-evaluate-manual` webhook with the MANUAL_EVAL_TOKEN bearer. n8n
// drives the classifier sub-workflow and returns the verdict synchronously.
//
// Body: { task_card_url?: string, task_id?: string, profile_id: string }
//
// Responses:
//   200 — { verdict, request_id, manual_eval_id }
//   400 — bad URL / UUID / missing profile_id
//   401 — unauthenticated
//   403 — non-admin
//   404 — task_not_found | profile_snapshot_missing
//   429 — rate_limited (Retry-After header set)
//   502 — n8n unreachable
//   504 — n8n timeout

export const dynamic = "force-dynamic";

const N8N_WEBHOOK_BASE =
  process.env.N8N_WEBHOOK_BASE || "https://ikonicdev.app.n8n.cloud/webhook";
const MANUAL_EVAL_WEBHOOK_PATH = "job-evaluate-manual";
// Classifier latency profile depends on the primary LLM:
//   Gemini 2.5 Flash:       ~10s warm path
//   DeepSeek R1 (full):     180-300s (reasoning model)
//   DeepSeek R1-Distill-70B: 20-40s typical (current primary as of 2026-05-15)
// Plus profile-context HTTP, persist HTTP, and respond formatting overhead.
// 60s gives ~2x safety margin over the current typical run. Bump if you swap
// to a slower model (see docs/relevancy/llm_options_and_latency.md).
const N8N_TIMEOUT_MS = 60_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Permissive: any host, /tasks or /my-tasks, ?task=<uuid> as the FIRST or only param.
const TASK_URL_RE = /^https?:\/\/[^/]+\/(?:tasks|my-tasks)(?:\?|\?[^#]*&)task=([0-9a-f-]{36})(?:[&#].*)?$/i;

function parseTaskId(input: { task_card_url?: unknown; task_id?: unknown }): {
  taskId: string | null;
  error: string | null;
} {
  if (typeof input.task_id === "string" && input.task_id.trim()) {
    const candidate = input.task_id.trim();
    if (!UUID_RE.test(candidate)) {
      return { taskId: null, error: "task_id is not a valid UUID" };
    }
    return { taskId: candidate.toLowerCase(), error: null };
  }
  if (typeof input.task_card_url === "string" && input.task_card_url.trim()) {
    const raw = input.task_card_url.trim();
    // Try the strict regex first.
    const m = raw.match(TASK_URL_RE);
    if (m) return { taskId: m[1].toLowerCase(), error: null };
    // Fallback: extract via URL + searchParams. Handles ?profile=foo&task=<uuid>
    // and other unusual orderings without rejecting the user's paste.
    try {
      const u = new URL(raw);
      const path = u.pathname.replace(/\/+$/, "");
      if (path !== "/tasks" && path !== "/my-tasks") {
        return { taskId: null, error: "URL must point to /tasks or /my-tasks" };
      }
      const tp = u.searchParams.get("task");
      if (!tp || !UUID_RE.test(tp)) {
        return { taskId: null, error: "URL must include ?task=<uuid>" };
      }
      return { taskId: tp.toLowerCase(), error: null };
    } catch {
      return { taskId: null, error: "task_card_url is not a valid URL" };
    }
  }
  return { taskId: null, error: "task_card_url or task_id is required" };
}

export async function POST(req: NextRequest) {
  // 1. Auth — admin only.
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const requestedBy = session.user.id;
  if (!requestedBy) {
    // Defensive — session.user.id is required to attribute the eval. Shouldn't
    // happen under NextAuth v5 but rejecting beats writing a NULL audit row.
    return NextResponse.json({ error: "session_missing_user_id" }, { status: 401 });
  }

  // 2. Parse body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body_must_be_object" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const profileId =
    typeof input.profile_id === "string" ? input.profile_id.trim() : "";
  if (!profileId) {
    return NextResponse.json({ error: "profile_id is required" }, { status: 400 });
  }

  const { taskId, error: parseErr } = parseTaskId(input);
  if (parseErr || !taskId) {
    return NextResponse.json({ error: parseErr ?? "task_parse_failed" }, { status: 400 });
  }

  // 3. Cross-row preflight: task must exist; profile must have a current snapshot.
  //    Doing these BEFORE rate-limit / n8n call so bad input doesn't burn budget.
  const taskRow = await sql<{ id: string }>`
    SELECT id FROM tasks WHERE id = ${taskId} LIMIT 1
  `;
  if (taskRow.rows.length === 0) {
    return NextResponse.json({ error: "task_not_found", task_id: taskId }, { status: 404 });
  }

  const snapshot = await getUpworkProfileSnapshot(profileId);
  if (!snapshot) {
    return NextResponse.json(
      { error: "profile_snapshot_missing", profile_id: profileId },
      { status: 404 }
    );
  }

  // 4. Rate limit.
  const rl = await checkManualEvalRateLimit({ requestedBy });
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

  // 5. Forward to n8n. Env var name matches plan §15.1.
  //    `MANUAL_EVAL_TOKEN` is accepted as a transitional alias (the earlier
  //    .env.relevancy.example used that name) but `RELEVANCY_MANUAL_EVAL_TOKEN`
  //    is authoritative.
  const token = process.env.RELEVANCY_MANUAL_EVAL_TOKEN || process.env.MANUAL_EVAL_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "manual_eval_token_not_configured" },
      { status: 500 }
    );
  }
  const requestId = randomUUID();
  const url = `${N8N_WEBHOOK_BASE}/${MANUAL_EVAL_WEBHOOK_PATH}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

  let verdict: unknown;
  let upstreamStatus = 0;
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
        profile_id: profileId,
        requested_by: requestedBy,
        request_id: requestId,
      }),
    });
    upstreamStatus = upstream.status;
    const text = await upstream.text();
    try {
      verdict = text ? JSON.parse(text) : null;
    } catch {
      verdict = { _raw: text };
    }
    if (!upstream.ok) {
      await insertManualJobEvaluation({
        taskId,
        profileId,
        requestedBy,
        scoreId: null,
        loadStatus: "failed",
        loadError: `n8n_status_${upstream.status}`,
      });
      return NextResponse.json(
        {
          error: "n8n_returned_error",
          status: upstream.status,
          verdict,
        },
        { status: upstream.status >= 500 ? 502 : 422 }
      );
    }
  } catch (e) {
    const isAbort = (e as Error).name === "AbortError";
    const errMsg = (e as Error).message ?? "n8n_fetch_failed";
    await insertManualJobEvaluation({
      taskId,
      profileId,
      requestedBy,
      scoreId: null,
      loadStatus: "failed",
      loadError: isAbort ? "n8n_timeout" : `n8n_unreachable: ${errMsg}`.slice(0, 500),
    });
    return NextResponse.json(
      { error: isAbort ? "n8n_timeout" : "n8n_unreachable", detail: errMsg },
      { status: isAbort ? 504 : 502 }
    );
  } finally {
    clearTimeout(timer);
  }

  // 6. Persist the manual_job_evaluations row linking the verdict.
  //    The classifier sub-workflow's C10 already wrote relevancy_scores; we
  //    surface that row's id back so the audit page can deep-link.
  const verdictObj = (verdict && typeof verdict === "object" ? verdict : {}) as Record<
    string,
    unknown
  >;
  const scoreId =
    typeof verdictObj._score_id === "number"
      ? verdictObj._score_id
      : typeof verdictObj.score_id === "number"
        ? (verdictObj.score_id as number)
        : null;

  const evalRow = await insertManualJobEvaluation({
    taskId,
    profileId,
    requestedBy,
    scoreId,
    loadStatus: scoreId == null ? "partial" : "success",
    loadError: scoreId == null ? "verdict_returned_without_score_id" : null,
  });

  return NextResponse.json({
    verdict,
    request_id: requestId,
    manual_eval_id: evalRow.id,
    upstream_status: upstreamStatus,
  });
}
