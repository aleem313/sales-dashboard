import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTaskComments, createComment, getTaskById, isProjectMember } from "@/lib/task-data";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await params;
  const comments = await getTaskComments(taskId);
  return NextResponse.json(comments);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await params;
  const agentId = session.user.agentId;

  if (!agentId) {
    return NextResponse.json({ error: "Agent ID required" }, { status: 401 });
  }

  // Verify task exists and user has access
  const task = await getTaskById(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  if (!(await isProjectMember(task.project_id, agentId))) {
    return NextResponse.json({ error: "Not a project member" }, { status: 403 });
  }

  const body = await request.json();

  if (!body.body || typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "Comment body is required" }, { status: 422 });
  }

  const comment = await createComment(
    taskId,
    agentId,
    body.body.trim(),
    body.parent_id ?? null
  );

  return NextResponse.json(comment, { status: 201 });
}
