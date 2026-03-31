import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reorderColumns, getProjectColumns } from "@/lib/task-data";

export async function PATCH(
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

  if (!body.orderedIds || !Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return NextResponse.json({ error: "orderedIds array is required" }, { status: 422 });
  }

  await reorderColumns(projectId, body.orderedIds);
  const columns = await getProjectColumns(projectId);

  return NextResponse.json(columns);
}
