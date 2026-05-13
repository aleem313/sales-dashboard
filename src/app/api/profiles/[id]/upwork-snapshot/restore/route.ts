import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getProfileById } from "@/lib/data";
import { restorePreviousSnapshotAction } from "@/lib/actions";

// POST /api/profiles/[id]/upwork-snapshot/restore
// Body: { snapshotId: string }
// Admin-only: promotes the historical snapshot to current and hard-deletes the
// current row. The action does the cache invalidation.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }

  const { id: profileUuid } = await params;
  const profile = await getProfileById(profileUuid);
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  let body: { snapshotId?: string };
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const snapshotId = body?.snapshotId;
  if (!snapshotId || typeof snapshotId !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'snapshotId'" },
      { status: 400 }
    );
  }

  try {
    const result = await restorePreviousSnapshotAction(profile.profile_id, snapshotId);
    return NextResponse.json(result);
  } catch (err) {
    const message = (err as Error).message;
    const status = message === "Admin only" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
