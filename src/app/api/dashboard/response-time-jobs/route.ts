import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseDateRange } from "@/lib/date-utils";
import { getResponseTimeJobs } from "@/lib/data";

// Backing list for the "Response time to apply" card drill-down. Mirrors the
// auth + agent-scoping of /api/dashboard/metric-tasks: agents are forced to
// their own agentId so they can only see their own jobs.
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;

  const range = parseDateRange({
    range: sp.get("range") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    tz: sp.get("tz") ?? undefined,
  });

  const isAgent = session.user.role === "agent";
  const agentId = isAgent ? session.user.agentId : sp.get("agent") ?? undefined;
  const profileId = sp.get("profile") ?? undefined;

  const { jobs, medianMinutes } = await getResponseTimeJobs(range, agentId, profileId);
  return NextResponse.json({ count: jobs.length, medianMinutes, jobs });
}
