import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Public endpoint — n8n fetches this on every execution to get
// the current profile → agent mapping. No auth required so n8n
// can call it without credentials beyond what it already has.
// Always fresh — revalidated when profile assignments change.

export const dynamic = "force-dynamic";

type PortfolioItem = {
  title: string;
  description: string;
};

type UpworkSnapshot = {
  name: string;
  title: string;
  top_rated_status: string;
  hourly_rate: number | null;
  rating: number | null;
  total_jobs: number;
  total_hours: number;
  last_worked_on: string | null;
  skills_summary: string;
  bio: string;
  portfolio: PortfolioItem[];
};

export async function GET() {
  const result = await sql`
    SELECT
      p.profile_name,
      p.profile_id,
      p.stack,
      a.id AS agent_id,
      a.name AS assigned_agent,
      s.name              AS upwork_name,
      s.title             AS upwork_title,
      s.top_rated_status  AS upwork_top_rated_status,
      s.hourly_rate       AS upwork_hourly_rate,
      s.rating            AS upwork_rating,
      s.total_jobs_worked AS upwork_total_jobs,
      s.total_hours       AS upwork_total_hours,
      s.last_worked_on    AS upwork_last_worked_on,
      s.skills_summary    AS upwork_skills_summary,
      s.data->>'description' AS upwork_bio,
      s.data->'portfolio'    AS upwork_portfolio
    FROM profiles p
    LEFT JOIN agents a ON p.agent_id = a.id
    LEFT JOIN upwork_profile_snapshots_current s ON s.profile_id = p.profile_id
    WHERE p.active = true
    ORDER BY p.profile_name
  `;

  const mapping: Record<string, {
    assigned_agent: string;
    agent_id: string;
    profile_id: string;
    stack: string;
    upwork: UpworkSnapshot | null;
  }> = {};

  for (const row of result.rows) {
    let upwork: UpworkSnapshot | null = null;
    if (row.upwork_name) {
      const rawPortfolio = row.upwork_portfolio;
      const portfolioArr: PortfolioItem[] = Array.isArray(rawPortfolio)
        ? rawPortfolio.slice(0, 3).map((p: Record<string, unknown>) => ({
            title: String(p.title ?? p.name ?? ""),
            description: String(p.description ?? "").slice(0, 240),
          }))
        : [];

      upwork = {
        name: String(row.upwork_name ?? ""),
        title: String(row.upwork_title ?? ""),
        top_rated_status: String(row.upwork_top_rated_status ?? ""),
        hourly_rate: row.upwork_hourly_rate !== null ? Number(row.upwork_hourly_rate) : null,
        rating: row.upwork_rating !== null ? Number(row.upwork_rating) : null,
        total_jobs: row.upwork_total_jobs !== null ? Number(row.upwork_total_jobs) : 0,
        total_hours: row.upwork_total_hours !== null ? Number(row.upwork_total_hours) : 0,
        last_worked_on: row.upwork_last_worked_on ? String(row.upwork_last_worked_on) : null,
        skills_summary: String(row.upwork_skills_summary ?? ""),
        bio: String(row.upwork_bio ?? "").slice(0, 1200),
        portfolio: portfolioArr,
      };
    }

    mapping[String(row.profile_name)] = {
      assigned_agent: String(row.assigned_agent ?? ""),
      agent_id: String(row.agent_id ?? ""),
      profile_id: String(row.profile_id ?? row.profile_name),
      stack: String(row.stack ?? ""),
      upwork,
    };
  }

  return NextResponse.json(mapping, {
    headers: {
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
    },
  });
}
