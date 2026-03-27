import { NextRequest, NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { isClickUpConfigured, fetchTask, fetchAllTasks, mapStatusToOutcome, RISING_LION_SPACE_ID } from "@/lib/clickup";
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
            // Check if job moved to a post-sent status
            const preSent = ['to do', 'todo', 'new', 'proposal ready', 'n/a', 'rejected', 'filtered out', 'on hold'];
            const isNowSent = !preSent.includes(newStatus.toLowerCase());

            await sql`
              UPDATE jobs SET
                clickup_status = ${newStatus},
                proposal_sent_at = CASE
                  WHEN proposal_sent_at IS NULL AND ${isNowSent}::boolean THEN NOW()
                  ELSE proposal_sent_at
                END,
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

/**
 * POST /api/sync/clickup — Full sync: fetch ALL tasks from every profile's
 * ClickUp list, create missing jobs, and update statuses for existing ones.
 * This backfills jobs that were previously skipped by the n8n webhook.
 */
export async function POST(request: NextRequest) {
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
    });
  }

  const syncLog = await createSyncLog("clickup");
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  try {
    // Get all profiles that have a ClickUp list
    const profilesResult = await sql`
      SELECT profile_id, profile_name, clickup_list_id, agent_id
      FROM profiles
      WHERE clickup_list_id IS NOT NULL AND active = true
    `;

    // Get all existing clickup_task_ids so we know what's missing
    const existingResult = await sql`
      SELECT clickup_task_id, id, clickup_status FROM jobs WHERE clickup_task_id IS NOT NULL
    `;
    const existingMap = new Map(
      existingResult.rows.map((r) => [r.clickup_task_id, { id: r.id, status: r.clickup_status }])
    );

    // Build agent lookup by clickup_user_id for resolving assignees
    const agentsResult = await sql`SELECT id, clickup_user_id FROM agents WHERE clickup_user_id IS NOT NULL`;
    const agentByClickupId = new Map(
      agentsResult.rows.map((r) => [String(r.clickup_user_id), r.id])
    );

    // Statuses that mean a proposal hasn't been sent yet
    const preSentStatuses = new Set(['to do', 'todo', 'new', 'proposal ready', 'n/a', 'rejected', 'filtered out', 'on hold']);

    for (const profile of profilesResult.rows) {
      try {
        const tasks = await fetchAllTasks(profile.clickup_list_id);

        for (const task of tasks) {
          const currentStatus = task.status.status;
          const existing = existingMap.get(task.id);

          if (existing) {
            // Job exists — update status if changed
            if (existing.status !== currentStatus) {
              const newOutcome = mapStatusToOutcome(currentStatus);
              const isNowSent = !preSentStatuses.has(currentStatus.toLowerCase());
              await sql`
                UPDATE jobs SET
                  clickup_status = ${currentStatus},
                  proposal_sent_at = CASE
                    WHEN proposal_sent_at IS NULL AND ${isNowSent}::boolean THEN received_at
                    ELSE proposal_sent_at
                  END,
                  outcome = COALESCE(${newOutcome}, outcome),
                  outcome_at = CASE
                    WHEN ${newOutcome}::text IS NOT NULL AND outcome IS NULL THEN NOW()
                    ELSE outcome_at
                  END,
                  updated_at = NOW()
                WHERE id = ${existing.id}
              `;
              updated++;
            } else {
              skipped++;
            }
          } else {
            // Job missing from DB — create it
            const receivedAt = task.date_created
              ? new Date(parseInt(task.date_created)).toISOString()
              : new Date().toISOString();

            // Extract job title from ClickUp task name (strip [Agent] prefix if present)
            const titleMatch = task.name.match(/^\[.*?\]\s*(.+)$/);
            const jobTitle = titleMatch ? titleMatch[1] : task.name;

            // Use clickup task ID as fallback job_id
            const jobId = `clickup_${task.id}`;
            const outcome = mapStatusToOutcome(currentStatus);

            // Resolve agent from ClickUp assignee, fall back to profile's agent
            const assigneeId = task.assignees?.[0]?.id;
            const agentId = (assigneeId ? agentByClickupId.get(String(assigneeId)) : null) ?? profile.agent_id ?? null;

            // Set proposal_sent_at for jobs already past the pre-sent stage
            const isPostSent = !preSentStatuses.has(currentStatus.toLowerCase());
            const proposalSentAt = isPostSent ? receivedAt : null;

            // Guard against duplicate clickup_task_id: skip if already tracked
            const dupCheck = await sql`SELECT 1 FROM jobs WHERE clickup_task_id = ${task.id} LIMIT 1`;
            if (dupCheck.rows.length > 0) {
              skipped++;
              continue;
            }

            await sql`
              INSERT INTO jobs (
                job_id, job_title, clickup_task_id, clickup_task_url,
                clickup_status, profile_id, agent_id, outcome,
                proposal_sent_at, received_at, created_at, updated_at
              ) VALUES (
                ${jobId}, ${jobTitle}, ${task.id}, ${task.url ?? null},
                ${currentStatus}, ${profile.profile_id}, ${agentId}, ${outcome},
                ${proposalSentAt}::timestamptz, ${receivedAt}::timestamptz, NOW(), NOW()
              )
              ON CONFLICT (job_id) DO NOTHING
            `;
            created++;
          }
        }
      } catch (listErr) {
        errors.push(`List ${profile.clickup_list_id} (${profile.profile_name}): ${listErr instanceof Error ? listErr.message : "Unknown error"}`);
      }
    }

    await completeSyncLog(syncLog.id, {
      records_synced: created + updated + skipped,
      records_updated: created + updated,
      errors: errors.length > 0 ? errors : undefined,
      status: errors.length > 0 ? "failed" : "success",
    });

    return NextResponse.json({ ok: true, created, updated, skipped, errors });
  } catch (error) {
    await completeSyncLog(syncLog.id, {
      records_synced: 0,
      records_updated: 0,
      errors: [error instanceof Error ? error.message : "Unknown error"],
      status: "failed",
    });

    return NextResponse.json(
      { error: "Full sync failed", details: errors },
      { status: 500 }
    );
  }
}
