import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { sql } from "@vercel/postgres";
import { mapStatusToOutcome, isRisingLionTask } from "@/lib/clickup";
import { createSyncLog, completeSyncLog } from "@/lib/data";

export async function POST(request: NextRequest) {
  const secret = process.env.CLICKUP_WEBHOOK_SECRET;

  if (secret) {
    const signature = request.headers.get("x-signature");
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

    const data = JSON.parse(body);
    return processEvent(data);
  }

  const data = await request.json();
  return processEvent(data);
}

async function processEvent(data: Record<string, unknown>) {
  const event = data.event as string;

  // Only handle task status updates
  if (event !== "taskStatusUpdated") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const taskId = String(
    (data.task_id as string) ??
    ((data.history_items as Array<Record<string, unknown>>)?.[0]?.parent_id as string) ??
    ""
  );

  if (!taskId) {
    return NextResponse.json({ error: "No task ID found" }, { status: 400 });
  }

  // Only process tasks from Rising Lion space
  const isRisingLion = await isRisingLionTask(taskId);
  if (!isRisingLion) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Not in Rising Lion space" });
  }

  const syncLog = await createSyncLog("clickup");

  try {
    // Find job by clickup_task_id
    const jobResult = await sql`
      SELECT id, outcome FROM jobs WHERE clickup_task_id = ${taskId} LIMIT 1
    `;

    if (jobResult.rows.length === 0) {
      await completeSyncLog(syncLog.id, {
        records_synced: 0,
        records_updated: 0,
        status: "success",
      });
      return NextResponse.json({ ok: true, message: "Task not tracked" });
    }

    const historyItems = data.history_items as Array<Record<string, unknown>> | undefined;
    const newStatus = (historyItems?.[0]?.after as Record<string, unknown>)?.status as string | undefined;

    if (!newStatus) {
      await completeSyncLog(syncLog.id, {
        records_synced: 0,
        records_updated: 0,
        status: "success",
      });
      return NextResponse.json({ ok: true, message: "No status change found" });
    }

    const newOutcome = mapStatusToOutcome(newStatus);
    const job = jobResult.rows[0];

    await sql`
      UPDATE jobs SET
        clickup_status = ${newStatus},
        outcome = COALESCE(${newOutcome}, outcome),
        outcome_at = CASE
          WHEN ${newOutcome}::text IS NOT NULL AND ${job.outcome}::text IS NULL THEN NOW()
          ELSE outcome_at
        END,
        updated_at = NOW()
      WHERE id = ${job.id}
    `;

    await completeSyncLog(syncLog.id, {
      records_synced: 1,
      records_updated: 1,
      status: "success",
    });

    // Bust cache so dashboard shows status change instantly
    revalidatePath("/dashboard");
    revalidatePath("/jobs");
    revalidatePath("/agents");
    revalidatePath("/profiles");
    revalidatePath("/pipeline");
    revalidatePath("/connects");
    revalidatePath("/alerts");
    revalidatePath("/my-dashboard");
    revalidatePath("/my-jobs");

    return NextResponse.json({ ok: true, updated: true });
  } catch (error) {
    await completeSyncLog(syncLog.id, {
      records_synced: 0,
      records_updated: 0,
      errors: [error instanceof Error ? error.message : "Unknown error"],
      status: "failed",
    });

    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }
}
