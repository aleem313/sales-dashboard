import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reorderCustomFieldDefinitions } from "@/lib/task-data";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const { id: projectId } = await params;
  const body = await req.json();
  if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return NextResponse.json({ error: "orderedIds array required" }, { status: 422 });
  }
  await reorderCustomFieldDefinitions(projectId, body.orderedIds);
  return NextResponse.json({ success: true });
}
