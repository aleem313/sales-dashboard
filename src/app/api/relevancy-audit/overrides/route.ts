import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { createAdminAuditOverride } from "@/lib/data";

// POST /api/relevancy-audit/overrides
// Body: { score_id: number, note?: string }
// Admin only. Creates a single admin_audit override row tied to session.user.id.

export const dynamic = "force-dynamic";

const NOTE_MAX_LEN = 2000;

interface Body {
  score_id?: unknown;
  note?: unknown;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin_only" }, { status: 403 });
  }
  const adminId = session.user.id;
  if (!adminId) {
    return NextResponse.json({ error: "no_admin_id" }, { status: 500 });
  }

  // Parse + validate body.
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const scoreId = Number(body.score_id);
  if (!Number.isFinite(scoreId) || !Number.isInteger(scoreId) || scoreId <= 0) {
    return NextResponse.json({ error: "score_id must be a positive integer" }, { status: 400 });
  }

  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") {
      return NextResponse.json({ error: "note must be a string" }, { status: 400 });
    }
    const trimmed = body.note.trim();
    if (trimmed.length > NOTE_MAX_LEN) {
      return NextResponse.json(
        { error: `note too long (max ${NOTE_MAX_LEN} chars)` },
        { status: 400 }
      );
    }
    note = trimmed.length > 0 ? trimmed : null;
  }

  try {
    const result = await createAdminAuditOverride({ scoreId, adminId, note });
    if ("error" in result) {
      if (result.error === "score_not_found") {
        return NextResponse.json({ error: "score_not_found" }, { status: 404 });
      }
      if (result.error === "already_overridden") {
        return NextResponse.json(
          { error: "already_overridden", override_id: result.override_id },
          { status: 409 }
        );
      }
    } else {
      revalidatePath("/relevancy-audit");
      return NextResponse.json(result, { status: 201 });
    }
    return NextResponse.json({ error: "unknown" }, { status: 500 });
  } catch (e) {
    return NextResponse.json(
      { error: "insert_failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}
