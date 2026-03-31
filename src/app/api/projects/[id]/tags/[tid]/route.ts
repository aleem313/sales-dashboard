import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sql } from "@vercel/postgres";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tid: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tid } = await params;
  const body = await req.json();

  const result = await sql`
    UPDATE task_tags SET
      name = COALESCE(${body.name ?? null}, name),
      color = COALESCE(${body.color ?? null}, color)
    WHERE id = ${tid}
    RETURNING *
  `;
  if (result.rows.length === 0) {
    return NextResponse.json({ error: "Tag not found" }, { status: 404 });
  }

  return NextResponse.json(result.rows[0]);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; tid: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { tid } = await params;
  await sql`DELETE FROM task_tags WHERE id = ${tid}`;
  return NextResponse.json({ deleted: true });
}
