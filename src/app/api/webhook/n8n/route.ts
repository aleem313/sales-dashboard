import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { sql } from "@vercel/postgres";
import { upsertJob, createSyncLog, completeSyncLog } from "@/lib/data";

export async function POST(request: NextRequest) {
  const secret = process.env.N8N_WEBHOOK_SECRET;

  // Verify HMAC signature if secret is configured
  if (secret) {
    const signature = request.headers.get("x-n8n-signature");
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }

    const body = await request.text();
    const expected = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    if (signature !== expected) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse body since we consumed it
    const data = JSON.parse(body);
    return processWebhook(data);
  }

  // No secret configured — accept all requests
  const data = await request.json();
  return processWebhook(data);
}

// Parse a currency/number string like "$3,000" or "52k" to a number
function parseNumber(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === "number") return val;
  const str = String(val).replace(/[$,\s]/g, "");
  if (!str) return null;
  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

// Extract budget range from a string like "$1,000 - $3,000" or "$3,000"
function parseBudgetRange(budget: unknown): { min: number | null; max: number | null } {
  if (budget == null) return { min: null, max: null };
  if (typeof budget === "number") return { min: budget, max: budget };
  const str = String(budget);
  const numbers = str.match(/[\d,]+\.?\d*/g);
  if (!numbers || numbers.length === 0) return { min: null, max: null };
  const parsed = numbers.map((n) => parseFloat(n.replace(/,/g, "")));
  if (parsed.length === 1) return { min: parsed[0], max: parsed[0] };
  return { min: parsed[0], max: parsed[1] };
}

// Look up agent UUID by name or clickup_user_id
async function resolveAgentId(
  agentName?: string | null,
  agentClickupId?: string | null
): Promise<string | null> {
  if (!agentName && !agentClickupId) return null;

  if (agentClickupId) {
    const result = await sql`
      SELECT id FROM agents WHERE clickup_user_id = ${agentClickupId} LIMIT 1
    `;
    if (result.rows.length > 0) return result.rows[0].id;
  }

  if (agentName) {
    const result = await sql`
      SELECT id FROM agents WHERE LOWER(name) = LOWER(${agentName}) LIMIT 1
    `;
    if (result.rows.length > 0) return result.rows[0].id;
  }

  return null;
}

// Look up profile_id by filter tag or profile name
async function resolveProfileId(
  filterName?: string | null,
  profileName?: string | null
): Promise<string | null> {
  if (!filterName && !profileName) return null;

  if (filterName) {
    const result = await sql`
      SELECT profile_id FROM profiles WHERE LOWER(vollna_filter_tag) = LOWER(${filterName}) LIMIT 1
    `;
    if (result.rows.length > 0) return result.rows[0].profile_id;
  }

  if (profileName) {
    const result = await sql`
      SELECT profile_id FROM profiles WHERE LOWER(profile_name) = LOWER(${profileName}) LIMIT 1
    `;
    if (result.rows.length > 0) return result.rows[0].profile_id;
  }

  return null;
}

