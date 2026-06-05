import { sql, withTransaction } from "@/lib/db";
import { RELEVANCY_REASON_SET } from "@/lib/relevancy-reasons";
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
// KPI DRILL-DOWN — list of tasks behind a single KPI tile
// ============================================================

export type KPIMetricKey =
  | "total_jobs"
  | "proposals_sent"
  | "proposals_viewed"
  | "in_chat"
  | "meetings_booked"
  | "meetings_done"
  | "won"
  | "lost"
  | "bad_leads"
  | "untouched";

export interface KPIMetricTaskRow {
  id: string;
  title: string;
  columnName: string;
  firstAt: string | null;
  jobUrl: string | null;
  assignees: string | null;
  tags: { name: string; color: string | null }[];
}

// Reuses the SAME CTE chain as getKPIMetrics (lines ~64-212) so the modal list
// length always matches the card count. The CASE expressions in `target` map
// each metric to (a) its anchor date and (b) its inclusion predicate — both
// must stay in lockstep with the corresponding `COUNT(*) FILTER` in
// getKPIMetrics. If you change the funnel-stage set or current-state predicate
// in getKPIMetrics, mirror it here.
export async function getKPIMetricTasks(
  metric: KPIMetricKey,
  range?: DateRange,
  agentId?: string,
  profileId?: string,
): Promise<KPIMetricTaskRow[]> {
  const { startDate, endDate } = range ?? {};

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
        t.title,
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
    ),
    target AS (
      SELECT
        tv.task_id,
        tv.title,
        tv.custom_fields,
        tv.col_name,
        CASE ${metric}::text
          WHEN 'total_jobs' THEN tv.created_at
          WHEN 'proposals_sent' THEN tv.first_proposals_sent_at
          WHEN 'proposals_viewed' THEN tv.first_proposals_viewed_at
          WHEN 'in_chat' THEN tv.first_in_chat_at
          WHEN 'meetings_booked' THEN tv.first_meetings_booked_at
          WHEN 'meetings_done' THEN tv.first_meetings_done_at
          ELSE COALESCE(j.stage_entered_at, tv.updated_at, tv.created_at)
        END AS metric_at,
        CASE ${metric}::text
          WHEN 'total_jobs' THEN TRUE
          WHEN 'proposals_sent' THEN tv.first_proposals_sent_at IS NOT NULL
          WHEN 'proposals_viewed' THEN tv.first_proposals_viewed_at IS NOT NULL
          WHEN 'in_chat' THEN tv.first_in_chat_at IS NOT NULL
          WHEN 'meetings_booked' THEN tv.first_meetings_booked_at IS NOT NULL
          WHEN 'meetings_done' THEN tv.first_meetings_done_at IS NOT NULL
          WHEN 'won' THEN tv.col_lower = 'won'
          WHEN 'lost' THEN tv.col_lower = 'lost'
          WHEN 'bad_leads' THEN tv.col_lower = 'n/a'
          WHEN 'untouched' THEN tv.col_lower IN ('todo', 'to do', 'new', 'proposal ready')
          ELSE FALSE
        END AS in_metric
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
    )
    SELECT
      task_id AS id,
      title,
      col_name AS column_name,
      metric_at AS first_at,
      custom_fields->>'_job_url' AS job_url,
      (SELECT string_agg(a.name, ', ' ORDER BY a.name)
         FROM task_assignees ta
         JOIN agents a ON a.id = ta.agent_id
        WHERE ta.task_id = target.task_id) AS assignees,
      (SELECT COALESCE(json_agg(json_build_object('name', tt.name, 'color', tt.color) ORDER BY tt.name), '[]'::json)
         FROM task_tag_map ttm
         JOIN task_tags tt ON tt.id = ttm.tag_id
        WHERE ttm.task_id = target.task_id) AS tags
    FROM target
    WHERE in_metric
      AND (${startDate}::timestamptz IS NULL OR metric_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR metric_at <= ${endDate}::timestamptz)
    ORDER BY metric_at DESC NULLS LAST
    LIMIT 500
  `;

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    columnName: row.column_name,
    firstAt: row.first_at ? new Date(row.first_at).toISOString() : null,
    jobUrl: row.job_url ?? null,
    assignees: row.assignees ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
  }));
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
  range?: DateRange,
  agentId?: string,
  profileId?: string
): Promise<{
  jobs: (Job & { agent_name: string | null; profile_name: string | null; response_minutes: number })[];
  total: number;
}> {
  // Window on received_at to match the top navbar date filter ("jobs received in
  // this period that are still waiting"). Same received_at semantics as
  // getAvgResponseTime. Newest received first so the latest slow jobs sit on top.
  // COUNT(*) OVER() returns the TRUE total before LIMIT, so the header can show
  // "N jobs (showing 20)" instead of the cap masquerading as the count.
  const { startDate, endDate } = range ?? {};
  const result = await sql`
    SELECT j.*,
      a.name AS agent_name,
      p.profile_name,
      EXTRACT(EPOCH FROM (NOW() - j.received_at)) / 60 AS response_minutes,
      COUNT(*) OVER() AS total_count
    FROM jobs j
    LEFT JOIN agents a ON a.id = j.agent_id
    LEFT JOIN profiles p ON p.profile_id = j.profile_id
    WHERE LOWER(j.status) IN ('to do', 'todo', 'new', 'proposal ready', 'n/a')
      AND EXTRACT(EPOCH FROM (NOW() - j.received_at)) / 60 > ${thresholdMinutes}
      AND (${startDate}::timestamptz IS NULL OR j.received_at >= ${startDate}::timestamptz)
      AND (${endDate}::timestamptz IS NULL OR j.received_at <= ${endDate}::timestamptz)
      AND (${agentId ?? null}::uuid IS NULL OR j.agent_id = ${agentId ?? null}::uuid)
      AND (${profileId ?? null}::text IS NULL OR j.profile_id = ${profileId ?? null}::text)
    ORDER BY j.received_at DESC
    LIMIT 20
  `;

  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
  const jobs = result.rows.map((row) => ({
    ...row,
    skills: row.skills ?? null,
    response_minutes: Math.round(parseFloat(row.response_minutes) || 0),
  })) as (Job & { agent_name: string | null; profile_name: string | null; response_minutes: number })[];
  return { jobs, total };
}

// ============================================================
// UPWORK PROFILE SNAPSHOTS (migration 017)
// ============================================================

// Reads the current snapshot for a profile from upwork_profile_snapshots_current view.
// Returns null if no snapshot has ever been saved for this profile.
export async function getUpworkProfileSnapshot(
  profileId: string
): Promise<import("./types").UpworkProfileSnapshot | null> {
  const result = await sql`
    SELECT * FROM upwork_profile_snapshots_current
    WHERE profile_id = ${profileId}
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    profile_id: row.profile_id as string,
    extracted_at: row.extracted_at as string,
    is_current: row.is_current as boolean,
    name: (row.name as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    hourly_rate: row.hourly_rate != null ? parseFloat(row.hourly_rate as string) : null,
    rating: row.rating != null ? parseFloat(row.rating as string) : null,
    job_success_score: row.job_success_score != null ? parseInt(row.job_success_score as string) : null,
    top_rated_status: (row.top_rated_status as string | null) ?? null,
    total_jobs_worked: row.total_jobs_worked != null ? parseInt(row.total_jobs_worked as string) : null,
    total_hours: row.total_hours != null ? parseFloat(row.total_hours as string) : null,
    last_worked_on: row.last_worked_on
      ? (typeof row.last_worked_on === "string"
        ? row.last_worked_on
        : new Date(row.last_worked_on as Date).toISOString().slice(0, 10))
      : null,
    profile_url: (row.profile_url as string | null) ?? null,
    ciphertext: (row.ciphertext as string | null) ?? null,
    skills_summary: (row.skills_summary as string | null) ?? null,
    data: row.data,
    created_at: row.created_at as string,
  };
}

// Returns a map of profile_id → current-snapshot summary for ALL profiles that have one.
// Used by the Settings page to render "📄 Snapshot · last updated X" badges per row.
// Profiles without a snapshot are simply absent from the returned map.
export async function getUpworkProfileSnapshotSummaries(): Promise<
  Record<string, {
    extractedAt: string;
    name: string | null;
    rating: number | null;
    jobSuccessScore: number | null;
    totalJobsWorked: number | null;
  }>
> {
  const result = await sql<{
    profile_id: string;
    extracted_at: string;
    name: string | null;
    rating: string | null;
    job_success_score: number | null;
    total_jobs_worked: number | null;
  }>`
    SELECT profile_id, extracted_at, name, rating, job_success_score, total_jobs_worked
    FROM upwork_profile_snapshots_current
  `;

  const out: Record<string, {
    extractedAt: string; name: string | null; rating: number | null;
    jobSuccessScore: number | null; totalJobsWorked: number | null;
  }> = {};
  for (const row of result.rows) {
    out[row.profile_id] = {
      extractedAt: row.extracted_at,
      name: row.name,
      rating: row.rating != null ? parseFloat(row.rating) : null,
      jobSuccessScore: row.job_success_score != null ? Number(row.job_success_score) : null,
      totalJobsWorked: row.total_jobs_worked != null ? Number(row.total_jobs_worked) : null,
    };
  }
  return out;
}

// Returns the snapshot history for a profile (lightweight: no full JSONB), most recent first.
// Used to render the History tab in the Settings drawer and for retrospective analysis.
export async function getUpworkProfileSnapshotHistory(
  profileId: string,
  limit = 20
): Promise<import("./types").UpworkProfileSnapshotHistoryRow[]> {
  const result = await sql`
    SELECT
      id,
      extracted_at,
      rating,
      job_success_score,
      total_jobs_worked,
      total_hours,
      is_current
    FROM upwork_profile_snapshots
    WHERE profile_id = ${profileId}
    ORDER BY extracted_at DESC
    LIMIT ${limit}
  `;

  return result.rows.map((row) => ({
    id: row.id as string,
    extracted_at: row.extracted_at as string,
    rating: row.rating != null ? parseFloat(row.rating as string) : null,
    job_success_score: row.job_success_score != null ? parseInt(row.job_success_score as string) : null,
    total_jobs_worked: row.total_jobs_worked != null ? parseInt(row.total_jobs_worked as string) : null,
    total_hours: row.total_hours != null ? parseFloat(row.total_hours as string) : null,
    is_current: row.is_current as boolean,
  }));
}

