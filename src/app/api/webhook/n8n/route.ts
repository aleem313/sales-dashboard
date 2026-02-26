import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
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

async function processWebhook(data: Record<string, unknown>) {
  const syncLog = await createSyncLog("n8n_webhook");

  try {
    const job = await upsertJob({
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
    });

    await completeSyncLog(syncLog.id, {
      records_synced: 1,
      records_updated: 1,
      status: "success",
    });

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
