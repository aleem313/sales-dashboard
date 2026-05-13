import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listRelevancyAuditRejects } from "@/lib/data";

// GET /api/relevancy-audit/rejects
//
// Lists classifier verdicts where effective_decision='reject' in a date window.
// Admin only. Optional filters: profile_ids (comma-separated), hide_overridden.
//
// Query params:
//   from              ISO date string. Default = now - 24h.
//   to                ISO date string. Default = now.
//   profile_ids       Comma-separated profile_id slugs. Default = all profiles.
//   hide_overridden   "true" | "false". Default = "true" (hide already-flagged rows).
//
// Response:
//   { rows: RelevancyAuditRejectRow[], total: number }

export const dynamic = "force-dynamic";

const MAX_WINDOW_DAYS = 90;

function parseDate(value: string | null, fallback: Date): Date | null {
  if (!value) return fallback;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d;
}

export async function GET(req: NextRequest) {
  // 1. Admin auth — middleware already enforces "must be authenticated", we
  //    add the role check here (middleware redirects agent role → /my-dashboard
  //    but a defensive check at the route layer guards against bypass).
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }

  // 2. Parse query params with defaults.
  const sp = req.nextUrl.searchParams;
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const from = parseDate(sp.get("from"), defaultFrom);
  const to = parseDate(sp.get("to"), now);
  if (from === null) {
    return NextResponse.json({ error: "invalid `from` — must be ISO date" }, { status: 400 });
  }
  if (to === null) {
    return NextResponse.json({ error: "invalid `to` — must be ISO date" }, { status: 400 });
  }
  if (from.getTime() > to.getTime()) {
    return NextResponse.json({ error: "`from` must be <= `to`" }, { status: 400 });
  }
  const windowDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
  if (windowDays > MAX_WINDOW_DAYS) {
    return NextResponse.json({ error: `window too large (max ${MAX_WINDOW_DAYS} days)` }, { status: 400 });
  }

  const profileIdsParam = sp.get("profile_ids");
  const profileIds = profileIdsParam
    ? profileIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  // hide_overridden defaults to true. Only "false" turns it off.
  const hideOverridden = sp.get("hide_overridden") !== "false";

  // 3. Query.
  try {
    const result = await listRelevancyAuditRejects({
      from,
      to,
      profileIds,
      hideOverridden,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "query_failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}
