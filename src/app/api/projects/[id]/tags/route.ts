import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProjectTags, createTag, isProjectMember } from "@/lib/task-data";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  // Check membership (system admin bypasses)
  if (session.user.agentId) {
    const isMember = await isProjectMember(projectId, session.user.agentId);
    if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tags = await getProjectTags(projectId);
  return NextResponse.json(tags);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;
  const body = await req.json();

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 422 });
  }

  const tag = await createTag(projectId, body.name.trim(), body.color);
  return NextResponse.json(tag, { status: 201 });
}
