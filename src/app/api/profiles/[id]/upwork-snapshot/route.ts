import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getProfileById,
  getUpworkProfileSnapshot,
  getUpworkProfileSnapshotById,
  getUpworkProfileSnapshotHistory,
} from "@/lib/data";
import { saveUpworkProfileSnapshotAction } from "@/lib/actions";

// GET /api/profiles/[id]/upwork-snapshot
//   → current snapshot (full JSONB)
// GET /api/profiles/[id]/upwork-snapshot?history=1
//   → lightweight history rows (no JSONB), most recent first
// GET /api/profiles/[id]/upwork-snapshot?snapshotId=<uuid>
//   → that specific historical snapshot (full JSONB)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: profileUuid } = await params;
  const profile = await getProfileById(profileUuid);
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Agents can only read their own profiles.
  if (session.user.role !== "admin") {
    if (!profile.agent_id || profile.agent_id !== session.user.agentId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const url = request.nextUrl;
  const snapshotId = url.searchParams.get("snapshotId");
  if (snapshotId) {
    const snap = await getUpworkProfileSnapshotById(snapshotId);
    if (!snap || snap.profile_id !== profile.profile_id) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }
    return NextResponse.json({ snapshot: snap });
  }

  if (url.searchParams.get("history")) {
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam) || 20, 1), 100) : 20;
    const rows = await getUpworkProfileSnapshotHistory(profile.profile_id, limit);
    return NextResponse.json({ history: rows });
  }

  const current = await getUpworkProfileSnapshot(profile.profile_id);
  if (!current) {
    return NextResponse.json({ snapshot: null }, { status: 200 });
  }
  return NextResponse.json({ snapshot: current });
}

// POST /api/profiles/[id]/upwork-snapshot
//   - Body can be application/json (the parsed snapshot itself) OR
//     multipart/form-data with a `file` field (a .json file upload).
//   - Admin-only (agents currently read-only on snapshots).
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

  // Parse the body — either JSON or multipart with a file field.
  let json: unknown;
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "Missing 'file' field in form data" }, { status: 400 });
      }
      const text = await (file as File).text();
      json = JSON.parse(text);
    } else {
      json = await request.json();
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  try {
    const result = await saveUpworkProfileSnapshotAction(profile.profile_id, json);
    return NextResponse.json({
      ok: true,
      id: result.id,
      replaced: result.replaced,
      profileId: profile.profile_id,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}
