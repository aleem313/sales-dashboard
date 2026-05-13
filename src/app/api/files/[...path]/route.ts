import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";
import { getUploadsDir, guessMimeType } from "@/lib/uploads";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path: segments } = await params;
  if (!segments || segments.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const uploadsDir = path.resolve(getUploadsDir());
  const relPath = segments.map((s) => decodeURIComponent(s)).join("/");
  const absPath = path.resolve(uploadsDir, relPath);

  // Path-traversal guard: the resolved absolute path must stay inside uploads.
  if (absPath !== uploadsDir && !absPath.startsWith(uploadsDir + path.sep)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let info;
  try {
    info = await stat(absPath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!info.isFile()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = await readFile(absPath);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": guessMimeType(absPath),
      "Content-Length": String(info.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
