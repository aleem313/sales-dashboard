import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProjectMembers, addProjectMembers, isProjectMember } from "@/lib/task-data";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId } = await params;
  const members = await getProjectMembers(projectId);
  return NextResponse.json(members);
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
    return NextResponse.json({ error: "Forbidden", required_role: "admin" }, { status: 403 });
  }

  const { id: projectId } = await params;
  const body = await request.json();

  if (!body.agent_ids || !Array.isArray(body.agent_ids) || body.agent_ids.length === 0) {
    return NextResponse.json({ error: "agent_ids array is required" }, { status: 422 });
  }

  const role = body.role === "admin" ? "admin" : "member";
  const added = await addProjectMembers(projectId, body.agent_ids, role);

  return NextResponse.json({ ok: true, added }, { status: 201 });
}
