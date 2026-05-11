import { NextRequest, NextResponse } from "next/server";
import { getTaskJobPayload } from "@/lib/data";

// Phase 4 of plan v3.3.
// GET /api/tasks/:id/job-payload — classifier-ready job JSON projected from
// `tasks.custom_fields`. Used by:
//   - Manual eval (J3 in `job-evaluate-manual` workflow, Phase 8) — fetches the
//     payload before invoking the classifier core.
//   - Future debugging / audit-page replay (any tool that wants to see what
//     payload would be scored if the classifier was re-invoked for this card).
//
// Default source = "manual_url" (the J3 caller). Override via ?source=auto for
// retroactive replay scenarios.
//
// NOT cached — task `custom_fields` can change at any time (column move, edit,
// agent comment) and we always want the freshest projection. The endpoint is
// fast (~5ms): one PK SELECT + one assignee subquery. Auth deferred to Phase 5a.

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;

  if (!taskId || typeof taskId !== "string") {
    return NextResponse.json({ error: "task id is required" }, { status: 400 });
  }

  const sourceParam = req.nextUrl.searchParams.get("source");
  const source: "auto" | "manual_url" = sourceParam === "auto" ? "auto" : "manual_url";

  try {
    const payload = await getTaskJobPayload(taskId, source);
    if (!payload) {
      return NextResponse.json(
        { error: "Task not found", taskId },
        { status: 404 }
      );
    }
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to project job payload", detail: (error as Error).message },
      { status: 500 }
    );
  }
}
