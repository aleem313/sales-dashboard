import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { isClickUpConfigured, fetchTask, mapStatusToOutcome, RISING_LION_SPACE_ID } from "@/lib/clickup";
import { createSyncLog, completeSyncLog } from "@/lib/data";
import { auth as getSession } from "@/lib/auth";
import { checkAlerts, dispatchAlerts } from "@/lib/alerts";

export async function GET(request: NextRequest) {
  // Accept either a valid cron secret or a valid user session
  const cronSecret = process.env.CRON_SECRET;
  const cronAuth = request.headers.get("authorization");
  const hasCronAuth = cronSecret && cronAuth === `Bearer ${cronSecret}`;

  if (!hasCronAuth) {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!isClickUpConfigured()) {
    return NextResponse.json({
      ok: true,
      message: "ClickUp not configured — skipping sync",
      synced: 0,
    });
  }

  const syncLog = await createSyncLog("clickup");
  let synced = 0;
  let updated = 0;
  const errors: string[] = [];

  try {
    // Get all open jobs with clickup_task_id
    const openJobs = await sql`
      SELECT id, clickup_task_id, clickup_status, outcome
      FROM jobs
      WHERE clickup_task_id IS NOT NULL
        AND (outcome IS NULL OR outcome = 'pending')
      LIMIT 100
    `;

    // Process in batches of 10
    const jobs = openJobs.rows;
    for (let i = 0; i < jobs.length; i += 10) {
      const batch = jobs.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (job) => {
          const task = await fetchTask(job.clickup_task_id);
          if (!task) return null;

          // Skip tasks not in Rising Lion space
          if (task.space?.id !== RISING_LION_SPACE_ID) return null;

          const newStatus = task.status.status;
          const newOutcome = mapStatusToOutcome(newStatus);

          if (newStatus !== job.clickup_status || newOutcome !== job.outcome) {
            await sql`
              UPDATE jobs SET
                clickup_status = ${newStatus},
                outcome = COALESCE(${newOutcome}, outcome),
                outcome_at = CASE
                  WHEN ${newOutcome}::text IS NOT NULL AND outcome IS NULL THEN NOW()
                  ELSE outcome_at
                END,
                updated_at = NOW()
              WHERE id = ${job.id}
            `;
            updated++;
          }
          synced++;
        })
      );

      for (const r of results) {
        if (r.status === "rejected") {
          errors.push(r.reason instanceof Error ? r.reason.message : "Unknown error");
        }
      }
    }

    await completeSyncLog(syncLog.id, {
      records_synced: synced,
      records_updated: updated,
      errors: errors.length > 0 ? errors : undefined,
      status: errors.length > 0 ? "failed" : "success",
    });

    // Run alert checks after sync
    try {
      const triggered = await checkAlerts();
      if (triggered.length > 0) {
        await dispatchAlerts(triggered);
      }
    } catch (alertErr) {
      console.error("Alert check failed:", alertErr);
    }

    return NextResponse.json({ ok: true, synced, updated, errors });
  } catch (error) {
    await completeSyncLog(syncLog.id, {
      records_synced: synced,
      records_updated: updated,
      errors: [error instanceof Error ? error.message : "Unknown error"],
      status: "failed",
    });

    return NextResponse.json(
      { error: "Sync failed", details: errors },
      { status: 500 }
    );
  }
}
