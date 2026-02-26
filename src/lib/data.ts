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
  SyncLog,
  JobFilters,
  PaginatedResult,
  DateRange,
  WinRateTrendPoint,
  DistributionBucket,
  SkillAnalysis,
  RevenueByEntity,
  RevenueByBudgetType,
  Alert,
  ProposalAnalytics,
  CountryStats,
  TimeSlotStats,
  BudgetWinRate,
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
    role: row.role ?? "agent",
    github_email: row.github_email ?? null,
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

// ============================================================
// MUTATION / SYNC FUNCTIONS (Phase 3 + 4)
// ============================================================

export async function upsertJob(jobData: {
  job_id: string;
  job_title: string;
  job_url?: string | null;
  job_description?: string | null;
  budget_type?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  hourly_min?: number | null;
  hourly_max?: number | null;
  skills?: string[] | null;
  client_country?: string | null;
  client_rating?: number | null;
  client_total_spent?: number | null;
  client_hires?: number | null;
  posted_at?: string | null;
  profile_id?: string | null;
  agent_id?: string | null;
  clickup_task_id?: string | null;
  clickup_task_url?: string | null;
  clickup_status?: string;
  proposal_text?: string | null;
  gpt_model?: string | null;
  gpt_tokens_used?: number | null;
}): Promise<Job> {
  const result = await sql`
    INSERT INTO jobs (
      job_id, job_title, job_url, job_description,
      budget_type, budget_min, budget_max, hourly_min, hourly_max,
      skills, client_country, client_rating, client_total_spent, client_hires,
      posted_at, profile_id, agent_id,
      clickup_task_id, clickup_task_url, clickup_status,
      proposal_text, gpt_model, gpt_tokens_used
    ) VALUES (
      ${jobData.job_id}, ${jobData.job_title}, ${jobData.job_url ?? null}, ${jobData.job_description ?? null},
      ${jobData.budget_type ?? null}, ${jobData.budget_min ?? null}, ${jobData.budget_max ?? null},
      ${jobData.hourly_min ?? null}, ${jobData.hourly_max ?? null},
      ${jobData.skills ? `{${jobData.skills.join(",")}}` : null}, ${jobData.client_country ?? null}, ${jobData.client_rating ?? null},
      ${jobData.client_total_spent ?? null}, ${jobData.client_hires ?? null},
      ${jobData.posted_at ?? null}, ${jobData.profile_id ?? null}, ${jobData.agent_id ?? null},
      ${jobData.clickup_task_id ?? null}, ${jobData.clickup_task_url ?? null},
      ${jobData.clickup_status ?? 'New'},
      ${jobData.proposal_text ?? null}, ${jobData.gpt_model ?? null}, ${jobData.gpt_tokens_used ?? null}
    )
    ON CONFLICT (job_id) DO UPDATE SET
      job_title = EXCLUDED.job_title,
      job_url = COALESCE(EXCLUDED.job_url, jobs.job_url),
      job_description = COALESCE(EXCLUDED.job_description, jobs.job_description),
      budget_type = COALESCE(EXCLUDED.budget_type, jobs.budget_type),
      budget_min = COALESCE(EXCLUDED.budget_min, jobs.budget_min),
      budget_max = COALESCE(EXCLUDED.budget_max, jobs.budget_max),
      skills = COALESCE(EXCLUDED.skills::text[], jobs.skills),
      clickup_task_id = COALESCE(EXCLUDED.clickup_task_id, jobs.clickup_task_id),
      clickup_task_url = COALESCE(EXCLUDED.clickup_task_url, jobs.clickup_task_url),
      clickup_status = COALESCE(EXCLUDED.clickup_status, jobs.clickup_status),
      proposal_text = COALESCE(EXCLUDED.proposal_text, jobs.proposal_text),
      updated_at = NOW()
    RETURNING *
  `;
  return result.rows[0] as Job;
}

export async function createSyncLog(
  source: "clickup" | "sheets" | "n8n_webhook"
): Promise<SyncLog> {
  const result = await sql`
    INSERT INTO sync_log (source, records_synced, records_updated, status)
    VALUES (${source}, 0, 0, 'running')
    RETURNING *
  `;
  return result.rows[0] as SyncLog;
}

