import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTaskActivity } from "@/lib/task-data";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: taskId } = await params;
  const commentsOnly = request.nextUrl.searchParams.get("comments_only") === "true";

  const activity = await getTaskActivity(taskId, commentsOnly);
  return NextResponse.json(activity);
}
