# QA Audit Report

## 1. Executive Summary
- Overall system health: Critical.
- Production readiness status: Not production-ready for untrusted users, public webhooks, or agent-scoped data access until the Critical and High items below are fixed.
- High-level risks:
  - Multiple API routes enforce authentication but miss object-level authorization, allowing agent users to read, update, move, or export data outside their scope.
  - Public operational endpoints fail open when secrets are missing, including the migration route and n8n ingestion route.
  - TypeScript and ESLint failures are currently hidden by production build settings, so broken code can deploy.
  - Task creation, movement, assignments, tags, comments, and webhook ingestion are not wrapped in transactions, creating partial-write and duplicate-data risks.
  - Deployment to Contabo runs directly from `main` with no CI quality gate and uses an HTTP-only production compose file.
- Immediate action items:
  - Disable or lock down `src/app/api/migrate/route.ts` before any public deployment.
  - Make all webhooks fail closed when secrets or matching webhook configuration are absent.
  - Add object-level authorization to task, attachment, and job APIs.
  - Remove `typescript.ignoreBuildErrors` from `next.config.ts` after fixing `tsc --noEmit`.
  - Fix the conditional hook errors in `src/components/tasks/board-column.tsx`.
  - Add CI checks for lint, type-check, and at least smoke/integration tests before deploy.

---

## 2. Critical Issues ( Must Fix)

### Critical - Migration API Fails Open When `CRON_SECRET` Is Missing
- Title: Public database migration endpoint can execute operational mutations.
- Description: `src/app/api/migrate/route.ts` only rejects requests when `CRON_SECRET` exists and the provided secret is wrong. If `CRON_SECRET` is unset, the route allows migration actions. It also accepts `secret` as a query parameter, which can leak through logs or browser history.
- Impact: Unauthenticated users can trigger schema/data migration paths, backfills, task migrations, cache changes, or other destructive operational code depending on the selected version. This can break production data integrity.
- Affected Area: `src/app/api/migrate/route.ts`.
- Suggested Fix: Fail closed when `CRON_SECRET` is missing in production, remove query-string secrets, require POST plus admin session or signed bearer auth, and move one-off migration execution out of public app routes.

### Critical - n8n Dashboard Webhook Accepts Unsigned Requests If Secret Is Empty
- Title: Public job ingestion can be spoofed.
- Description: `src/app/api/webhook/n8n/route.ts` only validates `x-n8n-signature` when `N8N_WEBHOOK_SECRET` is present. Project docs note the Contabo value has been left empty.
- Impact: Anyone who can reach the route can insert or update job data, poison analytics, create fake revenue/pipeline states, and flood logs.
- Affected Area: `src/app/api/webhook/n8n/route.ts`, `.env.server.example`, deployment environment.
- Suggested Fix: Require a non-empty secret in production, reject missing signatures, compare HMACs with `crypto.timingSafeEqual`, add rate limiting, and log rejected attempts without storing sensitive payloads.

### Critical - Task Webhook Accepts Any Bearer Token When No Config Matches
- Title: Inbound Task Board webhook has a dangerous default-project fallback.
- Description: `src/app/api/v1/webhooks/tasks/route.ts` hashes the bearer token and looks for an active `webhook_configs` match. If no config matches, it falls back to the default project instead of rejecting.
- Impact: Arbitrary external callers can create tasks, assign agents, set custom fields, and pollute the board if webhook config is missing or misconfigured.
- Affected Area: `src/app/api/v1/webhooks/tasks/route.ts`, `webhook_configs`.
- Suggested Fix: Reject unmatched tokens in all non-development environments. Require an explicit active webhook config, rotate current tokens, store token hashes with a strong keyed HMAC or bcrypt/argon2, and add request rate limits.

