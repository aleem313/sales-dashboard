import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

export function isSheetsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY &&
    process.env.GOOGLE_SHEET_ID
  );
}

async function getAuthClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
  await auth.authorize();
  return auth;
}

export async function fetchSheetRows(): Promise<Record<string, string>[]> {
  const auth = await getAuthClient();
  const sheets = google.sheets({ version: "v4", auth });

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: "job_log",
  });

  const rows = response.data.values;
  if (!rows || rows.length < 2) return [];

  const headers = rows[0].map((h: string) => h.trim().toLowerCase());

  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header: string, i: number) => {
      obj[header] = row[i] ?? "";
    });
    return obj;
  });
}

export function mapSheetRowToJobData(row: Record<string, string>) {
  return {
    job_id: row["job_id"] || row["id"],
    job_title: row["job_title"] || row["title"] || "Untitled",
    job_url: row["job_url"] || row["url"] || null,
    job_description: row["job_description"] || row["description"] || null,
    budget_type: row["budget_type"] || null,
    budget_min: row["budget_min"] ? parseFloat(row["budget_min"]) : null,
    budget_max: row["budget_max"] ? parseFloat(row["budget_max"]) : null,
    hourly_min: row["hourly_min"] ? parseFloat(row["hourly_min"]) : null,
    hourly_max: row["hourly_max"] ? parseFloat(row["hourly_max"]) : null,
    skills: row["skills"]
      ? row["skills"].split(",").map((s) => s.trim())
      : null,
    client_country: row["client_country"] || null,
    client_rating: row["client_rating"]
      ? parseFloat(row["client_rating"])
      : null,
    client_total_spent: row["client_total_spent"]
      ? parseFloat(row["client_total_spent"])
      : null,
    client_hires: row["client_hires"]
      ? parseInt(row["client_hires"], 10)
      : null,
    posted_at: row["posted_at"] || null,
    profile_id: row["profile_id"] || null,
    agent_id: row["agent_id"] || null,
    clickup_task_id: row["clickup_task_id"] || null,
    clickup_task_url: row["clickup_task_url"] || null,
    clickup_status: row["clickup_status"] || "New",
    proposal_text: row["proposal_text"] || null,
    gpt_model: row["gpt_model"] || null,
    gpt_tokens_used: row["gpt_tokens_used"]
      ? parseInt(row["gpt_tokens_used"], 10)
      : null,
  };
}
