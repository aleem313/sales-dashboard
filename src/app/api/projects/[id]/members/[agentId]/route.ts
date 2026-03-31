import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateMemberRole, removeProjectMember } from "@/lib/task-data";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", required_role: "admin" }, { status: 403 });
  }

  const { id: projectId, agentId } = await params;
  const body = await request.json();

  if (!body.role || !["admin", "member"].includes(body.role)) {
    return NextResponse.json({ error: "role must be 'admin' or 'member'" }, { status: 422 });
  }

  const result = await updateMemberRole(projectId, agentId, body.role);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; agentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", required_role: "admin" }, { status: 403 });
  }

  const { id: projectId, agentId } = await params;
  const unassign = request.nextUrl.searchParams.get("unassign") === "true";

  const result = await removeProjectMember(projectId, agentId, unassign);
  if (!result.success) {
    const status = result.assignedTaskCount ? 409 : 400;
    return NextResponse.json(
      { error: result.error, assigned_task_count: result.assignedTaskCount },
      { status }
    );
  }

  return NextResponse.json({ ok: true });
}
