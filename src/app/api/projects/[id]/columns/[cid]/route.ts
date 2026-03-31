import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateColumn, deleteColumn } from "@/lib/task-data";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden", required_role: "admin" },
      { status: 403 }
    );
  }

  const { cid: columnId } = await params;
  const body = await request.json();

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Column name cannot be empty" }, { status: 422 });
    }
    if (body.name.trim().length > 50) {
      return NextResponse.json({ error: "Column name must be 50 characters or less" }, { status: 422 });
    }
    body.name = body.name.trim();
  }

  const column = await updateColumn(columnId, {
    name: body.name,
    color: body.color,
    is_done: body.is_done,
    wip_limit: body.wip_limit,
  });

  return NextResponse.json(column);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden", required_role: "admin" },
      { status: 403 }
    );
  }

  const { cid: columnId } = await params;
  const result = await deleteColumn(columnId);

  if (!result.deleted) {
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }
    return NextResponse.json(
      { error: `Cannot delete column with ${result.taskCount} tasks. Move or delete tasks first.` },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
