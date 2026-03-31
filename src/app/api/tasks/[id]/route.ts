import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTaskById, updateTask, deleteTask, isProjectMember } from "@/lib/task-data";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await params;
  const task = await getTaskById(taskId);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const agentId = session.user.agentId;
  if (agentId && !(await isProjectMember(task.project_id, agentId))) {
    return NextResponse.json({ error: "Not a project member" }, { status: 403 });
  }

  return NextResponse.json(task);
}

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

  const validPriorities = ["urgent", "high", "medium", "low", null];
  if (body.priority !== undefined && !validPriorities.includes(body.priority)) {
    return NextResponse.json(
      { error: "Invalid priority. Must be: urgent, high, medium, low, or null" },
      { status: 422 }
    );
  }

  const task = await updateTask(
    taskId,
    {
      title: body.title,
      description: body.description,
      priority: body.priority,
      due_date: body.due_date,
      start_date: body.start_date,
      custom_fields: body.custom_fields,
    },
    session.user.agentId ?? null
  );

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json(task);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Admin only
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { error: "Forbidden", required_role: "admin" },
      { status: 403 }
    );
  }

  const { id: taskId } = await params;
  const deleted = await deleteTask(taskId, session.user.agentId ?? null);

  if (!deleted) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
