import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSavedViews, createSavedView, isProjectMember } from "@/lib/task-data";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: projectId } = await params;
  if (session.user.agentId) {
    const isMember = await isProjectMember(projectId, session.user.agentId);
    if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const views = await getSavedViews(projectId);
  return NextResponse.json(views);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const { id: projectId } = await params;
  const body = await req.json();
  if (!body.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 422 });
  let ownerId = session.user.agentId;
  if (!ownerId) {
    const { sql } = await import("@vercel/postgres");
    const agent = await sql`SELECT id FROM agents WHERE active = true LIMIT 1`;
    if (agent.rows.length === 0) return NextResponse.json({ error: "No active agents" }, { status: 500 });
    ownerId = agent.rows[0].id as string;
  }
  const view = await createSavedView({
    project_id: projectId, owner_id: ownerId, name: body.name.trim(),
    filters: body.filters ?? {}, sort: body.sort ?? {},
  });
  return NextResponse.json(view, { status: 201 });
}