### Critical - Task APIs Have IDOR Authorization Gaps
- Title: Authenticated users can mutate or inspect tasks outside their board membership.
- Description: `GET /api/tasks/[id]` checks project membership, but `PATCH /api/tasks/[id]` does not. `PATCH /api/tasks/[id]/move` calls `moveTask()` with no membership check. `GET /api/tasks/[id]/attachments` lists attachments for any task ID to any authenticated user, and `DELETE` does not verify the attachment belongs to the URL task or that the user can access that task.
- Impact: Any authenticated agent who learns or guesses UUIDs can update tasks, move tasks across columns, view attachments, and in some cases delete attachments outside their authorized project.
- Affected Area: `src/app/api/tasks/[id]/route.ts`, `src/app/api/tasks/[id]/move/route.ts`, `src/app/api/tasks/[id]/attachments/route.ts`, `src/lib/task-data.ts`.
- Suggested Fix: Centralize `requireTaskAccess(taskId, session)` and enforce it before every read/write/delete. Verify target columns belong to the same project. Verify attachment `task_id` matches the route task ID. Add regression tests for cross-agent and cross-project access.

### Critical - Agent Job APIs Leak Cross-Agent Data
- Title: Agent users can access job records and exports without agent/profile scoping.
- Description: `src/app/api/jobs/[id]/route.ts`, `src/app/api/jobs/search/route.ts`, and `src/app/api/jobs/export/route.ts` require authentication but do not consistently restrict agents to their own assigned profiles/jobs. Export accepts an `agent` query parameter and can return broad CSV data.
- Impact: Agents can read or export job titles, client URLs, proposal text, revenue, profile names, and pipeline state for other agents.
- Affected Area: `src/app/api/jobs/[id]/route.ts`, `src/app/api/jobs/search/route.ts`, `src/app/api/jobs/export/route.ts`, `src/lib/data.ts`.
- Suggested Fix: Enforce role-aware filters server-side. Agents must be scoped by `session.user.agentId` and assigned profiles only. Ignore user-supplied `agent` filters for non-admin users. Add tests for agent A attempting to access agent B data.

### Critical - Build Pipeline Masks TypeScript Failures
- Title: Production build succeeds while type-check fails.
- Description: `next.config.ts` sets `typescript.ignoreBuildErrors: true`. Verified `npx tsc --noEmit` fails with many SQL row typing errors across `src/lib/data.ts`, `src/lib/task-data.ts`, `src/lib/db.ts`, `src/app/api/migrate/route.ts`, and webhook routes. `npm run build` succeeds because it skips type validation.
- Impact: Runtime-breaking type regressions can ship. Refactors are unsafe because CI/deploy cannot distinguish a valid build from a broken typed codebase.
- Affected Area: `next.config.ts`, `src/lib/data.ts`, `src/lib/task-data.ts`, `src/lib/db.ts`, API routes.
- Suggested Fix: Fix database helper typings and row mappers, remove `ignoreBuildErrors`, and add `npx tsc --noEmit` to CI before deploy.

### Critical - GitHub OAuth Can Grant Admin If `ALLOWED_EMAILS` Is Missing
- Title: Missing allowlist turns any GitHub login into an admin-capable session.
- Description: In `src/lib/auth.ts`, the GitHub `signIn` callback allows all GitHub users when `ALLOWED_EMAILS` is unset. The JWT callback maps users not found in the `agents` table to `role: "admin"`.
- Impact: A misconfigured production environment can allow arbitrary GitHub users to authenticate as admins.
- Affected Area: `src/lib/auth.ts`, production environment variables.
- Suggested Fix: Fail closed when `ALLOWED_EMAILS` is missing in production. Only assign admin to explicit admin identities. Add a startup/env validation check for auth-critical variables.

