import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteSavedView } from "@/lib/task-data";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const { vid } = await params;
  const deleted = await deleteSavedView(vid);
  if (!deleted) return NextResponse.json({ error: "View not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
