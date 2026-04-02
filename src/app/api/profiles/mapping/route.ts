import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";

// Public endpoint — n8n fetches this on every execution to get
// the current profile → agent mapping. No auth required so n8n
// can call it without credentials beyond what it already has.
// Always fresh — revalidated when profile assignments change.

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await sql`
    SELECT
      p.profile_name,
      p.profile_id,
      p.stack,
      p.clickup_list_id,
      a.name AS assigned_agent,
      a.clickup_user_id AS agent_clickup_id
    FROM profiles p
    LEFT JOIN agents a ON p.agent_id = a.id
    WHERE p.active = true
    ORDER BY p.profile_name
  `;

  // Build the mapping object keyed by profile_name (matches n8n filter_name)
  const mapping: Record<string, {
    assigned_agent: string;
    agent_clickup_id: string;
    profile_id: string;
    stack: string;
    clickup_list_id: string;
  }> = {};

  for (const row of result.rows) {
    mapping[row.profile_name] = {
      assigned_agent: row.assigned_agent || "",
      agent_clickup_id: row.agent_clickup_id || "",
      profile_id: row.profile_id || row.profile_name,
      stack: row.stack || "",
      clickup_list_id: row.clickup_list_id || "",
    };
  }

  return NextResponse.json(mapping, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
    },
  });
}
