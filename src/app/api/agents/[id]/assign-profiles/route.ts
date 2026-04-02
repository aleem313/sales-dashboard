import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getAllProfiles, updateProfileAgent } from "@/lib/data";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: agentId } = await params;
  const { profileIds } = (await request.json()) as { profileIds: string[] };

  if (!Array.isArray(profileIds)) {
    return NextResponse.json({ error: "profileIds must be an array" }, { status: 400 });
  }

  const profiles = await getAllProfiles();

  // Unassign profiles currently assigned to this agent that aren't in the new list
  for (const p of profiles) {
    if (p.agent_id === agentId && !profileIds.includes(p.id)) {
      await updateProfileAgent(p.id, null);
    }
  }

  // Assign selected profiles to this agent
  for (const pid of profileIds) {
    const profile = profiles.find((p) => p.id === pid);
    if (!profile) continue;
    await updateProfileAgent(pid, agentId);
  }

  return NextResponse.json({ success: true, agentId, assignedProfileIds: profileIds });
}
