import { sql } from "@vercel/postgres";
import type {
  KPIMetrics,
  AgentStats,
  ProfileStats,
  JobVolumePoint,
  StatusFunnelStep,
  ActivityEvent,
  SystemHealth,
  Job,
  Agent,
  Profile,
  JobFilters,
  PaginatedResult,
  DateRange,
} from "./types";

// ============================================================
// DASHBOARD KPIs
// ============================================================

export async function getKPIMetrics(range?: DateRange): Promise<KPIMetrics> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      COUNT(*) AS total_jobs,
      COUNT(CASE WHEN proposal_sent_at IS NOT NULL THEN 1 END) AS proposals_sent,
      COUNT(CASE WHEN outcome = 'won' THEN 1 END) AS won,
      COUNT(CASE WHEN outcome = 'lost' THEN 1 END) AS lost,
      ROUND(
        COUNT(CASE WHEN outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate,
      COALESCE(SUM(CASE WHEN outcome = 'won' THEN won_value END), 0) AS total_revenue
    FROM jobs
    WHERE (${startDate}::timestamptz IS NULL OR received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR received_at <= ${endDate}::timestamptz)
  `;

  const row = result.rows[0];
  return {
    totalJobs: parseInt(row.total_jobs) || 0,
    proposalsSent: parseInt(row.proposals_sent) || 0,
    won: parseInt(row.won) || 0,
    lost: parseInt(row.lost) || 0,
    winRate: parseFloat(row.win_rate) || 0,
    totalRevenue: parseFloat(row.total_revenue) || 0,
  };
}

// ============================================================
// CHARTS DATA
// ============================================================

export async function getJobVolumeOverTime(
  range?: DateRange
): Promise<JobVolumePoint[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      TO_CHAR(received_at, 'YYYY-MM-DD') AS date,
      COUNT(*) AS count
    FROM jobs
    WHERE (${startDate}::timestamptz IS NULL OR received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR received_at <= ${endDate}::timestamptz)
    GROUP BY TO_CHAR(received_at, 'YYYY-MM-DD')
    ORDER BY date
  `;

  return result.rows.map((row) => ({
    date: row.date,
    count: parseInt(row.count),
  }));
}

export async function getStatusFunnel(
  range?: DateRange
): Promise<StatusFunnelStep[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      clickup_status AS status,
      COUNT(*) AS count
    FROM jobs
    WHERE (${startDate}::timestamptz IS NULL OR received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR received_at <= ${endDate}::timestamptz)
    GROUP BY clickup_status
    ORDER BY
      CASE clickup_status
        WHEN 'Proposal Ready' THEN 1
        WHEN 'Sent' THEN 2
        WHEN 'Following Up' THEN 3
        WHEN 'Won' THEN 4
        WHEN 'Lost' THEN 5
        ELSE 6
      END
  `;

  return result.rows.map((row) => ({
    status: row.status,
    count: parseInt(row.count),
  }));
}

export async function getRevenueOverTime(
  range?: DateRange
): Promise<{ date: string; revenue: number }[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      TO_CHAR(outcome_at, 'YYYY-MM-DD') AS date,
      SUM(won_value) AS revenue
    FROM jobs
    WHERE outcome = 'won'
      AND won_value IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR outcome_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR outcome_at <= ${endDate}::timestamptz)
    GROUP BY TO_CHAR(outcome_at, 'YYYY-MM-DD')
    ORDER BY date
  `;

  return result.rows.map((row) => ({
    date: row.date,
    revenue: parseFloat(row.revenue) || 0,
  }));
}

// ============================================================
// AGENT DATA
// ============================================================

export async function getAgentStats(
  range?: DateRange
): Promise<AgentStats[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      a.id,
      a.name,
      a.clickup_user_id,
      COUNT(j.id) AS total_jobs,
      COUNT(CASE WHEN j.proposal_sent_at IS NOT NULL THEN 1 END) AS proposals_sent,
      COUNT(CASE WHEN j.outcome = 'won' THEN 1 END) AS won,
      COUNT(CASE WHEN j.outcome = 'lost' THEN 1 END) AS lost,
      ROUND(
        COUNT(CASE WHEN j.outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN j.outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct,
      COALESCE(SUM(CASE WHEN j.outcome = 'won' THEN j.won_value END), 0) AS total_revenue,
      AVG(
        CASE WHEN j.proposal_sent_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (j.proposal_sent_at - j.received_at)) / 3600
        END
      ) AS avg_response_hours
    FROM agents a
    LEFT JOIN jobs j ON j.agent_id = a.id
      AND (${startDate}::timestamptz IS NULL OR j.received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.received_at <= ${endDate}::timestamptz)
    WHERE a.active = true
    GROUP BY a.id, a.name, a.clickup_user_id
    ORDER BY total_jobs DESC
  `;

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    clickup_user_id: row.clickup_user_id,
    total_jobs: parseInt(row.total_jobs) || 0,
    proposals_sent: parseInt(row.proposals_sent) || 0,
    won: parseInt(row.won) || 0,
    lost: parseInt(row.lost) || 0,
    win_rate_pct: row.win_rate_pct ? parseFloat(row.win_rate_pct) : null,
    total_revenue: parseFloat(row.total_revenue) || 0,
    avg_response_hours: row.avg_response_hours
      ? parseFloat(parseFloat(row.avg_response_hours).toFixed(1))
      : null,
  }));
}

export async function getTopAgentsByWinRate(
  limit: number = 3,
  range?: DateRange
): Promise<AgentStats[]> {
  const stats = await getAgentStats(range);
  return stats
    .filter((a) => a.win_rate_pct !== null)
    .sort((a, b) => (b.win_rate_pct ?? 0) - (a.win_rate_pct ?? 0))
    .slice(0, limit);
}

export async function getAgentById(
  id: string
): Promise<(Agent & { profiles: Profile[] }) | null> {
  const agentResult = await sql`
    SELECT * FROM agents WHERE id = ${id}
  `;
  if (agentResult.rows.length === 0) return null;

  const profilesResult = await sql`
    SELECT * FROM profiles WHERE agent_id = ${id} ORDER BY profile_name
  `;

  const row = agentResult.rows[0];
  return {
    id: row.id,
    clickup_user_id: row.clickup_user_id,
    name: row.name,
    email: row.email,
    avatar_url: row.avatar_url,
    active: row.active,
    created_at: row.created_at,
    profiles: profilesResult.rows as Profile[],
  };
}

// ============================================================
// PROFILE DATA
// ============================================================

export async function getProfileStats(
  range?: DateRange
): Promise<ProfileStats[]> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      p.id,
      p.profile_id,
      p.profile_name,
      p.stack,
      COUNT(j.id) AS total_jobs,
      COUNT(CASE WHEN j.outcome = 'won' THEN 1 END) AS won,
      ROUND(
        COUNT(CASE WHEN j.outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN j.outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct,
      AVG(CASE WHEN j.outcome = 'won' THEN j.won_value END) AS avg_won_value,
      COALESCE(SUM(CASE WHEN j.outcome = 'won' THEN j.won_value END), 0) AS total_revenue
    FROM profiles p
    LEFT JOIN jobs j ON j.profile_id = p.profile_id
      AND (${startDate}::timestamptz IS NULL OR j.received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.received_at <= ${endDate}::timestamptz)
    WHERE p.active = true
    GROUP BY p.id, p.profile_id, p.profile_name, p.stack
    ORDER BY total_jobs DESC
  `;

  return result.rows.map((row) => ({
    id: row.id,
    profile_id: row.profile_id,
    profile_name: row.profile_name,
    stack: row.stack,
    total_jobs: parseInt(row.total_jobs) || 0,
    won: parseInt(row.won) || 0,
    win_rate_pct: row.win_rate_pct ? parseFloat(row.win_rate_pct) : null,
    avg_won_value: row.avg_won_value
      ? parseFloat(parseFloat(row.avg_won_value).toFixed(0))
      : null,
    total_revenue: parseFloat(row.total_revenue) || 0,
  }));
}

export async function getTopProfilesByVolume(
  limit: number = 3,
  range?: DateRange
): Promise<ProfileStats[]> {
  const stats = await getProfileStats(range);
  return stats.sort((a, b) => b.total_jobs - a.total_jobs).slice(0, limit);
}

export async function getProfileById(
  id: string
): Promise<(Profile & { agent: Agent | null }) | null> {
  const profileResult = await sql`
    SELECT * FROM profiles WHERE id = ${id}
  `;
  if (profileResult.rows.length === 0) return null;

  const row = profileResult.rows[0];
  let agent: Agent | null = null;
  if (row.agent_id) {
    const agentResult = await sql`SELECT * FROM agents WHERE id = ${row.agent_id}`;
    agent = agentResult.rows[0] as Agent ?? null;
  }

  return {
    ...(row as Profile),
    agent,
  };
}

// ============================================================
// JOBS DATA
// ============================================================

export async function getJobs(
  filters: JobFilters = {}
): Promise<PaginatedResult<Job>> {
  const {
    agent_id,
    profile_id,
    clickup_status,
    outcome,
    budget_type,
    search,
    startDate,
    endDate,
    sortBy = "received_at",
    sortDir = "desc",
    page = 1,
    limit = 25,
  } = filters;

  const offset = (page - 1) * limit;

  // Allowlisted sort columns to prevent injection
  const allowedSorts: Record<string, string> = {
    received_at: "j.received_at",
    job_title: "j.job_title",
    budget_max: "j.budget_max",
    clickup_status: "j.clickup_status",
    outcome: "j.outcome",
  };
  const sortColumn = allowedSorts[sortBy] || "j.received_at";
  const direction = sortDir === "asc" ? "ASC" : "DESC";

  // Count query
  const countResult = await sql`
    SELECT COUNT(*) AS total
    FROM jobs j
    WHERE (${agent_id}::uuid IS NULL OR j.agent_id = ${agent_id}::uuid)
      AND (${profile_id}::text IS NULL OR j.profile_id = ${profile_id}::text)
      AND (${clickup_status}::text IS NULL OR j.clickup_status = ${clickup_status}::text)
      AND (${outcome}::text IS NULL OR j.outcome = ${outcome}::text)
      AND (${budget_type}::text IS NULL OR j.budget_type = ${budget_type}::text)
      AND (${search}::text IS NULL OR j.job_title ILIKE '%' || ${search}::text || '%')
      AND (${startDate}::timestamptz IS NULL OR j.received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.received_at <= ${endDate}::timestamptz)
  `;

  const total = parseInt(countResult.rows[0].total);

  // Data query — using safe sort column
  const dataResult = await sql.query(
    `SELECT j.*,
       a.name AS agent_name,
       p.profile_name
     FROM jobs j
     LEFT JOIN agents a ON a.id = j.agent_id
     LEFT JOIN profiles p ON p.profile_id = j.profile_id
     WHERE ($1::uuid IS NULL OR j.agent_id = $1::uuid)
       AND ($2::text IS NULL OR j.profile_id = $2::text)
       AND ($3::text IS NULL OR j.clickup_status = $3::text)
       AND ($4::text IS NULL OR j.outcome = $4::text)
       AND ($5::text IS NULL OR j.budget_type = $5::text)
       AND ($6::text IS NULL OR j.job_title ILIKE '%' || $6::text || '%')
       AND ($7::timestamptz IS NULL OR j.received_at >= $7::timestamptz)
       AND ($8::timestamptz IS NULL OR j.received_at <= $8::timestamptz)
     ORDER BY ${sortColumn} ${direction}
     LIMIT $9 OFFSET $10`,
    [
      agent_id ?? null,
      profile_id ?? null,
      clickup_status ?? null,
      outcome ?? null,
      budget_type ?? null,
      search ?? null,
      startDate ?? null,
      endDate ?? null,
      limit,
      offset,
    ]
  );

  return {
    data: dataResult.rows as Job[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getJobById(id: string): Promise<
  | (Job & { agent_name: string | null; profile_name: string | null })
  | null
> {
  const result = await sql`
    SELECT j.*,
      a.name AS agent_name,
      p.profile_name
    FROM jobs j
    LEFT JOIN agents a ON a.id = j.agent_id
    LEFT JOIN profiles p ON p.profile_id = j.profile_id
    WHERE j.id = ${id}
  `;

  if (result.rows.length === 0) return null;
  return result.rows[0] as Job & {
    agent_name: string | null;
    profile_name: string | null;
  };
}

// ============================================================
// ACTIVITY & HEALTH
// ============================================================

export async function getRecentActivity(
  limit: number = 10
): Promise<ActivityEvent[]> {
  const result = await sql`
    SELECT
      j.id,
      j.job_title,
      a.name AS agent_name,
      p.profile_name,
      j.clickup_status,
      j.outcome,
      j.updated_at
    FROM jobs j
    LEFT JOIN agents a ON a.id = j.agent_id
    LEFT JOIN profiles p ON p.profile_id = j.profile_id
    ORDER BY j.updated_at DESC
    LIMIT ${limit}
  `;

  return result.rows.map((row) => ({
    id: row.id,
    job_title: row.job_title,
    agent_name: row.agent_name,
    profile_name: row.profile_name,
    clickup_status: row.clickup_status,
    outcome: row.outcome,
    updated_at: row.updated_at,
  }));
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const [syncResult, failureResult, openResult] = await Promise.all([
    sql`
      SELECT started_at, status
      FROM sync_log
      ORDER BY started_at DESC
      LIMIT 1
    `,
    sql`
      SELECT
        COUNT(CASE WHEN proposal_text IS NULL AND received_at < NOW() - INTERVAL '1 hour' THEN 1 END) AS failures,
        COUNT(*) AS total
      FROM jobs
      WHERE received_at > NOW() - INTERVAL '7 days'
    `,
    sql`
      SELECT COUNT(*) AS count
      FROM jobs
      WHERE outcome IS NULL
        AND clickup_status NOT IN ('Won', 'Lost')
    `,
  ]);

  const lastSync = syncResult.rows[0];
  const failRow = failureResult.rows[0];
  const totalJobs = parseInt(failRow.total) || 0;
  const failures = parseInt(failRow.failures) || 0;

  return {
    lastSyncAt: lastSync?.started_at ?? null,
    lastSyncStatus: lastSync?.status ?? null,
    gptFailureRate: totalJobs > 0 ? Math.round((failures / totalJobs) * 100) : 0,
    openJobsCount: parseInt(openResult.rows[0].count) || 0,
  };
}

// ============================================================
// SYNC LOG
// ============================================================

export async function getSyncLogs(limit: number = 20) {
  const result = await sql`
    SELECT *
    FROM sync_log
    ORDER BY started_at DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

// ============================================================
// LISTS (for dropdowns / filters)
// ============================================================

export async function getAllAgents(): Promise<Agent[]> {
  const result = await sql`
    SELECT * FROM agents ORDER BY name
  `;
  return result.rows as Agent[];
}

export async function getAllProfiles(): Promise<Profile[]> {
  const result = await sql`
    SELECT * FROM profiles ORDER BY profile_name
  `;
  return result.rows as Profile[];
}