### Critical - React Hook Rule Violations in Task Board
- Title: Task board column component has conditional hook calls.
- Description: `npm run lint` reports conditional hook calls in `src/components/tasks/board-column.tsx` for `useDroppable`, `useBoardStore`, `useState`, `useRef`, and `useEffect`.
- Impact: Hook order violations can cause unstable rendering, broken drag/drop behavior, state corruption, and production-only UI failures.
- Affected Area: `src/components/tasks/board-column.tsx`.
- Suggested Fix: Move all hooks above conditional returns and branch only in rendered output. Add lint to CI and block deploys on `react-hooks/rules-of-hooks`.

### High - Secrets and Credentials Are Present in Documentation/Working Tree
- Title: Sensitive environment material is too exposed.
- Description: `docs/devops-sync-plan.md` contains a concrete Neon database URL pattern with credentials. Local `.env.local`, `.env.neon`, and `.env.docker` are present in the working tree. Tracked files include `.env.example`, `.env.docker.example`, `.env.server.example`, and `docs/devops-sync-plan.md`.
- Impact: Accidental credential reuse or commits can expose production database access and webhook secrets.
- Affected Area: `docs/devops-sync-plan.md`, root `.env*` handling, deployment documentation.
- Suggested Fix: Remove real credentials from docs, rotate any exposed secrets, add secret scanning, and keep only sanitized examples committed.

### High - Multi-Step Data Mutations Are Not Transactional
- Title: Task and project writes can partially succeed.
- Description: `createTask()`, `updateTask()`, `moveTask()`, `deleteProject()`, and webhook task creation perform multiple SQL statements without a transaction. Examples include task insert plus assignees, tags, and activity log; task move plus activity log; project delete plus activity-log cleanup.
- Impact: Failures or concurrent requests can leave tasks without expected assignees/tags/logs, activity logs without matching state, duplicated positions, or partially deleted project data.
- Affected Area: `src/lib/task-data.ts`, `src/app/api/v1/webhooks/tasks/route.ts`.
- Suggested Fix: Add a transaction helper in `src/lib/db.ts` and wrap all multi-row mutations. Use row locks or advisory locks for column position changes.

---

## 3. Security Audit 

### Authentication & Authorization
- Critical: `src/lib/auth.ts` fails open for GitHub OAuth when `ALLOWED_EMAILS` is missing, and unknown GitHub users are mapped to admin.
- High: Admin credentials are environment-based plaintext comparisons and there is no application-level login rate limiting or lockout.
- High: `requireAuth()` only verifies a session, not role or object ownership. Several APIs rely on it where role-aware or object-aware checks are required.
- Critical: Task routes have IDOR gaps in update, move, and attachments APIs.
- Critical: Job APIs expose cross-agent job and proposal data.
- Medium: The documented Task Board role model includes project admins, but many routes require global `session.user.role === "admin"` only. This creates authorization inconsistency and prevents least-privilege project administration.
- Medium: Saved view and board creation fallback to a first active agent when a system admin has no `agentId`, creating weak audit attribution.

### Common Vulnerabilities
- XSS: No `dangerouslySetInnerHTML` usage was found via code search. Risk remains because rich text descriptions/comments/proposal data are stored as text/HTML-like content and must be sanitized before any future HTML rendering.
- CSRF: Mutating API route handlers use cookie-backed sessions and do not enforce origin checks or CSRF tokens. Server actions have framework protections, but REST endpoints such as task mutation, project mutation, and settings mutation should still validate origin or use explicit CSRF protection.
- SQL Injection: Most SQL uses the tagged `sql` helper. Dynamic `sql.query()` usage in `src/lib/data.ts` and similar helpers must keep sort fields, metric names, and filter keys whitelisted. Current risk is medium, not obviously exploitable from the sampled code, but raw SQL volume is high.
- Insecure API endpoints: `src/app/api/migrate/route.ts`, `src/app/api/webhook/n8n/route.ts`, `src/app/api/v1/webhooks/tasks/route.ts`, job APIs, and task mutation APIs need immediate hardening.
- IDOR: Confirmed in task update/move/attachments and job detail/search/export APIs.
- File upload vulnerabilities: `src/app/api/tasks/[id]/attachments/route.ts` only checks size. It lacks MIME allowlist, extension blocklist, filename normalization, malware scanning, and attachment access checks on GET/DELETE.

