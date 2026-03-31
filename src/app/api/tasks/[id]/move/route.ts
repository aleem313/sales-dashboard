import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { moveTask } from "@/lib/task-data";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await params;
  const body = await request.json();

  if (!body.column_id) {
    return NextResponse.json({ error: "column_id is required" }, { status: 422 });
  }

  const task = await moveTask(
    taskId,
    body.column_id,
    body.position,
    session.user.agentId ?? null
  );

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(task);
}
