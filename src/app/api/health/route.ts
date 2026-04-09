import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const checkDb = searchParams.get("db") === "true";

  const health: Record<string, unknown> = {
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  if (checkDb) {
    try {
      const { sql } = await import("@/lib/db");
      const result = await sql`SELECT 1 AS ping`;
      health.database = result.rows.length > 0 ? "connected" : "error";
    } catch {
      health.database = "error";
      health.status = "degraded";
    }
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}