### Secrets & Environment Variables
- High: `docs/devops-sync-plan.md` contains a concrete database credential example that should be treated as compromised if ever real.
- Critical: Auth and webhook secrets fail open or become unsafe when missing: `ALLOWED_EMAILS`, `N8N_WEBHOOK_SECRET`, and `CRON_SECRET`.
- Medium: `.env.local`, `.env.neon`, and `.env.docker` are present locally. They are not shown as tracked by `git ls-files`, but the repo should enforce `.gitignore` and secret scanning.
- Medium: `NEXT_PUBLIC_*` exposure should be audited before adding any API keys. No obvious public secret misuse was confirmed in the sampled files.

---

## 4. Backend (API Routes / Server Actions) ⚙️
- High: Input validation is ad hoc. Routes parse `request.json()` directly and use manual checks instead of shared schemas. Affected examples: task routes, project routes, settings thresholds, webhooks, profile sync.
- High: Invalid JSON is generally not handled; `request.json()` errors can produce 500s instead of controlled 400 responses.
- Critical: Public operational route `src/app/api/migrate/route.ts` should not exist in the deployed app surface.
- High: API and server action behavior diverges. The server action `moveTaskAction` performs dashboard sync, but `PATCH /api/tasks/[id]/move` calls `moveTask()` directly and bypasses job-status synchronization.
- Medium: Response formats are inconsistent: some routes return `{ error }`, others include `required_role`, `message`, raw details, or custom shapes.
- Medium: Error handling is uneven. Many handlers have no try/catch, while some expose internal messages, for example export and migration failures.
- Medium: No centralized rate limiting is present for login, webhooks, search, export, migration, or sync routes.
- Medium: `src/app/api/profiles/sync-n8n/route.ts` performs external workflow sync work inside a request lifecycle; timeout/retry/rollback behavior is not clearly bounded.
- Medium: Route coverage in middleware is incomplete by design for some APIs, but critical endpoints then need their own fail-closed checks. Several do not.

---

## 5. Database & Data Integrity ️
- High: Multi-step writes are not transactional in `src/lib/task-data.ts`.
- High: `tasks.column_id` references `columns(id)`, but there is no composite constraint enforcing that the column belongs to the same `project_id` as the task. A malicious or buggy caller can create cross-project task/column mismatches.
- High: `task_assignees` references `agents(id)` but does not enforce that assigned agents are project members.
- High: `task_tag_map` references tags but does not enforce tag/project consistency with the task project.
- High: Webhook idempotency is application-level only. `src/app/api/v1/webhooks/tasks/route.ts` checks `stats_cache` and existing tasks before insertion, then writes later. Concurrent retries can still duplicate tasks.
- Medium: `stats_cache` is overloaded for idempotency and dashboard/config caching. This makes cleanup and retention ambiguous.
- Medium: `webhook_event_log.payload` stores full inbound payloads, which may include client URLs, proposal text, and business data. Retention and redaction are missing.
- Medium: `ILIKE '%search%'` task/job search patterns will not use normal B-tree indexes. Add trigram indexes or full-text search for scale.
- Medium: Board pagination queries are improved with lateral counts, but `hydrateAssigneesAndTags(tasks)` should be profiled for N+1 behavior on large boards.
- Medium: Activity log deletion is now allowed for admins, but deleting `task_moved` entries changes dashboard KPI history. This is a business-data integrity risk unless deletion creates an audit tombstone.
- Low: Timezone-specific status logic uses America/New_York semantics in dashboard calculations; confirm this is an explicit reporting requirement for all users.

---

## 6. Frontend QA 