export async function completeSyncLog(
  id: string,
  result: {
    records_synced: number;
    records_updated: number;
    errors?: string[];
    status: "success" | "failed";
  }
): Promise<void> {
  await sql`
    UPDATE sync_log SET
      records_synced = ${result.records_synced},
      records_updated = ${result.records_updated},
      errors = ${result.errors ? `{${result.errors.join(",")}}` : null},
      status = ${result.status},
      completed_at = NOW()
    WHERE id = ${id}
  `;
}

export async function getCachedStats(key: string): Promise<unknown | null> {
  const result = await sql`
    SELECT data FROM stats_cache
    WHERE cache_key = ${key}
      AND (expires_at IS NULL OR expires_at > NOW())
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return result.rows[0].data;
}

export async function setCachedStats(
  key: string,
  data: unknown,
  ttlMinutes: number = 5
): Promise<void> {
  await sql`
    INSERT INTO stats_cache (cache_key, data, computed_at, expires_at)
    VALUES (
      ${key},
      ${JSON.stringify(data)},
      NOW(),
      NOW() + ${`${ttlMinutes} minutes`}::INTERVAL
    )
    ON CONFLICT (cache_key) DO UPDATE SET
      data = EXCLUDED.data,
      computed_at = EXCLUDED.computed_at,
      expires_at = EXCLUDED.expires_at
  `;
}

// ============================================================
// ADMIN MUTATION FUNCTIONS (Phase 4)
// ============================================================

export async function toggleAgentActive(
  id: string,
  active: boolean
): Promise<void> {
  await sql`UPDATE agents SET active = ${active} WHERE id = ${id}`;
}

export async function createAgent(data: {
  name: string;
  email?: string | null;
  clickup_user_id: string;
}): Promise<Agent> {
  const result = await sql`
    INSERT INTO agents (name, email, clickup_user_id)
    VALUES (${data.name}, ${data.email ?? null}, ${data.clickup_user_id})
    RETURNING *
  `;
  return result.rows[0] as Agent;
}

export async function toggleProfileActive(
  id: string,
  active: boolean
): Promise<void> {
  await sql`UPDATE profiles SET active = ${active} WHERE id = ${id}`;
}

export async function updateProfileAgent(
  id: string,
  agentId: string | null
): Promise<void> {
  await sql`UPDATE profiles SET agent_id = ${agentId} WHERE id = ${id}`;
}

export async function createProfile(data: {
  profile_id: string;
  profile_name: string;
  stack?: string | null;
  vollna_filter_tag?: string | null;
  agent_id?: string | null;
  clickup_list_id?: string | null;
}): Promise<Profile> {
  const result = await sql`
    INSERT INTO profiles (profile_id, profile_name, stack, vollna_filter_tag, agent_id, clickup_list_id)
    VALUES (
      ${data.profile_id}, ${data.profile_name}, ${data.stack ?? null},
      ${data.vollna_filter_tag ?? null}, ${data.agent_id ?? null}, ${data.clickup_list_id ?? null}
    )
    RETURNING *
  `;
  return result.rows[0] as Profile;
}

// ============================================================
// CHART QUERY FUNCTIONS (Phase 5)
// ============================================================

export async function getAgentWinRateTrend(
  agentId: string,
  weeks: number = 12
): Promise<WinRateTrendPoint[]> {
  const result = await sql`
    SELECT
      TO_CHAR(DATE_TRUNC('week', outcome_at), 'YYYY-MM-DD') AS week,
      COUNT(CASE WHEN outcome = 'won' THEN 1 END) AS won,
      COUNT(*) AS decided,
      ROUND(
        COUNT(CASE WHEN outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(*), 0) * 100, 1
      ) AS win_rate
    FROM jobs
    WHERE agent_id = ${agentId}
      AND outcome IN ('won', 'lost')
      AND outcome_at >= NOW() - (${weeks} || ' weeks')::INTERVAL
    GROUP BY DATE_TRUNC('week', outcome_at)
    ORDER BY week
  `;
  return result.rows.map((row) => ({
    week: row.week,
    won: parseInt(row.won) || 0,
    decided: parseInt(row.decided) || 0,
    win_rate: parseFloat(row.win_rate) || 0,
  }));
}

export async function getResponseTimeDistribution(
  agentId?: string
): Promise<DistributionBucket[]> {
  const result = await sql`
    SELECT
      CASE
        WHEN hours < 1 THEN '< 1h'
        WHEN hours < 2 THEN '1-2h'
        WHEN hours < 4 THEN '2-4h'
        WHEN hours < 8 THEN '4-8h'
        WHEN hours < 24 THEN '8-24h'
        ELSE '24h+'
      END AS bucket,
      COUNT(*) AS count
    FROM (
      SELECT EXTRACT(EPOCH FROM (proposal_sent_at - received_at)) / 3600 AS hours
      FROM jobs
      WHERE proposal_sent_at IS NOT NULL
        AND (${agentId}::uuid IS NULL OR agent_id = ${agentId}::uuid)
    ) sub
    GROUP BY
      CASE
        WHEN hours < 1 THEN '< 1h'
        WHEN hours < 2 THEN '1-2h'
        WHEN hours < 4 THEN '2-4h'
        WHEN hours < 8 THEN '4-8h'
        WHEN hours < 24 THEN '8-24h'
        ELSE '24h+'
      END
    ORDER BY MIN(hours)
  `;
  return result.rows.map((row) => ({
    bucket: row.bucket,
    count: parseInt(row.count) || 0,
  }));
}

export async function getBudgetDistribution(
  profileId?: string
): Promise<DistributionBucket[]> {
  const result = await sql`
    SELECT
      CASE
        WHEN budget_max < 100 THEN '< $100'
        WHEN budget_max < 500 THEN '$100-500'
        WHEN budget_max < 1000 THEN '$500-1K'
        WHEN budget_max < 5000 THEN '$1K-5K'
        WHEN budget_max < 10000 THEN '$5K-10K'
        ELSE '$10K+'
      END AS bucket,
      COUNT(*) AS count
    FROM jobs
    WHERE outcome = 'won'
      AND budget_max IS NOT NULL
      AND (${profileId}::text IS NULL OR profile_id = ${profileId}::text)
    GROUP BY
      CASE
        WHEN budget_max < 100 THEN '< $100'
        WHEN budget_max < 500 THEN '$100-500'
        WHEN budget_max < 1000 THEN '$500-1K'
        WHEN budget_max < 5000 THEN '$1K-5K'
        WHEN budget_max < 10000 THEN '$5K-10K'
        ELSE '$10K+'
      END
    ORDER BY MIN(budget_max)
  `;
  return result.rows.map((row) => ({
    bucket: row.bucket,
    count: parseInt(row.count) || 0,
  }));
}

export async function getSkillsAnalysis(
  profileId?: string
): Promise<SkillAnalysis[]> {
  const result = await sql`
    SELECT skill, COUNT(*) AS count
    FROM jobs, unnest(skills) AS skill
    WHERE outcome = 'won'
      AND (${profileId}::text IS NULL OR profile_id = ${profileId}::text)
    GROUP BY skill
    ORDER BY count DESC
    LIMIT 10
  `;
  return result.rows.map((row) => ({
    skill: row.skill,
    count: parseInt(row.count) || 0,
  }));
}

export async function getRevenueByAgent(
  range?: DateRange
): Promise<RevenueByEntity[]> {
  const { startDate, endDate } = range ?? {};
  const result = await sql`
    SELECT a.name, COALESCE(SUM(j.won_value), 0) AS revenue
    FROM agents a
    INNER JOIN jobs j ON j.agent_id = a.id
    WHERE j.outcome = 'won'
      AND j.won_value IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR j.outcome_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.outcome_at <= ${endDate}::timestamptz)
    GROUP BY a.name
    ORDER BY revenue DESC
    LIMIT 10
  `;
  return result.rows.map((row) => ({
    name: row.name,
    revenue: parseFloat(row.revenue) || 0,
  }));
}

export async function getRevenueByProfile(
  range?: DateRange
): Promise<RevenueByEntity[]> {
  const { startDate, endDate } = range ?? {};
  const result = await sql`
    SELECT p.profile_name AS name, COALESCE(SUM(j.won_value), 0) AS revenue
    FROM profiles p
    INNER JOIN jobs j ON j.profile_id = p.profile_id
    WHERE j.outcome = 'won'
      AND j.won_value IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR j.outcome_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.outcome_at <= ${endDate}::timestamptz)
    GROUP BY p.profile_name
    ORDER BY revenue DESC
    LIMIT 10
  `;
  return result.rows.map((row) => ({
    name: row.name,
    revenue: parseFloat(row.revenue) || 0,
  }));
}

export async function getRevenueByBudgetType(
  range?: DateRange
): Promise<RevenueByBudgetType[]> {
  const { startDate, endDate } = range ?? {};
  const result = await sql`
    SELECT
      COALESCE(budget_type, 'Unknown') AS budget_type,
      COALESCE(SUM(won_value), 0) AS revenue,
      COUNT(*) AS count
    FROM jobs
    WHERE outcome = 'won'
      AND won_value IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR outcome_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR outcome_at <= ${endDate}::timestamptz)
    GROUP BY budget_type
    ORDER BY revenue DESC
  `;
  return result.rows.map((row) => ({
    budget_type: row.budget_type,
    revenue: parseFloat(row.revenue) || 0,
    count: parseInt(row.count) || 0,
  }));
}

// ============================================================
// ALERTS (Phase 8.1)
// ============================================================

export async function getActiveAlerts(): Promise<Alert[]> {
  const result = await sql`
    SELECT * FROM alerts
    WHERE dismissed = false
    ORDER BY created_at DESC
    LIMIT 10
  `;
  return result.rows as Alert[];
}

export async function getAlertHistory(limit: number = 50): Promise<Alert[]> {
  const result = await sql`
    SELECT * FROM alerts
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return result.rows as Alert[];
}

