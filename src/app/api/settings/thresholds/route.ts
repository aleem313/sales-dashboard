import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getCachedStats, setCachedStats } from "@/lib/data";
import type { AlertThresholds } from "@/lib/types";

const DEFAULT_THRESHOLDS: AlertThresholds = {
  winRateMin: 20,
  responseTimeMaxHours: 4,
  dailyJobsMin: 5,
};

export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  const cached = await getCachedStats("alert_thresholds");
  return NextResponse.json(cached ?? DEFAULT_THRESHOLDS);
}

export async function POST(request: Request) {
  const authError = await requireAuth();
  if (authError) return authError;

  const body = (await request.json()) as Partial<AlertThresholds>;
  const thresholds: AlertThresholds = {
    winRateMin: body.winRateMin ?? DEFAULT_THRESHOLDS.winRateMin,
    responseTimeMaxHours:
      body.responseTimeMaxHours ?? DEFAULT_THRESHOLDS.responseTimeMaxHours,
    dailyJobsMin: body.dailyJobsMin ?? DEFAULT_THRESHOLDS.dailyJobsMin,
  };

  // 1-year TTL
  await setCachedStats("alert_thresholds", thresholds, 525600);
  return NextResponse.json(thresholds);
}
