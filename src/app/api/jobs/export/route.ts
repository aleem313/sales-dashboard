import { NextRequest, NextResponse } from "next/server";
import { getJobs } from "@/lib/data";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const result = await getJobs({
    agent_id: params.get("agent") ?? undefined,
    profile_id: params.get("profile") ?? undefined,
    clickup_status: params.get("status") ?? undefined,
    outcome: params.get("outcome") ?? undefined,
    budget_type: params.get("budget_type") ?? undefined,
    search: params.get("search") ?? undefined,
    limit: 5000,
    page: 1,
  });

  const headers = [
    "Job Title",
    "Profile",
    "Agent",
    "Status",
    "Outcome",
    "Budget Type",
    "Budget Min",
    "Budget Max",
    "Won Value",
    "Client Country",
    "Client Rating",
    "Received At",
    "Proposal Sent At",
    "Outcome At",
    "Job URL",
  ];

  const rows = result.data.map((job) => {
    const row = job as unknown as Record<string, unknown>;
    return [
      job.job_title,
      (row.profile_name as string) ?? "",
      (row.agent_name as string) ?? "",
      job.clickup_status,
      job.outcome ?? "",
      job.budget_type ?? "",
      job.budget_min ?? "",
      job.budget_max ?? "",
      job.won_value ?? "",
      job.client_country ?? "",
      job.client_rating ?? "",
      job.received_at,
      job.proposal_sent_at ?? "",
      job.outcome_at ?? "",
      job.job_url ?? "",
    ];
  });

  const escape = (v: unknown) => {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="jobs-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