export async function dismissAlert(id: string): Promise<void> {
  await sql`UPDATE alerts SET dismissed = true WHERE id = ${id}`;
}

export async function insertAlert(alert: {
  alert_type: string;
  message: string;
  current_value: number | null;
  threshold_value: number | null;
}): Promise<void> {
  // Dedup: don't re-alert same type within 24h
  const existing = await sql`
    SELECT id FROM alerts
    WHERE alert_type = ${alert.alert_type}
      AND created_at > NOW() - INTERVAL '24 hours'
    LIMIT 1
  `;
  if (existing.rows.length > 0) return;

  await sql`
    INSERT INTO alerts (alert_type, message, current_value, threshold_value)
    VALUES (${alert.alert_type}, ${alert.message}, ${alert.current_value}, ${alert.threshold_value})
  `;
}

// ============================================================
// PROPOSAL INTELLIGENCE (Phase 8.2)
// ============================================================

export async function getProposalAnalytics(
  range?: DateRange
): Promise<ProposalAnalytics[]> {
  const { startDate, endDate } = range ?? {};
  const result = await sql`
    SELECT
      COALESCE(gpt_model, 'Unknown') AS model,
      COUNT(*) AS total,
      COUNT(CASE WHEN outcome = 'won' THEN 1 END) AS won,
      COUNT(CASE WHEN outcome = 'lost' THEN 1 END) AS lost,
      ROUND(
        COUNT(CASE WHEN outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct,
      ROUND(AVG(gpt_tokens_used)) AS avg_tokens
    FROM jobs
    WHERE gpt_model IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR received_at <= ${endDate}::timestamptz)
    GROUP BY gpt_model
    ORDER BY total DESC
  `;
  return result.rows.map((row) => ({
    model: row.model,
    total: parseInt(row.total) || 0,
    won: parseInt(row.won) || 0,
    lost: parseInt(row.lost) || 0,
    win_rate_pct: row.win_rate_pct ? parseFloat(row.win_rate_pct) : null,
    avg_tokens: row.avg_tokens ? parseInt(row.avg_tokens) : null,
  }));
}