### UI/UX
- Critical: `src/components/tasks/board-column.tsx` violates React hook rules and can destabilize the board.
- High: The UI may imply task movement is authoritative everywhere, but the API move route bypasses job/dashboard sync. Users can see inconsistent dashboard data after API-based moves.
- Medium: Task Board polling every 5 seconds and dashboard polling every 15 seconds can cause visible stale states without a strong "last refreshed" or conflict indicator.
- Medium: Notification permission UI is partly incompatible with the current HTTP-only Contabo deployment because browser notification APIs require a secure context.
- Medium: Admin destructive flows such as activity deletion use basic confirmation patterns and should be reviewed for irreversible KPI impact.
- Medium: Some docs and guide text are stale, including references to removed active-hours behavior and historical ClickUp/Supabase/Prisma material.

### React/Next.js Issues
- Critical: Conditional hook calls in `board-column.tsx` must be fixed before production.
- High: `npm run lint` fails with React Compiler hook rules such as synchronous setState inside effects in `board-create-dialog.tsx`, `board-members-panel.tsx`, `notification-permission-banner.tsx`, `task-create-full.tsx`, and `theme-toggle.tsx`.
- Medium: Multiple components use `<img>` instead of Next Image, including task board/detail avatar rendering. This affects LCP and image optimization.
- Medium: Client components combine URL params, server-rendered props, Zustand state, and polling. This increases hydration/desynchronization risk unless covered by tests.
- Medium: `middleware.ts` is deprecated in Next.js 16 in favor of `proxy`; build emits a warning.

---

## 7. State Management 
- High: Board state is split across server-loaded page data, URL search params, and `src/lib/stores/board-store.ts`. Polling, drag-and-drop, and filter changes can race.
- High: Optimistic task movement plus background polling can overwrite local state if the server response is stale or another user moves the same task concurrently.
- Medium: Cache invalidation is inconsistent. Some server actions call `revalidatePath`, direct API routes do not always revalidate the same surfaces, and job/task status sync differs by entry point.
- Medium: `stats_cache` is used as both cache and idempotency storage, so cache invalidation could accidentally affect webhook duplicate protection.
- Medium: Agent-scoped board views include unassigned tasks by design. Confirm this is desired because unassigned tasks may expose board work to all members.

---

## 8. Business Logic Validation ⚙️
- Critical: Dashboard/job status can diverge from Task Board state because `PATCH /api/tasks/[id]/move` bypasses `syncJobStatusFromTask`.
- High: `src/app/api/webhook/n8n/route.ts` maps `proposal_created` to `"Proposal Ready"`, while current Task Board status conventions use columns such as `Todo` and `Proposal Submitted`. This stale status name can break reporting consistency.
- High: n8n writes job data and Task Board webhooks create tasks through separate endpoints. There is no confirmed reconciliation job ensuring a job and its task stay aligned after partial failures.
- High: Webhook task creation accepts `column_id`, assignees, tags, and custom fields without enough project-level validation.
- Medium: Cumulative funnel metrics intentionally count shortcuts such as `Won` as passing through intermediate stages. This must be documented in-product because users may interpret it as literal stage movement.
- Medium: Activity log entries are now mutable through admin deletion, while KPI history relies on first-entry movement logs. This is a business audit risk.
- Medium: Manual connect cards are not attributable after fallback removal. Reporting should explicitly separate attributable and unattributed connects.
- Medium: Agent job exports can be filtered by user-controlled query parameters, which breaks business privacy rules until scoped server-side.

---

## 9. Feature Completeness ✅
- High: There is no test suite or `test` script in `package.json`. Current validation depends on manual checks and build output.
- High: Notification infrastructure exists in schema/docs, but real-time delivery, secure-context support, and production browser behavior are not complete.
- High: Webhook outbound delivery is schema-planned but not fully implemented as a robust queued/retryable integration.
- Medium: Project-admin semantics are incomplete. APIs mostly use global admin checks, despite project membership roles.
- Medium: Saved views exist, but shared/private ownership semantics are weak for system admins without `agentId`.
- Medium: Virtualization, keyboard navigation hardening, mobile board polish, and rate-limit work are not completed.
- Medium: Several docs are stale or historical. `CLAUDE.md`, `docs/taskboard_prd.md`, and `docs/n8n_workflow_prd.md` are the most reliable context; older milestone/ClickUp/Supabase/Prisma references should be archived or marked obsolete.
- Low: Some unused imports and variables indicate dead or unfinished UI paths in task components.

