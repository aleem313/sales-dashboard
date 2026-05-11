// Rising Lions Dashboard — Domain Types
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
  clickup_user_id?: string | null;
  name: string;
  email: string | null;
  avatar_url: string | null;
  active: boolean;
  role: string;
  github_email: string | null;
  password_hash: string | null;
  created_at: string;
}

export interface Profile {
  id: string;
  profile_id: string;
  profile_name: string;
  platform: string | null;
  stack: string | null;
  vollna_filter_tag: string | null;
  agent_id: string | null;
  clickup_list_id?: string | null;
  active: boolean;
  connects_budget?: number | null;
  created_at: string;
}

// Snapshot of an Upwork freelancer profile, populated from docs/profiles/extract-profile.js output.
// Append-only: every save inserts a new row and demotes the previous current row to is_current=false.
// The upwork_profile_snapshots_current view returns only is_current=true rows.
export interface UpworkProfileSnapshot {
  id: string;
  profile_id: string;
  extracted_at: string;
  is_current: boolean;
  // promoted hot columns
  name: string | null;
  title: string | null;
  hourly_rate: number | null;
  rating: number | null;
  job_success_score: number | null;
  top_rated_status: string | null;
  total_jobs_worked: number | null;
  total_hours: number | null;
  last_worked_on: string | null;
  profile_url: string | null;
  ciphertext: string | null;
  skills_summary: string | null;
  // full extractor JSON; shape mirrors docs/profiles/Shayan.json
  // (typed as unknown — consumers cast to the partial shape they need; tighten with a
  // dedicated UpworkProfileData interface in a future migration if call sites grow)
  data: unknown;
  created_at: string;
}

// Relevancy classifier operator controls (Phase 5b, plan v3.3 §10.6).
export type ClassifierMode = "shadow" | "active";

export interface RelevancySystemSettings {
  classifier_mode: ClassifierMode;
  min_score: number;                              // 0-100
  mode_updated_by: string | null;                 // session.user.id of last editor
  mode_updated_at: string | null;                 // ISO
  score_updated_by: string | null;
  score_updated_at: string | null;
}

export interface ProfileClassifierConfig {
  profile_id: string;                             // slug, e.g. "shayan"
  profile_name: string;                           // display name
  classifier_enabled: boolean;                    // FALSE = per-profile veto when global is Active
  min_score_override: number | null;              // null = inherit global
  has_snapshot: boolean;                          // true if upwork_profile_snapshots_current row exists
}

// Classifier-ready profile context, assembled server-side by getProfileContext()
// from the snapshot, profiles overrides, system_settings, and criteria_versions.
// Shape mirrors plan v3.3 §5.4. Consumed by the n8n classifier sub-workflow (C1).
export interface ProfileContext {
  profile: {
    id: string;
    profile_id: string;
    name: string | null;
    headline: string | null;                      // description/title from snapshot
    skills: string[];                             // flat list of skill names
    skills_summary: string | null;                // raw skills_summary column
    portfolio_tldr: Array<{
      title: string;
      description_excerpt: string;
      tech_stack_inferred: string[];              // lowercased skill names that appear in description
    }>;
    work_history_tldr: Array<{
      title: string;
      type: string | null;                        // "Hourly" | "Fixed"
      status: string | null;                      // "Closed" | "In Progress" | ...
      totalHours: number | null;
      feedback_score: number | null;
    }>;
    categories: Array<{ groupName: string; name: string }>;
    stats: {
      rating: number | null;
      jss: number | null;
      top_rated_status: string | null;
      top_rated_plus: boolean | null;
      hourly_rate_usd: number | null;
      total_jobs: number | null;
      total_hours: number | null;
      last_worked_on: string | null;
    };
    country: string | null;
    snapshot_age_days: number;
    snapshot_extracted_at: string;
    _warnings: string[];                          // ['stale_snapshot', ...]
  };
  thresholds_overrides: Record<string, unknown>;  // raw profiles.thresholds_overrides JSONB
  _system: {
    classifier_mode: "shadow" | "active";         // effective for THIS profile
    effective_min_score: number;                  // profile.min_score_override ?? global.min_score
    global_mode: "shadow" | "active";             // raw global value (for audit transparency)
    profile_enabled: boolean;                     // profiles.classifier_enabled
    profile_min_override: number | null;          // null = inherit global
  };
  criteria_version: string;
  context_generated_at: string;
}

