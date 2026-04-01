import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCustomFieldDefinitions, createCustomFieldDefinition, isProjectMember } from "@/lib/task-data";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: projectId } = await params;
  if (session.user.agentId) {
    const isMember = await isProjectMember(projectId, session.user.agentId);
    if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const includeArchived = req.nextUrl.searchParams.get("archived") === "true";
  const fields = await getCustomFieldDefinitions(projectId, includeArchived);
  return NextResponse.json(fields);
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
  const validTypes = ["text", "number", "dropdown", "multi_select", "date", "boolean"];
  if (!validTypes.includes(body.field_type)) return NextResponse.json({ error: "Invalid field type" }, { status: 422 });
  const field = await createCustomFieldDefinition(projectId, {
    name: body.name.trim(), field_type: body.field_type,
    options: body.options ?? null, required: body.required ?? false, show_on_card: body.show_on_card ?? false,
  });
  return NextResponse.json(field, { status: 201 });
}
