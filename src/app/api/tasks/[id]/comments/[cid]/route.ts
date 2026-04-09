import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { auth } from "@/lib/auth";
import { deleteComment } from "@/lib/task-data";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cid: commentId } = await params;
  const agentId = session.user.agentId;

  // Get comment to check ownership and edit window
  const comment = await sql`
    SELECT * FROM comments WHERE id = ${commentId} AND deleted_at IS NULL
  `;
  if (comment.rows.length === 0) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const row = comment.rows[0];

  // Only author can edit
  if (row.author_id !== agentId) {
    return NextResponse.json({ error: "Only the author can edit this comment" }, { status: 403 });
  }

  // 60-minute edit window
  const createdAt = new Date(row.created_at as string);
  const now = new Date();
  const minutesElapsed = (now.getTime() - createdAt.getTime()) / (1000 * 60);
  if (minutesElapsed > 60) {
    return NextResponse.json({ error: "Edit window expired (60 minutes)" }, { status: 403 });
  }

  const body = await request.json();
  if (!body.body || typeof body.body !== "string" || !body.body.trim()) {
    return NextResponse.json({ error: "Comment body is required" }, { status: 422 });
  }

  const result = await sql`
    UPDATE comments SET body = ${body.body.trim()}, updated_at = NOW()
    WHERE id = ${commentId}
    RETURNING *
  `;

  return NextResponse.json(result.rows[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cid: commentId } = await params;
  const agentId = session.user.agentId;

  const comment = await sql`
    SELECT * FROM comments WHERE id = ${commentId}
  `;
  if (comment.rows.length === 0) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const row = comment.rows[0];

  // Author (within 60 min) or admin can delete
  const isAdmin = session.user.role === "admin";
  const isAuthor = row.author_id === agentId;

  if (!isAdmin) {
    if (!isAuthor) {
      return NextResponse.json({ error: "Only the author or admin can delete" }, { status: 403 });
    }
    const createdAt = new Date(row.created_at as string);
    const minutesElapsed = (Date.now() - createdAt.getTime()) / (1000 * 60);
    if (minutesElapsed > 60) {
      return NextResponse.json({ error: "Delete window expired (60 minutes)" }, { status: 403 });
    }
  }

  await deleteComment(commentId);
  return NextResponse.json({ ok: true });
}
