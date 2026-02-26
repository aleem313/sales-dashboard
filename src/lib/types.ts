// Vollna Analytics Dashboard — Domain Types
// Source of truth: DASHBOARD_DEV.md Section 4

export interface DateRange {
  startDate: string;
  endDate: string;
}

// ============================================================
// DATABASE ENTITIES
// ============================================================

export interface Agent {
  id: string;
  clickup_user_id: string;
  name: string;
  email: string | null;
  avatar_url: string | null;
  active: boolean;
  role: string;
  github_email: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  profile_id: string;
  profile_name: string;
  stack: string | null;
  vollna_filter_tag: string | null;
  agent_id: string | null;
  clickup_list_id: string | null;
  active: boolean;
  created_at: string;
}

export interface Job {
  id: string;
  job_id: string;
  job_title: string;
  job_url: string | null;
  job_description: string | null;
  budget_type: string | null;
  budget_min: number | null;
  budget_max: number | null;
  hourly_min: number | null;
  hourly_max: number | null;
  skills: string[] | null;
  client_country: string | null;
  client_rating: number | null;
  client_total_spent: number | null;
  client_hires: number | null;
  posted_at: string | null;
  received_at: string;
  profile_id: string | null;
  agent_id: string | null;
  clickup_task_id: string | null;
  clickup_task_url: string | null;
  clickup_status: string;
  proposal_text: string | null;
  gpt_model: string | null;
  gpt_tokens_used: number | null;
  outcome: "won" | "lost" | "pending" | "skipped" | null;
  won_value: number | null;
  proposal_sent_at: string | null;
  outcome_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncLog {
  id: string;
  source: "clickup" | "sheets" | "n8n_webhook";
  records_synced: number;
  records_updated: number;
  errors: string[] | null;
  started_at: string;
  completed_at: string | null;
  status: "running" | "success" | "failed";
}

export interface StatsCache {
  id: string;
  cache_key: string;
  data: unknown;
  computed_at: string;
  expires_at: string | null;
}

// ============================================================
// AGGREGATED / COMPUTED TYPES
// ============================================================

export interface KPIMetrics {
  totalJobs: number;
  proposalsSent: number;
  won: number;
  lost: number;
  winRate: number;
  totalRevenue: number;
}

export interface AgentStats {
  id: string;
  name: string;
  clickup_user_id: string;
  total_jobs: number;
  proposals_sent: number;
  won: number;
  lost: number;
  win_rate_pct: number | null;
  total_revenue: number;
  avg_response_hours: number | null;
}

export interface ProfileStats {
  id: string;
  profile_id: string;
  profile_name: string;
  stack: string | null;
  total_jobs: number;
  won: number;
  win_rate_pct: number | null;
  avg_won_value: number | null;
  total_revenue: number;
}

export interface JobVolumePoint {
  date: string;
  count: number;
}

export interface StatusFunnelStep {
  status: string;
  count: number;
}

export interface ActivityEvent {
  id: string;
  job_title: string;
  agent_name: string | null;
  profile_name: string | null;
  clickup_status: string;
  outcome: string | null;
  updated_at: string;
}

export interface SystemHealth {
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  gptFailureRate: number;
  openJobsCount: number;
}

export interface JobFilters {
  agent_id?: string;
  profile_id?: string;
  clickup_status?: string;
  outcome?: string;
  budget_type?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ============================================================
// CHART DATA TYPES (Phase 5)
// ============================================================

export interface WinRateTrendPoint {
  week: string;
  won: number;
  decided: number;
  win_rate: number;
}

export interface DistributionBucket {
  bucket: string;
  count: number;
}

export interface SkillAnalysis {
  skill: string;
  count: number;
}

export interface RevenueByEntity {
  name: string;
  revenue: number;
}

export interface RevenueByBudgetType {
  budget_type: string;
  revenue: number;
  count: number;
}

// ============================================================
// PHASE 8: ADVANCED FEATURE TYPES
// ============================================================

export interface Alert {
  id: string;
  alert_type: string;
  message: string;
  current_value: number | null;
  threshold_value: number | null;
  dismissed: boolean;
  created_at: string;
}

export interface AlertThresholds {
  winRateMin: number;
  responseTimeMaxHours: number;
  dailyJobsMin: number;
}

export interface ProposalAnalytics {
  model: string;
  total: number;
  won: number;
  lost: number;
  win_rate_pct: number | null;
  avg_tokens: number | null;
}

export interface CountryStats {
  country: string;
  total: number;
  won: number;
  win_rate_pct: number | null;
}

export interface TimeSlotStats {
  day: number;     // 0=Sun..6=Sat
  hour: number;    // 0..23
  total: number;
  won: number;
  win_rate_pct: number | null;
}

export interface BudgetWinRate {
  bucket: string;
  total: number;
  won: number;
  win_rate_pct: number | null;
}
