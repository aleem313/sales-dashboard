import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteActivityMoveAction } from "@/lib/task-actions";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; activityId: string }> }
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

  const { id: taskId, activityId } = await params;
  const result = await deleteActivityMoveAction(taskId, activityId);

  if (result.ok) return NextResponse.json({ ok: true });

  if (result.reason === "forbidden") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (result.reason === "not_found") {
    return NextResponse.json({ error: "Activity entry not found" }, { status: 404 });
  }
  if (result.reason === "wrong_type") {
    return NextResponse.json(
      { error: "Only task_moved entries can be deleted" },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: "Unknown error" }, { status: 500 });
}
