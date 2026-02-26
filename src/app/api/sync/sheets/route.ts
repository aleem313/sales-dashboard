import { NextResponse } from "next/server";
import {
  isSheetsConfigured,
  fetchSheetRows,
  mapSheetRowToJobData,
} from "@/lib/sheets";
import { upsertJob, createSyncLog, completeSyncLog } from "@/lib/data";

export async function POST() {
  if (!isSheetsConfigured()) {
    return NextResponse.json(
      {
        error: "sheets_not_configured",
        message:
          "Google Sheets integration is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID environment variables.",
      },
      { status: 400 }
    );
  }

  const syncLog = await createSyncLog("sheets");
  const errors: string[] = [];
  let synced = 0;

  try {
    const rows = await fetchSheetRows();

    for (const row of rows) {
      try {
        const jobData = mapSheetRowToJobData(row);
        if (!jobData.job_id) {
          errors.push(`Skipped row: missing job_id`);
          continue;
        }
        await upsertJob(jobData);
        synced++;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Unknown error";
        errors.push(
          `Failed to upsert job ${row["job_id"] || "unknown"}: ${msg}`
        );
      }
    }

    await completeSyncLog(syncLog.id, {
      records_synced: synced,
      records_updated: synced,
      errors: errors.length > 0 ? errors : undefined,
      status: errors.length === rows.length && rows.length > 0 ? "failed" : "success",
    });

    return NextResponse.json({ ok: true, synced, errors });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Sheets sync failed";
    await completeSyncLog(syncLog.id, {
      records_synced: synced,
      records_updated: synced,
      errors: [message],
      status: "failed",
    });
    return NextResponse.json(
      { ok: false, synced, errors: [message] },
      { status: 500 }
    );
  }
}