---

## 10. Performance & Optimization 
- High: Lint currently scans `backend/vendor` and produces thousands of errors/warnings. ESLint needs an ignore configuration for vendor/build artifacts.
- High: Board polling every 5 seconds with background polling enabled can load the database heavily as task volume and user count grow.
- Medium: Dashboard polling every 15 seconds recalculates raw SQL metrics. Add caching policies, materialized summaries, or invalidation-based refresh for high-traffic use.
- Medium: Search uses `%term%` matching and should use trigram/full-text indexes.
- Medium: CSV export buffers up to 5000 jobs in memory and should stream for large exports.
- Medium: Several avatar/image render paths use `<img>` rather than optimized image components.
- Medium: No SWR/React Query cache layer is used for client data; polling and manual state updates are custom.
- Medium: Docker production app is limited to 512MB and 1 CPU in `docker-compose.server.yml`; current polling/raw SQL patterns may exceed this under concurrent users.

---

## 11. API & Integration Testing 
- Critical: Webhook authentication paths need integration tests for missing secret, wrong secret, unmatched token, replay, duplicate payload, and malformed JSON.
- High: n8n webhook handlers do not show robust timeout, retry, or dead-letter behavior. Failures are logged but not reliably recoverable.
- High: `src/app/api/v1/webhooks/tasks/route.ts` idempotency is race-prone and should be tested under concurrent identical requests.
- High: Job and task authorization requires negative tests for cross-agent and cross-project reads/writes.
- Medium: CSV export should test formula injection values beginning with `=`, `+`, `-`, or `@`.
- Medium: Google Sheets sync, n8n profile sync, Slack alerts, and external workflow sync need timeout and partial-failure tests.
- Medium: Health checks only hit `/api/health` by default; deploy uses `http://localhost/api/health` without `?db=true`, so it can pass while database access is degraded.

---

## 12. Error Handling & Logging ⚠️
- High: No centralized logging/observability is present. Errors are mostly `console.error` or ad hoc JSON responses.
- High: Webhook event logging stores full payloads. Redact proposal text, client URLs, tokens, and personally identifiable data before persistence.
- Medium: Many route handlers lack try/catch and return framework 500s for malformed JSON or unexpected database errors.
- Medium: Some errors expose internal details, including export failures and migration failures.
- Medium: Alerting falls back to console output when Slack is not configured; production operators may miss critical failures.
- Medium: There is no request correlation ID across webhook ingestion, task creation, job sync, and dashboard updates.

---

## 13. Edge Cases & Stress Testing 
- Critical: Concurrent task moves can produce stale positions or wrong activity history because no row locks or transaction boundaries protect moves.
- High: Concurrent webhook retries can duplicate tasks because idempotency is not enforced with a database unique constraint.
- High: Deleting or moving tasks while another user edits details can produce last-write-wins data loss.
- High: Large webhook bodies and malformed JSON are not bounded or consistently handled.
- High: HTTP-only production prevents secure-context browser features and weakens cookie/security assumptions.
- Medium: Empty board/project/member states have partial handling, but several admin fallbacks use "first active agent" and can fail or misattribute records.
- Medium: Network failures in n8n/profile sync paths can leave remote workflow state and local profile mappings inconsistent.
- Medium: Column renames can break status-based dashboard logic unless all KPI mappings are derived from stable IDs or a status mapping table.

---

