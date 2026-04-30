import { sql } from "@/lib/db";
import type {
  KPIMetrics,
  KPIMetricsWithDeltas,
  AgentStats,
  ProfileStats,
  JobVolumePoint,
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
  FunnelStep,
  PipelineStage,
  PipelineJob,
  EnhancedAgentStats,
  EnhancedProfileStats,
  ConnectsUsage,
  ConnectROI,
  FilterQuality,
  BoostedConnectsSummary,
  AlertCounts,
} from "./types";

// ============================================================
// DASHBOARD KPIs
// ============================================================

export async function getKPIMetrics(range?: DateRange, agentId?: string, profileId?: string): Promise<KPIMetrics> {
  const { startDate, endDate } = range ?? {};

  // Counts derived from the Task Board (tasks JOIN columns) — the source of
  // truth per CLAUDE.md. Win rate = won / (won + lost). Revenue is the only
  // metric still derived from jobs.won_value.
  //
  // Funnel KPIs (Proposals Sent / Viewed, In Chat, Meetings Booked / Done) are
  // gated by FIRST entry into each metric's funnel-stage set, not by "card last
  // touched in range". A card moved Submitted -> Views today had its proposal
  // sent earlier — counting it as "Proposals Sent today" would be wrong. We
  // compute per-task `first_<metric>_at` = LEAST(earliest move INTO any column
  // in this metric's funnel, t.created_at IF the task was already in a funnel
  // column at creation). The latter is detected when (a) the task has no
  // column-move history and its current column is in the funnel, OR (b) the
  // task's earliest column-move row has old_value in the funnel (i.e. it was
  // in the funnel before the first logged move).
  //
  // Won, Lost, Bad Leads (N/A), Untouched (Todo), and total_revenue remain
  // current-state metrics gated by COALESCE(stage_entered_at, updated_at,
  // created_at). total_jobs (intake) is gated by tv.created_at.
  const result = await sql`
    WITH earliest_move AS (
      SELECT DISTINCT ON (task_id)
        task_id,
        LOWER(old_value) AS old_lower
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
      ORDER BY task_id, created_at
    ),
    move_in_proposals_sent AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_proposals_viewed AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'proposal views', 'proposal viewed', 'viewed',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_in_chat AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_meetings_booked AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('meeting scheduled', 'meeting done', 'negotiation', 'won')
      GROUP BY task_id
    ),
    move_in_meetings_done AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('meeting done', 'negotiation', 'won')
      GROUP BY task_id
    ),
    task_visited AS (
      SELECT
        t.id AS task_id,
        t.column_id,
        t.custom_fields,
        t.updated_at,
        t.created_at,
        c.name AS col_name,
        LOWER(c.name) AS col_lower,
        LEAST(
          mips.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_proposals_sent_at,
        LEAST(
          mipv.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_proposals_viewed_at,
        LEAST(
          mic.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_in_chat_at,
        LEAST(
          mimb.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('meeting scheduled', 'meeting done', 'negotiation', 'won') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('meeting scheduled', 'meeting done', 'negotiation', 'won') THEN t.created_at
            ELSE NULL
          END
        ) AS first_meetings_booked_at,
        LEAST(
          mimd.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('meeting done', 'negotiation', 'won') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('meeting done', 'negotiation', 'won') THEN t.created_at
            ELSE NULL
          END
        ) AS first_meetings_done_at
      FROM tasks t
      JOIN columns c ON c.id = t.column_id
      LEFT JOIN earliest_move em ON em.task_id = t.id
      LEFT JOIN move_in_proposals_sent mips ON mips.task_id = t.id
      LEFT JOIN move_in_proposals_viewed mipv ON mipv.task_id = t.id
      LEFT JOIN move_in_in_chat mic ON mic.task_id = t.id
      LEFT JOIN move_in_meetings_booked mimb ON mimb.task_id = t.id
      LEFT JOIN move_in_meetings_done mimd ON mimd.task_id = t.id
    )
    -- Per-metric date predicates:
    --   total_jobs        -> tv.created_at (intake — "today's new arrivals")
    --   proposals_sent..meetings_done -> first_<metric>_at (first funnel entry)
    --   won/lost/bad_leads/untouched/total_revenue -> COALESCE(stage_entered, updated, created)
    --     (current-state metrics — "card is in this state AND was last touched in window")
    SELECT
      COUNT(*) FILTER (
        WHERE (${startDate}::timestamptz IS NULL OR tv.created_at >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR tv.created_at <= ${endDate}::timestamptz)
      ) AS total_jobs,
      COUNT(*) FILTER (
        WHERE tv.first_proposals_sent_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_proposals_sent_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_proposals_sent_at <= ${endDate}::timestamptz)
      ) AS proposals_sent,
      COUNT(*) FILTER (
        WHERE tv.first_proposals_viewed_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_proposals_viewed_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_proposals_viewed_at <= ${endDate}::timestamptz)
      ) AS proposals_viewed,
      COUNT(*) FILTER (
        WHERE tv.first_in_chat_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_in_chat_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_in_chat_at <= ${endDate}::timestamptz)
      ) AS in_chat,
      COUNT(*) FILTER (
        WHERE tv.first_meetings_booked_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_meetings_booked_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_meetings_booked_at <= ${endDate}::timestamptz)
      ) AS meetings_booked,
      COUNT(*) FILTER (
        WHERE tv.first_meetings_done_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_meetings_done_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_meetings_done_at <= ${endDate}::timestamptz)
      ) AS meetings_done,
      COUNT(*) FILTER (
        WHERE tv.col_lower = 'won'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS won,
      COUNT(*) FILTER (
        WHERE tv.col_lower = 'lost'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS lost,
      ROUND(
        COUNT(*) FILTER (
          WHERE tv.col_lower = 'won'
          AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
        )::DECIMAL /
        NULLIF(COUNT(*) FILTER (
          WHERE tv.col_lower IN ('won', 'lost')
          AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
        ), 0) * 100, 1
      ) AS win_rate,
      COALESCE(SUM(j.won_value) FILTER (
        WHERE tv.col_lower = 'won'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ), 0) AS total_revenue,
      COUNT(*) FILTER (
        WHERE tv.col_lower = 'n/a'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS bad_leads,
      COUNT(*) FILTER (
        WHERE tv.col_lower IN ('todo', 'to do', 'new', 'proposal ready')
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS untouched
    FROM task_visited tv
    LEFT JOIN jobs j ON j.job_id = (tv.custom_fields->>'_job_id')
    WHERE (${agentId ?? null}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = tv.task_id AND ta.agent_id = ${agentId ?? null}::uuid
      ))
      AND (${profileId ?? null}::text IS NULL
        OR j.profile_id = ${profileId ?? null}::text
        OR EXISTS (
          SELECT 1 FROM task_tag_map ttm
          JOIN task_tags tt ON tt.id = ttm.tag_id
          WHERE ttm.task_id = tv.task_id
            AND LOWER(tt.name) = (SELECT LOWER(profile_name) FROM profiles WHERE profile_id = ${profileId ?? null}::text LIMIT 1)
        ))
  `;

  const row = result.rows[0];
  return {
    totalJobs: parseInt(row.total_jobs) || 0,
    proposalsSent: parseInt(row.proposals_sent) || 0,
    proposalsViewed: parseInt(row.proposals_viewed) || 0,
    inChat: parseInt(row.in_chat) || 0,
    meetingsBooked: parseInt(row.meetings_booked) || 0,
    meetingsDone: parseInt(row.meetings_done) || 0,
    won: parseInt(row.won) || 0,
    lost: parseInt(row.lost) || 0,
    winRate: parseFloat(row.win_rate) || 0,
    totalRevenue: parseFloat(row.total_revenue) || 0,
    badLeads: parseInt(row.bad_leads) || 0,
    untouched: parseInt(row.untouched) || 0,
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
      COUNT(j.id) AS total_jobs,
      COUNT(CASE WHEN j.proposal_sent_at IS NOT NULL AND LOWER(j.status) != 'n/a' THEN 1 END) AS proposals_sent,
      COUNT(CASE WHEN LOWER(j.status) = 'won' THEN 1 END) AS won,
      COUNT(CASE WHEN LOWER(j.status) = 'lost' THEN 1 END) AS lost,
      ROUND(
        COUNT(CASE WHEN LOWER(j.status) = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN j.proposal_sent_at IS NOT NULL AND LOWER(j.status) != 'n/a' THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct,
      COALESCE(SUM(CASE WHEN LOWER(j.status) = 'won' THEN j.won_value END), 0) AS total_revenue,
      AVG(
        CASE WHEN j.proposal_sent_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (j.proposal_sent_at - j.received_at)) / 3600
        END
      ) AS avg_response_hours
    FROM agents a
    LEFT JOIN jobs j ON j.agent_id = a.id
      AND (${startDate}::timestamptz IS NULL OR j.stage_entered_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.stage_entered_at <= ${endDate}::timestamptz)
    WHERE a.active = true
    GROUP BY a.id, a.name
    ORDER BY total_jobs DESC
  `;

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
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
    SELECT id, clickup_user_id, name, email, avatar_url, active, role, github_email, created_at
    FROM agents WHERE id = ${id}
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
    password_hash: null,
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
      COUNT(CASE WHEN LOWER(j.status) = 'won' THEN 1 END) AS won,
      ROUND(
        COUNT(CASE WHEN LOWER(j.status) = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN LOWER(j.status) IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct,
      AVG(CASE WHEN LOWER(j.status) = 'won' THEN j.won_value END) AS avg_won_value,
      COALESCE(SUM(CASE WHEN LOWER(j.status) = 'won' THEN j.won_value END), 0) AS total_revenue
    FROM profiles p
    LEFT JOIN jobs j ON j.profile_id = p.profile_id
      AND (${startDate}::timestamptz IS NULL OR j.stage_entered_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.stage_entered_at <= ${endDate}::timestamptz)
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
    const agentResult = await sql`SELECT id, clickup_user_id, name, email, avatar_url, active, role, github_email, created_at FROM agents WHERE id = ${row.agent_id}`;
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
    status,
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
    status: "j.status",
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
      AND (${status}::text IS NULL OR j.status = ${status}::text)
      AND (${outcome}::text IS NULL OR j.outcome = ${outcome}::text)
      AND (${budget_type}::text IS NULL OR j.budget_type = ${budget_type}::text)
      AND (${search}::text IS NULL OR j.job_title ILIKE '%' || ${search}::text || '%')
      AND (${startDate}::timestamptz IS NULL OR j.stage_entered_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.stage_entered_at <= ${endDate}::timestamptz)
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
       AND ($3::text IS NULL OR j.status = $3::text)
       AND ($4::text IS NULL OR j.outcome = $4::text)
       AND ($5::text IS NULL OR j.budget_type = $5::text)
       AND ($6::text IS NULL OR j.job_title ILIKE '%' || $6::text || '%')
       AND ($7::timestamptz IS NULL OR j.stage_entered_at >= $7::timestamptz)
       AND ($8::timestamptz IS NULL OR j.stage_entered_at <= $8::timestamptz)
     ORDER BY ${sortColumn} ${direction}
     LIMIT $9 OFFSET $10`,
    [
      agent_id ?? null,
      profile_id ?? null,
      status ?? null,
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
        AND LOWER(status) NOT IN ('won', 'lost')
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
    SELECT id, clickup_user_id, name, email, avatar_url, active, role, github_email, created_at
    FROM agents ORDER BY name
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
  status?: string;
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
      clickup_task_id, clickup_task_url, status,
      proposal_text, gpt_model, gpt_tokens_used
    ) VALUES (
      ${jobData.job_id}, ${jobData.job_title}, ${jobData.job_url ?? null}, ${jobData.job_description ?? null},
      ${jobData.budget_type ?? null}, ${jobData.budget_min ?? null}, ${jobData.budget_max ?? null},
      ${jobData.hourly_min ?? null}, ${jobData.hourly_max ?? null},
      ${jobData.skills ? `{${jobData.skills.join(",")}}` : null}, ${jobData.client_country ?? null}, ${jobData.client_rating ?? null},
      ${jobData.client_total_spent ?? null}, ${jobData.client_hires ?? null},
      ${jobData.posted_at ?? null}, ${jobData.profile_id ?? null}, ${jobData.agent_id ?? null},
      ${jobData.clickup_task_id ?? null}, ${jobData.clickup_task_url ?? null},
      ${jobData.status ?? 'New'},
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
      status = COALESCE(EXCLUDED.status, jobs.status),
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
  email: string;
  password_hash: string;
  clickup_user_id?: string | null;
}): Promise<Agent> {
  // Auto-generate clickup_user_id if not provided (format: agent-<uuid-prefix>)
  const clickupId = data.clickup_user_id || `agent-${crypto.randomUUID().slice(0, 8)}`;
  const result = await sql`
    INSERT INTO agents (name, email, clickup_user_id, password_hash, role)
    VALUES (${data.name}, ${data.email}, ${clickupId}, ${data.password_hash}, 'agent')
    RETURNING *
  `;
  return result.rows[0] as Agent;
}

export async function getAgentByEmailExists(email: string): Promise<boolean> {
  const result = await sql`
    SELECT 1 FROM agents WHERE LOWER(email) = LOWER(${email}) LIMIT 1
  `;
  return result.rows.length > 0;
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
  platform?: string | null;
  stack?: string | null;
  vollna_filter_tag?: string | null;
  agent_id?: string | null;
  clickup_list_id?: string | null;
}): Promise<Profile> {
  const result = await sql`
    INSERT INTO profiles (profile_id, profile_name, platform, stack, vollna_filter_tag, agent_id, clickup_list_id)
    VALUES (
      ${data.profile_id}, ${data.profile_name}, ${data.platform ?? 'Upwork'},
      ${data.stack ?? null}, ${data.vollna_filter_tag ?? null}, ${data.agent_id ?? null}, ${data.clickup_list_id ?? null}
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
    WHERE LOWER(j.status) = 'won'
      AND j.won_value IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR j.stage_entered_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.stage_entered_at <= ${endDate}::timestamptz)
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
    WHERE LOWER(j.status) = 'won'
      AND j.won_value IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR j.stage_entered_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.stage_entered_at <= ${endDate}::timestamptz)
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
  range?: DateRange,
  agentId?: string,
  profileId?: string
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
      AND (${startDate}::timestamptz IS NULL OR stage_entered_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR stage_entered_at <= ${endDate}::timestamptz)
      AND (${agentId ?? null}::uuid IS NULL OR agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR profile_id = ${profileId ?? null}::text)
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
  range?: DateRange,
  agentId?: string,
  profileId?: string
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
      AND (${startDate}::timestamptz IS NULL OR stage_entered_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR stage_entered_at <= ${endDate}::timestamptz)
      AND (${agentId ?? null}::uuid IS NULL OR agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR profile_id = ${profileId ?? null}::text)
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
  range?: DateRange,
  agentId?: string,
  profileId?: string
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
      AND (${agentId ?? null}::uuid IS NULL OR agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR profile_id = ${profileId ?? null}::text)
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
  profileId?: string,
  agentId?: string
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
      AND (${profileId ?? null}::text IS NULL OR profile_id = ${profileId ?? null}::text)
      AND (${agentId ?? null}::uuid IS NULL OR agent_id = ${agentId ?? null}::uuid)
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

export async function getAgentByEmail(
  email: string
): Promise<{ id: string; name: string; role: string; password_hash: string } | null> {
  const result = await sql`
    SELECT id, name, role, password_hash FROM agents
    WHERE LOWER(email) = LOWER(${email}) AND active = true AND password_hash IS NOT NULL
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return {
    id: result.rows[0].id,
    name: result.rows[0].name,
    role: result.rows[0].role,
    password_hash: result.rows[0].password_hash,
  };
}

export async function markJobAsSent(jobId: string): Promise<void> {
  await sql`
    UPDATE jobs SET
      proposal_sent_at = NOW(),
      status = 'Sent',
      updated_at = NOW()
    WHERE id = ${jobId}
  `;
}

export async function getAgentKPIMetrics(
  agentId: string,
  range?: DateRange
): Promise<KPIMetrics> {
  // Scoped wrapper around getKPIMetrics — same task-board-derived semantics,
  // filtered to a single agent via task_assignees.
  return getKPIMetrics(range, agentId);
}

// ============================================================
// CYBERPUNK DASHBOARD QUERIES
// ============================================================

function getPreviousRange(range: DateRange): DateRange {
  const start = new Date(range.startDate!);
  const end = new Date(range.endDate!);
  const durationMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1); // 1ms before current start
  const prevStart = new Date(prevEnd.getTime() - durationMs);
  return { startDate: prevStart.toISOString(), endDate: prevEnd.toISOString() };
}

