import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getProfileContext } from "@/lib/data";

// Phase 3 of plan v3.3.
// GET /api/profiles/:id/context — classifier-ready profile JSON.
//
// Caching strategy (plan §11.4):
//   - 5-min unstable_cache, dual-tagged by `profile-context-<id>` + `system-settings`
//   - revalidateTag('profile-context-<id>') fires from saveUpworkProfileSnapshotAction
//   - revalidateTag('system-settings') fires from Phase 5b settings mutations
//
// Auth is intentionally NOT enforced here — Phase 5a will install the shared
// HMAC + idempotency middleware that wraps all n8n-callable routes.

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: profileId } = await params;

  if (!profileId || typeof profileId !== "string") {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  // unstable_cache key MUST include the profileId so each profile gets its own cache slot.
  // Both tags are needed: per-profile bust on snapshot upload, global bust on settings change.
  const getCached = unstable_cache(
    async (pid: string) => getProfileContext(pid),
    ["profile-context", profileId],
    {
      revalidate: 300,
      tags: [`profile-context-${profileId}`, "system-settings"],
    }
  );

  try {
    const context = await getCached(profileId);
    if (!context) {
      return NextResponse.json(
        { error: "No current Upwork snapshot for this profile", profileId },
        { status: 404 }
      );
    }
    return NextResponse.json(context);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to assemble profile context", detail: (error as Error).message },
      { status: 500 }
    );
  }
}
