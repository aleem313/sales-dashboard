import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProjectById, updateProject, deleteProject, getProjectTaskCount } from "@/lib/task-data";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const project = await getProjectById(id);
  if (!project) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", required_role: "admin" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Board name cannot be empty" }, { status: 422 });
    }
    if (body.name.trim().length > 100) {
      return NextResponse.json({ error: "Board name must be 100 characters or less" }, { status: 422 });
    }
    body.name = body.name.trim();
  }

  const project = await updateProject(id, {
    name: body.name,
    description: body.description,
  });

  if (!project) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", required_role: "admin" }, { status: 403 });
  }

  const { id } = await params;
  const taskCount = await getProjectTaskCount(id);

  // Require confirm=true if board has tasks
  const confirm = request.nextUrl.searchParams.get("confirm") === "true";
  if (taskCount > 0 && !confirm) {
    return NextResponse.json(
      { error: "Board has active tasks", task_count: taskCount, confirm_required: true },
      { status: 409 }
    );
  }

  const deleted = await deleteProject(id);
  if (!deleted) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted_tasks: taskCount });
}