export async function getKPIMetricsWithDeltas(
  range: DateRange,
  agentId?: string,
  profileId?: string
): Promise<KPIMetricsWithDeltas> {
  const prevRange = getPreviousRange(range);

  const [current, prev] = await Promise.all([
    getKPIMetrics(range, agentId, profileId),
    getKPIMetrics(prevRange, agentId, profileId),
  ]);

  return {
    ...current,
    deltaJobs: current.totalJobs - prev.totalJobs,
    deltaProposals: current.proposalsSent - prev.proposalsSent,
    deltaMeetings: current.meetingsBooked - prev.meetingsBooked,
    deltaWon: current.won - prev.won,
    deltaWinRate: current.winRate - prev.winRate,
    deltaBadLeads: current.badLeads - prev.badLeads,
    deltaUntouched: current.untouched - prev.untouched,
  };
}

export async function getConversionFunnel(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<FunnelStep[]> {
  const { startDate, endDate } = range ?? {};
  // Cumulative funnel steps (Proposals Sent, Responses, Meetings Done, Negotiation)
  // are gated by FIRST entry into each metric's funnel-stage set, computed via
  // per-metric move_in_* CTEs + created_at fallback for tasks created already
  // in-funnel. Jobs Received uses created_at (intake). Passed Filter, Won remain
  // current-state gated by COALESCE(stage_entered_at, updated_at, created_at).
  const result = await sql`
    WITH earliest_move AS (
      SELECT DISTINCT ON (task_id)
        task_id,
        LOWER(old_value) AS old_lower
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
      ORDER BY task_id, created_at
    ),
    move_in_proposals_sent AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_proposals_viewed AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'proposal views', 'proposal viewed', 'viewed',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_meetings_done AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('meeting done', 'negotiation', 'won')
      GROUP BY task_id
    ),
    move_in_negotiation AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('negotiation', 'won')
      GROUP BY task_id
    ),
    task_visited AS (
      SELECT
        t.id AS task_id,
        t.column_id,
        t.custom_fields,
        t.updated_at,
        t.created_at,
        LOWER(c.name) AS col_lower,
        LEAST(
          mips.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_proposals_sent_at,
        LEAST(
          mipv.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_proposals_viewed_at,
        LEAST(
          mimd.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('meeting done', 'negotiation', 'won') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('meeting done', 'negotiation', 'won') THEN t.created_at
            ELSE NULL
          END
        ) AS first_meetings_done_at,
        LEAST(
          mineg.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('negotiation', 'won') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('negotiation', 'won') THEN t.created_at
            ELSE NULL
          END
        ) AS first_negotiation_at
      FROM tasks t
      JOIN columns c ON c.id = t.column_id
      LEFT JOIN earliest_move em ON em.task_id = t.id
      LEFT JOIN move_in_proposals_sent mips ON mips.task_id = t.id
      LEFT JOIN move_in_proposals_viewed mipv ON mipv.task_id = t.id
      LEFT JOIN move_in_meetings_done mimd ON mimd.task_id = t.id
      LEFT JOIN move_in_negotiation mineg ON mineg.task_id = t.id
    )
    SELECT
      COUNT(*) FILTER (
        WHERE (${startDate}::timestamptz IS NULL OR tv.created_at >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR tv.created_at <= ${endDate}::timestamptz)
      ) AS total_jobs,
      COUNT(*) FILTER (
        WHERE tv.col_lower NOT IN ('rejected', 'filtered out')
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS passed_filter,
      COUNT(*) FILTER (
        WHERE tv.first_proposals_sent_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_proposals_sent_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_proposals_sent_at <= ${endDate}::timestamptz)
      ) AS proposals_sent,
      COUNT(*) FILTER (
        WHERE tv.first_proposals_viewed_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_proposals_viewed_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_proposals_viewed_at <= ${endDate}::timestamptz)
      ) AS responses,
      COUNT(*) FILTER (
        WHERE tv.first_meetings_done_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_meetings_done_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_meetings_done_at <= ${endDate}::timestamptz)
      ) AS meetings,
      COUNT(*) FILTER (
        WHERE tv.first_negotiation_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_negotiation_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_negotiation_at <= ${endDate}::timestamptz)
      ) AS negotiation,
      COUNT(*) FILTER (
        WHERE tv.col_lower = 'won'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS won
    FROM task_visited tv
    LEFT JOIN jobs j ON j.job_id = (tv.custom_fields->>'_job_id')
    WHERE (${agentId ?? null}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = tv.task_id AND ta.agent_id = ${agentId ?? null}::uuid
      ))
      AND (${profileId ?? null}::text IS NULL
        OR j.profile_id = ${profileId ?? null}::text
        OR EXISTS (
          SELECT 1 FROM task_tag_map ttm
          JOIN task_tags tt ON tt.id = ttm.tag_id
          WHERE ttm.task_id = tv.task_id
            AND LOWER(tt.name) = (SELECT LOWER(profile_name) FROM profiles WHERE profile_id = ${profileId ?? null}::text LIMIT 1)
        ))
  `;

  const r = result.rows[0];
  const total = parseInt(r.total_jobs) || 1;
  const steps = [
    { label: "Jobs Received", count: parseInt(r.total_jobs) || 0, color: "#1a56db" },
    { label: "Passed Filter", count: parseInt(r.passed_filter) || 0, color: "#4d8af0" },
    { label: "Proposals Sent", count: parseInt(r.proposals_sent) || 0, color: "#7c3aed" },
    { label: "Responses", count: parseInt(r.responses) || 0, color: "#8b5cf6" },
    { label: "Meetings Done", count: parseInt(r.meetings) || 0, color: "#f59e0b" },
    { label: "Negotiation", count: parseInt(r.negotiation) || 0, color: "#f97316" },
    { label: "Won", count: parseInt(r.won) || 0, color: "#10b981" },
  ];

  return steps.map((s) => ({
    ...s,
    percentage: Math.round((s.count / total) * 100),
  }));
}

export async function getPipelineNow(agentId?: string, profileId?: string): Promise<
  { label: string; count: number; color: string }[]
> {
  // Counts tasks from actual board columns — matches what the Task Board shows.
  // Joins tasks → columns for column names, and optionally tasks → jobs for agent/profile filtering.
  const result = await sql`
    SELECT
      COUNT(CASE WHEN LOWER(c.name) IN ('to do', 'todo') THEN 1 END) AS todo,
      COUNT(CASE WHEN LOWER(c.name) IN (
        'proposal submitted', 'proposal views',
        'prototype required', 'prototype done', 'prototype submitted',
        'in chat', 'on hold'
      ) THEN 1 END) AS in_progress,
      COUNT(CASE WHEN LOWER(c.name) IN ('meeting scheduled', 'meeting done') THEN 1 END) AS meetings,
      COUNT(CASE WHEN LOWER(c.name) = 'negotiation' THEN 1 END) AS negotiation
    FROM tasks t
    JOIN columns c ON c.id = t.column_id
    LEFT JOIN jobs j ON j.task_id = t.id
    WHERE LOWER(c.name) NOT IN ('won', 'lost', 'rejected', 'filtered out', 'n/a', 'new', 'proposal ready')
      AND (${agentId ?? null}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.agent_id = ${agentId ?? null}::uuid
      ))
      AND (${profileId ?? null}::text IS NULL
        OR j.profile_id = ${profileId ?? null}::text
        OR EXISTS (
          SELECT 1 FROM task_tag_map ttm
          JOIN task_tags tt ON tt.id = ttm.tag_id
          WHERE ttm.task_id = t.id
            AND LOWER(tt.name) = (SELECT LOWER(profile_name) FROM profiles WHERE profile_id = ${profileId ?? null}::text LIMIT 1)
        ))
  `;

  const r = result.rows[0];
  return [
    { label: "To Do", count: parseInt(r.todo) || 0, color: "#1a56db" },
    { label: "In Progress", count: parseInt(r.in_progress) || 0, color: "#7c3aed" },
    { label: "Meetings", count: parseInt(r.meetings) || 0, color: "#f59e0b" },
    { label: "Negotiation", count: parseInt(r.negotiation) || 0, color: "#10b981" },
  ];
}

export async function getPipelineStages(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<PipelineStage[]> {
  const { startDate, endDate } = range ?? {};

  // Cumulative funnel tiles (Proposal Submitted, Views, Prototype branches,
  // In Chat, Mtg Booked/Done, Negotiation) are gated by FIRST entry into each
  // tile's funnel-stage set, computed via per-metric move_in_* CTEs +
  // created_at fallback for tasks created already in-funnel. Todo, Won, Lost,
  // On Hold, N/A tiles remain current-state gated by COALESCE(stage_entered_at,
  // updated_at, created_at).
  const result = await sql`
    WITH earliest_move AS (
      SELECT DISTINCT ON (task_id)
        task_id,
        LOWER(old_value) AS old_lower
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
      ORDER BY task_id, created_at
    ),
    move_in_proposals_sent AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_proposals_viewed AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'proposal views', 'proposal viewed', 'viewed',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_proto_req AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent'
        )
      GROUP BY task_id
    ),
    move_in_proto_done AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('prototype done', 'prototype submitted', 'prototype sent')
      GROUP BY task_id
    ),
    move_in_proto_sub AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('prototype submitted', 'prototype sent')
      GROUP BY task_id
    ),
    move_in_in_chat AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_meetings_booked AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('meeting scheduled', 'meeting done', 'negotiation', 'won')
      GROUP BY task_id
    ),
    move_in_meetings_done AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('meeting done', 'negotiation', 'won')
      GROUP BY task_id
    ),
    move_in_negotiation AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('negotiation', 'won')
      GROUP BY task_id
    ),
    task_visited AS (
      SELECT
        t.id AS task_id,
        t.column_id,
        t.custom_fields,
        t.updated_at,
        t.created_at,
        LOWER(c.name) AS col_lower,
        LEAST(
          mips.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_proposals_sent_at,
        LEAST(
          mipv.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_proposals_viewed_at,
        LEAST(
          mpr.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_proto_req_at,
        LEAST(
          mpd.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('prototype done', 'prototype submitted', 'prototype sent') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('prototype done', 'prototype submitted', 'prototype sent') THEN t.created_at
            ELSE NULL
          END
        ) AS first_proto_done_at,
        LEAST(
          mps.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('prototype submitted', 'prototype sent') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('prototype submitted', 'prototype sent') THEN t.created_at
            ELSE NULL
          END
        ) AS first_proto_sub_at,
        LEAST(
          mic.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_in_chat_at,
        LEAST(
          mimb.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('meeting scheduled', 'meeting done', 'negotiation', 'won') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('meeting scheduled', 'meeting done', 'negotiation', 'won') THEN t.created_at
            ELSE NULL
          END
        ) AS first_meetings_booked_at,
        LEAST(
          mimd.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('meeting done', 'negotiation', 'won') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('meeting done', 'negotiation', 'won') THEN t.created_at
            ELSE NULL
          END
        ) AS first_meetings_done_at,
        LEAST(
          mineg.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('negotiation', 'won') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('negotiation', 'won') THEN t.created_at
            ELSE NULL
          END
        ) AS first_negotiation_at
      FROM tasks t
      JOIN columns c ON c.id = t.column_id
      LEFT JOIN earliest_move em ON em.task_id = t.id
      LEFT JOIN move_in_proposals_sent mips ON mips.task_id = t.id
      LEFT JOIN move_in_proposals_viewed mipv ON mipv.task_id = t.id
      LEFT JOIN move_in_proto_req mpr ON mpr.task_id = t.id
      LEFT JOIN move_in_proto_done mpd ON mpd.task_id = t.id
      LEFT JOIN move_in_proto_sub mps ON mps.task_id = t.id
      LEFT JOIN move_in_in_chat mic ON mic.task_id = t.id
      LEFT JOIN move_in_meetings_booked mimb ON mimb.task_id = t.id
      LEFT JOIN move_in_meetings_done mimd ON mimd.task_id = t.id
      LEFT JOIN move_in_negotiation mineg ON mineg.task_id = t.id
    )
    SELECT
      COUNT(*) FILTER (
        WHERE tv.col_lower IN ('todo', 'to do', 'new', 'proposal ready')
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS todo,
      COUNT(*) FILTER (
        WHERE tv.first_proposals_sent_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_proposals_sent_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_proposals_sent_at <= ${endDate}::timestamptz)
      ) AS proposal_submitted,
      COUNT(*) FILTER (
        WHERE tv.first_proposals_viewed_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_proposals_viewed_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_proposals_viewed_at <= ${endDate}::timestamptz)
      ) AS proposal_views,
      COUNT(*) FILTER (
        WHERE tv.first_proto_req_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_proto_req_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_proto_req_at <= ${endDate}::timestamptz)
      ) AS prototype_required,
      COUNT(*) FILTER (
        WHERE tv.first_proto_done_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_proto_done_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_proto_done_at <= ${endDate}::timestamptz)
      ) AS prototype_done,
      COUNT(*) FILTER (
        WHERE tv.first_proto_sub_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_proto_sub_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_proto_sub_at <= ${endDate}::timestamptz)
      ) AS prototype_submitted,
      COUNT(*) FILTER (
        WHERE tv.first_in_chat_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_in_chat_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_in_chat_at <= ${endDate}::timestamptz)
      ) AS in_chat,
      COUNT(*) FILTER (
        WHERE tv.first_meetings_booked_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_meetings_booked_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_meetings_booked_at <= ${endDate}::timestamptz)
      ) AS meeting_booked,
      COUNT(*) FILTER (
        WHERE tv.first_meetings_done_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_meetings_done_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_meetings_done_at <= ${endDate}::timestamptz)
      ) AS meeting_done,
      COUNT(*) FILTER (
        WHERE tv.first_negotiation_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR tv.first_negotiation_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR tv.first_negotiation_at <= ${endDate}::timestamptz)
      ) AS negotiation,
      COUNT(*) FILTER (
        WHERE tv.col_lower = 'won'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS won,
      COUNT(*) FILTER (
        WHERE tv.col_lower = 'lost'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS lost,
      COUNT(*) FILTER (
        WHERE tv.col_lower = 'on hold'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS on_hold,
      COUNT(*) FILTER (
        WHERE tv.col_lower = 'n/a'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at) <= ${endDate}::timestamptz)
      ) AS na
    FROM task_visited tv
    LEFT JOIN jobs j ON j.job_id = (tv.custom_fields->>'_job_id')
    WHERE (${agentId ?? null}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = tv.task_id AND ta.agent_id = ${agentId ?? null}::uuid
      ))
      AND (${profileId ?? null}::text IS NULL
        OR j.profile_id = ${profileId ?? null}::text
        OR EXISTS (
          SELECT 1 FROM task_tag_map ttm
          JOIN task_tags tt ON tt.id = ttm.tag_id
          WHERE ttm.task_id = tv.task_id
            AND LOWER(tt.name) = (SELECT LOWER(profile_name) FROM profiles WHERE profile_id = ${profileId ?? null}::text LIMIT 1)
        ))
  `;

  const r = result.rows[0];
  const n = (v: unknown) => parseInt(String(v ?? 0)) || 0;

  // Fixed stage order, matching the board column order. Funnel stages
  // (Submitted → Negotiation) are cumulative — count of cards that have reached
  // this stage or any later one. Terminal/off-funnel stages stay current-state.
  return [
    { key: "Todo",                label: "Todo",        count: n(r.todo),                subtitle: "Pending proposals" },
    { key: "Proposal Submitted",  label: "Submitted",   count: n(r.proposal_submitted),  subtitle: "Reached this stage" },
    { key: "Proposal Views",      label: "Views",       count: n(r.proposal_views),      subtitle: "Reached this stage" },
    { key: "Prototype Required",  label: "Proto Req.",  count: n(r.prototype_required),  subtitle: "Reached this stage" },
    { key: "Prototype Done",      label: "Proto Done",  count: n(r.prototype_done),      subtitle: "Reached this stage" },
    { key: "Prototype Submitted", label: "Proto Sent",  count: n(r.prototype_submitted), subtitle: "Reached this stage" },
    { key: "In Chat",             label: "In Chat",     count: n(r.in_chat),             subtitle: "Reached this stage" },
    { key: "Meeting Scheduled",   label: "Mtg Booked",  count: n(r.meeting_booked),      subtitle: "Reached this stage" },
    { key: "Meeting Done",        label: "Mtg Done",    count: n(r.meeting_done),        subtitle: "Reached this stage" },
    { key: "Negotiation",         label: "Negotiation", count: n(r.negotiation),         subtitle: "Reached this stage" },
    { key: "Won",                 label: "Won",         count: n(r.won),                 subtitle: "Closed won" },
    { key: "Lost",                label: "Lost",        count: n(r.lost),                subtitle: "Closed lost" },
    { key: "On Hold",             label: "On Hold",     count: n(r.on_hold),             subtitle: "Client paused" },
    { key: "N/A",                 label: "N/A",         count: n(r.na),                  subtitle: "Not applicable" },
  ];
}

export async function getActiveJobsInPipeline(agentId?: string, profileId?: string): Promise<PipelineJob[]> {
  const result = await sql`
    SELECT
      j.id,
      j.job_title,
      p.profile_name,
      a.name AS agent_name,
      j.status,
      j.updated_at,
      CASE
        WHEN j.budget_max >= 5000 THEN 'high'
        WHEN j.budget_max >= 1000 THEN 'medium'
        ELSE 'low'
      END AS priority
    FROM jobs j
    LEFT JOIN profiles p ON p.profile_id = j.profile_id
    LEFT JOIN agents a ON a.id = j.agent_id
    WHERE (j.outcome IS NULL OR j.outcome = 'pending')
      AND (${agentId ?? null}::uuid IS NULL OR j.agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR j.profile_id = ${profileId ?? null}::text)
    ORDER BY
      CASE j.status
        WHEN 'Negotiation' THEN 1 WHEN 'Meeting Done' THEN 2
        WHEN 'Meeting Scheduled' THEN 3 WHEN 'Prototype Sent' THEN 4
        WHEN 'Prototype Done' THEN 5 WHEN 'Prototype Required' THEN 6
        WHEN 'Following Up' THEN 7 WHEN 'Sent' THEN 8
        WHEN 'Submitted' THEN 9 WHEN 'To Do' THEN 10
        ELSE 11
      END,
      j.updated_at ASC NULLS LAST
    LIMIT 50
  `;

  return result.rows.map((row) => {
    const enteredAt = row.updated_at;
    const diffMs = Date.now() - new Date(enteredAt).getTime();
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(hours / 24);
    const timeStr = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;

    return {
      id: row.id,
      job_title: row.job_title,
      profile_name: row.profile_name,
      agent_name: row.agent_name,
      status: row.status,
      time_in_stage: timeStr,
      priority: row.priority || "low",
    };
  });
}

export async function getEnhancedAgentStats(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<EnhancedAgentStats[]> {
  const { startDate, endDate } = range ?? {};

  // proposals_sent / meetings_done use first entry into each metric's funnel
  // window (matches getKPIMetrics). won/lost stay current-state, gated by
  // COALESCE(stage_entered_at, updated_at, created_at). total_jobs uses created_at.
  const result = await sql`
    WITH earliest_move AS (
      SELECT DISTINCT ON (task_id)
        task_id,
        LOWER(old_value) AS old_lower
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
      ORDER BY task_id, created_at
    ),
    move_in_proposals_sent AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_meetings_done AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('meeting done', 'negotiation', 'won')
      GROUP BY task_id
    ),
    agent_scoped_tasks AS (
      SELECT
        ta.agent_id,
        t.id AS task_id,
        t.created_at,
        t.updated_at,
        c.name AS col_name,
        LOWER(c.name) AS col_lower,
        j.profile_id,
        j.won_value,
        j.proposal_sent_at,
        j.received_at,
        j.stage_entered_at,
        LEAST(
          mips.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_proposals_sent_at,
        LEAST(
          mimd.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('meeting done', 'negotiation', 'won') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('meeting done', 'negotiation', 'won') THEN t.created_at
            ELSE NULL
          END
        ) AS first_meetings_done_at
      FROM tasks t
      JOIN task_assignees ta ON ta.task_id = t.id
      JOIN columns c ON c.id = t.column_id
      LEFT JOIN earliest_move em ON em.task_id = t.id
      LEFT JOIN move_in_proposals_sent mips ON mips.task_id = t.id
      LEFT JOIN move_in_meetings_done mimd ON mimd.task_id = t.id
      LEFT JOIN jobs j ON j.job_id = (t.custom_fields->>'_job_id')
      WHERE (${profileId ?? null}::text IS NULL
        OR j.profile_id = ${profileId ?? null}::text
        OR EXISTS (
          SELECT 1 FROM task_tag_map ttm
          JOIN task_tags tt ON tt.id = ttm.tag_id
          WHERE ttm.task_id = t.id
            AND LOWER(tt.name) = (SELECT LOWER(profile_name) FROM profiles WHERE profile_id = ${profileId ?? null}::text LIMIT 1)
        ))
    )
    SELECT
      a.id,
      a.name,
      COUNT(s.task_id) FILTER (
        WHERE (${startDate}::timestamptz IS NULL OR s.created_at >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR s.created_at <= ${endDate}::timestamptz)
      ) AS total_jobs,
      COUNT(*) FILTER (
        WHERE s.first_proposals_sent_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR s.first_proposals_sent_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR s.first_proposals_sent_at <= ${endDate}::timestamptz)
      ) AS proposals_sent,
      COUNT(*) FILTER (
        WHERE s.col_lower = 'won'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
      ) AS won,
      COUNT(*) FILTER (
        WHERE s.col_lower = 'lost'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
      ) AS lost,
      ROUND(
        COUNT(*) FILTER (
          WHERE s.col_lower = 'won'
          AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
        )::DECIMAL /
        NULLIF(COUNT(*) FILTER (
          WHERE s.col_lower IN ('won', 'lost')
          AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
        ), 0) * 100, 1
      ) AS win_rate_pct,
      COALESCE(SUM(s.won_value) FILTER (
        WHERE s.col_lower = 'won'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
      ), 0) AS total_revenue,
      AVG(
        CASE WHEN s.proposal_sent_at IS NOT NULL AND s.received_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (s.proposal_sent_at - s.received_at)) / 3600
        END
      ) FILTER (
        WHERE (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
      ) AS avg_response_hours,
      COUNT(*) FILTER (
        WHERE s.first_meetings_done_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR s.first_meetings_done_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR s.first_meetings_done_at <= ${endDate}::timestamptz)
      ) AS meetings_done
    FROM agents a
    LEFT JOIN agent_scoped_tasks s ON s.agent_id = a.id
    WHERE a.active = true
      AND (${agentId ?? null}::uuid IS NULL OR a.id = ${agentId ?? null}::uuid)
    GROUP BY a.id, a.name
    ORDER BY won DESC, proposals_sent DESC
  `;

  return result.rows.map((row) => {
    const proposalsSent = parseInt(row.proposals_sent) || 0;
    const won = parseInt(row.won) || 0;
    const meetings = parseInt(row.meetings_done) || 0;
    const totalJobs = parseInt(row.total_jobs) || 0;
    // Conversion rate: % of all the agent's cards that ended up Won.
    // (Old "won/proposalsSent" formula only worked under cumulative semantics;
    // with current-state column counts it produced impossible >100% values.)
    const convRate = totalJobs > 0 ? Math.round((won / totalJobs) * 1000) / 10 : 0;

    // Score: weighted from win_rate (40%), conversion (30%), speed (30%)
    const winRate = parseFloat(row.win_rate_pct) || 0;
    const avgHours = parseFloat(row.avg_response_hours) || 2;
    const speedScore = Math.max(0, 100 - avgHours * 10); // faster = better
    const score = Math.round(winRate * 0.4 + convRate * 0.3 + speedScore * 0.3);

    return {
      id: row.id,
      name: row.name,
      total_jobs: totalJobs,
      proposals_sent: proposalsSent,
      won,
      lost: parseInt(row.lost) || 0,
      win_rate_pct: row.win_rate_pct ? parseFloat(row.win_rate_pct) : null,
      total_revenue: parseFloat(row.total_revenue) || 0,
      avg_response_hours: row.avg_response_hours
        ? parseFloat(parseFloat(row.avg_response_hours).toFixed(1))
        : null,
      meetings_done: meetings,
      conversion_rate: convRate,
      bonus_earned: 0,
      score_pct: Math.min(score, 100),
    };
  });
}

export async function getAgentWeeklyActivity(
  agentId: string
): Promise<{ day: string; count: number }[]> {
  const result = await sql`
    SELECT
      TO_CHAR(proposal_sent_at, 'Dy') AS day,
      COUNT(*) AS count
    FROM jobs
    WHERE agent_id = ${agentId}
      AND proposal_sent_at IS NOT NULL
      AND proposal_sent_at >= NOW() - INTERVAL '7 days'
    GROUP BY TO_CHAR(proposal_sent_at, 'Dy'), EXTRACT(DOW FROM proposal_sent_at)
    ORDER BY EXTRACT(DOW FROM proposal_sent_at)
  `;

  // Ensure all 7 days are present
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dataMap = new Map(result.rows.map((r) => [r.day, parseInt(r.count) || 0]));
  return days.map((d) => ({ day: d, count: dataMap.get(d) || 0 }));
}

export async function getEnhancedProfileStats(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<EnhancedProfileStats[]> {
  const { startDate, endDate } = range ?? {};

  // proposals_sent / responded / reached_meeting use first entry into each
  // metric's funnel window (matches getKPIMetrics). won stays current-state,
  // gated by COALESCE(stage_entered_at, updated_at, created_at). total_jobs
  // uses created_at. Profile link is via jobs.profile_id (orphan tasks have no profile).
  const result = await sql`
    WITH earliest_move AS (
      SELECT DISTINCT ON (task_id)
        task_id,
        LOWER(old_value) AS old_lower
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
      ORDER BY task_id, created_at
    ),
    move_in_proposals_sent AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_responded AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN (
          'proposal views', 'proposal viewed', 'viewed',
          'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
          'in chat', 'following up',
          'meeting scheduled', 'meeting done',
          'negotiation', 'won'
        )
      GROUP BY task_id
    ),
    move_in_reached_meeting AS (
      SELECT task_id, MIN(created_at) AS first_in
      FROM activity_log
      WHERE action_type = 'task_moved' AND field = 'column'
        AND LOWER(new_value) IN ('meeting scheduled', 'meeting done', 'negotiation', 'won')
      GROUP BY task_id
    ),
    profile_scoped_tasks AS (
      SELECT
        j.profile_id,
        t.id AS task_id,
        t.created_at,
        t.updated_at,
        c.name AS col_name,
        LOWER(c.name) AS col_lower,
        j.won_value,
        j.agent_id,
        j.stage_entered_at,
        LEAST(
          mips.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'proposal submitted', 'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_proposals_sent_at,
        LEAST(
          mir.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN (
              'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN (
              'proposal views', 'proposal viewed', 'viewed',
              'prototype required', 'prototype done', 'prototype submitted', 'prototype sent',
              'in chat', 'following up',
              'meeting scheduled', 'meeting done',
              'negotiation', 'won'
            ) THEN t.created_at
            ELSE NULL
          END
        ) AS first_responded_at,
        LEAST(
          mirm.first_in,
          CASE
            WHEN em.task_id IS NULL AND LOWER(c.name) IN ('meeting scheduled', 'meeting done', 'negotiation', 'won') THEN t.created_at
            WHEN em.task_id IS NOT NULL AND em.old_lower IN ('meeting scheduled', 'meeting done', 'negotiation', 'won') THEN t.created_at
            ELSE NULL
          END
        ) AS first_reached_meeting_at
      FROM tasks t
      JOIN columns c ON c.id = t.column_id
      JOIN jobs j ON j.job_id = (t.custom_fields->>'_job_id')
      LEFT JOIN earliest_move em ON em.task_id = t.id
      LEFT JOIN move_in_proposals_sent mips ON mips.task_id = t.id
      LEFT JOIN move_in_responded mir ON mir.task_id = t.id
      LEFT JOIN move_in_reached_meeting mirm ON mirm.task_id = t.id
      WHERE (${agentId ?? null}::uuid IS NULL OR j.agent_id = ${agentId ?? null}::uuid)
    )
    SELECT
      p.id,
      p.profile_id,
      p.profile_name,
      p.stack,
      COUNT(s.task_id) FILTER (
        WHERE (${startDate}::timestamptz IS NULL OR s.created_at >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR s.created_at <= ${endDate}::timestamptz)
      ) AS total_jobs,
      COUNT(*) FILTER (
        WHERE s.col_lower = 'won'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
      ) AS won,
      ROUND(
        COUNT(*) FILTER (
          WHERE s.col_lower = 'won'
          AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
        )::DECIMAL /
        NULLIF(COUNT(*) FILTER (
          WHERE s.col_lower IN ('won', 'lost')
          AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
        ), 0) * 100, 1
      ) AS win_rate_pct,
      AVG(s.won_value) FILTER (
        WHERE s.col_lower = 'won'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
      ) AS avg_won_value,
      COALESCE(SUM(s.won_value) FILTER (
        WHERE s.col_lower = 'won'
        AND (${startDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR COALESCE(s.stage_entered_at, s.updated_at, s.created_at) <= ${endDate}::timestamptz)
      ), 0) AS total_revenue,
      COUNT(*) FILTER (
        WHERE s.first_responded_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR s.first_responded_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR s.first_responded_at <= ${endDate}::timestamptz)
      ) AS responded,
      COUNT(*) FILTER (
        WHERE s.first_proposals_sent_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR s.first_proposals_sent_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR s.first_proposals_sent_at <= ${endDate}::timestamptz)
      ) AS proposals_sent,
      COUNT(*) FILTER (
        WHERE s.first_reached_meeting_at IS NOT NULL
        AND (${startDate}::timestamptz IS NULL OR s.first_reached_meeting_at >= ${startDate}::timestamptz)
        AND (${endDate}::timestamptz IS NULL OR s.first_reached_meeting_at <= ${endDate}::timestamptz)
      ) AS reached_meeting
    FROM profiles p
    LEFT JOIN profile_scoped_tasks s ON s.profile_id = p.profile_id
    WHERE p.active = true
      AND (${profileId ?? null}::text IS NULL OR p.profile_id = ${profileId ?? null}::text)
    GROUP BY p.id, p.profile_id, p.profile_name, p.stack
    ORDER BY total_jobs DESC
  `;

  return result.rows.map((row) => {
    const totalJobs = parseInt(row.total_jobs) || 0;
    const proposalsSent = parseInt(row.proposals_sent) || 0;
    const responded = parseInt(row.responded) || 0;
    const reached = parseInt(row.reached_meeting) || 0;

    return {
      id: row.id,
      profile_id: row.profile_id,
      profile_name: row.profile_name,
      stack: row.stack,
      niche: row.stack,
      total_jobs: totalJobs,
      proposals_sent: proposalsSent,
      won: parseInt(row.won) || 0,
      win_rate_pct: row.win_rate_pct ? parseFloat(row.win_rate_pct) : null,
      avg_won_value: row.avg_won_value
        ? parseFloat(parseFloat(row.avg_won_value).toFixed(0))
        : null,
      total_revenue: parseFloat(row.total_revenue) || 0,
      // Response rate: % of all the profile's submitted-or-later cards that
      // received a response (moved past Proposal Submitted).
      response_rate: totalJobs > 0 ? Math.round((responded / totalJobs) * 100) : 0,
      interview_rate: totalJobs > 0 ? Math.round((reached / totalJobs) * 100) : 0,
    };
  });
}

export async function getConnectsUsageByProfile(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<ConnectsUsage[]> {
  const { startDate, endDate } = range ?? {};

  // Sums real per-task connects from tasks.custom_fields._connects_used.
  // Tasks are attributed to a profile either through their linked job
  // (custom_fields._job_id -> jobs.job_id -> jobs.profile_id) OR through a
  // task tag whose name matches the profile_name (the same dual-resolution
  // pattern used elsewhere). Manual cards with neither linkage are not
  // attributable to a profile and are excluded from this per-profile view;
  // they are still captured by getBoostedConnectsSummary's totals.
  //
  // connects_budget per profile is now SUM(connects_count) of recorded
  // purchases (connects_purchases table), date-bounded by the same range.
  // The legacy profiles.connects_budget column is no longer read.
  const result = await sql`
    SELECT
      p.profile_name,
      p.stack,
      COALESCE(cpb.total_purchased, 0) AS connects_budget,
      COALESCE(SUM(NULLIF(t.custom_fields->>'_connects_used', '')::numeric), 0) AS connects_used
    FROM profiles p
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(cp.connects_count), 0) AS total_purchased
      FROM connects_purchases cp
      WHERE cp.profile_id = p.profile_id
        AND (${startDate}::timestamptz IS NULL OR cp.purchased_on >= (${startDate}::timestamptz)::date)
        AND (${endDate}::timestamptz   IS NULL OR cp.purchased_on <= (${endDate}::timestamptz)::date)
    ) cpb ON TRUE
    LEFT JOIN tasks t ON (
      EXISTS (
        SELECT 1 FROM jobs j2
        WHERE j2.job_id = (t.custom_fields->>'_job_id')
          AND j2.profile_id = p.profile_id
      )
      OR EXISTS (
        SELECT 1 FROM task_tag_map ttm
        JOIN task_tags tt ON tt.id = ttm.tag_id
        WHERE ttm.task_id = t.id
          AND LOWER(tt.name) = LOWER(p.profile_name)
      )
    )
    LEFT JOIN jobs j ON j.job_id = (t.custom_fields->>'_job_id')
    WHERE p.active = true
      AND (
        NULLIF(t.custom_fields->>'_connects_used', '') IS NOT NULL
        OR cpb.total_purchased > 0
      )
      AND (
        t.id IS NULL
        OR (
          NULLIF(t.custom_fields->>'_connects_used', '') IS NOT NULL
          AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, t.created_at) >= ${startDate}::timestamptz)
          AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, t.created_at) <= ${endDate}::timestamptz)
          AND (
            ${agentId ?? null}::uuid IS NULL
            OR j.agent_id = ${agentId ?? null}::uuid
            OR EXISTS (
              SELECT 1 FROM task_assignees ta
              WHERE ta.task_id = t.id AND ta.agent_id = ${agentId ?? null}::uuid
            )
          )
        )
      )
      AND (${agentId ?? null}::uuid IS NULL OR p.agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR p.profile_id = ${profileId ?? null}::text)
    GROUP BY p.profile_name, p.stack, cpb.total_purchased
    HAVING (
      COALESCE(SUM(NULLIF(t.custom_fields->>'_connects_used', '')::numeric), 0) > 0
      OR COALESCE(cpb.total_purchased, 0) > 0
    )
    ORDER BY connects_used DESC
  `;

  return result.rows.map((row) => ({
    profile_name: row.profile_name,
    niche: row.stack,
    connects_used: parseInt(row.connects_used) || 0,
    connects_budget: parseInt(row.connects_budget) || 0,
  }));
}

// ============================================================
// CONNECTS PURCHASE LEDGER
// ============================================================

export async function createConnectsPurchase(input: {
  profileId: string;
  purchasedOn: string; // YYYY-MM-DD
  connectsCount: number;
  amountSpent: number;
  notes?: string | null;
  createdBy: string | null; // agent UUID, NULL for admin
}): Promise<{ id: string }> {
  const result = await sql`
    INSERT INTO connects_purchases
      (profile_id, purchased_on, connects_count, amount_spent, notes, created_by)
    VALUES
      (${input.profileId}, ${input.purchasedOn}::date, ${input.connectsCount}, ${input.amountSpent}, ${input.notes ?? null}, ${input.createdBy})
    RETURNING id
  `;
  return { id: result.rows[0].id as string };
}

export async function deleteConnectsPurchase(purchaseId: string): Promise<boolean> {
  const result = await sql`DELETE FROM connects_purchases WHERE id = ${purchaseId}::uuid`;
  return (result.rowCount ?? 0) > 0;
}

export async function getProfileAgentId(profileId: string): Promise<string | null> {
  const result = await sql`
    SELECT agent_id FROM profiles WHERE profile_id = ${profileId} LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return (result.rows[0].agent_id as string | null) ?? null;
}

export async function getConnectsPurchasesByProfile(
  profileIds?: string[],
  range?: DateRange,
  limit = 200
): Promise<import("./types").ConnectsPurchase[]> {
  const { startDate, endDate } = range ?? {};
  const profileFilter = profileIds && profileIds.length > 0 ? profileIds : null;

  const result = await sql`
    SELECT
      cp.id,
      cp.profile_id,
      p.profile_name,
      p.agent_id,
      pa.name AS agent_name,
      cp.purchased_on,
      cp.connects_count,
      cp.amount_spent,
      cp.notes,
      cp.created_by,
      ca.name AS created_by_name,
      cp.created_at
    FROM connects_purchases cp
    JOIN profiles p ON p.profile_id = cp.profile_id
    LEFT JOIN agents pa ON pa.id = p.agent_id
    LEFT JOIN agents ca ON ca.id = cp.created_by
    WHERE (${profileFilter}::text[] IS NULL OR cp.profile_id = ANY(${profileFilter}::text[]))
      AND (${startDate}::timestamptz IS NULL OR cp.purchased_on >= (${startDate}::timestamptz)::date)
      AND (${endDate}::timestamptz   IS NULL OR cp.purchased_on <= (${endDate}::timestamptz)::date)
    ORDER BY cp.purchased_on DESC, cp.created_at DESC
    LIMIT ${limit}
  `;

  return result.rows.map((row) => ({
    id: row.id as string,
    profile_id: row.profile_id as string,
    profile_name: row.profile_name as string,
    agent_id: (row.agent_id as string | null) ?? null,
    agent_name: (row.agent_name as string | null) ?? null,
    purchased_on: typeof row.purchased_on === "string" ? row.purchased_on : new Date(row.purchased_on as Date).toISOString().slice(0, 10),
    connects_count: parseInt(row.connects_count as string) || 0,
    amount_spent: parseFloat(row.amount_spent as string) || 0,
    notes: (row.notes as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    created_by_name: (row.created_by_name as string | null) ?? null,
    created_at: row.created_at as string,
  }));
}

export async function getConnectsBudgetSummary(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<import("./types").ConnectsBudgetSummary> {
  const { startDate, endDate } = range ?? {};

  const result = await sql`
    SELECT
      COALESCE(SUM(cp.connects_count), 0) AS total_connects_purchased,
      COALESCE(SUM(cp.amount_spent),   0) AS total_spent_usd,
      COUNT(*)                            AS purchase_count
    FROM connects_purchases cp
    JOIN profiles p ON p.profile_id = cp.profile_id
    WHERE (${startDate}::timestamptz IS NULL OR cp.purchased_on >= (${startDate}::timestamptz)::date)
      AND (${endDate}::timestamptz   IS NULL OR cp.purchased_on <= (${endDate}::timestamptz)::date)
      AND (${agentId ?? null}::uuid IS NULL OR p.agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR cp.profile_id = ${profileId ?? null}::text)
  `;

  const row = result.rows[0];
  return {
    totalConnectsPurchased: parseInt(row.total_connects_purchased as string) || 0,
    totalSpentUsd: parseFloat(row.total_spent_usd as string) || 0,
    purchaseCount: parseInt(row.purchase_count as string) || 0,
  };
}

export async function getBoostedConnectsSummary(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<BoostedConnectsSummary> {
  const { startDate, endDate } = range ?? {};

  // tasks.custom_fields._job_id links to jobs.job_id (jobs.task_id is not populated).
  // LEFT JOIN so manually-created tasks without a linked job still count when no filters are set.
  const result = await sql`
    SELECT
      COALESCE(SUM(NULLIF(t.custom_fields->>'_connects_used', '')::numeric), 0) AS total_connects_used,
      COALESCE(SUM(NULLIF(t.custom_fields->>'_boosted_connects', '')::numeric), 0) AS total_boosted,
      COALESCE(SUM(
        CASE WHEN EXISTS (
          SELECT 1
          FROM task_tag_map ttm
          JOIN task_tags tg ON tg.id = ttm.tag_id
          WHERE ttm.task_id = t.id
            AND LOWER(tg.name) = 'bid out boost'
        )
        THEN NULLIF(t.custom_fields->>'_boosted_connects', '')::numeric
        ELSE 0
        END
      ), 0) AS bid_out_boost
    FROM tasks t
    LEFT JOIN jobs j ON j.job_id = (t.custom_fields->>'_job_id')
    WHERE (
        NULLIF(t.custom_fields->>'_connects_used', '') IS NOT NULL
        OR NULLIF(t.custom_fields->>'_boosted_connects', '') IS NOT NULL
      )
      AND (
        ${startDate}::timestamptz IS NULL
        OR COALESCE(j.stage_entered_at, t.created_at) >= ${startDate}::timestamptz
      )
      AND (
        ${endDate}::timestamptz IS NULL
        OR COALESCE(j.stage_entered_at, t.created_at) <= ${endDate}::timestamptz
      )
      AND (
        ${agentId ?? null}::uuid IS NULL
        OR j.agent_id = ${agentId ?? null}::uuid
        OR EXISTS (
          SELECT 1 FROM task_assignees ta
          WHERE ta.task_id = t.id AND ta.agent_id = ${agentId ?? null}::uuid
        )
      )
      AND (
        ${profileId ?? null}::text IS NULL
        OR j.profile_id = ${profileId ?? null}::text
      )
  `;

  const row = result.rows[0] ?? {};
  return {
    totalConnectsUsed: Number(row.total_connects_used) || 0,
    totalBoosted: Number(row.total_boosted) || 0,
    bidOutBoost: Number(row.bid_out_boost) || 0,
  };
}

export async function getConnectROIByNiche(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<ConnectROI[]> {
  const { startDate, endDate } = range ?? {};

  // Real connects from tasks.custom_fields._connects_used grouped by the
  // niche of the task's linked profile (via custom_fields._job_id). Tasks
  // whose linked job has no profile, or that have no _job_id at all
  // (typical manual creation), aggregate under 'Unspecified' so they stay
  // visible. Wins are read from the task's current column = 'Won', so a
  // manually-won card without a jobs row still counts toward its niche row.
  const result = await sql`
    SELECT
      COALESCE(p.stack, 'Unspecified') AS niche,
      COALESCE(SUM(NULLIF(t.custom_fields->>'_connects_used', '')::numeric), 0) AS connects_spent,
      COUNT(*) FILTER (WHERE LOWER(c.name) = 'won') AS wins
    FROM tasks t
    JOIN columns c ON c.id = t.column_id
    LEFT JOIN jobs j ON j.job_id = (t.custom_fields->>'_job_id')
    LEFT JOIN profiles p ON p.profile_id = j.profile_id
    WHERE NULLIF(t.custom_fields->>'_connects_used', '') IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, t.created_at) >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR COALESCE(j.stage_entered_at, t.created_at) <= ${endDate}::timestamptz)
      AND (
        ${agentId ?? null}::uuid IS NULL
        OR j.agent_id = ${agentId ?? null}::uuid
        OR EXISTS (
          SELECT 1 FROM task_assignees ta
          WHERE ta.task_id = t.id AND ta.agent_id = ${agentId ?? null}::uuid
        )
      )
      AND (${profileId ?? null}::text IS NULL OR j.profile_id = ${profileId ?? null}::text)
    GROUP BY COALESCE(p.stack, 'Unspecified')
    HAVING COALESCE(SUM(NULLIF(t.custom_fields->>'_connects_used', '')::numeric), 0) > 0
    ORDER BY connects_spent DESC
  `;

  return result.rows.map((row) => {
    const wins = parseInt(row.wins) || 0;
    const spent = parseInt(row.connects_spent) || 0;
    return {
      niche: row.niche,
      connects_spent: spent,
      wins,
      cost_per_win: wins > 0 ? Math.round(spent / wins) : null,
    };
  });
}

export async function getFilterQualityAnalysis(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<FilterQuality[]> {
  const { startDate, endDate } = range ?? {};

  // Generate filter quality analysis from loss patterns
  // rejection_reason column may not exist yet; use status-based analysis
  const result = await sql`
    SELECT
      CASE
        WHEN budget_max IS NOT NULL AND budget_max < 500 THEN 'Budget too low (<$500)'
        WHEN client_rating IS NOT NULL AND client_rating < 3 THEN 'Low client rating'
        WHEN client_hires IS NOT NULL AND client_hires = 0 THEN 'Unverified client'
        WHEN LOWER(status) IN ('rejected', 'filtered out') THEN 'Filtered out by system'
        ELSE 'Other'
      END AS reason,
      COUNT(*) AS count
    FROM jobs
    WHERE (outcome = 'lost' OR LOWER(status) IN ('rejected', 'filtered out', 'lost'))
      AND (${startDate}::timestamptz IS NULL OR stage_entered_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR stage_entered_at <= ${endDate}::timestamptz)
      AND (${agentId ?? null}::uuid IS NULL OR agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR profile_id = ${profileId ?? null}::text)
    GROUP BY
      CASE
        WHEN budget_max IS NOT NULL AND budget_max < 500 THEN 'Budget too low (<$500)'
        WHEN client_rating IS NOT NULL AND client_rating < 3 THEN 'Low client rating'
        WHEN client_hires IS NOT NULL AND client_hires = 0 THEN 'Unverified client'
        WHEN LOWER(status) IN ('rejected', 'filtered out') THEN 'Filtered out by system'
        ELSE 'Other'
      END
    ORDER BY count DESC
  `;

  const total = result.rows.reduce((sum, r) => sum + (parseInt(r.count) || 0), 0) || 1;

  return result.rows.map((row) => ({
    reason: row.reason,
    count: parseInt(row.count) || 0,
    percentage: Math.round(((parseInt(row.count) || 0) / total) * 100),
  }));
}

export async function getAlertCounts(): Promise<AlertCounts> {
  const [alertResult, overdueResult] = await Promise.all([
    sql`
      SELECT
        COUNT(CASE WHEN alert_type IN ('win_rate_drop', 'agent_slow', 'profile_zero_wins') THEN 1 END) AS critical,
        COUNT(CASE WHEN alert_type IN ('low_volume', 'connect_waste', 'follow_up_needed') THEN 1 END) AS warning,
        COUNT(CASE WHEN alert_type IN ('niche_outperform', 'bonus_threshold', 'filter_recommendation') THEN 1 END) AS opportunity
      FROM alerts
      WHERE dismissed = false
    `,
    sql`
      SELECT COUNT(*) AS count
      FROM jobs
      WHERE LOWER(status) IN ('to do', 'todo', 'new', 'proposal ready', 'n/a')
        AND (outcome IS NULL OR outcome = 'pending')
        AND updated_at < NOW() - INTERVAL '48 hours'
    `,
  ]);

  const ar = alertResult.rows[0];
  return {
    critical: parseInt(ar?.critical) || 0,
    warning: parseInt(ar?.warning) || 0,
    opportunity: parseInt(ar?.opportunity) || 0,
    overdue: parseInt(overdueResult.rows[0]?.count) || 0,
  };
}

export async function getOverdueItems(): Promise<PipelineJob[]> {
  const result = await sql`
    SELECT
      j.id,
      j.job_title,
      p.profile_name,
      a.name AS agent_name,
      j.status,
      j.updated_at,
      CASE
        WHEN j.budget_max >= 5000 THEN 'high'
        WHEN j.budget_max >= 1000 THEN 'medium'
        ELSE 'low'
      END AS priority
    FROM jobs j
    LEFT JOIN profiles p ON p.profile_id = j.profile_id
    LEFT JOIN agents a ON a.id = j.agent_id
    WHERE LOWER(j.status) IN ('to do', 'todo', 'new', 'proposal ready', 'n/a')
      AND (j.outcome IS NULL OR j.outcome = 'pending')
      AND j.updated_at < NOW() - INTERVAL '48 hours'
    ORDER BY j.updated_at ASC
    LIMIT 20
  `;

  return result.rows.map((row) => {
    const enteredAt = row.updated_at;
    const diffMs = Date.now() - new Date(enteredAt).getTime();
    const hours = Math.floor(diffMs / 3600000);
    const days = Math.floor(hours / 24);
    const timeStr = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;

    return {
      id: row.id,
      job_title: row.job_title,
      profile_name: row.profile_name,
      agent_name: row.agent_name,
      status: row.status,
      time_in_stage: timeStr,
      priority: row.priority || "low",
    };
  });
}

// Avg response time (hours) across all proposals in the period
export async function getAvgResponseTime(
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<number | null> {
  const { startDate, endDate } = range ?? {};

  // Median (P50), not mean — stale backfilled rows and bounce-back tasks left
  // outliers >100h that swung the arithmetic mean by hours. Median ignores them.
  // Date window stays on received_at to match "received in this period, time to first apply".
  const result = await sql`
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (proposal_sent_at - received_at)) / 3600
    ) AS median_hours
    FROM jobs
    WHERE proposal_sent_at IS NOT NULL
      AND (${startDate}::timestamptz IS NULL OR received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR received_at <= ${endDate}::timestamptz)
      AND (${agentId ?? null}::uuid IS NULL OR agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR profile_id = ${profileId ?? null}::text)
  `;

  const val = result.rows[0]?.median_hours;
  if (val === null || val === undefined) return null;
  return parseFloat(parseFloat(val).toFixed(2));
}

// Jobs still in pre-sent status where wait time > threshold (15 min default)
export async function getSlowResponseJobs(
  thresholdMinutes: number = 15,
  agentId?: string,
  profileId?: string
): Promise<(Job & { agent_name: string | null; profile_name: string | null; response_minutes: number })[]> {
  const result = await sql`
    SELECT j.*,
      a.name AS agent_name,
      p.profile_name,
      EXTRACT(EPOCH FROM (NOW() - j.received_at)) / 60 AS response_minutes
    FROM jobs j
    LEFT JOIN agents a ON a.id = j.agent_id
    LEFT JOIN profiles p ON p.profile_id = j.profile_id
    WHERE LOWER(j.status) IN ('to do', 'todo', 'new', 'proposal ready', 'n/a')
      AND EXTRACT(EPOCH FROM (NOW() - j.received_at)) / 60 > ${thresholdMinutes}
      AND (${agentId ?? null}::uuid IS NULL OR j.agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR j.profile_id = ${profileId ?? null}::text)
    ORDER BY j.received_at ASC
    LIMIT 20
  `;

  return result.rows.map((row) => ({
    ...row,
    skills: row.skills ?? null,
    response_minutes: Math.round(parseFloat(row.response_minutes) || 0),
  })) as (Job & { agent_name: string | null; profile_name: string | null; response_minutes: number })[];
}