// Core snapshot save: validates the JSON shape, extracts hot columns, and atomically
// (single CTE statement) demotes the previous current row + inserts the new row.
// Returns the new snapshot id and whether a previous snapshot was demoted.
//
// Auth is the caller's responsibility — the server action wraps this with admin/agent checks,
// the CLI import script calls it directly.
export async function saveUpworkProfileSnapshot(
  profileId: string,
  json: unknown
): Promise<{ id: string; replaced: boolean }> {
  if (!profileId || typeof profileId !== "string") {
    throw new Error("profileId is required");
  }
  if (!json || typeof json !== "object") {
    throw new Error("Snapshot JSON is not an object");
  }

  const obj = json as Record<string, unknown>;
  const identity = (obj.identity ?? {}) as {
    name?: string; title?: string; profileUrl?: string; ciphertext?: string;
  };
  if (!identity.name) {
    throw new Error("JSON missing required field: identity.name");
  }
  const stats = obj.stats as {
    rating?: number; jobSuccessScore?: number; topRatedStatus?: string;
    totalJobsWorked?: number; totalHours?: number; totalHoursActual?: number;
    lastWorkedOn?: string; hourlyRate?: { amount?: number };
  } | undefined;
  if (!stats || typeof stats !== "object") {
    throw new Error("JSON missing required field: stats");
  }

  const skills = Array.isArray(obj.skills) ? obj.skills as Array<{ name?: string }> : [];

  const name = identity.name ?? null;
  const title = identity.title ?? null;
  const profileUrl = identity.profileUrl ?? null;
  const ciphertext = identity.ciphertext ?? null;

  const hourlyRate = typeof stats.hourlyRate?.amount === "number" ? stats.hourlyRate.amount : null;
  const rating = typeof stats.rating === "number" ? stats.rating : null;
  const jss = typeof stats.jobSuccessScore === "number" ? stats.jobSuccessScore : null;
  const topRated = stats.topRatedStatus ?? null;
  const totalJobs = typeof stats.totalJobsWorked === "number" ? stats.totalJobsWorked : null;
  const totalHours = typeof stats.totalHoursActual === "number"
    ? stats.totalHoursActual
    : (typeof stats.totalHours === "number" ? stats.totalHours : null);
  const lastWorkedOn = typeof stats.lastWorkedOn === "string"
    ? stats.lastWorkedOn.slice(0, 10)
    : null;

  const skillsSummary = skills
    .map((s) => (s && typeof s === "object" ? s.name : undefined))
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .join(", ");

  // Run inside a transaction so the demote definitely lands before the insert.
  // Doing both in one CTE looks atomic but Postgres runs data-modifying CTEs
  // in undefined order — the INSERT could land first and trip the partial
  // unique index uq_upwork_snapshot_current_per_profile. The transaction
  // forces serial ordering on a single connection while still rolling back
  // both statements together if either fails.
  return withTransaction(async (tx) => {
    const demoted = await tx<{ id: string }>`
      UPDATE upwork_profile_snapshots
      SET is_current = FALSE
      WHERE profile_id = ${profileId} AND is_current = TRUE
      RETURNING id
    `;

    const inserted = await tx<{ id: string }>`
      INSERT INTO upwork_profile_snapshots (
        profile_id, name, title, hourly_rate, rating, job_success_score,
        top_rated_status, total_jobs_worked, total_hours, last_worked_on,
        profile_url, ciphertext, skills_summary, data
      )
      VALUES (
        ${profileId}, ${name}, ${title}, ${hourlyRate}, ${rating}, ${jss},
        ${topRated}, ${totalJobs}, ${totalHours}, ${lastWorkedOn}::date,
        ${profileUrl}, ${ciphertext}, ${skillsSummary || null},
        ${JSON.stringify(json)}::jsonb
      )
      RETURNING id
    `;

    const row = inserted.rows[0];
    if (!row) throw new Error("Failed to insert snapshot");
    return { id: row.id, replaced: (demoted.rowCount ?? 0) > 0 };
  });
}

// Admin restore: hard-deletes the current snapshot for `profileId` and promotes
// the historical snapshot identified by `snapshotId` to is_current=TRUE.
// Runs inside a transaction so the DELETE (which removes the existing
// is_current=TRUE row from the partial unique index) lands before the UPDATE
// that promotes the target row. Throws if `snapshotId` doesn't exist, doesn't
// belong to `profileId`, or is already the current row.
export async function restoreUpworkProfileSnapshot(
  profileId: string,
  snapshotId: string
): Promise<{ promoted_id: string; deleted_id: string | null }> {
  if (!profileId || !snapshotId) {
    throw new Error("profileId and snapshotId are required");
  }

  return withTransaction(async (tx) => {
    const target = await tx<{ id: string }>`
      SELECT id FROM upwork_profile_snapshots
      WHERE id = ${snapshotId}::uuid
        AND profile_id = ${profileId}
        AND is_current = FALSE
      LIMIT 1
    `;
    if (target.rows.length === 0) {
      throw new Error(
        "Snapshot not found, does not belong to this profile, or is already current"
      );
    }
    const targetId = target.rows[0].id;

    const deleted = await tx<{ id: string }>`
      DELETE FROM upwork_profile_snapshots
      WHERE profile_id = ${profileId} AND is_current = TRUE
      RETURNING id
    `;

    const promoted = await tx<{ id: string }>`
      UPDATE upwork_profile_snapshots
      SET is_current = TRUE
      WHERE id = ${targetId}::uuid
      RETURNING id
    `;

    if (promoted.rows.length === 0) {
      throw new Error("Failed to promote target snapshot");
    }

    return {
      promoted_id: promoted.rows[0].id,
      deleted_id: deleted.rows[0]?.id ?? null,
    };
  });
}

// Returns all profiles assigned to a given agent, ordered by name.
// Used by the agent-side /my-profiles page.
export async function getProfilesByAgent(
  agentId: string
): Promise<import("./types").Profile[]> {
  const result = await sql`
    SELECT * FROM profiles
    WHERE agent_id = ${agentId}
    ORDER BY profile_name
  `;
  return result.rows as import("./types").Profile[];
}

// Fetches a specific historical snapshot by id (returns the full JSONB).
// Used when the History tab user clicks an older row to view its content.
export async function getUpworkProfileSnapshotById(
  id: string
): Promise<import("./types").UpworkProfileSnapshot | null> {
  const result = await sql`
    SELECT * FROM upwork_profile_snapshots WHERE id = ${id} LIMIT 1
  `;
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    profile_id: row.profile_id as string,
    extracted_at: row.extracted_at as string,
    is_current: row.is_current as boolean,
    name: (row.name as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    hourly_rate: row.hourly_rate != null ? parseFloat(row.hourly_rate as string) : null,
    rating: row.rating != null ? parseFloat(row.rating as string) : null,
    job_success_score: row.job_success_score != null ? parseInt(row.job_success_score as string) : null,
    top_rated_status: (row.top_rated_status as string | null) ?? null,
    total_jobs_worked: row.total_jobs_worked != null ? parseInt(row.total_jobs_worked as string) : null,
    total_hours: row.total_hours != null ? parseFloat(row.total_hours as string) : null,
    last_worked_on: row.last_worked_on
      ? (typeof row.last_worked_on === "string"
        ? row.last_worked_on
        : new Date(row.last_worked_on as Date).toISOString().slice(0, 10))
      : null,
    profile_url: (row.profile_url as string | null) ?? null,
    ciphertext: (row.ciphertext as string | null) ?? null,
    skills_summary: (row.skills_summary as string | null) ?? null,
    data: row.data,
    created_at: row.created_at as string,
  };
}

// ============================================================
// RELEVANCY CLASSIFIER — OPERATOR SETTINGS (Phase 5b, plan v3.3 §10.6)
// ============================================================

// Reads both relevancy system settings + their per-key "last changed" audit
// columns. One round-trip, two rows.
export async function getRelevancySystemSettings(): Promise<import("./types").RelevancySystemSettings> {
  const result = await sql<{
    key: string;
    value: unknown;
    updated_by: string | null;
    updated_at: string | null;
  }>`
    SELECT key, value, updated_by, updated_at
    FROM system_settings
    WHERE key IN ('relevancy.classifier_mode', 'relevancy.min_score')
  `;

  const byKey = new Map(result.rows.map((r) => [r.key, r]));
  const modeRow = byKey.get("relevancy.classifier_mode");
  const scoreRow = byKey.get("relevancy.min_score");

  const mode = (modeRow?.value as string) ?? "shadow";
  if (mode !== "shadow" && mode !== "active") {
    throw new Error(`Invalid classifier_mode in system_settings: ${mode}`);
  }
  const minScore = scoreRow?.value != null ? Number(scoreRow.value) : 50;

  return {
    classifier_mode: mode,
    min_score: minScore,
    mode_updated_by: modeRow?.updated_by ?? null,
    mode_updated_at: modeRow?.updated_at ?? null,
    score_updated_by: scoreRow?.updated_by ?? null,
    score_updated_at: scoreRow?.updated_at ?? null,
  };
}

// Returns one row per profile with classifier config + snapshot presence flag.
// Profiles without a snapshot are still listed (the UI greys their controls).
export async function getProfileClassifierConfigs(): Promise<
  import("./types").ProfileClassifierConfig[]
> {
  const result = await sql<{
    profile_id: string;
    profile_name: string;
    classifier_enabled: boolean;
    min_score_override: number | string | null;
    has_snapshot: boolean;
  }>`
    SELECT
      p.profile_id,
      p.profile_name,
      p.classifier_enabled,
      p.min_score_override,
      EXISTS (
        SELECT 1 FROM upwork_profile_snapshots_current s WHERE s.profile_id = p.profile_id
      ) AS has_snapshot
    FROM profiles p
    WHERE p.active = TRUE
    ORDER BY p.profile_name
  `;

  return result.rows.map((row) => ({
    profile_id: row.profile_id,
    profile_name: row.profile_name,
    classifier_enabled: row.classifier_enabled,
    min_score_override: row.min_score_override != null ? Number(row.min_score_override) : null,
    has_snapshot: row.has_snapshot,
  }));
}

// Writes a single system_settings row + its updated_by/updated_at audit columns.
// Caller is responsible for cache invalidation (server action wraps with updateTag).
export async function setSystemSettingValue(
  key: string,
  value: unknown,
  userId: string | null
): Promise<void> {
  await sql`
    UPDATE system_settings
    SET value = ${JSON.stringify(value)}::jsonb,
        updated_by = ${userId},
        updated_at = NOW()
    WHERE key = ${key}
  `;
}

// Patches profiles.classifier_enabled and/or profiles.min_score_override
// for one profile. Either field may be omitted (only patches what's provided).
export async function setProfileClassifierConfigRow(
  profileId: string,
  patch: { classifier_enabled?: boolean; min_score_override?: number | null }
): Promise<void> {
  // Two narrow UPDATEs keep the SQL static — matches CLAUDE.md "raw sql" pattern.
  if (patch.classifier_enabled !== undefined) {
    await sql`
      UPDATE profiles
      SET classifier_enabled = ${patch.classifier_enabled}
      WHERE profile_id = ${profileId}
    `;
  }
  if (patch.min_score_override !== undefined) {
    await sql`
      UPDATE profiles
      SET min_score_override = ${patch.min_score_override}
      WHERE profile_id = ${profileId}
    `;
  }
}

// ============================================================
// RELEVANCY CLASSIFIER — SCORE INGESTION + DLQ (Phase 6, plan v3.3 §10.9.2)
// ============================================================

