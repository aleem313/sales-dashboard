# Rising Lions — Next.js to Laravel Backend Migration Plan

> **Project:** Rising Lions Analytics Dashboard  
> **Goal:** Migrate all backend logic from Next.js (App Router) to Laravel while keeping the Next.js frontend  
> **Current Stack:** Next.js 16 + React 19 + Vercel Postgres (raw SQL) + NextAuth v5  
> **Target Stack:** Laravel 12 (API backend) + Next.js 16 (frontend only) + MySQL 8.0+ + Laravel Sanctum  
> **Created:** 2026-04-08  

---

## Table of Contents

1. [Project Analysis](#1-project-analysis)
2. [Database Plan](#2-database-plan)
3. [Backend Migration Strategy](#3-backend-migration-strategy)
4. [Frontend Integration](#4-frontend-integration)
5. [Testing & QA](#5-testing--qa)
6. [Deployment & Environment Setup](#6-deployment--environment-setup)
7. [Timeline & Milestones](#7-timeline--milestones)
8. [Optional Improvements](#8-optional-improvements)
9. [Assumptions & Blockers](#9-assumptions--blockers)

---

## 1. Project Analysis

### 1.1 Backend Functionality Inventory

| Category | Count | Source Files |
|----------|-------|-------------|
| API Routes | 36 | `src/app/api/**` |
| Server Actions | 40+ | `src/lib/actions.ts`, `src/lib/task-actions.ts` |
| Database Query Functions | 80+ | `src/lib/data.ts`, `src/lib/task-data.ts` |
| Database Tables | 24 | `src/lib/seed.ts`, `src/lib/migrations/` |
| Webhook Handlers | 2 inbound | `/api/webhook/n8n`, `/api/v1/webhooks/tasks` |
| Cron Jobs | 1 (migration runner) | `vercel.json` |
| Third-Party Integrations | 4 | Google Sheets, n8n, Slack, Vercel Blob |

### 1.2 API Routes (Full Inventory)

#### Auth
| Method | Next.js Route | Purpose |
|--------|--------------|---------|
| GET/POST | `/api/auth/[...nextauth]` | NextAuth handlers (GitHub OAuth + Credentials) |

#### Jobs
| Method | Next.js Route | Purpose |
|--------|--------------|---------|
| GET | `/api/jobs/[id]` | Get job by ID |
| GET | `/api/jobs/search` | Search jobs by title/ID (limit 50) |
| GET | `/api/jobs/export` | Export jobs (auth required) |

#### Stats & Analytics
| Method | Next.js Route | Purpose |
|--------|--------------|---------|
| GET | `/api/stats/overview` | KPI metrics, top agents/profiles (cached 5min) |
| GET | `/api/stats/agents` | Agent statistics |
| GET | `/api/stats/profiles` | Profile statistics |

#### Settings
| Method | Next.js Route | Purpose |
|--------|--------------|---------|
| GET/POST | `/api/settings/thresholds` | Alert threshold CRUD |

#### Sync & Webhooks
| Method | Next.js Route | Purpose |
|--------|--------------|---------|
| POST | `/api/sync/sheets` | Google Sheets import |
| POST | `/api/webhook/n8n` | n8n job webhook (HMAC verified) |
| POST | `/api/v1/webhooks/tasks` | External task creation (Bearer token) |

#### Profiles & Agents
| Method | Next.js Route | Purpose |
|--------|--------------|---------|
| GET | `/api/profiles/mapping` | Profile→agent mapping for n8n |
| POST | `/api/profiles/sync-n8n` | Auto-provision n8n webhook nodes |
| PUT | `/api/agents/[id]/assign-profiles` | Bulk profile assignment |

#### Projects (Boards)
| Method | Next.js Route | Purpose |
|--------|--------------|---------|
| GET/POST | `/api/projects` | List/create projects |
| GET/PATCH/DELETE | `/api/projects/[id]` | Project CRUD |
| GET/POST | `/api/projects/[id]/tasks` | List/create tasks |
| GET/POST | `/api/projects/[id]/columns` | List/create columns |
| PATCH/DELETE | `/api/projects/[id]/columns/[cid]` | Column CRUD |
| POST | `/api/projects/[id]/columns/reorder` | Reorder columns |
| GET/POST | `/api/projects/[id]/members` | List/add members |
| PATCH/DELETE | `/api/projects/[id]/members/[agentId]` | Member role/removal |
| GET/POST | `/api/projects/[id]/tags` | List/create tags |
| PATCH/DELETE | `/api/projects/[id]/tags/[tid]` | Tag CRUD |
| GET/POST | `/api/projects/[id]/custom-fields` | List/create custom fields |
| PATCH/DELETE | `/api/projects/[id]/custom-fields/[fid]` | Custom field CRUD |
| POST | `/api/projects/[id]/custom-fields/reorder` | Reorder custom fields |
| GET/POST | `/api/projects/[id]/saved-views` | List/create saved views |
| DELETE | `/api/projects/[id]/saved-views/[vid]` | Delete saved view |

#### Tasks
| Method | Next.js Route | Purpose |
|--------|--------------|---------|
| GET/PATCH/DELETE | `/api/tasks/[id]` | Task CRUD |
| POST | `/api/tasks/[id]/move` | Move task between columns |
| GET/POST | `/api/tasks/[id]/comments` | List/create comments |
| PATCH/DELETE | `/api/tasks/[id]/comments/[cid]` | Comment edit/delete |
| GET | `/api/tasks/[id]/activity` | Activity log |
| POST/DELETE | `/api/tasks/[id]/attachments` | File upload/delete |

#### Database Migration
| Method | Next.js Route | Purpose |
|--------|--------------|---------|
| GET | `/api/migrate` | Run migrations (CRON_SECRET protected) |

### 1.3 Server Actions → API Endpoints

All Next.js server actions must become REST API endpoints in Laravel. Current server actions:

**Agent & Profile Management:**
- `toggleAgentActiveAction`, `createAgentAction`, `assignProfilesToAgentAction`
- `toggleProfileActiveAction`, `updateProfileAgentAction`, `createProfileAction`, `syncProfileToN8n`

**Alerts & Sync:**
- `dismissAlertAction`, `triggerSheetsSync`, `markProposalSentAction`

**Task Board (40+ actions):**
- Task CRUD: `createTaskAction`, `updateTaskAction`, `moveTaskAction`, `deleteTaskAction`
- Comments: `createCommentAction`
- Checklists: `toggleChecklistItemAction`, `addChecklistItemAction`, `deleteChecklistItemAction`
- Assignments: `setTaskAssigneesAction`, `setTaskTagsAction`
- Board CRUD: `createBoardAction`, `updateBoardAction`, `deleteBoardAction`
- Members: `addBoardMembersAction`, `updateMemberRoleAction`, `removeBoardMemberAction`
- Columns: `createColumnAction`, `updateColumnAction`, `deleteColumnAction`, `reorderColumnsAction`
- Tags: `createTagAction`, `updateTagAction`, `deleteTagAction`, `getProjectTagsAction`
- Custom fields: `createCustomFieldAction`, `updateCustomFieldAction`, `archiveCustomFieldAction`, `restoreCustomFieldAction`, `reorderCustomFieldsAction`
- Saved views: `createSavedViewAction`, `deleteSavedViewAction`

### 1.4 Authentication System

| Component | Current (Next.js) | Target (Laravel) |
|-----------|-------------------|-------------------|
| Auth library | NextAuth v5 (beta.30) | Laravel Sanctum (SPA + API tokens) |
| Credential login | Email + PBKDF2-SHA256 password | Laravel `Hash::make()` (bcrypt) + Sanctum |
| OAuth | GitHub via NextAuth | Laravel Socialite (GitHub) |
| Session | JWT in cookie | Sanctum SPA authentication (cookie-based) or API tokens |
| Roles | `admin` / `agent` in JWT | Laravel Gates + Policies or Spatie Permission |
| Middleware | `src/middleware.ts` route checks | Laravel middleware groups |
| Admin auth | `ADMIN_CREDENTIALS` env var (no DB row) | Seeded admin user in `users` table |

**Critical:** Current admin users do NOT have a row in the `agents` table. They authenticate via `ADMIN_CREDENTIALS` env var. In Laravel, create proper admin users in a `users` table.

### 1.5 Third-Party Integrations

| Integration | Current Implementation | Laravel Equivalent |
|-------------|----------------------|-------------------|
| Google Sheets | `googleapis` npm package, JWT auth | `google/apiclient` composer package |
| n8n | HTTP requests to n8n API | `Http::` facade or Guzzle |
| Slack | Webhook POST via `fetch()` | Laravel Notifications (Slack channel) |
| Vercel Blob | `@vercel/blob` for file uploads | Laravel Storage (S3/local/minio) |
| HMAC Webhooks | Manual SHA256 verification | Custom middleware or `spatie/laravel-webhook-client` |

### 1.6 Dependencies That Need Changes

| Dependency | Change Required |
|------------|----------------|
| `@vercel/postgres` | Replace with Laravel Eloquent + MySQL driver |
| `next-auth` | Replace with Laravel Sanctum + Socialite |
| `@vercel/blob` | Replace with Laravel Storage (S3-compatible) |
| Server actions (`"use server"`) | Convert to Laravel API endpoints |
| `revalidatePath()` cache busting | Not needed; frontend fetches fresh data via API |
| Vercel cron | Laravel Task Scheduling (`schedule:run`) |
| `process.env` | Laravel `.env` + `config()` helper |

---

## 2. Database Plan

### 2.1 Current Schema (24 Tables)

**Legacy tables (6):**
```
agents, profiles, jobs, sync_log, stats_cache, alerts
```

**Task management tables (18):**
```
workspaces, projects, project_members, columns, tasks, task_assignees,
task_tags, task_tag_map, comments, activity_log, checklist_items,
file_attachments, webhook_configs, webhook_event_log, notifications,
notification_preferences, saved_views, custom_field_definitions
```

### 2.2 Laravel Migration Plan

#### Phase 1: Core Tables (Laravel migrations)

All existing tables will be recreated as Laravel migrations with Eloquent models. Key changes:

| Current | Laravel Migration | Notes |
|---------|------------------|-------|
| `agents` | `create_users_table` | Rename to `users`; add standard Laravel auth columns; migrate `password_hash` to bcrypt |
| `profiles` | `create_profiles_table` | Keep structure; add `user_id` FK (was `agent_id`) |
| `jobs` | `create_jobs_table` | Keep structure; rename `agent_id` → `user_id` |
| `sync_log` | `create_sync_logs_table` | Keep structure |
| `stats_cache` | `create_stats_cache_table` | Or use Laravel Cache with DB driver |
| `alerts` | `create_alerts_table` | Keep structure |

#### Phase 2: Task Management Tables

> **MySQL UUID note:** All "UUID PK" entries below use `CHAR(36)` in MySQL. In Laravel migrations, use `$table->uuid('id')->primary()` which creates `CHAR(36)` on MySQL. Set `$incrementing = false` and `$keyType = 'string'` on Eloquent models. Use a `HasUuids` trait or `boot()` method to auto-generate UUIDs on creation.

| Current | Laravel Migration | Notes |
|---------|------------------|-------|
| `workspaces` | `create_workspaces_table` | UUID primary key |
| `projects` | `create_projects_table` | UUID PK, FK to workspaces |
| `project_members` | `create_project_members_table` | Composite PK (project_id, user_id) |
| `columns` | `create_board_columns_table` | Rename to avoid SQL reserved word conflict |
| `tasks` | `create_tasks_table` | CHAR(36) UUID PK, JSON custom_fields |
| `task_assignees` | `create_task_assignees_table` | Pivot table |
| `task_tags` | `create_task_tags_table` | UUID PK |
| `task_tag_map` | `create_task_tag_map_table` | Pivot table |
| `comments` | `create_comments_table` | Soft delete via `deleted_at` |
| `activity_log` | `create_activity_logs_table` | Append-only (enforce in model) |
| `checklist_items` | `create_checklist_items_table` | UUID PK |
| `file_attachments` | `create_file_attachments_table` | UUID PK |
| `webhook_configs` | `create_webhook_configs_table` | UUID PK |
| `webhook_event_log` | `create_webhook_event_logs_table` | UUID PK |
| `notifications` | `create_notifications_table` | Use Laravel's built-in notifications table |
| `notification_preferences` | `create_notification_preferences_table` | Composite PK |
| `saved_views` | `create_saved_views_table` | UUID PK, JSON filters/sort |
| `custom_field_definitions` | `create_custom_field_definitions_table` | UUID PK, JSON options |

#### Phase 3: Indexes & Constraints

Replicate all existing indexes (adapted for MySQL):
- [ ] Virtual generated column + index on `tasks.custom_fields` (MySQL JSON — use `JSON_EXTRACT()` with virtual columns for frequently queried paths, e.g., `ALTER TABLE tasks ADD COLUMN _job_id VARCHAR(255) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(custom_fields, '$._job_id'))) VIRTUAL, ADD INDEX idx_tasks_job_id (_job_id)`)
- [ ] Composite indexes: `tasks(column_id, position)`, `tasks(project_id)`
- [ ] `activity_log(task_id, created_at DESC)`
- [ ] `notifications(user_id, read, created_at DESC)`
- [ ] `comments(task_id, created_at)`
- [ ] UNIQUE on `board_columns(project_id, name)`
- [ ] Single `is_done` column constraint per project (application-level in Laravel)

> **MySQL vs PostgreSQL Note:** MySQL supports `JSON` columns natively (MySQL 8.0+) but does NOT support `JSONB` or `GIN` indexes. Use virtual generated columns with regular indexes for frequently queried JSON paths. For full JSON search, use `JSON_CONTAINS()`, `JSON_EXTRACT()`, and `JSON_SEARCH()` functions.

### 2.3 Eloquent Models & Relationships

```
User (was Agent)
├── hasMany: Profile, Job, Task (as creator), Comment, FileAttachment
├── belongsToMany: Project (via project_members), Task (via task_assignees)

Profile
├── belongsTo: User (agent)
├── hasMany: Job

Job
├── belongsTo: User (agent), Profile
├── hasOne: Task (via task_id)

Workspace
├── belongsTo: User (owner)
├── hasMany: Project

Project
├── belongsTo: Workspace
├── hasMany: BoardColumn, Task, TaskTag, WebhookConfig, CustomFieldDefinition, SavedView
├── belongsToMany: User (via project_members)

BoardColumn
├── belongsTo: Project
├── hasMany: Task

Task
├── belongsTo: Project, BoardColumn, User (creator)
├── belongsToMany: User (via task_assignees), TaskTag (via task_tag_map)
├── hasMany: Comment, ChecklistItem, FileAttachment, ActivityLog

Comment
├── belongsTo: Task, User (author), Comment (parent)
├── hasMany: Comment (replies)
├── uses SoftDeletes

TaskTag
├── belongsTo: Project
├── belongsToMany: Task (via task_tag_map)

CustomFieldDefinition
├── belongsTo: Project

SavedView
├── belongsTo: Project, User (owner)
```

### 2.4 Data Migration Strategy

**Option A (Recommended): Fresh start with data import script**

Since the app uses Vercel Postgres (Neon), create a Laravel Artisan command to:
1. Connect to the existing Neon PostgreSQL database (read-only, via `pgsql` secondary connection)
2. Import all data into the new MySQL database
3. Re-hash passwords from PBKDF2 to bcrypt (users must reset or use dual-hash check)
4. Convert PostgreSQL-specific types: `JSONB` → `JSON`, `UUID` → `CHAR(36)`, `TIMESTAMPTZ` → `TIMESTAMP`
5. Preserve UUIDs and foreign key relationships

**Option B: Direct database reuse — NOT AVAILABLE**

Since we are switching from PostgreSQL to MySQL, direct database reuse is not possible. Option A (fresh MySQL database + data import) is the only path.

**Password Migration (Critical):**
Current passwords use PBKDF2-SHA256 (`salt:hash` format). Options:
1. **Dual-hash login** — Check PBKDF2 first, if match → re-hash with bcrypt and update. Transparent to users.
2. **Force password reset** — Simpler but disrupts all agent users.

Recommendation: **Dual-hash login** via a custom Laravel `UserProvider`.

---

### 2.5 PostgreSQL → MySQL SQL Syntax Translation Guide

The current codebase (`data.ts` ~1700 lines, `task-data.ts` ~1400 lines) uses extensive PostgreSQL-specific SQL. These must be rewritten for MySQL or replaced with Eloquent. **This is a major effort — 90+ occurrences across 6 syntax categories.**

| PostgreSQL Syntax | Count | MySQL Equivalent | Example |
|-------------------|-------|-----------------|---------|
| `::type` type casts (e.g., `::uuid`, `::text`, `::timestamptz`, `::int`) | **90+** | `CAST(x AS type)` or Eloquent handles automatically | `$1::uuid` → `CAST(? AS CHAR(36))` or just `?` (MySQL bindings handle this) |
| `ILIKE` (case-insensitive LIKE) | **3** | `LIKE` (MySQL is case-insensitive by default with `utf8mb4_unicode_ci`) | `ILIKE '%' \|\| $1 \|\| '%'` → `LIKE CONCAT('%', ?, '%')` |
| `INTERVAL '...'` (quoted interval) | **6** | `INTERVAL N UNIT` (no quotes) | `INTERVAL '7 days'` → `INTERVAL 7 DAY` |
| `RETURNING *` / `RETURNING id` | **25+** | Not supported — use `LAST_INSERT_ID()` or separate `SELECT` after `INSERT/UPDATE`. Eloquent handles this automatically. | `INSERT ... RETURNING *` → `INSERT ...` then `SELECT * WHERE id = LAST_INSERT_ID()` |
| `COUNT(*) FILTER (WHERE ...)` | **1** | `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` | `COUNT(*) FILTER (WHERE is_checked)` → `SUM(CASE WHEN is_checked THEN 1 ELSE 0 END)` |
| `text[]` array type | **1** | `JSON` column (store as JSON array) | `skills::text[]` → `JSON` column with `JSON_ARRAY()` |

**Recommendation:** Use **Eloquent ORM** for the majority of queries (CRUD, filters, joins, pagination). This eliminates most syntax differences. Reserve raw SQL (`DB::select()`, `DB::statement()`) only for complex aggregation queries in the `StatsService` — and rewrite those using MySQL syntax.

> **Key MySQL string concatenation difference:** PostgreSQL uses `||` for string concatenation. MySQL uses `CONCAT()`. Example: `'%' || $1 || '%'` → `CONCAT('%', ?, '%')`.

---

## 3. Backend Migration Strategy

### Milestone 0: Laravel Project Setup & Infrastructure
> **Priority:** CRITICAL — foundation for everything else  
> **Estimated tasks:** 15

- [ ] **0.1** Initialize Laravel 12 project (`laravel new sales-dashboard-api`)
- [ ] **0.2** Configure MySQL connection in `.env` and `config/database.php`:
  - Set `DB_CONNECTION=mysql`
  - Set `charset=utf8mb4`, `collation=utf8mb4_unicode_ci`, `engine=InnoDB`
  - Set `strict=true` (recommended for data integrity)
  - Set `modes` array to include `STRICT_TRANS_TABLES`, `NO_ZERO_DATE`, `NO_ZERO_IN_DATE`, `ERROR_FOR_DIVISION_BY_ZERO`
- [ ] **0.3** Install required packages:
  - `laravel/sanctum` — API authentication
  - `laravel/socialite` — GitHub OAuth
  - `spatie/laravel-permission` — Role management (optional, or use Gates)
  - `spatie/laravel-webhook-client` — Inbound webhook processing
  - `google/apiclient` — Google Sheets integration
  - `intervention/image` — Image/thumbnail processing (for attachments)
  - `league/flysystem-aws-s3-v3` — S3 file storage
  - `spatie/laravel-activitylog` — Activity logging (optional, or custom)
- [ ] **0.3b** Configure secondary `pgsql` database connection in `config/database.php` for Neon data migration (temporary — remove after M7)
- [ ] **0.4** Set up CORS configuration (`config/cors.php`) — allow Next.js frontend origin
- [ ] **0.5** Configure Sanctum for SPA authentication (stateful domains, cookie settings)
- [ ] **0.6** Create base API controller with shared response helpers (`ApiController`)
- [ ] **0.7** Set up API versioning structure: `routes/api.php` → `api/v1/` prefix
- [ ] **0.8** Configure rate limiting (`RateLimiter` in `AppServiceProvider`)
- [ ] **0.9** Set up exception handling for consistent JSON error responses
- [ ] **0.10** Create base Form Request classes for validation
- [ ] **0.11** Set up `.env` with all required environment variables (see §1.5)
- [ ] **0.12** Configure logging (daily rotation + Slack channel for errors)
- [ ] **0.13** Set up queue connection (database or Redis) for async jobs
- [ ] **0.14** Create database seeders for default data (workspace, admin user, default project)
- [ ] **0.15** Set up PHPUnit configuration + base test case

---

### Milestone 1: Authentication & User Management
> **Priority:** CRITICAL — all other milestones depend on auth  
> **Estimated tasks:** 18

#### 1.1 Database Migrations
- [ ] Create `users` migration (combines current `agents` table + admin support):
  ```
  id (CHAR(36) UUID), name, email (unique), email_verified_at, password,
  avatar_url, role ENUM('admin','agent'), github_email, active TINYINT(1),
  legacy_password_hash (nullable TEXT, for PBKDF2 migration),
  remember_token, created_at, updated_at
  ```
  > MySQL note: Use `$table->uuid('id')->primary()` or `$table->char('id', 36)->primary()` with `Str::uuid()` in model. Set `charset=utf8mb4`, `collation=utf8mb4_unicode_ci`, `engine=InnoDB`.
- [ ] Create `personal_access_tokens` migration (Sanctum default)
- [ ] Seed admin user(s) from `ADMIN_CREDENTIALS` env var

#### 1.2 User Model & Auth
- [ ] Create `User` model with Sanctum traits (`HasApiTokens`, `Notifiable`)
- [ ] Implement custom `UserProvider` for dual-hash password verification:
  - Check bcrypt first
  - If fails, check PBKDF2 legacy hash → if match, re-hash to bcrypt + save
- [ ] Create `AuthController` with endpoints:
  - `POST /api/v1/auth/login` — Email/password login → Sanctum token
  - `POST /api/v1/auth/logout` — Revoke token
  - `GET /api/v1/auth/me` — Current user + role
  - `GET /api/v1/auth/github` — Redirect to GitHub OAuth
  - `GET /api/v1/auth/github/callback` — Handle OAuth callback → Sanctum token
- [ ] Implement `ALLOWED_EMAILS` check for GitHub OAuth (from env)
- [ ] Create `AdminMiddleware` — checks `role === 'admin'`
- [ ] Create `AgentMiddleware` — checks `role === 'agent'`
- [ ] Create `ProjectMemberMiddleware` — checks membership in `project_members`

#### 1.3 Agent CRUD API
- [ ] `GET /api/v1/agents` — List all agents (admin only)
- [ ] `POST /api/v1/agents` — Create agent (auto-generate password, return plain once)
  - Hash with bcrypt, NOT PBKDF2
- [ ] `PATCH /api/v1/agents/{id}/toggle-active` — Enable/disable agent
- [ ] `GET /api/v1/agents/{id}` — Agent detail with profiles

#### 1.4 Profile CRUD API
- [ ] `GET /api/v1/profiles` — List all profiles
- [ ] `POST /api/v1/profiles` — Create profile + auto-sync to n8n
- [ ] `PATCH /api/v1/profiles/{id}/toggle-active` — Enable/disable
- [ ] `PATCH /api/v1/profiles/{id}/agent` — Assign profile to agent
- [ ] `PUT /api/v1/agents/{id}/assign-profiles` — Bulk profile assignment
- [ ] `GET /api/v1/profiles/mapping` — Profile→agent mapping (for n8n, no auth, force no-cache)

**Laravel packages:**
- `laravel/sanctum` — Token auth + SPA cookies
- `laravel/socialite` — GitHub OAuth

---

### Milestone 2: Jobs & Analytics (Core Data)
> **Priority:** HIGH — this is the main dashboard data  
> **Estimated tasks:** 20

#### 2.1 Database Migrations
- [ ] Create `profiles` migration
- [ ] Create `jobs` migration (all columns from current schema including legacy `clickup_*` nullable)
- [ ] Create `sync_logs` migration
- [ ] Create `stats_cache` migration
- [ ] Create `alerts` migration

#### 2.2 Eloquent Models
- [ ] `Profile` model with `belongsTo(User)` and `hasMany(Job)` relationships
- [ ] `Job` model with `belongsTo(User)`, `belongsTo(Profile)` relationships
- [ ] `SyncLog` model
- [ ] `StatsCache` model with cache helper methods
- [ ] `Alert` model

#### 2.3 Jobs API
- [ ] `GET /api/v1/jobs` — Paginated list with filters:
  - Query params: `agent_id`, `profile_id`, `status`, `outcome`, `budget_type`, `search`, `start_date`, `end_date`, `sort_by`, `sort_dir`, `page`, `limit`
  - Returns: `{ data, total, page, limit, totalPages }`
- [ ] `GET /api/v1/jobs/{id}` — Job detail with agent_name, profile_name
- [ ] `GET /api/v1/jobs/search` — Quick search by title/ID (limit 50)
- [ ] `GET /api/v1/jobs/export` — Export jobs (admin only)
- [ ] `PATCH /api/v1/jobs/{id}/mark-sent` — Mark proposal as sent (`proposal_sent_at`)

#### 2.4 Stats API (with caching)
- [ ] Create `StatsService` with cache layer (5-min TTL using Laravel Cache):
  - `getKPIMetrics(range?, agentId?, profileId?)` — Total jobs, proposals, meetings, won, lost, win rate, revenue, bad leads, untouched
  - `getJobVolumeOverTime(range?)` — Daily volume trend
  - `getAgentStats(range?)` — Per-agent aggregated stats
  - `getTopAgentsByWinRate(limit, range?)` — Top performers
  - `getProfileStats(range?)` — Per-profile aggregated stats
  - `getTopProfilesByVolume(limit, range?)` — Top profiles
  - `getSystemHealth()` — Last sync, GPT failure rate, open jobs
  - `getAgentWinRateTrend(agentId, range?)` — Win rate over time for one agent
  - `getResponseTimeDistribution(range?)` — Time buckets
  - `getBudgetDistribution(range?)` — Budget ranges
  - `getSkillsAnalysis()` — Top skills
  - `getRevenueByAgent(range?)` — Revenue breakdown
  - `getRevenueByBudgetType(range?)` — Fixed vs hourly
- [ ] `GET /api/v1/stats/overview` — KPI metrics + top agents + top profiles
- [ ] `GET /api/v1/stats/agents` — Agent statistics
- [ ] `GET /api/v1/stats/profiles` — Profile statistics

#### 2.5 Settings API
- [ ] `GET /api/v1/settings/thresholds` — Get alert thresholds
- [ ] `POST /api/v1/settings/thresholds` — Update thresholds
- [ ] `GET /api/v1/alerts` — List alerts
- [ ] `POST /api/v1/alerts/{id}/dismiss` — Dismiss alert

**Laravel packages:**
- Built-in `Cache` facade with database/redis driver

---

### Milestone 3: Webhooks & External Integrations
> **Priority:** HIGH — data ingestion pipeline  
> **Estimated tasks:** 16

#### 3.1 n8n Inbound Webhook
- [ ] Create `N8nWebhookController`:
  - `POST /api/v1/webhooks/n8n` — Receive job data
  - HMAC-SHA256 signature verification (middleware)
  - Payload normalization (nested n8n format → flat)
  - Budget range parsing (`$1,000 - $3,000` → min/max)
  - Agent resolution by name
  - Profile resolution by filter tag or name
  - Outcome-to-status mapping:
    - `proposal_created` → "Proposal Ready"
    - `gpt_error` → "New"
    - `no_profile`, `rejected`, `weekend`, `inactive` → "N/A"
  - Skip non-job outcomes gracefully
  - Upsert job record
  - Bust stats cache
- [ ] Create `HmacVerificationMiddleware` for webhook routes
- [ ] Create `N8nWebhookJob` (queued) for async processing (optional)

#### 3.2 Task Inbound Webhook
- [ ] Create `TaskWebhookController`:
  - `POST /api/v1/webhooks/tasks` — Create task from external system
  - Bearer token auth (SHA256 hash against `webhook_configs`)
  - Idempotency key header (24h TTL)
  - Auto-assign agent from `_assigned_agent` custom field
  - Auto-set due date (24h) for n8n source
  - Auto-create tags (profile_name + "vollna-auto")
  - Map n8n custom fields to project field definitions
  - Fallback to default project

#### 3.3 Google Sheets Sync
- [ ] Create `SheetsService`:
  - `isSheetsConfigured()` — Check env vars
  - `fetchSheetRows()` — JWT auth, fetch from `job_log` sheet
  - `mapSheetRowToJobData(row)` — Parse row to job record
- [ ] Create `SheetsSyncController`:
  - `POST /api/v1/sync/sheets` — Trigger import (admin only)
- [ ] Create `SheetsSyncJob` (queued) for async processing
- [ ] Create `SyncLog` integration — track records synced/updated/errors

#### 3.4 n8n Outbound (Profile Provisioning)
- [ ] Create `N8nService`:
  - `syncProfileToN8n(profileName)` — Create webhook + respond nodes
  - `POST /api/v1/profiles/sync-n8n` — Trigger sync
- [ ] Use `Http::` facade for n8n API calls

#### 3.5 Slack Alerts
- [ ] Create `SlackAlertNotification` using Laravel Notifications:
  - Channel: Slack webhook
  - Alert types: `win_rate_low`, `gpt_failure_high`
- [ ] Create `AlertService`:
  - `checkThresholds()` — Evaluate alert conditions
  - `sendSlackAlert(alert)` — Send via notification

**Laravel packages:**
- `google/apiclient` — Google Sheets API
- `spatie/laravel-webhook-client` — Inbound webhook verification
- Laravel Notifications — Slack alerts (built-in)

---

### Milestone 4: Task Management — Core
> **Priority:** HIGH — Kanban board backend  
> **Estimated tasks:** 25

#### 4.1 Database Migrations
- [ ] Create `workspaces` migration (UUID PK)
- [ ] Create `projects` migration (UUID PK, FK to workspaces)
- [ ] Create `project_members` migration (composite PK)
- [ ] Create `board_columns` migration (UUID PK, position gap-based 1000)
- [ ] Create `tasks` migration (CHAR(36) UUID PK, JSON custom_fields)
- [ ] Create `task_assignees` migration (pivot)
- [ ] Create `task_tags` migration (UUID PK)
- [ ] Create `task_tag_map` migration (pivot)
- [ ] Create `comments` migration (soft delete)
- [ ] Create `activity_logs` migration (append-only enforced in model)
- [ ] Create `checklist_items` migration
- [ ] Create `file_attachments` migration
- [ ] Add virtual generated column indexes on frequently queried JSON paths in `tasks.custom_fields` (MySQL — replaces PostgreSQL GIN index)
- [ ] Add composite indexes on tasks, activity_logs, comments
- [ ] Seed default workspace + project + 14 columns + member assignments

#### 4.2 Eloquent Models
- [ ] `Workspace`, `Project`, `ProjectMember` models with relationships
- [ ] `BoardColumn` model with position ordering
- [ ] `Task` model with JSON cast for `custom_fields`, relationships to assignees/tags
- [ ] `Comment` model with `SoftDeletes`, parent/reply relationship
- [ ] `ActivityLog` model (read-only: override `save()`/`delete()` to prevent mutations)
- [ ] `ChecklistItem`, `FileAttachment`, `TaskTag` models

#### 4.3 Project (Board) API
- [ ] Create `ProjectController`:
  - `GET /api/v1/projects` — List boards (admin: all, agent: member-only)
  - `POST /api/v1/projects` — Create board (admin only) + 4 default columns
  - `GET /api/v1/projects/{id}` — Board detail
  - `PATCH /api/v1/projects/{id}` — Update name/description (admin only)
  - `DELETE /api/v1/projects/{id}?confirm=true` — Delete board (admin only, cascade)

#### 4.4 Column API
- [ ] Create `ColumnController`:
  - `GET /api/v1/projects/{id}/columns` — List with task counts
  - `POST /api/v1/projects/{id}/columns` — Create (admin, max 15)
  - `PATCH /api/v1/projects/{id}/columns/{cid}` — Update name/color/wip_limit
  - `DELETE /api/v1/projects/{id}/columns/{cid}` — Delete (blocked if has tasks, 409)
  - `POST /api/v1/projects/{id}/columns/reorder` — Reorder by ID array

#### 4.5 Task API
- [ ] Create `TaskController`:
  - `GET /api/v1/projects/{id}/tasks` — List with filters (column, assignee, priority, search, tag, date, sort)
  - `POST /api/v1/projects/{id}/tasks` — Create task (title, description, priority, due_date, assignees, tags, custom_fields)
  - `GET /api/v1/tasks/{id}` — Full detail (assignees, tags, checklist, custom fields, comment count, attachment count)
  - `PATCH /api/v1/tasks/{id}` — Update fields + activity log per changed field
  - `DELETE /api/v1/tasks/{id}` — Admin only
  - `POST /api/v1/tasks/{id}/move` — Move to column + position + sync job status

#### 4.6 Job-Task Status Sync
- [ ] Create `JobTaskSyncService`:
  - `syncJobStatusFromTask(taskId, newStatus, oldStatus)` — Update linked job's `status` column
  - `syncAllJobsInColumn(columnId, newStatus)` — Bulk sync when column renamed
  - Triggered from `moveTask` and `updateColumn` operations
- [ ] Status mapping: Column name → `jobs.status` value (exact match)

#### 4.7 Member Management API
- [ ] Create `ProjectMemberController`:
  - `GET /api/v1/projects/{id}/members` — List with role, name, email, avatar
  - `POST /api/v1/projects/{id}/members` — Add agents (admin only)
  - `PATCH /api/v1/projects/{id}/members/{agentId}` — Change role (block last admin demotion)
  - `DELETE /api/v1/projects/{id}/members/{agentId}` — Remove (block owner, unassign tasks if `?unassign=true`)
  - `GET /api/v1/projects/{id}/available-agents` — Active agents not yet on board

**Laravel packages:**
- Built-in Eloquent relationships and query scopes

---

### Milestone 5: Task Management — Extended Features
> **Priority:** MEDIUM — enhances task board UX  
> **Estimated tasks:** 18

#### 5.1 Comments API
- [ ] Create `CommentController`:
  - `GET /api/v1/tasks/{id}/comments` — List with author info, chronological
  - `POST /api/v1/tasks/{id}/comments` — Create (top-level or reply via `parent_id`)
  - `PATCH /api/v1/tasks/{id}/comments/{cid}` — Edit (author only, 60min window)
  - `DELETE /api/v1/tasks/{id}/comments/{cid}` — Soft delete (author 60min or admin)

#### 5.2 Activity Log API
- [ ] Create `ActivityLogController`:
  - `GET /api/v1/tasks/{id}/activity` — Append-only log, supports `?filter=comments`
- [ ] Create `ActivityLogService`:
  - `log(taskId, actorId, actionType, field?, oldValue?, newValue?, metadata?)` — Used by all mutations
- [ ] Integrate logging into all task/column/comment mutations (via Eloquent observers or explicit calls)

#### 5.3 Checklist API
- [ ] Create `ChecklistController`:
  - `POST /api/v1/tasks/{id}/checklist` — Add item
  - `PATCH /api/v1/tasks/{id}/checklist/{itemId}` — Toggle checked / rename
  - `DELETE /api/v1/tasks/{id}/checklist/{itemId}` — Delete item

#### 5.4 File Attachments API
- [ ] Create `AttachmentController`:
  - `POST /api/v1/tasks/{id}/attachments` — Upload file (S3 storage)
  - `DELETE /api/v1/tasks/{id}/attachments/{aid}` — Delete file + remove from storage
- [ ] Configure Laravel Storage with S3-compatible driver (e.g., AWS S3, MinIO, DigitalOcean Spaces)
- [ ] Create `FileUploadService` with thumbnail generation for images

#### 5.5 Tags API
- [ ] Create `TagController`:
  - `GET /api/v1/projects/{id}/tags` — List tags
  - `POST /api/v1/projects/{id}/tags` — Create tag
  - `PATCH /api/v1/projects/{id}/tags/{tid}` — Update tag
  - `DELETE /api/v1/projects/{id}/tags/{tid}` — Delete tag

#### 5.6 Custom Fields API
- [ ] Create `CustomFieldController`:
  - `GET /api/v1/projects/{id}/custom-fields` — List definitions (optional `?include_archived=true`)
  - `POST /api/v1/projects/{id}/custom-fields` — Create definition (admin only)
  - `PATCH /api/v1/projects/{id}/custom-fields/{fid}` — Update definition (admin only)
  - `DELETE /api/v1/projects/{id}/custom-fields/{fid}` — Archive (admin only, not hard delete)
  - `POST /api/v1/projects/{id}/custom-fields/{fid}/restore` — Restore archived
  - `POST /api/v1/projects/{id}/custom-fields/reorder` — Reorder by ID array

#### 5.7 Saved Views API
- [ ] Create `SavedViewController`:
  - `GET /api/v1/projects/{id}/saved-views` — List views
  - `POST /api/v1/projects/{id}/saved-views` — Create view (name, filters JSON, sort JSON)
  - `DELETE /api/v1/projects/{id}/saved-views/{vid}` — Delete view (admin only)

**Laravel packages:**
- `intervention/image` — Thumbnail generation
- `league/flysystem-aws-s3-v3` — S3 storage

---

### Milestone 6: Caching, Performance & Background Jobs
> **Priority:** MEDIUM  
> **Estimated tasks:** 10

- [ ] **6.1** Configure Laravel Cache (Redis recommended, or database driver)
  - Stats endpoints: 5-minute TTL cache
  - Cache tags for granular invalidation (`stats:overview`, `stats:agents`, etc.) — **Note: cache tags require Redis or Memcached; the `database` and `file` cache drivers do NOT support tags.** If using database driver, use explicit cache key prefixes + `Cache::forget()` instead.
  - Cache bust on job upsert, task move, sync complete
- [ ] **6.2** Create `CacheInvalidationService`:
  - Called from webhook handlers, sync jobs, and task mutations
  - Uses cache tags for selective invalidation
- [ ] **6.3** Set up Laravel Queues for async processing:
  - `ProcessN8nWebhookJob` — Handle n8n webhook payload
  - `SyncGoogleSheetsJob` — Batch import from Google Sheets
  - `SendSlackAlertJob` — Send Slack notifications
  - `SyncProfileToN8nJob` — Auto-provision n8n webhook nodes
- [ ] **6.4** Configure queue workers for production (Supervisor config)
- [ ] **6.5** Set up Laravel Task Scheduling:
  - Stats cache warming (every 5 min)
  - Alert threshold checks (every hour)
  - Stale idempotency key cleanup (daily)
- [ ] **6.6** Add database query optimization:
  - Eager loading for common includes (task → assignees, tags)
  - Query scopes on Eloquent models for common filters
  - Raw SQL for complex aggregation queries (stats) — Eloquent optional
- [ ] **6.7** API response pagination standardization
- [ ] **6.8** Implement API resource classes for consistent JSON output
- [ ] **6.9** Add request throttling per route group
- [ ] **6.10** Database connection pooling configuration (MySQL persistent connections via `'options' => [PDO::ATTR_PERSISTENT => true]` or ProxySQL if needed)

**Laravel packages:**
- Built-in Cache, Queue, Scheduler

---

### Milestone 7: Database Migration & Data Transfer
> **Priority:** CRITICAL (before go-live)  
> **Estimated tasks:** 8

- [ ] **7.1** Create `MigrateFromNeon` Artisan command:
  - Connects to existing Neon PostgreSQL database via secondary `pgsql` connection (read-only)
  - Reads from PostgreSQL, writes to MySQL
  - Converts data types: `JSONB` → `JSON`, `UUID` → `CHAR(36)`, `TIMESTAMPTZ` → `TIMESTAMP`, `BOOLEAN` → `TINYINT(1)`
  - Imports all tables in dependency order
  - Preserves UUIDs and foreign key relationships
- [ ] **7.2** Password migration logic:
  - Copy PBKDF2 hash to `legacy_password_hash` column
  - Generate placeholder bcrypt hash
  - Custom `UserProvider` checks bcrypt → PBKDF2 fallback → re-hash on success
- [ ] **7.3** Admin user creation:
  - Parse `ADMIN_CREDENTIALS` env var → create proper admin users in `users` table
  - Admins now have DB rows (unlike current system)
- [ ] **7.4** Job data migration:
  - Map `agent_id` → `user_id`
  - Preserve all fields including legacy `clickup_*` columns
  - Preserve `status` values (board column names)
- [ ] **7.5** Task management data migration:
  - Import workspaces, projects, members, columns, tasks, assignees, tags, comments, activity logs, checklist items, attachments, custom field definitions, saved views, webhook configs
  - Preserve all JSON data (custom_fields, filters, sort, metadata) — PostgreSQL JSONB → MySQL JSON (functionally equivalent)
- [ ] **7.6** File attachment migration:
  - Download from Vercel Blob → upload to new S3 storage
  - Update URLs in `file_attachments` table
- [ ] **7.7** Validation script:
  - Compare record counts between PostgreSQL source and MySQL target
  - Verify foreign key integrity
  - Spot-check JSON data (ensure JSONB→JSON conversion preserved all values)
  - Verify UUID columns are CHAR(36) with correct formatting
- [ ] **7.8** Rollback plan:
  - Keep Neon PostgreSQL database intact (read-only) as fallback data source
  - Environment variable toggle to switch frontend between old and new API
  - DNS/reverse proxy swap strategy

---

## 4. Frontend Integration

> **IMPORTANT: ZERO FRONTEND DESIGN CHANGES.** The migration is backend-only. All React components, pages, layouts, Tailwind styling, shadcn/ui components, Recharts charts, theme system, responsive design, and user experience remain exactly as they are today. The ONLY frontend changes are: (1) replacing direct DB calls with API client calls, (2) updating auth flow to use Sanctum, and (3) swapping `revalidatePath()` for `router.refresh()` / React Query. No visual, layout, or UX changes.

### 4.1 API Client Setup

The Next.js frontend currently uses server components with direct database access. After migration, it will consume the Laravel API via HTTP.

- [ ] Create `src/lib/api-client.ts` — Centralized API client:
  ```typescript
  // Base URL from env: NEXT_PUBLIC_API_URL
  // Auth token management (cookie or localStorage)
  // Request interceptors for auth headers
  // Response interceptors for 401 → redirect to login
  // Error handling with typed responses
  ```

- [ ] Create `src/lib/api/` directory with typed API modules:
  - `auth.ts` — Login, logout, me, GitHub OAuth
  - `agents.ts` — Agent CRUD
  - `profiles.ts` — Profile CRUD
  - `jobs.ts` — Job listing, search, export
  - `stats.ts` — KPI, agent stats, profile stats
  - `projects.ts` — Board CRUD, members, columns
  - `tasks.ts` — Task CRUD, move, comments, checklist, attachments
  - `settings.ts` — Thresholds, alerts
  - `webhooks.ts` — Webhook management
  - `sync.ts` — Google Sheets sync trigger

### 4.2 Authentication Flow Changes

| Current (Next.js) | New (Laravel) |
|-------------------|--------------|
| NextAuth session cookie | Sanctum SPA cookie (same-site) OR API token in `Authorization: Bearer` header |
| `getServerSession()` in server components | Server component → fetch with cookie forwarding |
| Server actions check `auth()` | API endpoints check Sanctum middleware |
| Middleware redirect (Next.js) | Next.js middleware checks auth cookie, redirects to login if missing |

- [ ] Update `src/middleware.ts` to check auth cookie/token instead of NextAuth session
- [ ] Create login page that calls Laravel `POST /api/v1/auth/login`
- [ ] Store auth token or rely on Sanctum SPA cookie
- [ ] Update all server components to fetch from API instead of direct DB queries
- [ ] Update all client components to use API client instead of server actions

### 4.3 Server Component → API Fetch Migration

Current server components call `data.ts` functions directly. They need to call the Laravel API instead.

**Pattern change:**
```typescript
// BEFORE (direct DB)
const kpiMetrics = await getKPIMetrics(dateRange, agentId, profileId);

// AFTER (API fetch)
const kpiMetrics = await api.stats.getOverview({ dateRange, agentId, profileId });
```

- [ ] Replace all `data.ts` imports in server components with API calls
- [ ] Replace all `task-data.ts` imports with API calls
- [ ] Replace all `actions.ts` server action calls with API POST/PATCH/DELETE calls
- [ ] Replace all `task-actions.ts` server action calls with API calls
- [ ] Update `revalidatePath()` calls → use `router.refresh()` or SWR/React Query revalidation

### 4.4 State Management Changes

- [ ] Keep Zustand board store for optimistic UI (drag-drop)
- [ ] Add API mutation functions that sync with the store
- [ ] Consider `@tanstack/react-query` (TanStack Query) for server state:
  - Auto-refetch on focus
  - Cache invalidation
  - Optimistic updates
  - Replace the current `<AutoRefresh>` polling component

### 4.5 File Upload Changes

- [ ] Update file upload to POST directly to Laravel API
- [ ] Handle presigned URLs if using S3 direct upload
- [ ] Update thumbnail/preview URLs to point to new storage

### 4.6 Environment Variables (Frontend)

```env
# New
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api/v1

# Keep
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# Remove (no longer needed on frontend)
POSTGRES_URL, POSTGRES_*, AUTH_SECRET, AUTH_GITHUB_*, 
GOOGLE_*, N8N_*, CRON_SECRET, SLACK_WEBHOOK_URL
```

---

## 5. Testing & QA

### 5.1 Laravel Unit Tests

- [ ] **Auth tests:**
  - Login with valid/invalid credentials
  - Login with PBKDF2 legacy password → auto-rehash to bcrypt
  - GitHub OAuth flow (mock Socialite)
  - Admin vs agent role assignment
  - Token generation and revocation
  - Protected route access (401/403)

- [ ] **Job tests:**
  - List with all filter combinations
  - Search by title/ID
  - Export (admin only, agent blocked)
  - Upsert (insert new, update existing)
  - Pagination edge cases

- [ ] **Stats tests:**
  - KPI calculation accuracy
  - Cache hit/miss behavior
  - Date range filtering
  - Agent-scoped stats vs global stats

- [ ] **Webhook tests:**
  - n8n webhook: valid HMAC, invalid HMAC, missing signature
  - n8n webhook: nested vs flat payload normalization
  - n8n webhook: all outcome types (proposal_created, gpt_error, no_profile, etc.)
  - n8n webhook: budget parsing edge cases
  - Task webhook: valid Bearer token, invalid token
  - Task webhook: idempotency key dedup
  - Task webhook: auto-assignment, auto-tagging

- [ ] **Task management tests:**
  - CRUD for projects, columns, tasks, comments, checklists
  - Task move + job status sync
  - Column reorder
  - Member add/remove/role-change
  - Custom field CRUD + archive/restore
  - Saved view CRUD
  - Activity log creation on all mutations
  - Comment soft delete + 60min edit window
  - Admin-only action enforcement
  - Project member access control

- [ ] **Integration tests:**
  - Google Sheets sync (mock Google API)
  - n8n profile sync (mock n8n API)
  - Slack alert notification (mock webhook)

### 5.2 Frontend Integration Tests

After each backend milestone:
- [ ] Verify all API endpoints return expected JSON structure
- [ ] Test auth flow end-to-end (login → protected page → logout)
- [ ] Test agent role scoping (agent can only see own data)
- [ ] Test admin access to all routes
- [ ] Test file upload/download
- [ ] Test webhook reception (n8n → Laravel → database → frontend refresh)

### 5.3 Regression Testing Checklist

Verify **feature parity** with the current system:

- [ ] **Dashboard:**
  - KPI cards show correct numbers
  - Charts render with correct data
  - Date range filter works
  - Agent/profile filter works (admin)
  - Auto-refresh updates data

- [ ] **Jobs page:**
  - Pagination works
  - All filters work (status, outcome, agent, profile, budget, search, date)
  - Sort by all columns
  - Export to CSV

- [ ] **Pipeline page:**
  - Correct grouping: Todo | In Progress | Meetings | Negotiation
  - Task counts per stage
  - Agent-scoped for agent role

- [ ] **Task Board:**
  - Board loads with columns and tasks
  - Drag-drop moves tasks between columns
  - Job status syncs on task move
  - Create/edit/delete tasks
  - Comments, checklists, attachments
  - Custom fields display and edit
  - Filter bar (search, column, priority, assignee)
  - Board switching (admin and agent)
  - Member management
  - Saved views

- [ ] **Agent pages:**
  - All `/my-*` pages show only agent's own data
  - Cannot access admin routes
  - Task board shows only assigned boards

- [ ] **Webhooks:**
  - n8n sends job → appears in dashboard + task board
  - Task webhook creates task with correct fields
  - HMAC verification works
  - Idempotency prevents duplicates

- [ ] **Settings:**
  - Agent CRUD
  - Profile CRUD + n8n auto-provision
  - Alert thresholds
  - Google Sheets sync trigger

### 5.4 Edge Cases to Test

- [ ] Admin with no `agents` row can still access everything
- [ ] Agent with multiple board memberships sees all assigned boards
- [ ] Agent removed from board → immediate 403 on next API call
- [ ] Last admin on board cannot be demoted
- [ ] Column with tasks cannot be deleted (409)
- [ ] Comment edit window (60 minutes) enforced
- [ ] Concurrent task moves (race condition on position)
- [ ] Large board (500+ tasks) performance
- [ ] JSON custom_fields with various types (text, number, dropdown, multi_select, date, boolean)
- [ ] File upload size limits
- [ ] Webhook payload with missing optional fields
- [ ] Budget parsing edge cases (`$0`, `$10,000+`, `<$100`, range formats)
- [ ] Date range filter with timezone differences
- [ ] Profile reassignment removes from previous agent
- [ ] Cascade delete board → all tasks, columns, tags, configs deleted

---

## 6. Deployment & Environment Setup

### 6.1 Development Environment

- [ ] **Laravel API:**
  - PHP 8.3+ with required extensions (pdo_mysql, mysqlnd, pdo_pgsql [for data migration only], mbstring, openssl, tokenizer, xml, ctype, json, bcmath)
  - Composer for dependency management
  - MySQL 8.0+ (local via Laragon — already available, or Docker)
  - Redis (optional, for cache/queues — can use database driver initially)
  - Laragon (user already has this — MySQL is bundled with Laragon)

- [ ] **Next.js Frontend:**
  - Keep existing setup
  - Add `NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1` in `.env.local`
  - CORS configured on Laravel to allow `localhost:3000`

### 6.2 Staging Environment

- [ ] Deploy Laravel API to staging server:
  - **Options:** Railway, Render, DigitalOcean App Platform, AWS Elastic Beanstalk, or a VPS with Forge
  - MySQL 8.0+ (managed) — PlanetScale, DigitalOcean Managed MySQL, AWS RDS, or self-hosted
  - Redis (managed) if using for cache/queues
  - S3-compatible storage for file attachments
  - Queue worker running (Supervisor or platform-native)
  - Laravel Scheduler running (`schedule:run` via cron)
  - Secondary `pgsql` connection to Neon for data migration (temporary, remove after migration)

- [ ] Deploy Next.js frontend to Vercel staging:
  - `NEXT_PUBLIC_API_URL` pointing to Laravel staging API
  - All DB-related env vars removed
  - **No changes to frontend design, components, or styling**

### 6.3 Production Environment

- [ ] **Laravel API hosting options:**
  - **Laravel Forge + DigitalOcean/AWS** (recommended for control — MySQL included)
  - **Laravel Vapor** (serverless on AWS Lambda + RDS MySQL — closest to current Vercel experience)
  - **Railway** (simple, auto-deploy from Git + MySQL add-on)
  - **Render** (auto-deploy, managed MySQL)

- [ ] **Production checklist:**
  - [ ] SSL certificate for API domain
  - [ ] `APP_ENV=production`, `APP_DEBUG=false`
  - [ ] Database connection pooling (MySQL persistent connections or ProxySQL)
  - [ ] Queue worker(s) running with Supervisor
  - [ ] Laravel Scheduler via cron (`* * * * * php artisan schedule:run`)
  - [ ] Log rotation configured
  - [ ] Error monitoring (Sentry/Bugsnag)
  - [ ] Backup strategy for database and file storage
  - [ ] Rate limiting on webhook endpoints
  - [ ] CORS restricted to production frontend domain only

### 6.4 CI/CD

- [ ] **Laravel API (GitHub Actions):**
  ```yaml
  on: push to main
  steps:
    - Checkout
    - Setup PHP 8.3 + MySQL
    - Composer install
    - Run PHPUnit tests
    - Run Laravel Pint (code style)
    - Run PHPStan (static analysis)
    - Deploy to staging (on push to develop)
    - Deploy to production (on push to main / manual trigger)
  ```

- [ ] **Next.js Frontend (Vercel):**
  - Keep existing Vercel Git push deploy
  - Update build environment to include `NEXT_PUBLIC_API_URL`
  - Remove all backend env vars from Vercel

### 6.5 Domain & Networking

```
Frontend:  dashboard.yourdomain.com  →  Vercel (Next.js)
API:       api.yourdomain.com        →  Laravel server
```

- [ ] Configure DNS for API subdomain
- [ ] Configure Sanctum `SANCTUM_STATEFUL_DOMAINS` for SPA auth
- [ ] Configure CORS (`config/cors.php`) for frontend domain
- [ ] If using Sanctum SPA cookies: both domains must share TLD for cookie access

---

## 7. Timeline & Milestones

### Execution Order (by priority)

| Phase | Milestone | Priority | Dependencies | Estimated Effort |
|-------|-----------|----------|-------------|-----------------|
| 1 | M0: Laravel Setup & Infrastructure | CRITICAL | None | 2-3 days |
| 2 | M1: Authentication & User Management | CRITICAL | M0 | 3-4 days |
| 3 | M7: Database Migration & Data Transfer | CRITICAL | M1 | 2-3 days |
| 4 | M2: Jobs & Analytics | HIGH | M1, M7 | 4-5 days |
| 5 | M3: Webhooks & External Integrations | HIGH | M2 | 3-4 days |
| 6 | M4: Task Management — Core | HIGH | M1, M7 | 5-6 days |
| 7 | M5: Task Management — Extended | MEDIUM | M4 | 3-4 days |
| 8 | M6: Caching, Performance & Background Jobs | MEDIUM | M2, M4 | 2-3 days |
| 9 | Frontend Integration | HIGH | M1-M5 (incremental) | 5-7 days |
| 10 | Testing & QA | HIGH | All | 3-5 days |
| 11 | Production Deployment | CRITICAL | All | 1-2 days |

**Total estimated effort: 33-46 working days (~7-9 weeks)**

### Checkpoints

| Week | Checkpoint | Deliverable |
|------|-----------|-------------|
| 1 | Laravel foundation + auth | Login/logout works, agent/admin roles enforced |
| 2 | Data migration + Jobs API | Dashboard data loads from Laravel API |
| 3 | Webhooks + integrations | n8n → Laravel → dashboard pipeline works |
| 4-5 | Task management API | Kanban board fully functional via API |
| 5-6 | Extended features + caching | Comments, attachments, custom fields, saved views |
| 6-7 | Frontend integration | All pages consuming Laravel API |
| 7-8 | Testing + regression | Full feature parity verified |
| 8-9 | Production deploy + cutover | Go live |

### Parallel Work Opportunities

Some work can happen in parallel:
- **Frontend API client setup** can start during M1 (auth)
- **Database migration scripts** (M7) can be built alongside M1-M2
- **CI/CD pipeline** can be set up during M0
- **Unit tests** should be written alongside each milestone, not deferred

---

## 8. Optional Improvements

### 8.1 Performance Improvements

| Improvement | Current | Proposed | Benefit |
|-------------|---------|----------|---------|
| Response caching | DB-based `stats_cache` table | Laravel Cache (Redis) with tags | Faster cache operations, tag-based invalidation |
| Queue processing | Synchronous webhook handling | Laravel Queues (Redis/database) | Non-blocking webhook processing, retry on failure |
| Database queries | Raw SQL everywhere | Eloquent with eager loading + raw SQL for aggregations | Cleaner code + N+1 prevention, raw SQL where performance matters |
| Connection pooling | Vercel serverless cold starts | MySQL persistent connections + ProxySQL | Faster DB access |
| API pagination | Custom implementation | Laravel API Resources + cursor pagination | Standardized, efficient for large datasets |

### 8.2 Security Enhancements

| Enhancement | Current | Proposed | Package |
|-------------|---------|----------|---------|
| Rate limiting | None on most routes | Per-route rate limits | Built-in `RateLimiter` |
| Input validation | Inline checks | Form Request classes with rules | Built-in |
| CSRF protection | NextAuth handles | Sanctum SPA CSRF token | `laravel/sanctum` |
| API throttling | None | Throttle middleware per IP | Built-in |
| SQL injection | Raw SQL with tagged templates | Eloquent parameterized queries | Built-in |
| Request logging | None | Middleware for audit trail | Custom or `spatie/laravel-activitylog` |
| Password policy | None | Validation rules on password fields | Built-in |

### 8.3 Laravel-Specific Replacements

| Current Next.js Pattern | Laravel Replacement | Benefit |
|-------------------------|-------------------|---------|
| `revalidatePath()` cache busting | Event-driven cache invalidation | More granular, no coupling to routes |
| `<AutoRefresh>` polling (5s/15s) | Laravel Echo + Pusher/Soketi (WebSockets) | Real-time updates instead of polling |
| Server actions (`"use server"`) | REST API endpoints with Form Requests | Proper validation, middleware, testing |
| `stats_cache` DB table | Laravel Cache (Redis or MySQL-backed) with TTL | Faster, built-in TTL management |
| PBKDF2 password hashing | bcrypt (Laravel default) | Industry standard, battle-tested |
| Manual HMAC verification | `spatie/laravel-webhook-client` | Signature verification, logging, retries |
| Manual activity logging | Model Observers + `ActivityLog` | Automatic change detection |
| Vercel Blob file storage | Laravel Storage (S3) | Provider-agnostic, presigned URLs |
| Vercel Cron | Laravel Task Scheduler | More flexible, testable, monitorable |

### 8.4 Architecture Improvements

- [ ] **Event-Driven Architecture:** Use Laravel Events + Listeners for:
  - Task moved → sync job status + bust cache + notify assignees
  - Job created → check alert thresholds + update stats
  - Profile created → auto-provision n8n webhook
  
- [ ] **Repository Pattern** (optional): Abstract database queries behind interfaces for testability

- [ ] **API Versioning:** `api/v1/` prefix allows future breaking changes without affecting existing clients

- [ ] **WebSocket Support:** With a dedicated Laravel server (not serverless), you can use Laravel Echo + Pusher/Soketi for real-time board updates instead of polling

- [ ] **Job Queues with Dead Letter:** Failed webhooks → retry queue → dead letter queue → admin notification

---

## 9. Assumptions & Blockers

### Assumptions

1. **Database switches from PostgreSQL to MySQL** — Laravel's MySQL support is its best-supported driver. MySQL 8.0+ provides JSON columns, CTEs, window functions, and UUIDs needed by this project. Laragon already bundles MySQL locally.
2. **Vercel Postgres (Neon) data will be migrated to MySQL** — A one-time data migration script will read from Neon PostgreSQL and write to the new MySQL database. The Neon connection is only needed during migration (secondary `pgsql` connection in `config/database.php`).
3. **n8n webhook URLs don't change** — The n8n workflow points to dashboard webhook URLs. These must be updated to point to the Laravel API.
4. **File storage will move from Vercel Blob to S3** — Vercel Blob is proprietary. Existing files need migration.
5. **Frontend stays on Vercel** — Only the API moves. Next.js continues deploying to Vercel.
6. **Admin users will be seeded** — Current admin auth via env var will become proper DB records.
7. **Dual-stack transition period** — Both Next.js backend and Laravel API may run simultaneously during migration. Frontend toggles via env var.

### Potential Blockers

| Blocker | Risk | Mitigation |
|---------|------|------------|
| **Password migration** | Users can't login if PBKDF2→bcrypt fails | Dual-hash `UserProvider` with fallback; test extensively |
| **n8n webhook URL change** | Data pipeline breaks during cutover | Update n8n workflow AFTER Laravel API is verified working; keep old endpoint as redirect |
| **Vercel Blob files** | Existing attachments inaccessible | Run migration script BEFORE cutover; verify all URLs |
| **PostgreSQL → MySQL data migration** | Data types differ (JSONB→JSON, TIMESTAMPTZ→TIMESTAMP, BOOLEAN→TINYINT) | Thorough type mapping in migration script; validate all JSON data post-migration |
| **MySQL JSON performance** | No GIN indexes; JSON queries slower than PostgreSQL JSONB | Use virtual generated columns with indexes for hot JSON paths; cache heavy queries |
| **CORS issues** | Frontend can't reach API | Test CORS config early (M0); use Sanctum SPA mode for same-site cookies |
| **Session/cookie domain** | Sanctum SPA auth fails cross-domain | Ensure frontend and API share TLD, or use API token auth instead |
| **Serverless → server** | Different performance profile | Load test with production data volume; monitor response times |
| **Complex raw SQL (90+ occurrences)** | PostgreSQL-specific syntax won't work in MySQL — see §2.5 for full audit | Rewrite: `::type` → `CAST()`, `ILIKE` → `LIKE`, `INTERVAL '5 min'` → `INTERVAL 5 MINUTE`, `RETURNING *` → separate SELECT, `FILTER (WHERE)` → `SUM(CASE WHEN)`, `text[]` → JSON array. Use Eloquent where possible to avoid raw SQL entirely |
| **Zero downtime cutover** | Data written to old system during migration | Run in parallel; use read replica or dual-write strategy |
| **Queue infrastructure** | Need Redis or database queue driver | Start with database driver; upgrade to Redis when needed |
| **Google Sheets API auth** | JWT credentials format differs | Test `google/apiclient` with same service account credentials |
| **MySQL strict mode** | Default MySQL 8.0 strict mode may reject some data | Ensure `STRICT_TRANS_TABLES` mode is handled in migration script; set appropriate SQL modes in `config/database.php` |

### Migration Sequence (Minimizing Downtime)

```
1. Deploy Laravel API alongside existing Next.js backend
2. Run data migration script (M7)
3. Switch frontend to Laravel API (env var toggle)
4. Update n8n webhook URLs to point to Laravel
5. Verify everything works
6. Decommission Next.js API routes
7. Remove backend code from Next.js (keep frontend only)
```

### What NOT to Change

- **Frontend design, layout, or styling** — All React components, Tailwind CSS, shadcn/ui, Recharts, page layouts, theme, responsive design, and UX remain exactly as-is. Only the data-fetching layer changes (direct DB → API calls). No visual changes whatsoever.
- **Board column names** — KPI calculations depend on exact status strings ("Proposal Submitted", "Won", "Lost", etc.)
- **n8n webhook payload format** — Keep the same nested format normalization
- **Task custom_fields JSON structure** — Frontend renders these directly (MySQL JSON is functionally equivalent to PostgreSQL JSONB for read/write)
- **UUID format** — Keep UUIDs as CHAR(36) for all task management entities (MySQL stores as string, not native UUID type)
- **Webhook token format** — Keep SHA256 Bearer token verification for backward compatibility
- **API response JSON structure** — Laravel API must return the same JSON shapes that the frontend currently expects from server components and server actions. No frontend refactoring needed beyond swapping data source.

---

## Appendix A: Laravel Route Map (Complete)

```
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
GET    /api/v1/auth/github
GET    /api/v1/auth/github/callback

GET    /api/v1/agents
POST   /api/v1/agents
GET    /api/v1/agents/{id}
PATCH  /api/v1/agents/{id}/toggle-active
PUT    /api/v1/agents/{id}/assign-profiles

GET    /api/v1/profiles
POST   /api/v1/profiles
PATCH  /api/v1/profiles/{id}/toggle-active
PATCH  /api/v1/profiles/{id}/agent
GET    /api/v1/profiles/mapping
POST   /api/v1/profiles/sync-n8n

GET    /api/v1/jobs
GET    /api/v1/jobs/search
GET    /api/v1/jobs/export
GET    /api/v1/jobs/{id}
PATCH  /api/v1/jobs/{id}/mark-sent

GET    /api/v1/stats/overview
GET    /api/v1/stats/agents
GET    /api/v1/stats/profiles

GET    /api/v1/settings/thresholds
POST   /api/v1/settings/thresholds
GET    /api/v1/alerts
POST   /api/v1/alerts/{id}/dismiss

POST   /api/v1/sync/sheets

POST   /api/v1/webhooks/n8n
POST   /api/v1/webhooks/tasks

GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/{id}
PATCH  /api/v1/projects/{id}
DELETE /api/v1/projects/{id}

GET    /api/v1/projects/{id}/columns
POST   /api/v1/projects/{id}/columns
PATCH  /api/v1/projects/{id}/columns/{cid}
DELETE /api/v1/projects/{id}/columns/{cid}
POST   /api/v1/projects/{id}/columns/reorder

GET    /api/v1/projects/{id}/tasks
POST   /api/v1/projects/{id}/tasks

GET    /api/v1/tasks/{id}
PATCH  /api/v1/tasks/{id}
DELETE /api/v1/tasks/{id}
POST   /api/v1/tasks/{id}/move

GET    /api/v1/tasks/{id}/comments
POST   /api/v1/tasks/{id}/comments
PATCH  /api/v1/tasks/{id}/comments/{cid}
DELETE /api/v1/tasks/{id}/comments/{cid}

GET    /api/v1/tasks/{id}/activity

POST   /api/v1/tasks/{id}/checklist
PATCH  /api/v1/tasks/{id}/checklist/{itemId}
DELETE /api/v1/tasks/{id}/checklist/{itemId}

POST   /api/v1/tasks/{id}/attachments
DELETE /api/v1/tasks/{id}/attachments/{aid}

GET    /api/v1/projects/{id}/members
POST   /api/v1/projects/{id}/members
PATCH  /api/v1/projects/{id}/members/{agentId}
DELETE /api/v1/projects/{id}/members/{agentId}
GET    /api/v1/projects/{id}/available-agents

GET    /api/v1/projects/{id}/tags
POST   /api/v1/projects/{id}/tags
PATCH  /api/v1/projects/{id}/tags/{tid}
DELETE /api/v1/projects/{id}/tags/{tid}

GET    /api/v1/projects/{id}/custom-fields
POST   /api/v1/projects/{id}/custom-fields
PATCH  /api/v1/projects/{id}/custom-fields/{fid}
DELETE /api/v1/projects/{id}/custom-fields/{fid}
POST   /api/v1/projects/{id}/custom-fields/{fid}/restore
POST   /api/v1/projects/{id}/custom-fields/reorder

GET    /api/v1/projects/{id}/saved-views
POST   /api/v1/projects/{id}/saved-views
DELETE /api/v1/projects/{id}/saved-views/{vid}
```

**Total: 62 API endpoints**

---

## Appendix B: Environment Variables (Laravel `.env`)

```env
# App
APP_NAME="Rising Lions API"
APP_ENV=production
APP_KEY=base64:...
APP_DEBUG=false
APP_URL=https://api.yourdomain.com

# Database (MySQL)
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=sales_dashboard
DB_USERNAME=your_user
DB_PASSWORD=your_password

# Legacy Database (for data migration only — remove after migration)
DB_LEGACY_CONNECTION=pgsql
DB_LEGACY_HOST=your-neon-postgres-host
DB_LEGACY_PORT=5432
DB_LEGACY_DATABASE=sales_dashboard
DB_LEGACY_USERNAME=your_neon_user
DB_LEGACY_PASSWORD=your_neon_password

# Auth
SANCTUM_STATEFUL_DOMAINS=dashboard.yourdomain.com,localhost:3000
SESSION_DOMAIN=.yourdomain.com
ADMIN_CREDENTIALS=admin@example.com:password_hash

# GitHub OAuth
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GITHUB_REDIRECT_URI=https://api.yourdomain.com/api/v1/auth/github/callback
ALLOWED_EMAILS=email1@x.com,email2@x.com

# Google Sheets
GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx@xxx.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
GOOGLE_SHEET_ID=xxx

# n8n
N8N_API_URL=https://ikonicdev.app.n8n.cloud
N8N_API_KEY=xxx
N8N_WORKFLOW_ID=EWnZg3svZWwcIRs4
N8N_WEBHOOK_SECRET=xxx

# Slack
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx

# Storage (S3-compatible)
FILESYSTEM_DISK=s3
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_DEFAULT_REGION=us-east-1
AWS_BUCKET=rising-lions-files

# Cache & Queue
CACHE_DRIVER=database  # or redis
QUEUE_CONNECTION=database  # or redis
SESSION_DRIVER=database

# CORS
CORS_ALLOWED_ORIGINS=https://dashboard.yourdomain.com

# Misc
CRON_SECRET=xxx
```

---

## Appendix C: Composer Packages

```json
{
    "require": {
        "php": "^8.3",
        "ext-pdo_mysql": "*",
        "laravel/framework": "^12.0",
        "laravel/sanctum": "^4.0",
        "laravel/socialite": "^5.0",
        "google/apiclient": "^2.0",
        "league/flysystem-aws-s3-v3": "^3.0",
        "intervention/image": "^3.0",
        "spatie/laravel-permission": "^6.0",
        "spatie/laravel-webhook-client": "^3.0"
    },
    "require-dev": {
        "phpunit/phpunit": "^11.0",
        "laravel/pint": "^1.0",
        "larastan/larastan": "^3.0",
        "mockery/mockery": "^1.6",
        "ext-pdo_pgsql": "*"
    }
}
```

> **Note:** `ext-pdo_pgsql` is only needed during data migration (M7) to connect to the Neon PostgreSQL source. It can be removed from `require-dev` after migration is complete.
