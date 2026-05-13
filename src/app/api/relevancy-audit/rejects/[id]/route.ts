import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRelevancyAuditRejectDetail } from "@/lib/data";

// GET /api/relevancy-audit/rejects/:id
// Full row detail for the expand-row view (gates, components, summary, confidence).
// Admin only.

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isFinite(id) || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    const detail = await getRelevancyAuditRejectDetail(id);
    if (!detail) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (e) {
    return NextResponse.json(
      { error: "query_failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}