// Inserts a single relevancy_scores row. Returns the assigned BIGSERIAL id.
// Maps every nullable / array / JSONB column from the v3.3 schema; missing
// fields fall through to NULL or [] defaults at the SQL layer.
export async function insertRelevancyScore(
  row: import("./types").RelevancyScoreInsert,
  // Optional sql client — pass a TxSql from withTransaction when the insert
  // must commit atomically with other statements (DLQ drain, manual eval, etc).
  // Defaults to the top-level pool sql.
  client: typeof sql | import("./db").TxSql = sql
): Promise<{ id: number }> {
  // JSON-stringify JSONB fields once so they can be parameterized as text + cast.
  const gatesEvidenceJson = row.gates_evidence != null ? JSON.stringify(row.gates_evidence) : null;
  const componentsJson = row.components != null ? JSON.stringify(row.components) : null;
  const evidencePanelJson = row.evidence_panel != null ? JSON.stringify(row.evidence_panel) : null;
  const thresholdsUsedJson = row.thresholds_used != null ? JSON.stringify(row.thresholds_used) : null;
  // total_score column is INTEGER; some LLMs (DeepSeek r1-distill, observed
  // 2026-05-18..20) return fractional weighted sums like 82.5. Round here as
  // a defensive last-line-of-defense so a malformed score never poisons the
  // audit-log insert and lands the row in the DLQ. Precision loss is harmless
  // for ranking/threshold comparisons, which is all the column is used for.
  const totalScoreInt =
    row.total_score == null ? null : Math.round(row.total_score);

  const result = await client<{ id: number | string }>`
    INSERT INTO relevancy_scores (
      task_id, job_external_id, job_title, job_url, profile_id, snapshot_id,
      decision, effective_decision, threshold_flipped, min_score_at_decision, classifier_mode_at_decision,
      rejection_reasons, gates_passed, gates_failed,
      gates_evidence, components,
      total_score, tier, confidence, confidence_warnings, proposal_angles,
      evidence_panel, summary, missing_signals, thresholds_used,
      model, prompt_version, prompt_mode, criteria_version, evaluation_path,
      request_id, source, requested_by,
      input_tokens, output_tokens, latency_ms
    ) VALUES (
      ${row.task_id ?? null},
      ${row.job_external_id ?? null},
      ${row.job_title ?? null},
      ${row.job_url ?? null},
      ${row.profile_id},
      ${row.snapshot_id ?? null},
      ${row.decision},
      ${row.effective_decision},
      ${row.threshold_flipped ?? false},
      ${row.min_score_at_decision ?? null},
      ${row.classifier_mode_at_decision},
      ${row.rejection_reasons ?? null},
      ${row.gates_passed ?? null},
      ${row.gates_failed ?? null},
      ${gatesEvidenceJson}::jsonb,
      ${componentsJson}::jsonb,
      ${totalScoreInt},
      ${row.tier ?? null},
      ${row.confidence ?? null},
      ${row.confidence_warnings ?? null},
      ${row.proposal_angles ?? null},
      ${evidencePanelJson}::jsonb,
      ${row.summary ?? null},
      ${row.missing_signals ?? null},
      ${thresholdsUsedJson}::jsonb,
      ${row.model},
      ${row.prompt_version},
      ${row.prompt_mode},
      ${row.criteria_version},
      ${row.evaluation_path},
      ${row.request_id ?? null},
      ${row.source ?? null},
      ${row.requested_by ?? null},
      ${row.input_tokens ?? null},
      ${row.output_tokens ?? null},
      ${row.latency_ms ?? null}
    )
    RETURNING id
  `;

  return { id: Number(result.rows[0].id) };
}

// Parks a failed score payload in relevancy_scores_dlq for later retry.
// Plan §16.6 I2: never block the parent verdict on the audit-log write.
export async function insertRelevancyScoreDlq(
  payload: unknown,
  errorDetail: string
): Promise<{ id: number }> {
  const result = await sql<{ id: number | string }>`
    INSERT INTO relevancy_scores_dlq (payload, error_detail)
    VALUES (${JSON.stringify(payload)}::jsonb, ${errorDetail})
    RETURNING id
  `;
  return { id: Number(result.rows[0].id) };
}

