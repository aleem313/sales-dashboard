import { NextRequest, NextResponse } from "next/server";
import { getAgentStats, getCachedStats, setCachedStats } from "@/lib/data";
import type { DateRange } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const days = parseInt(
    request.nextUrl.searchParams.get("days") ?? "30",
    10
  );

  const cacheKey = `agents_stats_${days}d`;
  const cached = await getCachedStats(cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  const range: DateRange = {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };

  const agents = await getAgentStats(range);

  await setCachedStats(cacheKey, agents, 5);

  return NextResponse.json(agents);
}
