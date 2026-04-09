import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get("limit") ?? "20"),
    50
  );

  const result = await sql`
    SELECT id, job_id, job_title, job_url, budget_type, budget_min, budget_max,
           client_country, posted_at, outcome, skills, proposal_text,
           status, agent_id
    FROM jobs
    WHERE (${q}::text = '' OR job_title ILIKE '%' || ${q}::text || '%'
           OR job_id ILIKE '%' || ${q}::text || '%')
    ORDER BY received_at DESC
    LIMIT ${limit}
  `;

  return NextResponse.json(result.rows);
}