// Idempotency cache lookup. Returns the cached response when the key is fresh
// AND not expired. Returns null on miss (caller proceeds to process the request).
export async function getCachedIdempotencyResponse(
  key: string
): Promise<{ status: number; body: unknown } | null> {
  const result = await sql<{ response_status: number; response_body: unknown }>`
    SELECT response_status, response_body
    FROM idempotency_keys
    WHERE key = ${key} AND expires_at > NOW()
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  return {
    status: result.rows[0].response_status,
    body: result.rows[0].response_body,
  };
}

// Persists an idempotency-cached response (24h TTL via column default).
// Uses ON CONFLICT to handle races where two replays land simultaneously.
export async function cacheIdempotencyResponse(
  key: string,
  status: number,
  body: unknown
): Promise<void> {
  await sql`
    INSERT INTO idempotency_keys (key, response_status, response_body)
    VALUES (${key}, ${status}, ${JSON.stringify(body)}::jsonb)
    ON CONFLICT (key) DO NOTHING
  `;
}

// ============================================================
// RELEVANCY CLASSIFIER — PROFILE CONTEXT (Phase 3, plan v3.3 §5.4)
// ============================================================

// Reads one row from system_settings. Returns undefined when the key isn't seeded.
// Value is the raw JSONB (already parsed by pg driver — string, number, object, etc.).
export async function getSystemSetting<T = unknown>(key: string): Promise<T | undefined> {
  const result = await sql`SELECT value FROM system_settings WHERE key = ${key} LIMIT 1`;
  if (result.rows.length === 0) return undefined;
  return result.rows[0].value as T;
}

// Returns the most recently effective criteria_versions row's version string.
// At the v3.3 baseline this is '0.2' (seeded by migration 019). Callers use this
// as the FK value for new relevancy_scores inserts AND as the value passed back
// to n8n in the /context response.
export async function getActiveCriteriaVersion(): Promise<string | null> {
  const result = await sql`
    SELECT version FROM criteria_versions
    ORDER BY effective_at DESC NULLS LAST, version DESC
    LIMIT 1
  `;
  return result.rows.length === 0 ? null : (result.rows[0].version as string);
}

// Computes effective classifier mode per the 4-precedence cases in plan §1.4:
//   global=shadow, profile=enabled  → shadow   (global wins)
//   global=shadow, profile=disabled → shadow   (global wins; per-profile is moot)
//   global=active, profile=enabled  → active
//   global=active, profile=disabled → shadow   (per-profile veto)
function resolveEffectiveMode(
  globalMode: "shadow" | "active",
  profileEnabled: boolean
): "shadow" | "active" {
  if (globalMode === "shadow") return "shadow";
  if (profileEnabled === false) return "shadow";
  return "active";
}

// Token-matches a portfolio description against the profile's skill list to produce
// tech_stack_inferred[]. Case-insensitive substring match — gate 10 (portfolio_match)
// consumes this as a deterministic overlap target without requiring a curated taxonomy.
function inferTechStack(description: string, skills: string[]): string[] {
  if (!description) return [];
  const haystack = description.toLowerCase();
  const matched = new Set<string>();
  for (const skill of skills) {
    if (!skill) continue;
    const needle = skill.toLowerCase();
    if (needle.length >= 2 && haystack.includes(needle)) {
      matched.add(needle);
    }
  }
  return Array.from(matched);
}

const SNAPSHOT_STALE_DAYS = 60;

// Assembles the full classifier-ready profile context. Returns null when no current
// snapshot exists for the profile (HTTP 404 at the route layer). Plan v3.3 §5.4.
//
// Read paths:
//   - upwork_profile_snapshots_current view (snapshot row)
//   - profiles                              (classifier_enabled, min_score_override, thresholds_overrides)
//   - system_settings                       (relevancy.classifier_mode, relevancy.min_score)
//   - criteria_versions                     (active version)
//
// Caller MUST wrap with unstable_cache + revalidateTag('profile-context-<id>')
// + revalidateTag('system-settings'). See src/app/api/profiles/[id]/context/route.ts.
export async function getProfileContext(
  profileId: string
): Promise<import("./types").ProfileContext | null> {
  const snapshot = await getUpworkProfileSnapshot(profileId);
  if (!snapshot) return null;

  const profileRow = await sql`
    SELECT classifier_enabled, min_score_override, thresholds_overrides
    FROM profiles
    WHERE profile_id = ${profileId}
    LIMIT 1
  `;
  // Defaults match migration 018: classifier_enabled defaults TRUE, overrides default {}.
  const profileEnabled = profileRow.rows[0]?.classifier_enabled !== false;
  const profileMinOverride = profileRow.rows[0]?.min_score_override != null
    ? Number(profileRow.rows[0].min_score_override)
    : null;
  const thresholdsOverrides = (profileRow.rows[0]?.thresholds_overrides as Record<string, unknown>) ?? {};

  // system_settings reads. Defaults are the migration 018 seed values.
  const globalMode = (await getSystemSetting<string>("relevancy.classifier_mode")) ?? "shadow";
  const globalMinScore = (await getSystemSetting<number>("relevancy.min_score")) ?? 50;
  if (globalMode !== "shadow" && globalMode !== "active") {
    throw new Error(`Invalid system_settings.relevancy.classifier_mode: ${globalMode}`);
  }

  const criteriaVersion = (await getActiveCriteriaVersion()) ?? "0.2";

  // Project the snapshot data JSONB into the lean shape the classifier consumes.
  type SnapshotData = {
    skills?: Array<{ name?: string }>;
    portfolio?: Array<{ title?: string; description?: string; uid?: string }>;
    workHistory?: Array<{
      title?: string;
      type?: string;
      status?: string;
      totalHours?: number;
      feedback?: { score?: number };
    }>;
    jobCategories?: Array<{ groupName?: string; name?: string }>;
    identity?: { location?: { country?: string } };
    stats?: { topRatedPlusStatus?: string };
    description?: string;
  };
  const data = (snapshot.data ?? {}) as SnapshotData;

  const skills = (data.skills ?? [])
    .map((s) => s?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);

  const portfolioTldr = (data.portfolio ?? []).map((p) => {
    const description = (p?.description ?? "").trim();
    const title = (p?.title ?? "").trim();
    return {
      title,
      description_excerpt: description.length > 280 ? description.slice(0, 280) + "…" : description,
      // Match skills against title + description — title often carries the strongest stack signal
      // (e.g., "Malian Exhausts - PHP | Laravel" body text is marketing copy with no stack keywords).
      tech_stack_inferred: inferTechStack(title + "\n" + description, skills),
    };
  });

  const workHistoryTldr = (data.workHistory ?? []).map((w) => ({
    title: (w?.title ?? "").trim(),
    type: w?.type ?? null,
    status: w?.status ?? null,
    totalHours: typeof w?.totalHours === "number" ? w.totalHours : null,
    feedback_score: typeof w?.feedback?.score === "number" ? w.feedback.score : null,
  }));

  const categories = (data.jobCategories ?? [])
    .filter((c) => typeof c?.groupName === "string" && typeof c?.name === "string")
    .map((c) => ({ groupName: c.groupName as string, name: c.name as string }));

  // Country lives at data.identity.location.country (NOT data.identity.country directly).
  const country = data.identity?.location?.country ?? null;

  // Snapshot age + warnings (plan §6.1 freshness policy).
  const extractedAt = new Date(snapshot.extracted_at);
  const snapshotAgeDays = Math.floor((Date.now() - extractedAt.getTime()) / (1000 * 60 * 60 * 24));
  const warnings: string[] = [];
  if (snapshotAgeDays > SNAPSHOT_STALE_DAYS) warnings.push("stale_snapshot");
  if (skills.length === 0) warnings.push("missing_skills");
  if (portfolioTldr.length === 0) warnings.push("missing_portfolio");

  const effectiveMode = resolveEffectiveMode(globalMode, profileEnabled);
  const effectiveMinScore = profileMinOverride ?? globalMinScore;

  return {
    profile: {
      id: snapshot.id,
      profile_id: snapshot.profile_id,
      name: snapshot.name,
      headline: snapshot.title ?? data.description?.split("\n")[0] ?? null,
      skills,
      skills_summary: snapshot.skills_summary,
      portfolio_tldr: portfolioTldr,
      work_history_tldr: workHistoryTldr,
      categories,
      stats: {
        rating: snapshot.rating,
        // JSS numeric value is no longer exposed by Upwork's SSR (audited 2026-05-11
        // against Shayan's saved HTML). The legacy stats.nSS100BwScore field is now
        // a binary flag (1 = JSS calculated, 0 = not), not a 0-100 percentage.
        // Classifier should use top_rated_status as the quality proxy:
        //   top_rated_plus ≈ elite, top_rated ≈ excellent, null ≈ unrated/junior.
        jss: null,
        top_rated_status: snapshot.top_rated_status,
        // top_rated_plus lives at data.stats.topRatedPlusStatus (separate from topRatedStatus).
        // A freelancer can be both top_rated AND top_rated_plus — distinct flags on Upwork side.
        top_rated_plus: data.stats?.topRatedPlusStatus === "top_rated_plus",
        hourly_rate_usd: snapshot.hourly_rate,
        total_jobs: snapshot.total_jobs_worked,
        total_hours: snapshot.total_hours,
        last_worked_on: snapshot.last_worked_on,
      },
      country,
      snapshot_age_days: snapshotAgeDays,
      snapshot_extracted_at: snapshot.extracted_at,
      _warnings: warnings,
    },
    thresholds_overrides: thresholdsOverrides,
    _system: {
      classifier_mode: effectiveMode,
      effective_min_score: effectiveMinScore,
      global_mode: globalMode,
      profile_enabled: profileEnabled,
      profile_min_override: profileMinOverride,
    },
    criteria_version: criteriaVersion,
    context_generated_at: new Date().toISOString(),
  };
}

// ============================================================
// RELEVANCY CLASSIFIER — JOB PAYLOAD (Phase 4, plan v3.3 §6.2)
// ============================================================

// Parses an Upwork _budget string ("15 - 35 USD" / "100 USD" / "Not Specified")
// into structured budget_type + min + max + fixed_amount.
// Returns nulls when the string can't be parsed.
function parseBudget(raw: string | null): {
  budget_type: "hourly" | "fixed" | null;
  budget_min: number | null;
  budget_max: number | null;
  fixed_amount: number | null;
} {
  if (!raw || raw.trim() === "" || raw.toLowerCase().includes("not specified")) {
    return { budget_type: null, budget_min: null, budget_max: null, fixed_amount: null };
  }
  // Strip thousands separators so "2,500 USD" parses the same as "2500 USD".
  const normalized = raw.replace(/,/g, "");
  // "15 - 35 USD" → hourly range
  const hourlyRange = normalized.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[A-Z]{0,3}/);
  if (hourlyRange) {
    return {
      budget_type: "hourly",
      budget_min: parseFloat(hourlyRange[1]),
      budget_max: parseFloat(hourlyRange[2]),
      fixed_amount: null,
    };
  }
  // "100 USD" / "2500 USD" / "2,500 USD" → fixed amount
  const fixed = normalized.match(/^(\d+(?:\.\d+)?)\s*[A-Z]{0,3}\s*$/);
  if (fixed) {
    return {
      budget_type: "fixed",
      budget_min: null,
      budget_max: null,
      fixed_amount: parseFloat(fixed[1]),
    };
  }
  return { budget_type: null, budget_min: null, budget_max: null, fixed_amount: null };
}

// Parses _generated ("May 6, 2026, 09:53 PM UTC") into ISO. Returns null on failure.
function parsePostedAt(raw: string | null): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return isNaN(ms) ? null : new Date(ms).toISOString();
}

// Strips a "[profile]" prefix from a task title. "[Shayan] Foo" → "Foo".
// If no prefix present, returns the input unchanged.
function stripProfilePrefix(title: string): string {
  return title.replace(/^\[[^\]]+\]\s*/, "");
}

// Returns the canonical classifier-ready job payload for one task. Reads `tasks` +
// joined column + assignee, projects `custom_fields` JSONB into the §6.2 shape, and
// populates _missing_fields[] for every field absent from the actual cards on this
// system (older cards from before Vollna started populating it / manual cards never
// linked to a Vollna job — see plan §6.2.2).
//
// Returns null when the task doesn't exist.
//
// Caller (the route) tags `source` based on the eval flow:
//   - manual evaluator: source = "manual_url"
//   - auto pipeline (Phase 6+): n8n produces the same shape from Vollna directly
//     so this function is mostly used by the manual flow.
export async function getTaskJobPayload(
  taskId: string,
  source: "auto" | "manual_url" = "manual_url"
): Promise<import("./types").JobPayload | null> {
  // tasks has no stage_entered_at — that column only lives on `jobs` (migration 015).
  // updated_at is the established "last touched" proxy across the codebase
  // (see CLAUDE.md current-state KPI tile pattern: COALESCE(j.stage_entered_at,
  // t.updated_at, t.created_at)).
  const result = await sql<{
    id: string;
    title: string;
    description: string | null;
    custom_fields: Record<string, unknown> | null;
    created_at: string;
    updated_at: string | null;
    column_name: string | null;
    assignee_names: string[] | null;
  }>`
    SELECT
      t.id,
      t.title,
      t.description,
      t.custom_fields,
      t.created_at,
      t.updated_at,
      c.name AS column_name,
      ARRAY(
        SELECT a.name FROM task_assignees ta
        JOIN agents a ON a.id = ta.agent_id
        WHERE ta.task_id = t.id
      ) AS assignee_names
    FROM tasks t
    LEFT JOIN columns c ON c.id = t.column_id
    WHERE t.id = ${taskId}
    LIMIT 1
  `;

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const cf = (row.custom_fields ?? {}) as Record<string, unknown>;

  const missing: string[] = [];
  const need = (key: string, value: unknown): unknown => {
    if (value === null || value === undefined || value === "") {
      missing.push(key);
      return null;
    }
    return value;
  };

  // Numeric coercions tolerate string inputs (Vollna writes everything as text).
  const toNum = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return isNaN(n) ? null : n;
  };

  // Skills can arrive as a JSON-stringified array OR a real array (depending on n8n version).
  let skills: string[] = [];
  const rawSkills = cf._skills;
  if (Array.isArray(rawSkills)) {
    skills = rawSkills.filter((s): s is string => typeof s === "string");
  } else if (typeof rawSkills === "string" && rawSkills.trim() !== "") {
    try {
      const parsed = JSON.parse(rawSkills);
      if (Array.isArray(parsed)) skills = parsed.filter((s): s is string => typeof s === "string");
    } catch { /* leave as empty */ }
  }
  if (skills.length === 0) missing.push("_skills");

  const budget = parseBudget((cf._budget as string | null) ?? null);
  if (budget.budget_type === null) missing.push("_budget");

  const postedAt = parsePostedAt((cf._generated as string | null) ?? null);
  if (postedAt === null) missing.push("_generated");

  // Fields the §6.2 spec calls for that DON'T exist in our current Vollna→n8n pipeline.
  // Always missing — flag once each so the classifier knows to treat as "unverified" gates.
  const proposalsCount = need("_proposals_count", cf._proposals_count);
  const interviewingCount = need("_interviewing_count", cf._interviewing_count);
  const invitesSentCount = need("_invites_sent_count", cf._invites_sent_count);
  const hiresMadeCount = need("_hires_made_count", cf._hires_made_count);
  const clientPaymentVerified = cf._client_payment_verified;
  if (clientPaymentVerified === null || clientPaymentVerified === undefined) {
    missing.push("_client_payment_verified");
  }
  const clientMemberSince = need("_client_member_since", cf._client_member_since);
  const category = need("_category", cf._category);
  const jobDescription = cf._job_description;
  if (jobDescription === null || jobDescription === undefined || jobDescription === "") {
    missing.push("_job_description");
  }

  const rawTitle = row.title ?? "";
  const cleanTitle = stripProfilePrefix(rawTitle);

  // card_age_days: integer days since task creation.
  const createdAt = new Date(row.created_at);
  const cardAgeDays = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

  return {
    task_id: row.id,
    task: {
      title: cleanTitle,
      raw_title: rawTitle,
      current_column: row.column_name,
      current_assignee_name: row.assignee_names?.[0] ?? null,
      created_at: row.created_at,
      stage_entered_at: row.updated_at, // updated_at is the proxy — see SELECT comment above
    },
    job_id: (cf._job_id as string | null) ?? null,
    url: (cf._job_url as string | null) ?? null,
    title: cleanTitle,
    // Fall back to tasks.description (which holds the proposal+job-snapshot blob from
    // n8n's Format ClickUp Task) when _job_description isn't populated. The classifier
    // prompt knows to ignore the proposal portion when reading description text.
    description: (cf._job_description as string | null) ?? row.description ?? null,
    skills_required: skills,
    category: category as string | null,
    budget_type: budget.budget_type,
    budget_min: budget.budget_min,
    budget_max: budget.budget_max,
    fixed_amount: budget.fixed_amount,
    client: {
      country: (cf._client_country as string | null) ?? null,
      total_spent: toNum(cf._client_spent),
      hires: toNum(cf._client_hires),
      rating: toNum(cf._client_rating),
      payment_verified: typeof clientPaymentVerified === "boolean" ? clientPaymentVerified : null,
      member_since: clientMemberSince as string | null,
    },
    proposals_count: toNum(proposalsCount),
    interviewing_count: toNum(interviewingCount),
    invites_sent_count: toNum(invitesSentCount),
    hires_made_count: toNum(hiresMadeCount),
    posted_at: postedAt,
    source,
    card_age_days: cardAgeDays,
    _proposal_already_drafted: (cf._proposal as string | null) ?? null,
    _assigned_agent: (cf._assigned_agent as string | null) ?? null,
    _profile_name: (cf._profile_name as string | null) ?? null,
    _missing_fields: Array.from(new Set(missing)),
  };
}

// ===================================================================
// Relevancy audit page (migration 021 — admin overrides on classifier rejects)
// ===================================================================

export interface RelevancyAuditRejectRow {
  score_id: number;
  evaluated_at: string;
  profile_id: string | null;
  profile_name: string | null;
  job_external_id: string | null;
  job_title: string;
  job_url: string | null;
  task_id: string | null;
  total_score: number | null;
  tier: string | null;
  decision: string;
  effective_decision: string;
  threshold_flipped: boolean;
  rejection_reasons: string[] | null;
  classifier_mode_at_decision: string;
  override: { override_id: number; note: string | null; created_at: string } | null;
}

export interface RelevancyAuditListResult {
  rows: RelevancyAuditRejectRow[];
  total: number;
}

// Lists classifier rejects within the date window, optionally filtered by profile
// and hiding rows the admin has already flagged. Joins relevancy_scores → profiles
// (for display name), tasks (for title via _relevancy_score_id stamp), and the
// per-row admin_audit override (LEFT JOIN — NULL means unreviewed).
export async function listRelevancyAuditRejects(opts: {
  from: Date;
  to: Date;
  profileIds: string[] | null;
  hideOverridden: boolean;
  limit?: number;
}): Promise<RelevancyAuditListResult> {
  const limit = opts.limit ?? 200;
  const profileFilter = opts.profileIds && opts.profileIds.length > 0 ? opts.profileIds : null;

  const dataResult = await sql<{
    score_id: number | string;
    evaluated_at: string | Date;
    profile_id: string | null;
    profile_name: string | null;
    job_external_id: string | null;
    job_title: string | null;
    job_url: string | null;
    task_id: string | null;
    total_score: number | null;
    tier: string | null;
    decision: string;
    effective_decision: string;
    threshold_flipped: boolean;
    rejection_reasons: string[] | null;
    classifier_mode_at_decision: string;
    override_id: number | string | null;
    override_note: string | null;
    override_created_at: string | Date | null;
  }>`
    SELECT
      rs.id AS score_id,
      rs.evaluated_at,
      rs.profile_id,
      p.profile_name,
      rs.job_external_id,
      -- Prefer the verdict-time title written by the classifier (migration 022);
      -- fall back to the task title when present (pre-022 rows + Shadow-mode
      -- rows where a card was created). NULL → "Untitled" at the mapper layer.
      COALESCE(rs.job_title, t.title) AS job_title,
      -- Prefer the verdict-time URL (migration 022); fall back to the task's
      -- _job_url custom_field. NULL when neither is available.
      COALESCE(rs.job_url, t.custom_fields->>'_job_url') AS job_url,
      t.id AS task_id,
      rs.total_score,
      rs.tier,
      rs.decision,
      rs.effective_decision,
      rs.threshold_flipped,
      rs.rejection_reasons,
      rs.classifier_mode_at_decision,
      ro.id AS override_id,
      ro.note AS override_note,
      ro.created_at AS override_created_at
    FROM relevancy_scores rs
    LEFT JOIN profiles p ON p.profile_id = rs.profile_id
    LEFT JOIN tasks t ON t.custom_fields->>'_relevancy_score_id' = rs.id::text
    LEFT JOIN relevancy_overrides ro
      ON ro.score_id = rs.id AND ro.override_type = 'admin_audit'
    WHERE rs.effective_decision = 'reject'
      AND rs.evaluated_at BETWEEN ${opts.from.toISOString()} AND ${opts.to.toISOString()}
      AND (${profileFilter}::text[] IS NULL OR rs.profile_id = ANY(${profileFilter}::text[]))
      AND (${opts.hideOverridden} = FALSE OR ro.id IS NULL)
    ORDER BY rs.evaluated_at DESC
    LIMIT ${limit}
  `;

  // Separate count query for the badge — same filters, no LIMIT.
  const countResult = await sql<{ total: number | string }>`
    SELECT COUNT(*)::int AS total
    FROM relevancy_scores rs
    LEFT JOIN relevancy_overrides ro
      ON ro.score_id = rs.id AND ro.override_type = 'admin_audit'
    WHERE rs.effective_decision = 'reject'
      AND rs.evaluated_at BETWEEN ${opts.from.toISOString()} AND ${opts.to.toISOString()}
      AND (${profileFilter}::text[] IS NULL OR rs.profile_id = ANY(${profileFilter}::text[]))
      AND (${opts.hideOverridden} = FALSE OR ro.id IS NULL)
  `;

  const rows: RelevancyAuditRejectRow[] = dataResult.rows.map((r) => ({
    score_id: Number(r.score_id),
    evaluated_at: r.evaluated_at instanceof Date ? r.evaluated_at.toISOString() : r.evaluated_at,
    profile_id: r.profile_id,
    profile_name: r.profile_name,
    job_external_id: r.job_external_id,
    job_title: r.job_title ?? "Untitled",
    job_url: r.job_url,
    task_id: r.task_id,
    total_score: r.total_score,
    tier: r.tier,
    decision: r.decision,
    effective_decision: r.effective_decision,
    threshold_flipped: r.threshold_flipped,
    rejection_reasons: r.rejection_reasons,
    classifier_mode_at_decision: r.classifier_mode_at_decision,
    override: r.override_id != null
      ? {
          override_id: Number(r.override_id),
          note: r.override_note,
          created_at: r.override_created_at instanceof Date
            ? r.override_created_at.toISOString()
            : (r.override_created_at as string),
        }
      : null,
  }));

  return { rows, total: Number(countResult.rows[0]?.total ?? 0) };
}

export interface RelevancyAuditRejectDetail {
  score_id: number;
  summary: string | null;
  confidence: number | null;
  confidence_warnings: string[] | null;
  gates_passed: number[] | null;
  gates_failed: number[] | null;
  gates_evidence: Record<string, unknown> | null;
  components: Record<string, unknown> | null;
  snapshot_id: string | null;
  total_score: number | null;
  tier: string | null;
  rejection_reasons: string[] | null;
  threshold_flipped: boolean;
  min_score_at_decision: number | null;
  classifier_mode_at_decision: string;
  model: string;
  prompt_version: string;
  criteria_version: string;
}

// Full row detail for the expand-row view on /relevancy-audit. Only the fields
// the UI renders are projected (drops requested_by, request_id, etc.).
export async function getRelevancyAuditRejectDetail(
  scoreId: number
): Promise<RelevancyAuditRejectDetail | null> {
  const result = await sql<RelevancyAuditRejectDetail>`
    SELECT
      id AS score_id,
      summary,
      confidence,
      confidence_warnings,
      gates_passed,
      gates_failed,
      gates_evidence,
      components,
      snapshot_id,
      total_score,
      tier,
      rejection_reasons,
      threshold_flipped,
      min_score_at_decision,
      classifier_mode_at_decision,
      model,
      prompt_version,
      criteria_version
    FROM relevancy_scores
    WHERE id = ${scoreId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

// Creates an admin_audit override for the given score. Resolves task_id from
// tasks.custom_fields->>'_relevancy_score_id' (NULL if no card was created —
// expected in Active mode for jobs that hit the End audit-only branch).
// Returns the new override row id + classifier_decision + source for the caller.
export async function createAdminAuditOverride(opts: {
  scoreId: number;
  adminId: string;
  note: string | null;
  // Task-board path only. When provided, the score is BOUND to this task (an
  // admin can't stamp a score that doesn't belong to the card they opened) and
  // the row is task-stamped. /relevancy-audit omits both and keeps the unbound,
  // note-only behavior.
  taskId?: string | null;
  overrideReason?: string[] | null;
}): Promise<{ override_id: number; created_at: string } | { error: "score_not_found" } | { error: "already_overridden"; override_id: number }> {
  // 1. Look up the score row (need classifier_decision + source for the insert).
  //    With taskId, bind via the CARD STAMP (relevancy_scores.task_id is a dead
  //    column on ~97% of rows — same link the agent feedback path uses), so a
  //    crafted score_id from another card surfaces score_not_found.
  const scoreRow = opts.taskId
    ? await sql<{ decision: string; source: string | null }>`
        SELECT rs.decision, rs.source
        FROM relevancy_scores rs
        WHERE rs.id = ${opts.scoreId}
          AND (
            rs.task_id = ${opts.taskId}::uuid
            OR EXISTS (
              SELECT 1 FROM tasks t
              WHERE t.id = ${opts.taskId}::uuid
                AND t.custom_fields->>'_relevancy_score_id' = rs.id::text
            )
          )
        LIMIT 1
      `
    : await sql<{ decision: string; source: string | null }>`
        SELECT decision, source FROM relevancy_scores WHERE id = ${opts.scoreId} LIMIT 1
      `;
  if (scoreRow.rows.length === 0) {
    return { error: "score_not_found" };
  }
  const { decision, source } = scoreRow.rows[0];

  // 2. Block duplicate admin overrides for the same score — admin should
  //    re-use the existing override row via DELETE-then-POST or PATCH (TODO).
  const existing = await sql<{ id: number | string }>`
    SELECT id FROM relevancy_overrides
    WHERE score_id = ${opts.scoreId} AND override_type = 'admin_audit'
    LIMIT 1
  `;
  if (existing.rows.length > 0) {
    return { error: "already_overridden", override_id: Number(existing.rows[0].id) };
  }

  // 3. Resolve task_id — prefer the board-supplied task, else the card stamp.
  let taskId = opts.taskId ?? null;
  if (!taskId) {
    const taskRow = await sql<{ id: string }>`
      SELECT id FROM tasks
      WHERE custom_fields->>'_relevancy_score_id' = ${String(opts.scoreId)}
      LIMIT 1
    `;
    taskId = taskRow.rows[0]?.id ?? null;
  }

  // 4. Insert. agent_action + agent_id stay NULL (admin path, post-migration-021).
  //    override_reason carries the ticked reasons / __decision__ sentinel when the
  //    admin flags from the task board; NULL for the note-only audit-page path.
  const inserted = await sql<{ id: number | string; created_at: string | Date }>`
    INSERT INTO relevancy_overrides (
      score_id, task_id, classifier_decision, agent_action, agent_id,
      override_type, admin_id, override_reason, note, source
    ) VALUES (
      ${opts.scoreId},
      ${taskId},
      ${decision},
      NULL,
      NULL,
      'admin_audit',
      ${opts.adminId},
      ${opts.overrideReason ?? null},
      ${opts.note},
      ${source}
    )
    RETURNING id, created_at
  `;

  const row = inserted.rows[0];
  return {
    override_id: Number(row.id),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

// Deletes an admin override iff it belongs to the requesting admin. Returns
// the outcome so the route can map to 204 / 403 / 404.
export async function deleteAdminAuditOverride(opts: {
  overrideId: number;
  adminId: string;
}): Promise<"deleted" | "not_found" | "forbidden"> {
  const row = await sql<{ admin_id: string | null; override_type: string }>`
    SELECT admin_id, override_type
    FROM relevancy_overrides
    WHERE id = ${opts.overrideId}
    LIMIT 1
  `;
  if (row.rows.length === 0) return "not_found";
  const r = row.rows[0];
  if (r.override_type !== "admin_audit") return "not_found";
  if (r.admin_id !== opts.adminId) return "forbidden";

  await sql`DELETE FROM relevancy_overrides WHERE id = ${opts.overrideId}`;
  return "deleted";
}

// Captures an agent_move override when a card move contradicts the classifier
// verdict stamped on its custom_fields. Two disagreement directions:
//   - effective_decision in (proceed, review) AND move TO N/A   → false proceed
//   - effective_decision = reject               AND move OUT of N/A → false reject
//
// No-op when:
//   - actorId is null (admin moves use the audit page instead)
//   - the card has no `_relevancy_score_id` (pre-classifier card)
//   - the move is between two non-N/A columns (normal workflow progression)
//   - the move direction agrees with the classifier
//   - the score row has already been overridden by the same agent (duplicate guard)
//
// Returns the new override id, or null when it was a no-op. Callers should
// wrap this in try/catch — failure must never block the move.
export async function captureAgentMoveOverride(opts: {
  taskId: string;
  agentId: string;
  oldColumnName: string;
  newColumnName: string;
}): Promise<{ override_id: number } | null> {
  const N_A = "N/A";
  const movingToNA = opts.newColumnName === N_A && opts.oldColumnName !== N_A;
  const movingFromNA = opts.oldColumnName === N_A && opts.newColumnName !== N_A;
  if (!movingToNA && !movingFromNA) return null;

  // Pull the score-related fields stamped on the card.
  const taskRow = await sql<{
    score_id_raw: unknown;
    effective: string | null;
    decision: string | null;
  }>`
    SELECT
      custom_fields->>'_relevancy_score_id' AS score_id_raw,
      custom_fields->>'_relevancy_effective' AS effective,
      custom_fields->>'_relevancy_decision' AS decision
    FROM tasks
    WHERE id = ${opts.taskId}
    LIMIT 1
  `;
  if (taskRow.rows.length === 0) return null;
  const { score_id_raw, effective, decision } = taskRow.rows[0];
  if (!score_id_raw || decision === null) return null;
  const scoreId = Number(score_id_raw);
  if (!Number.isFinite(scoreId) || !Number.isInteger(scoreId) || scoreId <= 0) {
    return null;
  }

  // Disagreement check (use effective_decision since that's what would have
  // routed the job in active mode).
  const effDecision = effective ?? decision;
  const proceedLike = effDecision === "proceed" || effDecision === "review";
  const rejectLike = effDecision === "reject";
  const isDisagreement = (movingToNA && proceedLike) || (movingFromNA && rejectLike);
  if (!isDisagreement) return null;

  // Duplicate guard — one agent_move override per (score_id, agent_id).
  const existing = await sql<{ id: number | string }>`
    SELECT id FROM relevancy_overrides
    WHERE score_id = ${scoreId}
      AND override_type = 'agent_move'
      AND agent_id = ${opts.agentId}::uuid
    LIMIT 1
  `;
  if (existing.rows.length > 0) return null;

  // Pull source from the score row for the audit trail. Skip if the score
  // row doesn't exist anymore (shouldn't happen — score_id is stamped from
  // an insert that already succeeded, but defend in case of manual deletion).
  const scoreRow = await sql<{ source: string | null }>`
    SELECT source FROM relevancy_scores WHERE id = ${scoreId} LIMIT 1
  `;
  if (scoreRow.rows.length === 0) return null;
  const source = scoreRow.rows[0].source;

  const inserted = await sql<{ id: number | string }>`
    INSERT INTO relevancy_overrides (
      score_id, task_id, classifier_decision, agent_action, agent_id,
      override_type, source
    ) VALUES (
      ${scoreId},
      ${opts.taskId}::uuid,
      ${decision},
      ${movingToNA ? "moved_to_na" : "moved_from_na"},
      ${opts.agentId}::uuid,
      'agent_move',
      ${source}
    )
    RETURNING id
  `;
  return { override_id: Number(inserted.rows[0].id) };
}

// ===================================================================
// Agent feedback on AI classifications (migration 023)
// ===================================================================
//
// Lets agents flag specific rejection reasons emitted by the LLM as wrong from
// inside the task card's AI Relevancy panel. Distinct from agent_move (which
// fires on column drag) and admin_audit (admin-only on /relevancy-audit). The
// feedback rows are scoped per-(score, agent) — one agent gets one row per
// score, edit-via-delete-then-insert (matches admin path).
//
// Permission contract: an agent may flag a card only if they are an assignee
// (or the card is unassigned); admins may flag any card. Enforced at the API
// route via assertCanFlagTaskRelevancy below.

export interface AgentFeedbackRow {
  feedback_id: number;
  score_id: number;
  override_reason: string[] | null;
  note: string | null;
  created_at: string;
  agent_id: string | null;
}

export interface AgentFeedbackListRow extends AgentFeedbackRow {
  agent_name: string | null;
  task_id: string | null;
  task_title: string | null;
  classifier_decision: string;
  job_external_id: string | null;
  job_url: string | null;
  job_title: string | null;
}

// Resolves the caller's effective scope for flagging a given task's classifier.
// Mirrors the /my-tasks agent-scope rule: assigned OR unassigned. Admins are
// allowed unconditionally. Returns the agent_id resolved from the session so
// the API route doesn't have to look it up again.
export async function assertCanFlagTaskRelevancy(opts: {
  taskId: string;
  sessionUserId: string | undefined;
  sessionRole: string | undefined;
  sessionAgentId: string | undefined;
}): Promise<
  | { ok: true; scope: "admin"; agentId: string | null }
  | { ok: true; scope: "agent"; agentId: string }
  | { ok: false; code: "unauthorized" | "not_assigned" | "task_not_found" }
> {
  if (!opts.sessionUserId) return { ok: false, code: "unauthorized" };

  // Admin path — no assignment check.
  if (opts.sessionRole === "admin") {
    return { ok: true, scope: "admin", agentId: opts.sessionAgentId ?? null };
  }

  if (!opts.sessionAgentId) return { ok: false, code: "unauthorized" };

  // Agent path — must be assigned OR card unassigned. Same rule the kanban
  // applies via agentScopeOnCurrentBoard.
  const row = await sql<{ assigned: boolean; has_any_assignees: boolean }>`
    SELECT
      EXISTS (
        SELECT 1 FROM task_assignees ta
        WHERE ta.task_id = ${opts.taskId}::uuid AND ta.agent_id = ${opts.sessionAgentId}::uuid
      ) AS assigned,
      EXISTS (
        SELECT 1 FROM task_assignees ta WHERE ta.task_id = ${opts.taskId}::uuid
      ) AS has_any_assignees
  `;
  if (row.rows.length === 0) return { ok: false, code: "task_not_found" };
  const { assigned, has_any_assignees } = row.rows[0];
  if (!assigned && has_any_assignees) return { ok: false, code: "not_assigned" };

  return { ok: true, scope: "agent", agentId: opts.sessionAgentId };
}

// Writes an agent_feedback row for the given score. Returns the new feedback
// id + created_at, or an error code on duplicate / missing score. The same
// agent flagging the same score twice gets a 409-style error — the API maps
// that to the edit-via-delete-then-insert flow.
export async function createAgentFeedbackOverride(opts: {
  scoreId: number;
  agentId: string;
  taskId: string;
  overrideReason: string[];
  note: string | null;
}): Promise<
  | { feedback_id: number; created_at: string }
  | { error: "score_not_found" }
  | { error: "already_flagged"; feedback_id: number }
> {
  // Bind the score to the URL-supplied task. A malicious agent assigned to
  // task A cannot poison the audit by submitting a score_id from task B —
  // the lookup returns nothing and the API surfaces score_not_found (404).
  //
  // The canonical task↔score link is the CARD STAMP
  // (tasks.custom_fields->>'_relevancy_score_id' = relevancy_scores.id), NOT
  // relevancy_scores.task_id. The classifier persists the score BEFORE the
  // board card exists, so task_id is NULL on ~97% of rows (2026-06-01: 2062 of
  // 2132) and nothing ever backfills it — the same dead-column pattern as
  // jobs.task_id, and the same link the admin audit query uses. Binding on
  // task_id alone surfaced score_not_found for every classifier-scored card.
  // Accept EITHER link so the rare task-bound rows (manual eval) and the common
  // card-stamped rows both resolve, while still scoping the score to this task.
  const scoreRow = await sql<{ decision: string; source: string | null }>`
    SELECT rs.decision, rs.source
    FROM relevancy_scores rs
    WHERE rs.id = ${opts.scoreId}
      AND (
        rs.task_id = ${opts.taskId}::uuid
        OR EXISTS (
          SELECT 1 FROM tasks t
          WHERE t.id = ${opts.taskId}::uuid
            AND t.custom_fields->>'_relevancy_score_id' = rs.id::text
        )
      )
    LIMIT 1
  `;
  if (scoreRow.rows.length === 0) return { error: "score_not_found" };
  const { decision, source } = scoreRow.rows[0];

  const existing = await sql<{ id: number | string }>`
    SELECT id FROM relevancy_overrides
    WHERE score_id = ${opts.scoreId}
      AND override_type = 'agent_feedback'
      AND agent_id = ${opts.agentId}::uuid
    LIMIT 1
  `;
  if (existing.rows.length > 0) {
    return { error: "already_flagged", feedback_id: Number(existing.rows[0].id) };
  }

  try {
    const inserted = await sql<{ id: number | string; created_at: string | Date }>`
      INSERT INTO relevancy_overrides (
        score_id, task_id, classifier_decision, agent_action, agent_id,
        override_type, override_reason, note, source
      ) VALUES (
        ${opts.scoreId},
        ${opts.taskId}::uuid,
        ${decision},
        NULL,
        ${opts.agentId}::uuid,
        'agent_feedback',
        ${opts.overrideReason},
        ${opts.note},
        ${source}
      )
      RETURNING id, created_at
    `;
    const row = inserted.rows[0];
    return {
      feedback_id: Number(row.id),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    };
  } catch (e) {
    // Race: a concurrent POST won the partial unique index
    // (idx_feedback_unique_score_agent). Refetch the winning row and surface
    // already_flagged so the client swaps into edit mode.
    const code = (e as { code?: string } | null)?.code;
    if (code === "23505") {
      const refetch = await sql<{ id: number | string }>`
        SELECT id FROM relevancy_overrides
        WHERE score_id = ${opts.scoreId}
          AND override_type = 'agent_feedback'
          AND agent_id = ${opts.agentId}::uuid
        LIMIT 1
      `;
      if (refetch.rows.length > 0) {
        return { error: "already_flagged", feedback_id: Number(refetch.rows[0].id) };
      }
    }
    throw e;
  }
}

// Unions canonical reason labels into a task's `_reason` custom field (the Task
// Board's N/A reason multi-select). Mirrors an agent's red-flag ticks from the AI
// Relevancy feedback form so they don't fill the card's Reasons field separately.
// MERGE-only — never wipes existing reasons. Non-canonical values (e.g. the
// `__decision__` sentinel) are dropped, so only real labels land. No-op when
// nothing is left to add. Callers must wrap in try/catch: a mirror failure must
// never block the feedback save itself.
export async function mirrorReasonsToCard(opts: {
  taskId: string;
  reasons: string[];
}): Promise<void> {
  const labels = opts.reasons.filter((r) => RELEVANCY_REASON_SET.has(r));
  if (labels.length === 0) return;

  // Read the current _reason array (node-postgres parses jsonb → JS array). The
  // CASE guards against a malformed non-array value.
  const cur = await sql<{ reasons: string[] | null }>`
    SELECT CASE
             WHEN jsonb_typeof(custom_fields->'_reason') = 'array'
             THEN custom_fields->'_reason'
             ELSE '[]'::jsonb
           END AS reasons
    FROM tasks
    WHERE id = ${opts.taskId}::uuid
    LIMIT 1
  `;
  if (cur.rows.length === 0) return; // task vanished — nothing to mirror

  const existing = Array.isArray(cur.rows[0].reasons) ? cur.rows[0].reasons : [];
  const merged = Array.from(new Set([...existing, ...labels]));
  // Superset-only union: if no new label was added, skip the write entirely.
  if (merged.length === existing.length) return;

  await sql`
    UPDATE tasks
    SET custom_fields = jsonb_set(
      COALESCE(custom_fields, '{}'::jsonb),
      '{_reason}',
      ${JSON.stringify(merged)}::jsonb
    )
    WHERE id = ${opts.taskId}::uuid
  `;
}

// Returns the caller's existing feedback row for the given task (NULL if not
// yet flagged). Used to pre-fill the form in edit mode. Scoped by agent_id so
// each agent only sees their own.
export async function getAgentFeedbackForTask(opts: {
  taskId: string;
  agentId: string;
}): Promise<AgentFeedbackRow | null> {
  const result = await sql<{
    id: number | string;
    score_id: number | string;
    override_reason: string[] | null;
    note: string | null;
    created_at: string | Date;
    agent_id: string | null;
  }>`
    SELECT id, score_id, override_reason, note, created_at, agent_id
    FROM relevancy_overrides
    WHERE task_id = ${opts.taskId}::uuid
      AND override_type = 'agent_feedback'
      AND agent_id = ${opts.agentId}::uuid
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    feedback_id: Number(r.id),
    score_id: Number(r.score_id),
    override_reason: r.override_reason,
    note: r.note,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    agent_id: r.agent_id,
  };
}

// Admin counterpart to getAgentFeedbackForTask. Returns the admin_audit override
// the requesting admin created for THIS task's score (NULL if none), shaped like
// AgentFeedbackRow so the task-board panel/form reuse the agent edit flow. Scoped
// to admin_id so each admin only edits their own verdict; a score audited by a
// different admin reads as null here (managed on /relevancy-audit instead). Links
// by the card stamp because legacy audit-page rows have task_id = NULL.
export async function getAdminAuditOverrideForTask(opts: {
  taskId: string;
  adminId: string;
}): Promise<AgentFeedbackRow | null> {
  const result = await sql<{
    id: number | string;
    score_id: number | string;
    override_reason: string[] | null;
    note: string | null;
    created_at: string | Date;
  }>`
    SELECT ro.id, ro.score_id, ro.override_reason, ro.note, ro.created_at
    FROM relevancy_overrides ro
    WHERE ro.override_type = 'admin_audit'
      AND ro.admin_id = ${opts.adminId}
      AND (
        ro.task_id = ${opts.taskId}::uuid
        OR ro.score_id = (
          SELECT NULLIF(t.custom_fields->>'_relevancy_score_id', '')::int
          FROM tasks t WHERE t.id = ${opts.taskId}::uuid
        )
      )
    ORDER BY ro.created_at DESC
    LIMIT 1
  `;
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    feedback_id: Number(r.id),
    score_id: Number(r.score_id),
    override_reason: r.override_reason,
    note: r.note,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    agent_id: null,
  };
}

// Deletes an agent_feedback row iff (a) it belongs to the requesting agent
// AND (b) it lives under the URL-supplied task. Admins use the AsAdmin variant
// below which skips the agent_id check but still enforces the task_id match.
export async function deleteAgentFeedback(opts: {
  feedbackId: number;
  agentId: string;
  taskId: string;
}): Promise<"deleted" | "not_found" | "forbidden"> {
  const row = await sql<{
    agent_id: string | null;
    override_type: string;
    task_id: string | null;
  }>`
    SELECT agent_id, override_type, task_id
    FROM relevancy_overrides
    WHERE id = ${opts.feedbackId}
    LIMIT 1
  `;
  if (row.rows.length === 0) return "not_found";
  const r = row.rows[0];
  if (r.override_type !== "agent_feedback") return "not_found";
  // Treat a path/row mismatch as not_found rather than forbidden — the row
  // doesn't exist *under this URL*, even if it exists elsewhere.
  if (r.task_id !== opts.taskId) return "not_found";
  if (r.agent_id !== opts.agentId) return "forbidden";

  await sql`DELETE FROM relevancy_overrides WHERE id = ${opts.feedbackId}`;
  return "deleted";
}

// Admin variant — can delete any agent's feedback row. Used by /relevancy-audit
// admin moderation UI. Still enforces the task_id match so an admin can't be
// tricked by a crafted DELETE body into removing a row outside the URL scope.
export async function deleteAgentFeedbackAsAdmin(opts: {
  feedbackId: number;
  taskId: string;
}): Promise<"deleted" | "not_found"> {
  const row = await sql<{ override_type: string; task_id: string | null }>`
    SELECT override_type, task_id
    FROM relevancy_overrides
    WHERE id = ${opts.feedbackId}
    LIMIT 1
  `;
  if (row.rows.length === 0) return "not_found";
  if (row.rows[0].override_type !== "agent_feedback") return "not_found";
  if (row.rows[0].task_id !== opts.taskId) return "not_found";
  await sql`DELETE FROM relevancy_overrides WHERE id = ${opts.feedbackId}`;
  return "deleted";
}

// Admin delete dispatcher for the task-board feedback endpoint. Handles BOTH
// override types an admin can remove from a card:
//   - agent_feedback — admin moderating an agent's flag (task-bound, any agent)
//   - admin_audit    — admin removing their OWN board/audit verdict (admin-owned)
// Returns the outcome so the route maps to 204 / 403 / 404.
export async function deleteRelevancyFeedbackAsAdmin(opts: {
  feedbackId: number;
  taskId: string;
  adminId: string;
}): Promise<"deleted" | "not_found" | "forbidden"> {
  const row = await sql<{
    override_type: string;
    task_id: string | null;
    admin_id: string | null;
  }>`
    SELECT override_type, task_id, admin_id
    FROM relevancy_overrides
    WHERE id = ${opts.feedbackId}
    LIMIT 1
  `;
  if (row.rows.length === 0) return "not_found";
  const r = row.rows[0];

  if (r.override_type === "agent_feedback") {
    // Same task-binding guard as deleteAgentFeedbackAsAdmin — a crafted body
    // can't reach a row outside this URL's task.
    if (r.task_id !== opts.taskId) return "not_found";
    await sql`DELETE FROM relevancy_overrides WHERE id = ${opts.feedbackId}`;
    return "deleted";
  }
  if (r.override_type === "admin_audit") {
    // Only the creating admin may remove their verdict (mirrors
    // deleteAdminAuditOverride). Legacy audit-page rows have task_id = NULL, so
    // only enforce the binding when a task is stamped.
    if (r.task_id !== null && r.task_id !== opts.taskId) return "not_found";
    if (r.admin_id !== opts.adminId) return "forbidden";
    await sql`DELETE FROM relevancy_overrides WHERE id = ${opts.feedbackId}`;
    return "deleted";
  }
  return "not_found";
}

// Lists agent_feedback rows for the admin review surface on /relevancy-audit.
// When scopeAgentId is provided, results are restricted to that agent's rows
// (used when the page is viewed by an agent, not admin). Joins tasks + agents
// + scores so the table can render context without extra round trips.
export async function listAgentFeedback(opts: {
  scopeAgentId?: string | null;
  from?: Date | null;
  to?: Date | null;
  profileIds?: string[] | null;
  limit?: number;
}): Promise<AgentFeedbackListRow[]> {
  const limit = opts.limit ?? 100;
  // Date filter is on the flag time (ro.created_at) — matches the table's
  // "When" column and the relevancy-audit page's windowing. Null = unbounded.
  const fromIso = opts.from ? opts.from.toISOString() : null;
  const toIso = opts.to ? opts.to.toISOString() : null;
  const profileFilter =
    opts.profileIds && opts.profileIds.length > 0 ? opts.profileIds : null;
  const result = await sql<{
    id: number | string;
    score_id: number | string;
    override_reason: string[] | null;
    note: string | null;
    created_at: string | Date;
    agent_id: string | null;
    agent_name: string | null;
    task_id: string | null;
    task_title: string | null;
    classifier_decision: string;
    job_external_id: string | null;
    job_url: string | null;
    job_title: string | null;
  }>`
    SELECT
      ro.id, ro.score_id, ro.override_reason, ro.note, ro.created_at,
      ro.agent_id, ag.name AS agent_name,
      ro.task_id, t.title AS task_title,
      ro.classifier_decision,
      rs.job_external_id, rs.job_url, COALESCE(rs.job_title, t.title) AS job_title
    FROM relevancy_overrides ro
    LEFT JOIN agents ag ON ag.id = ro.agent_id
    LEFT JOIN tasks t ON t.id = ro.task_id
    LEFT JOIN relevancy_scores rs ON rs.id = ro.score_id
    WHERE ro.override_type = 'agent_feedback'
      AND (${opts.scopeAgentId ?? null}::uuid IS NULL OR ro.agent_id = ${opts.scopeAgentId ?? null}::uuid)
      AND (${fromIso}::timestamptz IS NULL OR ro.created_at >= ${fromIso}::timestamptz)
      AND (${toIso}::timestamptz IS NULL OR ro.created_at <= ${toIso}::timestamptz)
      AND (${profileFilter}::text[] IS NULL OR rs.profile_id = ANY(${profileFilter}::text[]))
    ORDER BY ro.created_at DESC
    LIMIT ${limit}
  `;
  return result.rows.map((r) => ({
    feedback_id: Number(r.id),
    score_id: Number(r.score_id),
    override_reason: r.override_reason,
    note: r.note,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
    agent_id: r.agent_id,
    agent_name: r.agent_name,
    task_id: r.task_id,
    task_title: r.task_title,
    classifier_decision: r.classifier_decision,
    job_external_id: r.job_external_id,
    job_url: r.job_url,
    job_title: r.job_title,
  }));
}

// ===================================================================
// DLQ retry worker (plan v3.3 Appendix C)
// ===================================================================

export interface DlqDrainResult {
  retried: number;          // rows we attempted (= succeeded + failed)
  succeeded: number;        // rows that re-inserted cleanly into relevancy_scores
  failed: number;           // rows whose retry threw — backoff bumped
  permanent: number;        // rows that just crossed `maxAttempts` (terminal)
  pending_after_run: number; // DLQ depth still awaiting future attempts
}

// Drains up to `batchSize` rows from relevancy_scores_dlq that are ready to
// retry. Each row is processed in its own transaction with FOR UPDATE SKIP
// LOCKED so overlapping cron + manual workflow_dispatch runs never touch the
// same row. Plan §C.1 + §C.4.
//
// Backoff: next_attempt_at = NOW() + INTERVAL '1 hour' * 2^attempts (so
// attempts=0 → +1h, attempts=4 → +16h). When attempts crosses maxAttempts the
// row is left with resolved_at=NULL but excluded from future selections by the
// `attempts < maxAttempts` predicate — preserves forensic state for manual
// inspection without bouncing the same broken payload forever.
//
// Slack alerting is intentionally not wired (per v3.3 Q12 — no Slack for
// relevancy events; surface via the audit page tile instead).
export async function drainRelevancyScoresDlq(opts: {
  maxAttempts?: number;
  batchSize?: number;
}): Promise<DlqDrainResult> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const batchSize = opts.batchSize ?? 50;

  let succeeded = 0;
  let failed = 0;
  let permanent = 0;
  let retried = 0;

  for (let i = 0; i < batchSize; i++) {
    const didWork = await withTransaction(async (tx) => {
      // Grab one ready-to-retry row, exclude permanently-failed ones, and
      // hold a row lock for the duration of this tx.
      const sel = await tx<{
        id: number | string;
        payload: unknown;
        attempts: number;
      }>`
        SELECT id, payload, attempts
        FROM relevancy_scores_dlq
        WHERE resolved_at IS NULL
          AND next_attempt_at <= NOW()
          AND attempts < ${maxAttempts}
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      if (sel.rows.length === 0) return false; // nothing left to do

      const row = sel.rows[0];
      const dlqId = Number(row.id);
      const currentAttempts = row.attempts;
      retried++;

      // Wrap the risky replay in a SAVEPOINT so a failure rolls back ONLY the
      // replay attempt — the bookkeeping UPDATE below then runs on a healthy
      // tx. Without this, an aborted replay poisons the outer tx and the
      // entire batch loop crashes on the first malformed payload (observed
      // 2026-05-21: 694 rows accumulated because catch-block UPDATE hit
      // "current transaction is aborted, commands ignored").
      await tx`SAVEPOINT sp_replay`;
      try {
        // Replay the parked verdict through the normal insert path. Postgres
        // CHECK constraints + FK on criteria_version are the validator —
        // shape mismatches raise here and route to the failure branch below.
        await insertRelevancyScore(
          row.payload as import("./types").RelevancyScoreInsert,
          tx
        );
        await tx`RELEASE SAVEPOINT sp_replay`;
        await tx`
          UPDATE relevancy_scores_dlq
          SET resolved_at = NOW()
          WHERE id = ${dlqId}
        `;
        succeeded++;
      } catch (err) {
        // The replay aborted the tx; roll back to the savepoint so the outer
        // tx is healthy again and the bookkeeping UPDATE can commit.
        await tx`ROLLBACK TO SAVEPOINT sp_replay`;
        // Exponential backoff: 1h, 2h, 4h, 8h, 16h. attempts will become
        // `currentAttempts + 1` after this UPDATE; if that crosses maxAttempts
        // the row is permanent.
        const intervalHours = Math.pow(2, currentAttempts);
        const errDetail = (err as Error).message.slice(0, 500);
        await tx`
          UPDATE relevancy_scores_dlq
          SET attempts = attempts + 1,
              next_attempt_at = NOW() + (${intervalHours} || ' hours')::interval,
              error_detail = ${errDetail}
          WHERE id = ${dlqId}
        `;
        failed++;
        if (currentAttempts + 1 >= maxAttempts) permanent++;
      }
      return true;
    });
    if (!didWork) break;
  }

  // Final depth — only counts rows that are still recoverable.
  const depth = await sql<{ pending: number | string }>`
    SELECT COUNT(*)::int AS pending
    FROM relevancy_scores_dlq
    WHERE resolved_at IS NULL AND attempts < ${maxAttempts}
  `;

  return {
    retried,
    succeeded,
    failed,
    permanent,
    pending_after_run: Number(depth.rows[0]?.pending ?? 0),
  };
}

// ============================================================
// MANUAL EVALUATOR (Phase 5 + 9, plan v3.3 §6.1, §10.3)
// ============================================================

export type ManualEvalLoadStatus = "success" | "partial" | "failed";

// Writes one row to manual_job_evaluations linking the request to the
// resulting relevancy_scores row (or to the failure that prevented one).
export async function insertManualJobEvaluation(args: {
  taskId: string;
  profileId: string;
  requestedBy: string;
  scoreId: number | null;
  loadStatus: ManualEvalLoadStatus;
  loadError: string | null;
}): Promise<{ id: number }> {
  const result = await sql<{ id: number | string }>`
    INSERT INTO manual_job_evaluations (
      task_id, profile_id, score_id, requested_by, load_status, load_error
    ) VALUES (
      ${args.taskId},
      ${args.profileId},
      ${args.scoreId},
      ${args.requestedBy},
      ${args.loadStatus},
      ${args.loadError}
    )
    RETURNING id
  `;
  return { id: Number(result.rows[0].id) };
}

export interface ManualEvalRateLimitResult {
  allowed: boolean;
  exceeded: "hourly" | "daily" | null;
  hourlyCount: number;
  dailyCount: number;
  retryAfterSeconds: number;
}

// Postgres-backed rate limiter for the manual evaluator (plan §16.3 R1):
// 60 evals/hour and 300/day per admin. Derives counts directly from
// manual_job_evaluations.created_at — no separate counter table needed.
// `requestedBy` is the session.user.id (TEXT). Two cheap COUNT(*) calls
// against the partial idx_mje_profile / idx_mje_task indexes; well under
// 5ms on a populated table.
export async function checkManualEvalRateLimit(args: {
  requestedBy: string;
  perHour?: number;
  perDay?: number;
}): Promise<ManualEvalRateLimitResult> {
  const perHour = args.perHour ?? 60;
  const perDay = args.perDay ?? 300;

  const result = await sql<{ hourly: number | string; daily: number | string }>`
    SELECT
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS hourly,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')::int  AS daily
    FROM manual_job_evaluations
    WHERE requested_by = ${args.requestedBy}
      AND created_at > NOW() - INTERVAL '1 day'
  `;

  const hourlyCount = Number(result.rows[0]?.hourly ?? 0);
  const dailyCount = Number(result.rows[0]?.daily ?? 0);

  if (hourlyCount >= perHour) {
    return {
      allowed: false,
      exceeded: "hourly",
      hourlyCount,
      dailyCount,
      retryAfterSeconds: 3600,
    };
  }
  if (dailyCount >= perDay) {
    return {
      allowed: false,
      exceeded: "daily",
      hourlyCount,
      dailyCount,
      retryAfterSeconds: 24 * 3600,
    };
  }
  return {
    allowed: true,
    exceeded: null,
    hourlyCount,
    dailyCount,
    retryAfterSeconds: 0,
  };
}

// Profile listing for the evaluator's picker: every active profile + a flag
// indicating whether a current snapshot exists. The UI greys profiles where
// has_snapshot=false (linkout: /settings → Profiles → upload snapshot).
export async function listProfilesForManualEval(): Promise<
  Array<{ profile_id: string; profile_name: string; has_snapshot: boolean }>
> {
  const result = await sql<{
    profile_id: string;
    profile_name: string;
    has_snapshot: boolean;
  }>`
    SELECT
      p.profile_id,
      p.profile_name,
      EXISTS (
        SELECT 1 FROM upwork_profile_snapshots_current s
        WHERE s.profile_id = p.profile_id
      ) AS has_snapshot
    FROM profiles p
    WHERE p.active = TRUE
    ORDER BY p.profile_name
  `;
  return result.rows.map((r) => ({
    profile_id: r.profile_id,
    profile_name: r.profile_name,
    has_snapshot: r.has_snapshot,
  }));
}

// ============================================================
// THRESHOLD PREVIEW (Phase 13/14, plan v3.3 §10.6.4)
// ============================================================

export interface ThresholdPreview {
  window_days: number;
  profile_id: string | null;
  total: number;                         // all rows in window
  scored: number;                        // rows with total_score IS NOT NULL
  by_decision: Record<string, number>;   // proceed / reject / review counts
  by_effective_decision: Record<string, number>;
  proceeds_total: number;                // rows where decision = proceed
  would_flip: Array<{ threshold: number; count: number; pct_of_proceeds: number }>;
  score_distribution: Array<{ band: string; count: number }>;  // 0-9, 10-19, ..., 90-100
}

// Computes the calibration distribution for the operator settings preview.
// Filters: last N days (default 7), optionally scoped to one profile.
// Powers the inline preview shown next to the min_score input + the per-profile
// dropdown on the Settings page.
export async function getThresholdPreview(opts: {
  windowDays?: number;
  profileId?: string | null;
}): Promise<ThresholdPreview> {
  const windowDays = opts.windowDays && opts.windowDays > 0 && opts.windowDays <= 90
    ? Math.floor(opts.windowDays)
    : 7;
  const profileId = opts.profileId && typeof opts.profileId === "string"
    ? opts.profileId
    : null;

  // Use parameterized sql.query for dynamic profile_id branching; tagged
  // templates can't splice query fragments cleanly with the wrapper in db.ts.
  const aggSql = `
    SELECT
      COUNT(*)::int                                                                            AS total,
      COUNT(*) FILTER (WHERE total_score IS NOT NULL)::int                                     AS scored,
      COUNT(*) FILTER (WHERE decision = 'proceed')::int                                        AS proceed_count,
      COUNT(*) FILTER (WHERE decision = 'reject')::int                                         AS reject_count,
      COUNT(*) FILTER (WHERE decision = 'review')::int                                         AS review_count,
      COUNT(*) FILTER (WHERE effective_decision = 'proceed')::int                              AS eff_proceed,
      COUNT(*) FILTER (WHERE effective_decision = 'reject')::int                               AS eff_reject,
      COUNT(*) FILTER (WHERE effective_decision = 'review')::int                               AS eff_review,
      COUNT(*) FILTER (WHERE decision = 'proceed' AND total_score IS NOT NULL)::int            AS proceeds_total,
      COUNT(*) FILTER (WHERE decision = 'proceed' AND total_score IS NOT NULL AND total_score < 40)::int AS flip_40,
      COUNT(*) FILTER (WHERE decision = 'proceed' AND total_score IS NOT NULL AND total_score < 50)::int AS flip_50,
      COUNT(*) FILTER (WHERE decision = 'proceed' AND total_score IS NOT NULL AND total_score < 60)::int AS flip_60,
      COUNT(*) FILTER (WHERE decision = 'proceed' AND total_score IS NOT NULL AND total_score < 70)::int AS flip_70,
      COUNT(*) FILTER (WHERE decision = 'proceed' AND total_score IS NOT NULL AND total_score < 80)::int AS flip_80
    FROM relevancy_scores
    WHERE evaluated_at > NOW() - ($1 || ' days')::interval
      ${profileId ? "AND profile_id = $2" : ""}
  `;
  const aggParams: unknown[] = profileId ? [windowDays, profileId] : [windowDays];
  const rows = await sql.query<{
    total: number | string;
    scored: number | string;
    proceed_count: number | string;
    reject_count: number | string;
    review_count: number | string;
    eff_proceed: number | string;
    eff_reject: number | string;
    eff_review: number | string;
    proceeds_total: number | string;
    flip_40: number | string;
    flip_50: number | string;
    flip_60: number | string;
    flip_70: number | string;
    flip_80: number | string;
  }>(aggSql, aggParams);

  const distSql = `
    SELECT
      LEAST(FLOOR(total_score / 10)::int, 9) AS band,
      COUNT(*)::int                          AS cnt
    FROM relevancy_scores
    WHERE evaluated_at > NOW() - ($1 || ' days')::interval
      AND total_score IS NOT NULL
      ${profileId ? "AND profile_id = $2" : ""}
    GROUP BY band
    ORDER BY band
  `;
  const dist = await sql.query<{ band: number | string; cnt: number | string }>(
    distSql,
    aggParams
  );

  const r = rows.rows[0] ?? {
    total: 0, scored: 0, proceed_count: 0, reject_count: 0, review_count: 0,
    eff_proceed: 0, eff_reject: 0, eff_review: 0, proceeds_total: 0,
    flip_40: 0, flip_50: 0, flip_60: 0, flip_70: 0, flip_80: 0,
  };
  const proceedsTotal = Number(r.proceeds_total);
  const pct = (n: number) =>
    proceedsTotal > 0 ? Math.round((n / proceedsTotal) * 1000) / 10 : 0;

  // Pre-fill all 10 bands so the UI can render a stable histogram.
  const bandMap = new Map<number, number>();
  for (let i = 0; i <= 9; i++) bandMap.set(i, 0);
  for (const d of dist.rows) {
    bandMap.set(Number(d.band), Number(d.cnt));
  }
  const score_distribution = Array.from(bandMap.entries()).map(([band, count]) => ({
    band: band === 9 ? "90-100" : `${band * 10}-${band * 10 + 9}`,
    count,
  }));

  return {
    window_days: windowDays,
    profile_id: profileId,
    total: Number(r.total),
    scored: Number(r.scored),
    by_decision: {
      proceed: Number(r.proceed_count),
      reject: Number(r.reject_count),
      review: Number(r.review_count),
    },
    by_effective_decision: {
      proceed: Number(r.eff_proceed),
      reject: Number(r.eff_reject),
      review: Number(r.eff_review),
    },
    proceeds_total: proceedsTotal,
    would_flip: [
      { threshold: 40, count: Number(r.flip_40), pct_of_proceeds: pct(Number(r.flip_40)) },
      { threshold: 50, count: Number(r.flip_50), pct_of_proceeds: pct(Number(r.flip_50)) },
      { threshold: 60, count: Number(r.flip_60), pct_of_proceeds: pct(Number(r.flip_60)) },
      { threshold: 70, count: Number(r.flip_70), pct_of_proceeds: pct(Number(r.flip_70)) },
      { threshold: 80, count: Number(r.flip_80), pct_of_proceeds: pct(Number(r.flip_80)) },
    ],
    score_distribution,
  };
}
