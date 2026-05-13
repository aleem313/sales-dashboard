import { NextRequest, NextResponse } from "next/server";
import { drainRelevancyScoresDlq } from "@/lib/data";

// POST /api/cron/relevancy-dlq-drain
//
// Hit hourly by .github/workflows/relevancy-dlq-drain.yml. Re-attempts failed
// audit-log writes parked in relevancy_scores_dlq. Plan v3.3 Appendix C.
//
// Auth: same CRON_SECRET Bearer pattern as /api/migrate. Re-using the existing
// secret avoids provisioning a new one. GET supported for ad-hoc browser /
// curl checks; POST is what the cron uses.

export const dynamic = "force-dynamic";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Header (preferred by GH Actions) OR ?secret= query (browser debugging).
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  const querySecret = req.nextUrl.searchParams.get("secret");
  return querySecret === secret;
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await drainRelevancyScoresDlq({
      maxAttempts: MAX_ATTEMPTS,
      batchSize: BATCH_SIZE,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "drain_failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}

export const POST = handle;
export const GET = handle;
