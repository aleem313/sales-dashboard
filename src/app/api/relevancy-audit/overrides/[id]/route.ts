import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { deleteAdminAuditOverride } from "@/lib/data";

// DELETE /api/relevancy-audit/overrides/:id
// Admin only. Hard-deletes an admin_audit override row, but only if the row's
// admin_id matches the requesting admin (admins can only delete their own).

export const dynamic = "force-dynamic";

export async function DELETE(
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
  const adminId = session.user.id;
  if (!adminId) {
    return NextResponse.json({ error: "no_admin_id" }, { status: 500 });
  }

  const { id: rawId } = await params;
  const overrideId = Number(rawId);
  if (!Number.isFinite(overrideId) || !Number.isInteger(overrideId) || overrideId <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  try {
    const outcome = await deleteAdminAuditOverride({ overrideId, adminId });
    if (outcome === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (outcome === "forbidden") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    revalidatePath("/relevancy-audit");
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    return NextResponse.json(
      { error: "delete_failed", detail: (e as Error).message },
      { status: 500 }
    );
  }
}
