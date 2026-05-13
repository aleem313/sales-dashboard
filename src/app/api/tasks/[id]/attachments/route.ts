import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getTaskById, isProjectMember } from "@/lib/task-data";
import { getUploadsDir, sanitizeFilename } from "@/lib/uploads";

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: taskId } = await params;
  const result = await sql`
    SELECT fa.*, a.name AS uploader_name
    FROM file_attachments fa
    LEFT JOIN agents a ON a.id = fa.uploader_id
    WHERE fa.task_id = ${taskId}
    ORDER BY fa.created_at DESC
  `;
  return NextResponse.json(result.rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: taskId } = await params;
  const task = await getTaskById(taskId);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const agentId = session.user.agentId;
  if (agentId && !(await isProjectMember(task.project_id, agentId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 422 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 422 });

  const safeName = `${randomUUID()}-${sanitizeFilename(file.name)}`;
  const relPath = `tasks/${taskId}/${safeName}`;
  const absPath = path.join(getUploadsDir(), relPath);

  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, Buffer.from(await file.arrayBuffer()));

  const publicUrl = `/api/files/${relPath}`;

  const result = await sql`
    INSERT INTO file_attachments (task_id, filename, url, blob_path, size_bytes, mime_type, uploader_id)
    VALUES (${taskId}, ${file.name}, ${publicUrl}, ${relPath}, ${file.size}, ${file.type}, ${agentId ?? null})
    RETURNING *
  `;

  return NextResponse.json(result.rows[0], { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params: _params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const attachmentId = searchParams.get("attachmentId");
  if (!attachmentId) return NextResponse.json({ error: "attachmentId required" }, { status: 422 });

  const att = await sql`SELECT * FROM file_attachments WHERE id = ${attachmentId}`;
  if (att.rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = att.rows[0];
  const isAdmin = session.user.role === "admin";
  const isUploader = session.user.agentId === row.uploader_id;
  if (!isAdmin && !isUploader) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Remove from disk. Legacy rows (Vercel Blob era) have an absolute URL in
  // `url` and no on-disk file — those silently no-op here.
  const blobPath = row.blob_path as string | null;
  if (blobPath) {
    const absPath = path.join(getUploadsDir(), blobPath);
    try {
      await fs.unlink(absPath);
    } catch {
      // file may already be gone — nothing to do
    }
  }

  await sql`DELETE FROM file_attachments WHERE id = ${attachmentId}`;
  return NextResponse.json({ deleted: true });
}