// ============================================================
// ADVANCED ANALYTICS (Phase 8.3)
// ============================================================

export async function getCountryStats(
  range?: DateRange
): Promise<CountryStats[]> {
  const { startDate, endDate } = range ?? {};
  const result = await sql`
    SELECT
      client_country AS country,
      COUNT(*) AS total,
      COUNT(CASE WHEN outcome = 'won' THEN 1 END) AS won,
      ROUND(
        COUNT(CASE WHEN outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct
    FROM jobs
    WHERE client_country IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR received_at <= ${endDate}::timestamptz)
    GROUP BY client_country
    HAVING COUNT(*) >= 2
    ORDER BY total DESC
  `;
  return result.rows.map((row) => ({
    country: row.country,
    total: parseInt(row.total) || 0,
    won: parseInt(row.won) || 0,
    win_rate_pct: row.win_rate_pct ? parseFloat(row.win_rate_pct) : null,
  }));
}

export async function getBestTimeToApply(
  range?: DateRange
): Promise<TimeSlotStats[]> {
  const { startDate, endDate } = range ?? {};
  const result = await sql`
    SELECT
      EXTRACT(DOW FROM received_at)::int AS day,
      EXTRACT(HOUR FROM received_at)::int AS hour,
      COUNT(*) AS total,
      COUNT(CASE WHEN outcome = 'won' THEN 1 END) AS won,
      ROUND(
        COUNT(CASE WHEN outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct
    FROM jobs
    WHERE (${startDate}::timestamptz IS NULL OR received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR received_at <= ${endDate}::timestamptz)
    GROUP BY EXTRACT(DOW FROM received_at), EXTRACT(HOUR FROM received_at)
    ORDER BY day, hour
  `;
  return result.rows.map((row) => ({
    day: parseInt(row.day),
    hour: parseInt(row.hour),
    total: parseInt(row.total) || 0,
    won: parseInt(row.won) || 0,
    win_rate_pct: row.win_rate_pct ? parseFloat(row.win_rate_pct) : null,
  }));
}

