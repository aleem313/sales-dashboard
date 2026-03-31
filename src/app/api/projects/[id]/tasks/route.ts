import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getProjectTasks,
  createTask,
  isProjectMember,
  type TaskFilters,
} from "@/lib/task-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const agentId = session.user.agentId;

  if (agentId && !(await isProjectMember(projectId, agentId))) {
    return NextResponse.json({ error: "Not a project member" }, { status: 403 });
  }

  const searchParams = request.nextUrl.searchParams;
  const filters: TaskFilters = {
    column_id: searchParams.get("column_id") ?? undefined,
    assignee_id: searchParams.get("assignee_id") ?? undefined,
    priority: searchParams.get("priority") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    due_before: searchParams.get("due_before") ?? undefined,
    due_after: searchParams.get("due_after") ?? undefined,
    tag_id: searchParams.get("tag_id") ?? undefined,
    sort_by: searchParams.get("sort_by") ?? undefined,
    sort_dir: (searchParams.get("sort_dir") as "asc" | "desc") ?? undefined,
  };

  const tasks = await getProjectTasks(projectId, filters);
  return NextResponse.json(tasks);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const agentId = session.user.agentId;

  if (agentId && !(await isProjectMember(projectId, agentId))) {
    return NextResponse.json({ error: "Not a project member" }, { status: 403 });
  }

  const body = await request.json();

  if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 422 });
  }
  if (!body.column_id) {
    return NextResponse.json({ error: "Column ID is required" }, { status: 422 });
  }

  const validPriorities = ["urgent", "high", "medium", "low"];
  if (body.priority && !validPriorities.includes(body.priority)) {
    return NextResponse.json(
      { error: "Invalid priority. Must be: urgent, high, medium, low" },
      { status: 422 }
    );
  }

  const task = await createTask({
    project_id: projectId,
    column_id: body.column_id,
    title: body.title.trim(),
    description: body.description ?? null,
    priority: body.priority ?? null,
    due_date: body.due_date ?? null,
    start_date: body.start_date ?? null,
    creator_id: agentId ?? null,
    assignee_ids: body.assignee_ids ?? [],
    tag_ids: body.tag_ids ?? [],
    custom_fields: body.custom_fields ?? {},
  });

  return NextResponse.json(task, { status: 201 });
}
