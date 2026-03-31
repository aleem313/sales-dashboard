import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAllProjects, getUserProjectsWithMeta, createProject } from "@/lib/task-data";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const projects =
    session.user.role === "admin"
      ? await getAllProjects()
      : session.user.agentId
        ? await getUserProjectsWithMeta(session.user.agentId)
        : [];

  return NextResponse.json(projects);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden", required_role: "admin" }, { status: 403 });
  }

  const body = await request.json();

  if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Board name is required" }, { status: 422 });
  }
  if (body.name.trim().length > 100) {
    return NextResponse.json({ error: "Board name must be 100 characters or less" }, { status: 422 });
  }

  // Use agentId if available, otherwise find/create an owner
  let creatorId = session.user.agentId;
  if (!creatorId) {
    // Admin via env var — find first active agent as proxy owner
    const { sql } = await import("@vercel/postgres");
    const agent = await sql`SELECT id FROM agents WHERE active = true LIMIT 1`;
    if (agent.rows.length === 0) {
      return NextResponse.json({ error: "No active agents to assign as board owner" }, { status: 500 });
    }
    creatorId = agent.rows[0].id as string;
  }

  const project = await createProject({
    name: body.name.trim(),
    description: body.description?.trim() || null,
    creator_id: creatorId,
  });

  return NextResponse.json(project, { status: 201 });
}