export async function getBudgetWinRate(
  profileId?: string
): Promise<BudgetWinRate[]> {
  const result = await sql`
    SELECT
      CASE
        WHEN budget_max < 100 THEN '< $100'
        WHEN budget_max < 500 THEN '$100-500'
        WHEN budget_max < 1000 THEN '$500-1K'
        WHEN budget_max < 5000 THEN '$1K-5K'
        WHEN budget_max < 10000 THEN '$5K-10K'
        ELSE '$10K+'
      END AS bucket,
      COUNT(*) AS total,
      COUNT(CASE WHEN outcome = 'won' THEN 1 END) AS won,
      ROUND(
        COUNT(CASE WHEN outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct
    FROM jobs
    WHERE budget_max IS NOT NULL
      AND outcome IN ('won', 'lost')
      AND (${profileId}::text IS NULL OR profile_id = ${profileId}::text)
    GROUP BY
      CASE
        WHEN budget_max < 100 THEN '< $100'
        WHEN budget_max < 500 THEN '$100-500'
        WHEN budget_max < 1000 THEN '$500-1K'
        WHEN budget_max < 5000 THEN '$1K-5K'
        WHEN budget_max < 10000 THEN '$5K-10K'
        ELSE '$10K+'
      END
    ORDER BY MIN(budget_max)
  `;
  return result.rows.map((row) => ({
    bucket: row.bucket,
    total: parseInt(row.total) || 0,
    won: parseInt(row.won) || 0,
    win_rate_pct: row.win_rate_pct ? parseFloat(row.win_rate_pct) : null,
  }));
}

// ============================================================
// AGENT PORTAL (Phase 8.4)
// ============================================================

export async function getAgentByGithubEmail(
  email: string
): Promise<{ id: string; role: string } | null> {
  const result = await sql`
    SELECT id, role FROM agents
    WHERE github_email = ${email} AND active = true
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return { id: result.rows[0].id, role: result.rows[0].role };
}

export async function markJobAsSent(jobId: string): Promise<void> {
  await sql`
    UPDATE jobs SET
      proposal_sent_at = NOW(),
      clickup_status = 'Sent',
      updated_at = NOW()
    WHERE id = ${jobId}
  `;
}

export async function getAgentKPIMetrics(
  agentId: string,
  range?: DateRange
): Promise<KPIMetrics> {
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
    WHERE agent_id = ${agentId}
      AND (${startDate}::timestamptz IS NULL OR received_at >= ${startDate}::timestamptz)
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