// Classifier-ready job payload, projected server-side by getTaskJobPayload()
// from one row of `tasks` + its `custom_fields` JSONB.
// Shape mirrors plan v3.3 §6.2. Consumed by both the manual eval (J3 fetches it)
// and the auto pipeline (n8n's `Process Job` produces the same shape from Vollna).
export interface JobPayload {
  task_id: string;
  task: {
    title: string;                                  // task title with [profile] prefix stripped
    raw_title: string;                              // original title with prefix kept (UI display)
    current_column: string | null;                  // column.name from join
    current_assignee_name: string | null;
    created_at: string;
    stage_entered_at: string | null;
  };
  job_id: string | null;                            // Upwork stable ID
  url: string | null;
  title: string;                                    // job title (= task.title without prefix)
  description: string | null;                       // job description text
  skills_required: string[];                        // parsed _skills array
  category: string | null;                          // not always populated
  budget_type: "hourly" | "fixed" | null;
  budget_min: number | null;
  budget_max: number | null;
  fixed_amount: number | null;
  client: {
    country: string | null;
    total_spent: number | null;
    hires: number | null;
    rating: number | null;
    payment_verified: boolean | null;
    member_since: string | null;
  };
  proposals_count: number | null;
  interviewing_count: number | null;
  invites_sent_count: number | null;
  hires_made_count: number | null;
  posted_at: string | null;                         // ISO from parsed _generated
  source: "auto" | "manual_url";                    // tag set by the caller
  card_age_days: number;
  _proposal_already_drafted: string | null;         // surfaced for UI; NOT fed back to classifier
  _assigned_agent: string | null;
  _profile_name: string | null;                     // matches profiles.profile_id
  _missing_fields: string[];                        // populated when _budget_*, _proposals_count etc. are absent
}

// Lightweight row returned by the history fetcher — no JSONB, just the timeline + key stats.
export interface UpworkProfileSnapshotHistoryRow {
  id: string;
  extracted_at: string;
  rating: number | null;
  job_success_score: number | null;
  total_jobs_worked: number | null;
  total_hours: number | null;
  is_current: boolean;
}

export interface ConnectsPurchase {
  id: string;
  profile_id: string;
  profile_name: string;
  agent_id: string | null;
  agent_name: string | null;
  purchased_on: string;
  connects_count: number;
  amount_spent: number;
  notes: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface ConnectsBudgetSummary {
  totalConnectsPurchased: number;
  totalSpentUsd: number;
  purchaseCount: number;
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
  status: string;
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
  proposalsViewed: number;
  inChat: number;
  meetingsBooked: number;
  meetingsDone: number;
  won: number;
  lost: number;
  winRate: number;
  totalRevenue: number;
  badLeads: number;
  untouched: number;
}

export interface AgentStats {
  id: string;
  name: string;
  clickup_user_id?: string | null;
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
  status: string;
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
  status?: string;
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

// ============================================================
// CYBERPUNK DASHBOARD TYPES
// ============================================================

export interface KPIMetricsWithDeltas extends KPIMetrics {
  deltaJobs: number;
  deltaProposals: number;
  deltaMeetings: number;
  deltaWon: number;
  deltaWinRate: number;
  deltaBadLeads: number;
  deltaUntouched: number;
}

export interface FunnelStep {
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface PipelineStage {
  key: string;
  label: string;
  count: number;
  subtitle: string;
}

export interface PipelineJob {
  id: string;
  job_title: string;
  profile_name: string | null;
  agent_name: string | null;
  status: string;
  time_in_stage: string;
  priority: string;
}

export interface EnhancedAgentStats extends AgentStats {
  meetings_done: number;
  conversion_rate: number;
  bonus_earned: number;
  score_pct: number;
}

export interface EnhancedProfileStats extends ProfileStats {
  niche: string | null;
  proposals_sent: number;
  response_rate: number;
  interview_rate: number;
}

export interface ConnectsUsage {
  profile_name: string;
  niche: string | null;
  connects_used: number;
  connects_budget: number;
}

export interface BoostedConnectsSummary {
  totalConnectsUsed: number;
  totalBoosted: number;
  bidOutBoost: number;
}

export interface ConnectROI {
  niche: string;
  connects_spent: number;
  wins: number;
  cost_per_win: number | null;
}

export interface FilterQuality {
  reason: string;
  count: number;
  percentage: number;
}

export interface AlertCounts {
  critical: number;
  warning: number;
  opportunity: number;
  overdue: number;
}