## 14. Deployment & DevOps ⚙️
- Critical: `.github/workflows/deploy-contabo.yml` deploys directly from `main` over SSH with no lint, type-check, test, migration dry-run, or security scan gate.
- Critical: `next.config.ts` skips TypeScript validation during production builds.
- High: `docker-compose.server.yml` is explicitly HTTP-only, publishes Next.js directly on port 80, and has no nginx/security headers/TLS layer.
- High: Deploy script performs `git reset --hard origin/main` on the server. That may be operationally acceptable for immutable deploys, but it can destroy emergency hotfixes or uncommitted server changes.
- Medium: `/api/health` does not check database unless `?db=true`; deploy should use the DB check.
- Medium: No CI artifact promotion or rollback strategy is documented beyond rebuilding on server.
- Medium: No secret scanning, dependency vulnerability scan, or SBOM generation is configured.
- Medium: Build emits a Next.js warning that `middleware` convention is deprecated and should be migrated to `proxy`.

---

## 15. Code Quality & Maintainability 
- High: `src/lib/data.ts` and `src/lib/task-data.ts` are very large raw-SQL modules with many responsibilities. This increases regression risk.
- High: `src/app/api/migrate/route.ts` contains a large amount of operational migration code inside the runtime web app.
- High: TypeScript row typing is not reliable; many SQL results are treated as `unknown` or cast into domain types.
- Medium: Authorization logic is duplicated across routes instead of centralized in reusable guards.
- Medium: Validation logic is duplicated and inconsistent. Add shared Zod schemas for route inputs and webhook payloads.
- Medium: Naming is inconsistent across statuses and docs: `Todo`, `To Do`, `Proposal Ready`, and `Proposal Submitted` all appear in related contexts.
- Medium: Documentation has strong historical value but needs a current/archived split so operators do not follow outdated deployment or integration assumptions.
- Medium: ESLint is not scoped correctly and scans `backend/vendor`, causing noisy failures that hide real app issues.

---

## 16. Recommendations & Improvements 
- Security hardening:
  - Fail closed for `CRON_SECRET`, `N8N_WEBHOOK_SECRET`, `ALLOWED_EMAILS`, and webhook token configuration.
  - Centralize route guards: `requireAdmin`, `requireAgent`, `requireProjectMember`, `requireTaskAccess`, and `requireJobAccess`.
  - Add rate limiting to login, webhooks, search, export, sync, and migration/admin endpoints.
  - Enforce CSRF/origin checks on cookie-authenticated mutating API routes.
  - Add MIME allowlisting and malware scanning for attachments.
- Architecture improvements:
  - Move migrations and one-off backfills out of public API routes.
  - Create a service layer for task movement that always updates activity logs, job status, cache invalidation, and dashboard revalidation consistently.
  - Add transaction support in `src/lib/db.ts` and use it for all multi-step writes.
  - Replace status-name coupling with stable column/status IDs or a mapping table.
- Quality gates:
  - Fix `npx tsc --noEmit`, remove `typescript.ignoreBuildErrors`, and make type-check required in CI.
  - Fix `npm run lint`, add ESLint ignores for `backend/vendor`, and block deploys on hook-rule violations.
  - Add integration tests for authorization boundaries and webhook ingestion before feature work continues.
- Data integrity:
  - Add project-consistency constraints or triggers for task columns, assignees, tags, saved views, and custom fields.
  - Add unique constraints or advisory-lock based idempotency for webhook-created tasks.
  - Add retention/redaction policy for `webhook_event_log`.
- Performance:
  - Add indexes for search and dashboard reporting paths.
  - Rework polling into invalidation/SSE where practical, or at least make polling adaptive to tab visibility and active board usage.
  - Stream CSV exports and guard against formula injection.
- Deployment:
  - Put the Contabo deployment behind HTTPS and a reverse proxy with security headers.
  - Use `/api/health?db=true` in deploy checks.
  - Add rollback documentation and stop deploying untested `main` directly to production.

