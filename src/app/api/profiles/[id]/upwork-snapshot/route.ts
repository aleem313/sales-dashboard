import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { auth } from "@/lib/auth";
import {
  getProfileById,
  getUpworkProfileSnapshot,
  getUpworkProfileSnapshotById,
  getUpworkProfileSnapshotHistory,
} from "@/lib/data";
import { saveUpworkProfileSnapshotAction } from "@/lib/actions";
import {
  extractProfileFromHtml,
  ProfileExtractionError,
} from "@/lib/upwork-extractor";

const MAX_ZIP_SIZE = 25 * 1024 * 1024; // 25 MB

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
//   - Body can be:
//       * application/json — parsed snapshot itself (admin path; legacy)
//       * multipart/form-data with `file` field:
//           - .json → snapshot itself
//           - .zip  → Chrome "Save Page As → Webpage, Complete" output; the server
//             extracts the .html, runs the extractor, and stores the result.
//   - Auth: admins can upload to any profile; agents only to their own assigned profile.
//     The auth check lives inside saveUpworkProfileSnapshotAction.
export async function POST(
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

  // Resolve the snapshot JSON from whichever input shape the client sent.
  let json: unknown;
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const fileField = form.get("file");
      if (!fileField || typeof fileField === "string") {
        return NextResponse.json(
          { error: "Missing 'file' field in form data" },
          { status: 400 }
        );
      }
      const file = fileField as File;
      const filename = (file.name || "").toLowerCase();
      const fileType = (file.type || "").toLowerCase();
      const looksZip =
        filename.endsWith(".zip") ||
        fileType === "application/zip" ||
        fileType === "application/x-zip-compressed";

      if (looksZip) {
        if (file.size > MAX_ZIP_SIZE) {
          return NextResponse.json(
            {
              error: `ZIP is too large (${(file.size / 1024 / 1024).toFixed(
                1
              )} MB, max 25 MB). Make sure you didn't accidentally include other files.`,
            },
            { status: 400 }
          );
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        try {
          json = await extractFromZipBuffer(buffer, file.name || "upload.zip");
        } catch (err) {
          return NextResponse.json(
            { error: zipErrorMessage(err as Error) },
            { status: 400 }
          );
        }
      } else {
        // .json file — parse the text body.
        const text = await file.text();
        try {
          json = JSON.parse(text);
        } catch (err) {
          return NextResponse.json(
            { error: `Invalid JSON: ${(err as Error).message}` },
            { status: 400 }
          );
        }
      }
    } else {
      json = await request.json();
    }
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read request body: ${(err as Error).message}` },
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
    const message = (err as Error).message;
    const status =
      message === "Unauthorized"
        ? 401
        : message.includes("Not authorized")
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

// Unzips an in-memory ZIP buffer, locates the first .html entry that
// isn't inside a *_files/ sidecar directory, and runs the extractor.
// Throws ProfileExtractionError or a plain Error with a user-readable message.
async function extractFromZipBuffer(
  buffer: Buffer,
  archiveName: string
): Promise<unknown> {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    throw new Error(
      `Could not open ZIP archive (${(err as Error).message}). Make sure the file is a valid .zip.`
    );
  }

  const entries = zip.getEntries();
  const htmlEntry = entries.find(
    (e) =>
      !e.isDirectory &&
      e.entryName.toLowerCase().endsWith(".html") &&
      // ignore HTML files Chrome may have placed inside the *_files sidecar
      !/_files\//i.test(e.entryName)
  );

  if (!htmlEntry) {
    throw new Error(
      "ZIP doesn't contain an HTML file. Save the Upwork profile page with 'Save Page As → Webpage, Complete' (Ctrl+S), then zip the resulting .html and *_files folder together."
    );
  }

  const html = htmlEntry.getData().toString("utf8");
  // extractProfileFromHtml may throw ProfileExtractionError — bubble up unchanged
  // so the caller can map error.code to a specific user-facing message.
  return extractProfileFromHtml(html, htmlEntry.entryName || archiveName);
}

function zipErrorMessage(err: Error): string {
  if (err instanceof ProfileExtractionError) {
    switch (err.code) {
      case "no_nuxt":
      case "eval_failed":
        return "Couldn't read profile data from this HTML. The page you saved doesn't look like a freelancer profile page. Open your profile on Upwork, then re-save and re-zip.";
      case "no_identity":
      case "no_stats":
        return "Extracted data is missing required fields (name/stats). The profile page may not have fully loaded before saving. Reload the page on Upwork, wait until all sections are visible, then re-save.";
    }
  }
  return err.message;
}
