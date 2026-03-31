import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProjectColumns, createColumn, isProjectMember } from "@/lib/task-data";

export async function GET(
  _request: NextRequest,
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

  const columns = await getProjectColumns(projectId);
  return NextResponse.json(columns);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

  const { id: projectId } = await params;
  const body = await request.json();

  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Column name is required" }, { status: 422 });
  }

  if (body.name.trim().length > 50) {
    return NextResponse.json({ error: "Column name must be 50 characters or less" }, { status: 422 });
  }

  // Enforce max 15 columns
  const existing = await getProjectColumns(projectId);
  if (existing.length >= 15) {
    return NextResponse.json({ error: "Maximum 15 columns per project" }, { status: 422 });
  }

  const column = await createColumn(
    projectId,
    body.name.trim(),
    body.color,
    body.is_done
  );

  return NextResponse.json(column, { status: 201 });
}
