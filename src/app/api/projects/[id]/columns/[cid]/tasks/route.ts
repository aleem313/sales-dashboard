// src/app/api/projects/[id]/columns/[cid]/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getColumnTasksPage, isProjectMember } from "@/lib/task-data";
import { parseBoardFiltersFromSearchParams, PAGE_SIZE } from "@/lib/board-filters";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: projectId, cid: columnId } = await params;
  const agentId = session.user.agentId;

  if (agentId && !(await isProjectMember(projectId, agentId))) {
    return NextResponse.json({ error: "Not a project member" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const filters = parseBoardFiltersFromSearchParams(sp);
  // Column scoping comes from the URL segment, not the filter bag.
  filters.columnId = undefined;
  const offset = Math.max(0, parseInt(sp.get("offset") ?? "0", 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(sp.get("limit") ?? String(PAGE_SIZE), 10) || PAGE_SIZE));

  const isAdmin = session.user.role === "admin";
  const result = await getColumnTasksPage(projectId, columnId, filters, offset, limit, {
    agentId,
    agentScopeOnCurrentBoard: !isAdmin && !!agentId,
  });

  return NextResponse.json(result);
}
