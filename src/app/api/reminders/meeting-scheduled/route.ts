import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getMeetingScheduledTasks } from "@/lib/data";

// Cards currently sitting in the "Meeting Scheduled" column, for the floating
// reminder widget. Admins see every card; agents see only their assigned cards
// (same role-scoping as /api/dashboard/metric-tasks).
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const agentId =
    session.user.role === "agent" ? session.user.agentId ?? null : null;

  const tasks = await getMeetingScheduledTasks(agentId);
  return NextResponse.json({ count: tasks.length, tasks });
}
