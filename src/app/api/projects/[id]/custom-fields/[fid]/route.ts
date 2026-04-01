import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateCustomFieldDefinition, archiveCustomFieldDefinition } from "@/lib/task-data";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fid: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const { fid } = await params;
  const body = await req.json();
  const field = await updateCustomFieldDefinition(fid, {
    name: body.name, options: body.options, required: body.required, show_on_card: body.show_on_card,
  });
  if (!field) return NextResponse.json({ error: "Field not found" }, { status: 404 });
  return NextResponse.json(field);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fid: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const { fid } = await params;
  const archived = await archiveCustomFieldDefinition(fid);
  if (!archived) return NextResponse.json({ error: "Field not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
