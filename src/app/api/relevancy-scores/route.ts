import { NextRequest, NextResponse } from "next/server";
import {
  insertRelevancyScore,
  insertRelevancyScoreDlq,
  getCachedIdempotencyResponse,
  cacheIdempotencyResponse,
} from "@/lib/data";
import type { RelevancyScoreInsert } from "@/lib/types";

// Phase 6 of plan v3.3.
// POST /api/relevancy-scores — audit-log writer called by n8n's C10 node
//   after every classifier run (auto AND manual). Body is the full verdict
//   produced by the Gemini call + threshold logic (C6).
//
// Idempotency: `X-Idempotency-Key` header (UUID per n8n execution). When the
//   same key replays within 24h, the cached response is returned without
//   re-inserting. Backed by `idempotency_keys` (migration 018).
//
// Auth: Bearer ${RELEVANCY_INGEST_TOKEN}. Inline pattern (per the agreed
//   "skip Phase 5a, use inline auth" decision). Same pattern as the existing
//   /api/v1/webhooks/tasks route.
//
// DLQ: `?dlq=1` query param. When n8n's C10 itself errors and routes to its
//   error output (C11), C11 re-invokes this same endpoint with ?dlq=1 to park
//   the original verdict for the hourly drain worker. Body shape on DLQ writes:
//     { payload: <original verdict>, error_detail: <string> }

export const dynamic = "force-dynamic";

interface DlqRequestBody {
  payload: unknown;
  error_detail?: string;
}

function isDlqBody(body: unknown): body is DlqRequestBody {
  return typeof body === "object" && body !== null && "payload" in (body as Record<string, unknown>);
}

function validateScoreInsert(body: unknown): { ok: true; row: RelevancyScoreInsert } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  // Required string fields
  for (const field of ["profile_id", "decision", "effective_decision", "classifier_mode_at_decision", "model", "prompt_version", "prompt_mode", "criteria_version", "evaluation_path"]) {
    if (typeof b[field] !== "string" || b[field] === "") {
      return { ok: false, error: `Missing or invalid ${field}` };
    }
  }

  // Enum validation
  const decisionEnum = new Set(["proceed", "reject", "review"]);
  if (!decisionEnum.has(b.decision as string)) {
    return { ok: false, error: `decision must be one of: ${[...decisionEnum].join(", ")}` };
  }
  if (!decisionEnum.has(b.effective_decision as string)) {
    return { ok: false, error: `effective_decision must be one of: ${[...decisionEnum].join(", ")}` };
  }
  if (b.classifier_mode_at_decision !== "shadow" && b.classifier_mode_at_decision !== "active") {
    return { ok: false, error: "classifier_mode_at_decision must be 'shadow' or 'active'" };
  }
  if (b.prompt_mode !== "A_full" && b.prompt_mode !== "B_edge") {
    return { ok: false, error: "prompt_mode must be 'A_full' or 'B_edge'" };
  }
  const evalPathEnum = new Set(["deterministic", "llm", "llm_after_deterministic", "manual_url", "shadow"]);
  if (!evalPathEnum.has(b.evaluation_path as string)) {
    return { ok: false, error: `evaluation_path must be one of: ${[...evalPathEnum].join(", ")}` };
  }

  // total_score, min_score_at_decision range (when present)
  if (b.total_score != null && (typeof b.total_score !== "number" || b.total_score < 0 || b.total_score > 100)) {
    return { ok: false, error: "total_score must be a number 0-100" };
  }
  if (b.min_score_at_decision != null && (typeof b.min_score_at_decision !== "number" || b.min_score_at_decision < 0 || b.min_score_at_decision > 100)) {
    return { ok: false, error: "min_score_at_decision must be a number 0-100" };
  }

  // Optional job_title + job_url (migration 022). Cap lengths so a runaway
  // upstream value can't bloat the row. NULL when absent.
  if (b.job_title != null) {
    if (typeof b.job_title !== "string") {
      return { ok: false, error: "job_title must be a string when present" };
    }
    if (b.job_title.length > 500) {
      b.job_title = b.job_title.slice(0, 500);
    }
  }
  if (b.job_url != null) {
    if (typeof b.job_url !== "string") {
      return { ok: false, error: "job_url must be a string when present" };
    }
    if (b.job_url.length > 2000) {
      b.job_url = b.job_url.slice(0, 2000);
    }
  }

  return { ok: true, row: b as unknown as RelevancyScoreInsert };
}

export async function POST(req: NextRequest) {
  // 1. Auth — Bearer token
  const token = process.env.RELEVANCY_INGEST_TOKEN;
  if (!token) {
    // Misconfigured server — return 500 (not 401) so the operator sees this in logs.
    return NextResponse.json(
      { error: "RELEVANCY_INGEST_TOKEN not configured" },
      { status: 500 }
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse body once (used for both DLQ + ingest paths)
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 3. Idempotency lookup — replay returns the cached response immediately
  const idempotencyKey = req.headers.get("x-idempotency-key");
  if (idempotencyKey) {
    const cached = await getCachedIdempotencyResponse(idempotencyKey);
    if (cached) {
      return NextResponse.json(cached.body, { status: cached.status });
    }
  }

  // 4. Route: DLQ write vs main ingest
  const isDlqWrite = req.nextUrl.searchParams.get("dlq") === "1";
  let response: { ok: boolean; id?: number; dlq_id?: number; error?: string };
  let status = 200;

  if (isDlqWrite) {
    if (!isDlqBody(body)) {
      return NextResponse.json(
        { error: "DLQ body must be { payload: <original verdict>, error_detail?: string }" },
        { status: 400 }
      );
    }
    try {
      const dlq = await insertRelevancyScoreDlq(body.payload, body.error_detail ?? "(no detail)");
      response = { ok: true, dlq_id: dlq.id };
    } catch (e) {
      response = { ok: false, error: `DLQ write failed: ${(e as Error).message}` };
      status = 500;
    }
  } else {
    const v = validateScoreInsert(body);
    if (!v.ok) {
      return NextResponse.json({ error: v.error }, { status: 400 });
    }
    try {
      const inserted = await insertRelevancyScore(v.row);
      response = { ok: true, id: inserted.id };
    } catch (e) {
      // Insert failure → write to DLQ ourselves so the verdict isn't lost,
      // but tell the caller it failed so they can log / alert.
      try {
        const dlq = await insertRelevancyScoreDlq(body, (e as Error).message);
        response = { ok: false, dlq_id: dlq.id, error: (e as Error).message };
      } catch (dlqError) {
        // DLQ also failed — this is the worst case. Return 500.
        response = {
          ok: false,
          error: `Score insert AND DLQ failed. Score: ${(e as Error).message}. DLQ: ${(dlqError as Error).message}`,
        };
        status = 500;
      }
    }
  }

  // 5. Cache idempotency response (only on success paths — failures should be retriable)
  if (idempotencyKey && status < 500) {
    await cacheIdempotencyResponse(idempotencyKey, status, response);
  }

  return NextResponse.json(response, { status });
}
