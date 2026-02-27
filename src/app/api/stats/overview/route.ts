import { NextRequest, NextResponse } from "next/server";
import {
  getKPIMetrics,
  getTopAgentsByWinRate,
  getTopProfilesByVolume,
  getCachedStats,
  setCachedStats,
} from "@/lib/data";
import type { DateRange } from "@/lib/types";
import { requireAuth } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const days = parseInt(
    request.nextUrl.searchParams.get("days") ?? "30",
    10
  );

  const cacheKey = `overview_${days}d`;
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

  const [kpis, topAgents, topProfiles] = await Promise.all([
    getKPIMetrics(range),
    getTopAgentsByWinRate(5, range),
    getTopProfilesByVolume(5, range),
  ]);

  const data = { kpis, topAgents, topProfiles, days };

  await setCachedStats(cacheKey, data, 5);

  return NextResponse.json(data);
}
