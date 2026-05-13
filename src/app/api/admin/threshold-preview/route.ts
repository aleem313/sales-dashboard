import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getThresholdPreview } from "@/lib/data";

// GET /api/admin/threshold-preview?profile_id=<slug>&days=7
//
// Admin-only. Backs the inline preview widget on /settings → Relevancy
// Classifier card. Tells the operator "at min_score=N, this many recent
// proceeds would flip to reject" so Phase 13 calibration is data-driven
// instead of a guess.
//
// Returns:
//   { window_days, profile_id, total, scored, by_decision,
//     by_effective_decision, proceeds_total, would_flip[], score_distribution[] }

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const profileId = sp.get("profile_id");
  const daysRaw = sp.get("days");
  const days = daysRaw ? Number(daysRaw) : 7;
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    return NextResponse.json({ error: "days must be 1-90" }, { status: 400 });
  }

  try {
    const preview = await getThresholdPreview({
      windowDays: days,
      profileId: profileId && profileId.trim() ? profileId.trim() : null,
    });
    return NextResponse.json(preview);
  } catch (e) {
    return NextResponse.json(
      { error: "preview_failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}