// Normalize nested n8n payload to flat dashboard fields
async function normalizePayload(data: Record<string, unknown>) {
  const job = data.job as Record<string, unknown> | undefined;
  const client = data.client as Record<string, unknown> | undefined;
  const routing = data.routing as Record<string, unknown> | undefined;
  const scores = data.scores as Record<string, unknown> | undefined;
  const clickup = data.clickup as Record<string, unknown> | undefined;

  // Detect nested n8n format vs flat format
  const isNested = Boolean(job || client || routing);

  if (!isNested) {
    // Already flat — legacy/direct format, return as-is
    return {
      job_id: String(data.job_id ?? data.id ?? ""),
      job_title: String(data.job_title ?? data.title ?? "Untitled"),
      job_url: (data.job_url as string) ?? null,
      job_description: (data.job_description as string) ?? null,
      budget_type: (data.budget_type as string) ?? null,
      budget_min: (data.budget_min as number) ?? null,
      budget_max: (data.budget_max as number) ?? null,
      hourly_min: (data.hourly_min as number) ?? null,
      hourly_max: (data.hourly_max as number) ?? null,
      skills: (data.skills as string[]) ?? null,
      client_country: (data.client_country as string) ?? null,
      client_rating: (data.client_rating as number) ?? null,
      client_total_spent: (data.client_total_spent as number) ?? null,
      client_hires: (data.client_hires as number) ?? null,
      posted_at: (data.posted_at as string) ?? null,
      profile_id: (data.profile_id as string) ?? null,
      agent_id: (data.agent_id as string) ?? null,
      clickup_task_id: (data.clickup_task_id as string) ?? null,
      clickup_task_url: (data.clickup_task_url as string) ?? null,
      clickup_status: (data.clickup_status as string) ?? undefined,
      proposal_text: (data.proposal_text as string) ?? null,
      gpt_model: (data.gpt_model as string) ?? null,
      gpt_tokens_used: (data.gpt_tokens_used as number) ?? null,
    };
  }

  // Nested n8n format — map fields
  const budgetRange = parseBudgetRange(job?.budget);
  const budgetType = (job?.budgetType as string)?.toLowerCase() ?? null;

  // Resolve profile first, then agent (with fallback to profile's linked agent)
  const profileId = await resolveProfileId(
    routing?.filterName as string | null,
    routing?.profileName as string | null
  );
  let agentId = await resolveAgentId(
    routing?.assignedAgent as string | null,
    routing?.agentClickupId as string | null
  );

  // Fallback: if agent not resolved but profile was, use the profile's linked agent
  if (!agentId && profileId) {
    const profileAgent = await sql`
      SELECT agent_id FROM profiles WHERE profile_id = ${profileId} AND agent_id IS NOT NULL LIMIT 1
    `;
    if (profileAgent.rows.length > 0) {
      agentId = profileAgent.rows[0].agent_id;
    }
  }

  return {
    job_id: String(job?.id ?? data.job_id ?? ""),
    job_title: String(job?.title ?? data.job_title ?? "Untitled"),
    job_url: (job?.url as string) ?? null,
    job_description: (job?.description as string) ?? null,
    budget_type: budgetType,
    budget_min: budgetRange.min,
    budget_max: budgetRange.max,
    hourly_min: budgetType === "hourly" ? budgetRange.min : null,
    hourly_max: budgetType === "hourly" ? budgetRange.max : null,
    skills: (job?.skills as string[]) ?? null,
    client_country: (client?.country as string) ?? null,
    client_rating: parseNumber(client?.rating),
    client_total_spent: parseNumber(client?.spent),
    client_hires: parseNumber(client?.hires),
    posted_at: (job?.postedDate as string) ?? null,
    profile_id: profileId,
    agent_id: agentId,
    clickup_task_id: (clickup?.taskId as string) ?? (data.clickup_task_id as string) ?? null,
    clickup_task_url: (clickup?.taskUrl as string) ?? (data.clickup_task_url as string) ?? null,
    clickup_status: (clickup?.status as string) ?? (data.clickup_status as string) ?? undefined,
    proposal_text: (data.proposal as string) ?? null,
    gpt_model: (data.gpt_model as string) ?? (scores?.aiModel as string) ?? null,
    gpt_tokens_used: parseNumber(data.gpt_tokens_used ?? scores?.aiTokens) ?? null,
  };
}

async function processWebhook(data: Record<string, unknown>) {
  const syncLog = await createSyncLog("n8n_webhook");

  try {
    const normalized = await normalizePayload(data);

    if (!normalized.job_id) {
      await completeSyncLog(syncLog.id, {
        records_synced: 0,
        records_updated: 0,
        errors: ["Missing job_id"],
        status: "failed",
      });
      return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
    }

    const job = await upsertJob(normalized);

    await completeSyncLog(syncLog.id, {
      records_synced: 1,
      records_updated: 1,
      status: "success",
    });

    // Bust cache so dashboard shows new data instantly
    revalidatePath("/dashboard");
    revalidatePath("/jobs");
    revalidatePath("/agents");
    revalidatePath("/profiles");
    revalidatePath("/analytics");
    revalidatePath("/pipeline");
    revalidatePath("/connects");
    revalidatePath("/alerts");
    revalidatePath("/my-dashboard");
    revalidatePath("/my-jobs");

    return NextResponse.json({ ok: true, job_id: job.id });
  } catch (error) {
    await completeSyncLog(syncLog.id, {
      records_synced: 0,
      records_updated: 0,
      errors: [error instanceof Error ? error.message : "Unknown error"],
      status: "failed",
    });

    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 }
    );
  }
}
