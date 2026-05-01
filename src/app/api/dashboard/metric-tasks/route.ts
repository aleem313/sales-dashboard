import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseDateRange } from "@/lib/date-utils";
import { getKPIMetricTasks, type KPIMetricKey } from "@/lib/data";

const ALLOWED_METRICS: ReadonlySet<KPIMetricKey> = new Set([
  "total_jobs",
  "proposals_sent",
  "proposals_viewed",
  "in_chat",
  "meetings_booked",
  "meetings_done",
  "won",
  "lost",
  "bad_leads",
  "untouched",
]);

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const metricRaw = sp.get("metric");
  if (!metricRaw || !ALLOWED_METRICS.has(metricRaw as KPIMetricKey)) {
    return NextResponse.json({ error: "Invalid metric" }, { status: 400 });
  }
  const metric = metricRaw as KPIMetricKey;

  const range = parseDateRange({
    range: sp.get("range") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    tz: sp.get("tz") ?? undefined,
  });

  const isAgent = session.user.role === "agent";
  const agentId = isAgent
    ? session.user.agentId
    : sp.get("agent") ?? undefined;
  const profileId = sp.get("profile") ?? undefined;

  const tasks = await getKPIMetricTasks(metric, range, agentId, profileId);
  return NextResponse.json({ count: tasks.length, tasks });
}
