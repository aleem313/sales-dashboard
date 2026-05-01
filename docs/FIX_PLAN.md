# QA Fix Implementation Plan

> **Document goal:** translate the findings in `docs/QA.md` into a safe, phased, non-breaking remediation plan that can be executed against the live Contabo production system without breaking existing user flows, dashboard KPIs, n8n ingestion, or the Task Board.
>
> **Authoring stance:** production engineer, not refactor enthusiast. "Wrap and extend" beats "rewrite." Every change is reversible, additive where possible, and gated by either env, role, or feature flag where real risk exists.
>
> **Live system context (as of 2026-05-01):**
> - Contabo (`http://157.173.110.62`) is the only live deployment. Vercel is decommissioned.
> - `main` deploys directly to production via `.github/workflows/deploy-contabo.yml`.
> - n8n production workflow `EWnZg3svZWwcIRs4` writes to `/api/v1/webhooks/tasks` and `/api/webhook/n8n` — these endpoints are LOAD-BEARING for revenue and must not regress.
> - There is no test suite. All verification is manual + observational.

---

## 1. Strategy Overview

### Overall approach
- **Incremental and isolated.** Each fix is a small, reviewable change that touches as few files as possible. No "big-bang" refactors of `src/lib/data.ts` or `src/lib/task-data.ts`.
- **Wrap, don't rewrite.** New auth guards, transaction helpers, validators, and signature checks are introduced as **additive helpers** alongside existing code, then progressively adopted route-by-route. Old behavior remains until the new path is proven.
- **Fail closed at boundaries, fail open internally.** Public webhook/migration routes get their security tightened first; internal helpers stay permissive so callers don't break mid-deploy.
- **Backward-compatible API contracts.** No route changes its response shape. New fields are additive. New error codes are introduced only when the existing code path was already failing.
- **Zero schema-breaking migrations.** Every new column is nullable / has a default. No drops, no renames, no type narrowing on hot tables (`tasks`, `jobs`, `agents`, `activity_log`). Constraints are added as `NOT VALID` first, validated separately.

### How we avoid breaking changes
1. **Feature flags via env vars** — `STRICT_AUTH_MODE`, `STRICT_WEBHOOK_MODE`, `ENFORCE_TASK_AUTHZ` — default to `off` in this PR, switched to `on` after monitoring shows zero false-positive rejections.
2. **Shadow logging before enforcement** — every new auth/signature/validation check first logs "would have rejected" for ~24–72h before flipping to actually reject. Metric: % of legitimate traffic that would be rejected. Goal: <0.1% before flipping.
3. **Tightening per-route, not globally** — adopt new guards one route at a time so a regression is scoped to one endpoint, not the whole API surface.
4. **Idempotent migrations** — every migration uses `IF NOT EXISTS` / `IF EXISTS` and is safe to re-run.
5. **Type fixes are additive** — fix typings module-by-module, keep `ignoreBuildErrors: true` until `tsc --noEmit` is clean across the whole repo, then flip the switch in one PR.

### Deployment strategy
- **Branching:** create one branch per phase (`fix/phase-1-security`, `fix/phase-2-validation`, etc.), each with several small commits.
- **Pre-deploy local check:** `npm run build` + `npx tsc --noEmit` (with current state — must not get *worse*).
- **Phased rollout (single-environment caveat):** there is no staging. Mitigation:
  - Deploy each phase off-hours (early-morning ET, before agent shifts).
  - Deploy Phase 1 (security) one fix at a time, watch logs for 30 min between deploys.
  - Keep `STRICT_*` flags off on first deploy of each phase. Flip on next-day after observing the shadow logs.
- **Rollback plan baked into every phase:** all flags can be flipped off via env without redeploy (env reload + `docker compose restart app`).

---

## 2. Fix Prioritization

### Phase 1 — Critical (Immediate, Safe Security Fixes)
**Goal:** close the cross-tenant data exposure and unauthenticated mutation surface without breaking n8n ingestion or admin flows.

1. Lock down `/api/migrate` (Critical §2.1)
2. n8n dashboard webhook: enforce `N8N_WEBHOOK_SECRET` (Critical §2.2)
3. Task ingestion webhook: reject unmatched bearer tokens (Critical §2.3)
4. GitHub OAuth: fail closed when `ALLOWED_EMAILS` missing; remove unknown→admin mapping (Critical §2.7)
5. Fix React hook-rule violation in `board-column.tsx` (Critical §2.8)
6. Remove leaked credential pattern from `docs/devops-sync-plan.md`; rotate (High §2.9)

### Phase 2 — High Priority (Low-Risk Auth + Integrity)
**Goal:** plug IDOR holes, add transaction wrappers, fix the dashboard/board status divergence.

7. Centralized auth guards: `requireTaskAccess`, `requireJobAccess`, `requireProjectMember` (Critical §2.4 + 2.5)
8. Apply guards to task GET/PATCH/DELETE/move/attachments (Critical §2.4)
9. Apply guards to job detail/search/export (Critical §2.5)
10. Transaction helper + wrap `createTask`/`updateTask`/`moveTask`/`deleteProject`/webhook task creation (High §2.10)
11. `PATCH /api/tasks/[id]/move` calls `syncJobStatusFromTask` (High §8 §6 — fixes board/dashboard divergence)
12. Other React Compiler hook-rule warnings (High §6 React)
13. Webhook idempotency: add unique partial index for `(_job_id)` to prevent duplicate task rows (High §5)

### Phase 3 — Medium Priority (Validation, Build, Performance)
**Goal:** raise quality gates, validate inputs, improve observability.

14. Shared Zod validation schemas for route bodies + webhook payloads (High §4)
15. Try/catch + 400 for malformed JSON across mutating routes (Medium §4)
16. Type-fix `src/lib/data.ts`, `task-data.ts`, `db.ts`, route handlers; remove `typescript.ignoreBuildErrors` (Critical §2.6)
17. CI workflow: lint + type-check + smoke deploy gate (Critical §14)
18. ESLint ignore for `backend/vendor` (High §10)
19. Rate limiting (login, webhooks, search, export, sync, migrate) (Medium §3 §4)
20. CSV export streaming + formula-injection guard (Medium §10 §11)
21. Attachments: MIME allowlist, filename normalization, GET/DELETE access checks (Medium §3)
22. CSRF/origin verification for cookie-authed mutating routes (Medium §3)
23. Webhook event log redaction (Medium §5 §12)
24. Centralized logger + request correlation IDs (High §12)
25. Dashboard `?db=true` health check + nginx/TLS in front of Contabo (High §14)

### Phase 4 — Low Priority / Polish
**Goal:** safe code quality wins, doc hygiene, perf nice-to-haves.

26. Replace `<img>` with `next/image` where safe (Medium §6)
27. Trigram/full-text search indexes for `ILIKE '%term%'` (Medium §10)
28. Migrate `middleware.ts` → `proxy.ts` per Next.js 16 (Medium §6)
29. Project-consistency CHECK constraints (NOT VALID first) for tasks/columns/assignees/tags (High §5)
30. Activity-log tombstone instead of hard delete for `task_moved` (Medium §5 §8)
31. Documentation reorganization: archive obsolete docs, mark current vs historical (Medium §15)
32. Saved-view ownership semantics for system admins without `agentId` (Medium §3 §9)

---

## 3. Detailed Fix Plan

### Issue: Migration API fails open when `CRON_SECRET` is missing

- **Source:** QA.md §2 Critical (Migration API Fails Open)
- **Risk Level:** Critical

#### Problem Summary
`src/app/api/migrate/route.ts` only rejects when `CRON_SECRET` is set AND mismatched. If unset, anyone can trigger destructive migrations. Secret is also accepted via query string.

#### Safe Fix Strategy
**Additive guard, fail-closed in production.** Do not move migration code yet (Phase 4). First, just block public access.

Steps:
- Require `CRON_SECRET` to be present AND match. If `process.env.CRON_SECRET` is empty/undefined, return 503 in `NODE_ENV === 'production'`.
- Accept secret only from `Authorization: Bearer <CRON_SECRET>` header. Keep query-string acceptance as a deprecated fallback for one release, but log a `DEPRECATED_QUERY_SECRET` warning when used.
- Add `STRICT_MIGRATION_AUTH=true` env to flip query-string acceptance off entirely; default `false` for now to avoid breaking any operator habit.

#### Implementation Steps
1. Edit `src/app/api/migrate/route.ts`: at top of handler, add:
   ```ts
   const cronSecret = process.env.CRON_SECRET?.trim();
   if (!cronSecret) {
     if (process.env.NODE_ENV === 'production') {
       return Response.json({ error: 'migration disabled: CRON_SECRET missing' }, { status: 503 });
     }
   }
   ```
2. Replace existing query-string check with header-first, query-string fallback (logged).
3. Add a one-line note to `CLAUDE.md` "Migration Execution" section that header auth is now preferred.
4. Verify the migration cron call still works by hitting `/api/migrate?v=016` with a `Authorization: Bearer ...` header from the local machine.

#### Risk Assessment
- **Could break:** scripted migration calls that rely on query-string secret. Mitigation: query-string fallback retained for one release.
- **Why safe:** in production today the secret is set (we just verified migration 016 ran). The 503 path only fires if the env var is missing — i.e. an already-broken deploy.

#### Testing Plan
- **Manual:**
  - Hit `/api/migrate?v=016&secret=<correct>` — must still 200 (deprecation warning logged).
  - Hit with `Authorization: Bearer <correct>` — must 200.
  - Hit with no secret — must 401.
  - Temporarily unset `CRON_SECRET` in a local `.env`, restart, hit endpoint — must 503.
- **Verify:** check `docker logs sales-dashboard-app` for `DEPRECATED_QUERY_SECRET` line on legacy call.

#### Rollback Plan
Revert single file edit. No data changes.

---

### Issue: n8n dashboard webhook accepts unsigned requests when secret empty

- **Source:** QA.md §2 Critical (n8n Dashboard Webhook)
- **Risk Level:** Critical

#### Problem Summary
`src/app/api/webhook/n8n/route.ts` only verifies `x-n8n-signature` if `N8N_WEBHOOK_SECRET` is set. The Contabo `.env.production` has historically left this empty. Any unauthenticated caller can spoof job ingestion and corrupt revenue/pipeline data.

#### Safe Fix Strategy
**Two-step rollout to avoid breaking n8n.**

Step A (this PR): Add a `WEBHOOK_SHADOW_MODE=true` mode that **logs** would-be rejections without rejecting. Run for 48h.
Step B (next PR): Flip `WEBHOOK_SHADOW_MODE=false` so missing/invalid signatures actually reject in production.

Concurrently: provision `N8N_WEBHOOK_SECRET` in Contabo `.env.production`, mirror in n8n HTTP Request node header. Confirm it's set before flipping.

#### Implementation Steps
1. Generate a 32-byte random secret. Add to Contabo `.env.production` as `N8N_WEBHOOK_SECRET=<hex>`.
2. Update n8n `Send to Self-Hosted Dashboard` HTTP node to send `x-n8n-signature: <hmac-sha256(body, secret)>`. Test by triggering a manual run; verify dashboard shadow-logs `signature_valid=true`.
3. In `src/app/api/webhook/n8n/route.ts`:
   - Always compute expected signature.
   - Compare with `crypto.timingSafeEqual`.
   - Branch: if `process.env.WEBHOOK_SHADOW_MODE === 'true'`, log mismatch to `webhook_event_log` with `meta: { shadow_rejection: true, reason }` and continue to existing flow.
   - Else: reject with 401.
4. Reject when secret is missing in production (regardless of shadow mode), since that means a misconfig.
5. After 48h of zero `shadow_rejection: true` events from legitimate n8n traffic, set `WEBHOOK_SHADOW_MODE=false`.

#### Risk Assessment
- **Could break:** n8n traffic if HMAC computation in n8n disagrees with our verification (e.g. trailing newline, charset mismatch). Mitigation: shadow mode catches this without dropping events.
- **Why safe:** the existing flow continues to run; we only *add* rejection after a soak window proves no false positives.

#### Testing Plan
- **Manual:** trigger n8n test webhook, verify `signature_valid=true` in `webhook_event_log`.
- **Negative:** curl the endpoint with no signature, verify 401 once shadow mode off.
- **Replay:** verify timing-safe comparison by sending one wrong-byte signature.
- **Edge:** body with unicode characters, ensure HMAC matches.

#### Rollback Plan
Set `WEBHOOK_SHADOW_MODE=true` and reload env (`docker compose --env-file .env.production restart app`). Investigation log in `webhook_event_log`.

---

### Issue: Task webhook accepts any bearer token when no config matches

- **Source:** QA.md §2 Critical (Task Webhook Accepts Any Bearer)
- **Risk Level:** Critical

#### Problem Summary
`src/app/api/v1/webhooks/tasks/route.ts` looks up `webhook_configs` by hashed token. On no-match it falls back to the default project. Any bearer with any token can create tasks.

#### Safe Fix Strategy
**Same shadow → enforce pattern** as n8n webhook. Production currently uses token `n8n-board-sync` with a matching `webhook_configs` row, so the strict path will not break n8n if the row is intact.

#### Implementation Steps
1. Verify `webhook_configs` has an active row matching the production bearer token hash:
   ```sql
   SELECT id, name, target_project_id, is_active FROM webhook_configs WHERE is_active = true;
   ```
   If missing → insert before any code change (else fix breaks ingestion).
2. Edit route handler: when no matching config found, branch on `WEBHOOK_SHADOW_MODE`:
   - Shadow: log `unmatched_token=true` in `webhook_event_log`, continue with default project.
   - Strict (`NODE_ENV=production && !WEBHOOK_SHADOW_MODE`): return 401.
3. After 48h shadow soak, flip strict mode in production.
4. Document token rotation procedure in `docs/devops-sync-plan.md` (admin-only doc — sanitize first per fix below).

#### Risk Assessment
- **Could break:** n8n if `webhook_configs` row is missing or token mismatched. Mitigation: pre-flight verification step + shadow mode.
- **Why safe:** strict mode only flips after observed traffic shows 100% match rate.

#### Testing Plan
- **Manual:** trigger n8n "Create Board Task - Self-Hosted" with a test job; verify task appears, no shadow rejection logged.
- **Negative:** curl with random bearer; verify 401 (after strict flip).
- **Concurrent:** see Phase 2 idempotency fix (separate issue).

#### Rollback Plan
Toggle `WEBHOOK_SHADOW_MODE=true` via env reload.

---

### Issue: Task APIs IDOR — update/move/attachments not membership-checked

- **Source:** QA.md §2 Critical (Task APIs IDOR)
- **Risk Level:** Critical

#### Problem Summary
- `PATCH /api/tasks/[id]` does not check project membership.
- `PATCH /api/tasks/[id]/move` calls `moveTask()` directly with no membership check.
- `GET /api/tasks/[id]/attachments` exposes attachments to any authenticated user.
- `DELETE` does not validate that the attachment belongs to the URL task.

#### Safe Fix Strategy
**Additive helper, then route-by-route adoption with `ENFORCE_TASK_AUTHZ` flag.**

Step A: ship the helper.
Step B: adopt in routes behind `ENFORCE_TASK_AUTHZ=true`. Default off, shadow-log denials.
Step C: flip on after verifying logs show no legitimate-user denials.

#### Implementation Steps
1. Create `src/lib/auth-guards.ts` (new file). Export:
   ```ts
   export async function requireTaskAccess(taskId: string, session: Session, mode: 'read'|'write'|'delete')
     : Promise<{ allowed: boolean; reason?: string; task?: Task }>
   ```
   Logic:
   - Admin → allowed.
   - Otherwise: load task → load project → check `project_members` for `session.user.agentId`. Map `mode` → role minimums (`read` = member, `write` = member, `delete` = project_admin or global admin).
2. In `src/app/api/tasks/[id]/route.ts` PATCH/DELETE handlers:
   - Call `requireTaskAccess(...)`.
   - If `process.env.ENFORCE_TASK_AUTHZ === 'true' && !allowed` → 403.
   - Else (shadow): log `would-deny`, proceed with old behavior.
3. Same in `/move`, `/attachments` (GET + DELETE).
4. For attachments DELETE: also verify `attachment.task_id === params.id`. This check is **always on** (zero-cost server-side check, never legitimate to delete cross-task).
5. For target column on `/move`: verify column belongs to the same project as task. Always on.
6. After 72h soak: flip `ENFORCE_TASK_AUTHZ=true` in production env.

#### Risk Assessment
- **Could break:** agents who legitimately work on tasks where their `agentId` is somehow not in `project_members` (data drift). Mitigation: shadow mode surfaces these so we backfill membership before flipping.
- **Cross-board surveillance:** since dashboards now query Task Board directly, agent UI may rely on viewing tasks the agent is *assigned to* but not formally a project member of. Audit all UI that reads task detail before flipping; backfill membership for any task in `task_assignees` whose project lacks the agent.
- **Why safe:** flag-gated, shadow-monitored.

#### Testing Plan
- **Manual:**
  - Agent A loads own task → still works.
  - Agent A tries to PATCH agent B's task by guessed UUID → shadow logs (pre-flip), then 403 (post-flip).
  - Admin can still patch any task.
  - Move task: target column from same project → works. From other project → 400.
  - Delete attachment: matching task → works. Attachment ID from a different task in same project → 400.
- **Pre-flip query** to find at-risk users:
  ```sql
  SELECT DISTINCT ta.agent_id, t.project_id
  FROM task_assignees ta
  JOIN tasks t ON t.id = ta.task_id
  LEFT JOIN project_members pm ON pm.project_id = t.project_id AND pm.agent_id = ta.agent_id
  WHERE pm.agent_id IS NULL;
  ```
  Fix the gap before flipping.

#### Rollback Plan
Set `ENFORCE_TASK_AUTHZ=false` via env reload. Object-level check on `attachment.task_id` and column-project consistency stay on (no regression — those are pure correctness checks, not authorization).

---

### Issue: Job APIs leak cross-agent data

- **Source:** QA.md §2 Critical (Agent Job APIs)
- **Risk Level:** Critical

#### Problem Summary
`/api/jobs/[id]`, `/api/jobs/search`, `/api/jobs/export` require auth but do not consistently scope agents to their own assigned profiles. Export accepts `agent` query param.

#### Safe Fix Strategy
Same pattern: `requireJobAccess(jobId, session)` helper + `ENFORCE_JOB_AUTHZ` flag + shadow logging.

For export: server-side ignore `agent` query param when `session.user.role === 'agent'` and force it to `session.user.agentId`. This is **always on** (no legitimate agent use case for inspecting another agent's export).

#### Implementation Steps
1. Add `requireJobAccess(jobId, session)` to `src/lib/auth-guards.ts`. Logic: admin allowed; otherwise check `jobs.profile_id IN (SELECT id FROM profiles WHERE agent_id = session.user.agentId)`.
2. `/api/jobs/[id]/route.ts`: call guard, shadow → enforce.
3. `/api/jobs/search/route.ts`: append `WHERE` clause that filters by agent's profiles for non-admin sessions. Behind `ENFORCE_JOB_AUTHZ` flag (shadow mode logs how many rows the filter *would* have hidden).
4. `/api/jobs/export/route.ts`: **always** override `agent` param for non-admin role. Add log line if agent attempted to query another agent (for monitoring).
5. After 72h shadow soak, flip `ENFORCE_JOB_AUTHZ=true`.

#### Risk Assessment
- **Could break:** admin tooling that pretends to be an agent. Unlikely — admins use admin role. Mitigation: shadow mode.
- **Why safe:** scoped to non-admin sessions; admins remain unrestricted.

#### Testing Plan
- Agent A logged in: GET `/api/jobs/<job-from-B>` → 403 post-flip.
- Agent A logged in: GET `/api/jobs/search?agent=B` → returns only A's jobs (param ignored).
- Agent A export: only A's CSV rows.
- Admin: full access still works.

#### Rollback Plan
`ENFORCE_JOB_AUTHZ=false`; export-param override stays (no rollback needed there).

---

### Issue: Build pipeline masks TypeScript failures

- **Source:** QA.md §2 Critical (Build Pipeline)
- **Risk Level:** Critical

#### Problem Summary
`next.config.ts` has `typescript.ignoreBuildErrors: true`. `tsc --noEmit` fails. Runtime regressions can ship.

#### Safe Fix Strategy
**Do not flip the switch yet.** Removing `ignoreBuildErrors` while errors exist breaks every deploy and blocks unrelated bugfixes. Instead:
1. Catalog all errors.
2. Fix module-by-module in small PRs.
3. Add `tsc --noEmit` to CI as a **non-blocking** check first (count errors, post a comment).
4. Once count = 0, flip `ignoreBuildErrors: false` and make CI blocking. Single small PR.

#### Implementation Steps
1. Run `npx tsc --noEmit > tsc-errors.log` and commit baseline count to `docs/`.
2. Group errors by file.
3. Open small PRs, one per file/module, in order: `src/lib/db.ts` → typed row helpers → `src/lib/data.ts` → `src/lib/task-data.ts` → API routes.
4. The right way for raw SQL rows: define shared `Row*` types and use them via a single typed `sqlOne<T>()` / `sqlAll<T>()` helper added to `src/lib/db.ts`. **This helper is additive** — existing `sql\`...\`` calls keep working until migrated.
5. CI (Phase 3 fix #17): start with `tsc --noEmit` running but allowed to fail; report error count.
6. Once log shows 0 errors locally for two weeks: PR to flip `ignoreBuildErrors: false` + remove warning suppression.

#### Risk Assessment
- **Could break:** deploys, if flip happens before clean. Mitigation: gate flip on zero local errors + green CI for two consecutive weeks.
- **Why safe:** no behavior changes — types are compile-time only.

#### Testing Plan
After each PR: `npx tsc --noEmit` shows reduced count. `npm run build` still succeeds.

#### Rollback Plan
Revert any single PR. The flip-PR is reverted by re-adding `ignoreBuildErrors: true`.

---

### Issue: GitHub OAuth grants admin if `ALLOWED_EMAILS` missing

- **Source:** QA.md §2 Critical (GitHub OAuth)
- **Risk Level:** Critical

#### Problem Summary
`src/lib/auth.ts` `signIn` callback allows all GitHub users when `ALLOWED_EMAILS` unset. JWT callback maps unknown users to `role: "admin"`.

#### Safe Fix Strategy
Two narrowly-scoped, independent edits:
1. `signIn` callback: in production, when `ALLOWED_EMAILS` is empty/unset → return false (deny). Dev unchanged.
2. JWT callback: unknown user → `role: 'agent'` (or `'pending'` if we want explicit-only) instead of `'admin'`. **Never** elevate to admin without explicit allowlist.

#### Implementation Steps
1. Add startup check in `src/lib/auth.ts` (top of file or in a `validateAuthEnv()` helper called once): if `NODE_ENV === 'production'` and `!process.env.ALLOWED_EMAILS` → log fatal + throw. This prevents the misconfig from booting.
2. `signIn` callback: explicit empty-list → deny in production.
3. JWT callback: change default mapping for unknown user from admin to **deny** (return null/false to invalidate session) rather than silent role downgrade. This is safer than `agent` because an unmapped GitHub identity has no `agentId` and would behave inconsistently.
4. Verify `ALLOWED_EMAILS` is set in Contabo `.env.production` BEFORE deploying this change — else the app will refuse to boot.
5. Verify the admin's GitHub email is in the list.

#### Risk Assessment
- **Could break:** boot if env var not set. Mitigation: pre-deploy verification. (And: this is the *correct* behavior — don't boot insecurely.)
- **Could break:** legitimate admin login if their email isn't in the list. Mitigation: pre-flight verification.

#### Testing Plan
- Pre-deploy: SSH to Contabo, `grep ALLOWED_EMAILS /opt/sales-dashboard/.env.production`. Confirm admin email present.
- Post-deploy: log in via GitHub as listed admin → success.
- Negative: try logging in via GitHub from a non-listed account → denied.

#### Rollback Plan
Revert `src/lib/auth.ts`. Single file.

---

### Issue: React hook-rule violations in `board-column.tsx`

- **Source:** QA.md §2 Critical (React Hooks) + §6 React/Next.js
- **Risk Level:** Critical (currently invisible because lint is not blocking)

#### Problem Summary
Conditional hook calls for `useDroppable`, `useBoardStore`, `useState`, `useRef`, `useEffect`. Hook order violations cause unstable rendering, especially under Strict Mode + React 19.

#### Safe Fix Strategy
**Refactor in place** — move all hooks to the top, branch only in returned JSX. Identical visual output.

#### Implementation Steps
1. Read `src/components/tasks/board-column.tsx`. Identify the early-return that precedes hooks.
2. Move every hook call above the early return.
3. Wrap any hook whose effect depends on the early-return condition with the same condition inside the effect body, not around the hook call.
4. Verify with `npm run lint` — `react-hooks/rules-of-hooks` clean for this file.
5. Test the board: drag-drop, column scrolling, WIP counts, empty state.

#### Risk Assessment
- **Could break:** drag-and-drop behavior if `useDroppable` is now called for invalid states. Mitigation: gate the side-effect, not the hook.
- **Why safe:** semantics preserved; only restructuring.

#### Testing Plan
- Open Task Board admin and agent.
- Drag task across all 14 columns.
- Filter board to empty state, verify column placeholder still renders.
- Check console for React warnings.

#### Rollback Plan
Revert single file.

---

### Issue: Other React Compiler hook-rule warnings

- **Source:** QA.md §6 (React Compiler — `board-create-dialog.tsx`, `board-members-panel.tsx`, `notification-permission-banner.tsx`, `task-create-full.tsx`, `theme-toggle.tsx`)
- **Risk Level:** High

#### Problem Summary
Synchronous `setState` inside effects.

#### Safe Fix Strategy
File-by-file, small PRs. Replace the offending effect with derived state, `useMemo`, or properly-gated effect.

#### Implementation Steps
1. For each file, identify the `useEffect` block that sets state synchronously based on its deps.
2. If the value is derived from props/state → replace with `useMemo` or compute inline.
3. If the value depends on async work → keep effect, ensure setState is conditional (avoid loop).
4. Re-lint per file.

#### Risk Assessment
- **Could break:** state-update timing. Mitigation: visual review per component (each is small).

#### Testing Plan
Per-component manual smoke: open the dialog/panel/banner, verify behavior unchanged.

#### Rollback Plan
Revert per file.

---

### Issue: Secrets/credentials in docs and working tree

- **Source:** QA.md §2 High (Secrets in Docs) + §3 Secrets
- **Risk Level:** High

#### Problem Summary
`docs/devops-sync-plan.md` contains a concrete Neon DB URL pattern. Local `.env.*` files exist.

#### Safe Fix Strategy
1. Scrub the doc.
2. Rotate any credential that was real.
3. Confirm `.env.local`, `.env.neon`, `.env.docker` are in `.gitignore`.

#### Implementation Steps
1. Open `docs/devops-sync-plan.md`. Replace any real-looking credential with `<DATABASE_URL_PLACEHOLDER>` and add a note "secrets stored in Vault / Contabo .env.production".
2. Treat exposed credential as compromised: rotate Neon DB password (even though Vercel/Neon retired, rotate to prevent reuse).
3. Verify `.gitignore`: `.env*` except `.env.example`. If files were ever committed, run `git log --all --full-history -- .env.local` etc. to confirm — if found, document and rotate.
4. Add `gitleaks` or similar to CI in Phase 3.

#### Risk Assessment
- **Could break:** nothing — docs only.
- **Why safe:** purely informational change.

#### Testing Plan
- `git ls-files | grep -E "\.env"` returns only `.env*.example`.

#### Rollback Plan
Not needed. Doc-only.

---

### Issue: Multi-step writes are not transactional

- **Source:** QA.md §2 High (Transactional Writes) + §5 Database
- **Risk Level:** High

#### Problem Summary
`createTask`, `updateTask`, `moveTask`, `deleteProject`, webhook task creation all run multiple SQL statements with no transaction → partial-write risk.

#### Safe Fix Strategy
**Add a transaction helper alongside existing code.** Convert callers one at a time, with the existing non-transactional path remaining the fallback if the helper isn't used.

#### Implementation Steps
1. Add to `src/lib/db.ts`:
   ```ts
   export async function withTx<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
     // BEGIN; try { result = await fn(tx); COMMIT; } catch { ROLLBACK; throw; }
   }
   ```
   Use a pooled client from `@vercel/postgres` (`db.connect()`).
2. Convert `createTask` first (fewest dependents):
   - Wrap insert + assignees + tags + activity log in `withTx`.
   - Keep return shape identical.
3. Run smoke: create a task, verify all four rows committed; manually inject failure → verify rollback (delete the test data).
4. Repeat for `updateTask`, `moveTask`, `deleteProject`, webhook task creation.
5. Move-task specifically: also acquire row lock or advisory lock on the target column to prevent position-collision under concurrent moves. Add `pg_advisory_xact_lock(hashtext(column_id::text))`.

#### Risk Assessment
- **Could break:** if `db.connect()` pool exhausts under load. Mitigation: short transactions, default pool size. Also: `@vercel/postgres` pool semantics on Contabo Neon — verify connection limit before rolling out widely.
- **Could break:** if any operation inside the tx silently swallows errors. Audit each one.
- **Why safe:** if `withTx` itself throws, the catch path returns the same error shape as today's non-transactional code (callers already handle rejected promises).

#### Testing Plan
- Create task → 4 rows present.
- Force failure mid-tx (e.g. invalid tag UUID) → 0 rows of that task.
- Concurrent moves of two tasks to same column at same position → both succeed, positions differ (advisory lock did its job).

#### Rollback Plan
Revert per-function PR. Existing non-tx code path unchanged in reverted state.

---

### Issue: PATCH `/api/tasks/[id]/move` bypasses dashboard sync

- **Source:** QA.md §4 + §6 + §8 (API/server action divergence)
- **Risk Level:** High (causes board-vs-dashboard KPI drift)

#### Problem Summary
`moveTaskAction` (server action) calls `syncJobStatusFromTask`. The REST equivalent does not.

#### Safe Fix Strategy
**Additive call** in the REST route. No changes to `moveTask` or to the server action.

#### Implementation Steps
1. In `src/app/api/tasks/[id]/move/route.ts`, after the existing `moveTask()` call, add:
   ```ts
   await syncJobStatusFromTask(taskId);
   ```
   Wrap in try/catch + log; do not fail the move on sync error (keep current REST contract).
2. Verify activity log gets the `task_moved` row (cumulative-funnel KPIs depend on it — see CLAUDE.md rule #10).

#### Risk Assessment
- **Could break:** if `syncJobStatusFromTask` throws on tasks with no linked job (orphan tasks). Verify the function is null-safe; if not, guard before calling.
- **Why safe:** purely additive, errors logged not propagated.

#### Testing Plan
- Move a task via REST (Postman) → verify `jobs.status` updated.
- Move via UI (server action) → verify same behavior (regression check).
- Move an orphan task (no `_job_id`) → no error, no DB change to jobs.

#### Rollback Plan
Revert single file.

---

### Issue: Webhook idempotency race

- **Source:** QA.md §5 (Webhook Idempotency) + §13 (Concurrent Retries)
- **Risk Level:** High

#### Problem Summary
`/api/v1/webhooks/tasks` checks `stats_cache` and existing tasks before insertion. Concurrent retries can both pass the check and both insert.

#### Safe Fix Strategy
Add a **partial unique index** on `tasks` for `(custom_fields->>'_job_id')` where it's not null. Database enforces uniqueness; the route catches the unique-violation and returns 200 with the existing row.

#### Implementation Steps
1. New migration `017_task_job_id_unique.sql`:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_custom_job_id_unique
   ON tasks ((custom_fields->>'_job_id'))
   WHERE (custom_fields->>'_job_id') IS NOT NULL;
   ```
   **Pre-flight:** check current data for duplicates first:
   ```sql
   SELECT custom_fields->>'_job_id', COUNT(*) FROM tasks
   WHERE custom_fields->>'_job_id' IS NOT NULL
   GROUP BY 1 HAVING COUNT(*) > 1;
   ```
   If duplicates exist, dedupe (keep oldest) before creating index, otherwise migration fails.
2. Update webhook handler: catch Postgres `23505` unique violation → return 200 with `{ status: 'duplicate', task_id: <existing> }`. Existing happy path unchanged.
3. Test by firing the same webhook payload twice in rapid succession.

#### Risk Assessment
- **Could break:** if duplicates exist, migration fails. Mitigation: pre-flight dedupe.
- **Could break:** legitimate cases where the same `_job_id` is reused intentionally (e.g. Vollna re-run for an updated job). Confirm this isn't expected — if it is, switch to `INSERT ... ON CONFLICT DO NOTHING` semantics in the route and skip the unique index.
- **Why safe:** unique violation already returns a clean error code that we now handle gracefully.

#### Testing Plan
- Duplicate request → second one returns 200 with `duplicate` flag, no second row created.
- Verify n8n's `neverError: true` doesn't infinite-retry on duplicate (it shouldn't — 200 is success).

#### Rollback Plan
`DROP INDEX IF EXISTS idx_tasks_custom_job_id_unique;`. Migration is idempotent.

---

### Issue: Input validation is ad hoc

- **Source:** QA.md §4 (Backend)
- **Risk Level:** High

#### Problem Summary
Routes parse `request.json()` with manual checks. No shared schemas. Invalid JSON → 500.

#### Safe Fix Strategy
**Additive Zod schemas in `src/lib/validators/`.** Adopt route-by-route. Schemas are *permissive* (`.passthrough()` for unknown keys) so existing payloads continue to work.

#### Implementation Steps
1. `npm i zod` (already in deps? verify).
2. Create `src/lib/validators/tasks.ts`, `webhooks.ts`, `projects.ts`, etc. Mirror existing accepted shapes.
3. Wrap `request.json()` in a helper:
   ```ts
   async function parseBody<T>(req: Request, schema: ZodSchema<T>): Promise<{ data: T; error?: never } | { error: Response }> {
     try {
       const json = await req.json();
       const parsed = schema.safeParse(json);
       if (!parsed.success) return { error: Response.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 }) };
       return { data: parsed.data };
     } catch {
       return { error: Response.json({ error: 'invalid json' }, { status: 400 }) };
     }
   }
   ```
4. Adopt in routes one at a time. Default to `.passthrough()` to stay backward-compatible with extra fields n8n sends.
5. **Don't break webhook payloads** — schema must accept everything the current route accepts. Generate the schema from real production payloads in `webhook_event_log`.

#### Risk Assessment
- **Could break:** strict schemas can reject valid traffic. Mitigation: `.passthrough()` + test against real captured payloads from `webhook_event_log`.
- **Why safe:** opt-in per route, payload-tested.

#### Testing Plan
- Replay 100 random webhook payloads from `webhook_event_log` through new schema → 100% pass.
- Send malformed JSON → 400.
- Send missing required field → 400 with `issues`.

#### Rollback Plan
Per-route revert.

---

### Issue: Many handlers lack try/catch → 500 on malformed JSON

- **Source:** QA.md §4 §12
- **Risk Level:** Medium

#### Safe Fix Strategy
The Zod helper above (`parseBody`) handles this. Adopt route-by-route.

#### Implementation Steps
Bundle with the validator rollout above.

#### Risk Assessment / Testing / Rollback
Same as validator issue.

---

### Issue: No rate limiting

- **Source:** QA.md §4 §11 §13
- **Risk Level:** Medium

#### Safe Fix Strategy
Add lightweight in-memory rate limiter (single-instance Contabo deployment makes this fine; would need Redis for HA). Apply to specific routes, leave others alone.

#### Implementation Steps
1. Add `src/lib/rate-limit.ts` — token-bucket per IP, in-memory `Map`.
2. Apply to: `/api/auth/*` login, `/api/migrate`, `/api/webhook/*`, `/api/jobs/search`, `/api/jobs/export`, `/api/profiles/sync-n8n`.
3. Webhook routes: bypass rate limit for n8n's source IP (allowlist via env).
4. Limits: login 10/min, migration 5/min, webhooks 200/min (n8n bursts), search 60/min, export 10/min.
5. On limit: 429 + `Retry-After` header.

#### Risk Assessment
- **Could break:** n8n webhook bursts. Mitigation: generous limit + IP allowlist.
- **Could break:** legit admin export. Mitigation: 10/min is generous for human use.

#### Testing Plan
- Hit login 11 times in 1 min → 429 on 11th.
- n8n burst → all succeed.

#### Rollback Plan
Remove middleware import per route.

---

### Issue: No CSRF / origin checks on cookie-authed mutating routes

- **Source:** QA.md §3
- **Risk Level:** Medium

#### Safe Fix Strategy
Add origin check for cookie-authed mutating REST routes. Webhook routes (bearer/HMAC) are exempt.

#### Implementation Steps
1. Add `src/lib/origin-check.ts`:
   ```ts
   export function checkOrigin(req: Request): boolean {
     const origin = req.headers.get('origin');
     const referer = req.headers.get('referer');
     const expected = process.env.NEXTAUTH_URL || 'http://157.173.110.62';
     return (origin && origin.startsWith(expected)) || (referer && referer.startsWith(expected));
   }
   ```
2. Apply to cookie-session mutating routes (`POST/PATCH/DELETE`).
3. Shadow-log mismatches for 48h before enforcing.

#### Risk Assessment
- **Could break:** mobile webview / non-browser clients that don't send Origin. Mitigation: shadow logs catch this.
- **Could break:** if `NEXTAUTH_URL` mismatches. Mitigation: verify env.

#### Testing / Rollback
Standard shadow-then-enforce; flag-gated.

---

### Issue: Attachments — MIME, filename, access checks

- **Source:** QA.md §3 (File Upload)
- **Risk Level:** Medium

#### Safe Fix Strategy
Additive validation on upload + cross-task check on GET/DELETE (the latter already covered by Phase 2 task IDOR fix).

#### Implementation Steps
1. Define MIME allowlist: `image/png|jpeg|webp`, `application/pdf`, `text/csv`, `application/vnd.openxmlformats-*`.
2. On upload, reject if not in list. **Shadow log first** to see what real users currently upload.
3. Normalize filename: strip path components, replace non-alphanumeric with `_`, cap length 200.
4. Cap file size already exists — keep.
5. Skip malware scan for now (out of scope; track as separate ticket).

#### Risk Assessment
- **Could break:** legitimate uploads with quirky MIME types. Mitigation: shadow.

#### Testing Plan
- Upload PNG → ok.
- Upload `.exe` renamed `.png` → MIME catches it (server-side detect, not extension).

#### Rollback
Revert validator.

---

### Issue: No project-consistency constraints

- **Source:** QA.md §5
- **Risk Level:** High (data integrity), but Medium implementation risk

#### Safe Fix Strategy
Add CHECK constraints `NOT VALID` first (only enforced on new rows), then validate later. Or add at trigger level. Defer hard FK changes to Phase 4.

#### Implementation Steps
Phase 2: app-level checks in `requireTaskAccess`/`moveTask` (target column same project).
Phase 4: DB-level constraint:
1. Add `NOT VALID` check via trigger or constraint on `tasks` ↔ `columns.project_id`.
2. Run validation pass on existing data:
   ```sql
   SELECT t.id FROM tasks t JOIN columns c ON c.id = t.column_id WHERE t.project_id != c.project_id;
   ```
3. Fix any violations, then `VALIDATE CONSTRAINT`.

#### Risk Assessment
- **Could break:** any historical mismatched data. Pre-flight query is required.

#### Testing
Standard.

#### Rollback
Drop constraint.

---

### Issue: CSV export — buffering and formula injection

- **Source:** QA.md §10 §11
- **Risk Level:** Medium

#### Safe Fix Strategy
1. Prefix `=`/`+`/`-`/`@` cell values with `'` (Excel/Sheets convention).
2. Stream rows via cursor instead of buffering 5000.

#### Implementation Steps
1. Add helper `escapeCsvCell(val: string)` that prefixes formula characters.
2. Apply to every cell in export.
3. For streaming: use `Response` with a `ReadableStream` that pulls rows in batches of 100.

#### Risk Assessment
- **Could break:** downstream consumers who parse CSV expecting raw `=` (rare). Mitigation: document the change.

#### Testing
Open exported CSV in Excel → no formulas execute. Large export (5k rows) → memory stable.

#### Rollback
Revert helper.

---

### Issue: Webhook event log retention and redaction

- **Source:** QA.md §5 §12
- **Risk Level:** Medium

#### Safe Fix Strategy
1. Add a redactor that strips proposal text, client URLs, tokens before storing payload.
2. Add scheduled cleanup (cron) to delete entries >90d.

#### Implementation Steps
1. New helper `redactWebhookPayload(payload, route)` returns shallow-cloned object with sensitive fields replaced by `[REDACTED]`.
2. Apply at the `webhook_event_log` insert site.
3. Add `vercel.json` cron — wait, Vercel decommissioned. Add a Contabo cron job instead (`crontab -e` or n8n scheduled workflow).

#### Risk Assessment
- **Could break:** debugging — you'll lose the payload data you wanted to inspect. Mitigation: separate, short-retention raw log behind admin-only access if needed.

#### Testing
Insert event, query log, verify redacted fields are `[REDACTED]`.

#### Rollback
Bypass redactor via env flag.

---

### Issue: No centralized logger / correlation IDs

- **Source:** QA.md §12
- **Risk Level:** Medium

#### Safe Fix Strategy
Lightweight wrapper around `console.*` that adds request ID + timestamp. Don't introduce a heavy framework.

#### Implementation Steps
1. `src/lib/logger.ts` — `log.info|warn|error(reqId, msg, meta)`.
2. In each route handler, generate `reqId = crypto.randomUUID()` at entry. Pass to nested calls.
3. Eventually: send to a real log sink (Logtail/Better Stack). Out of scope for this plan.

#### Risk Assessment
- **Could break:** nothing — wrapper is purely additive.

#### Testing
Smoke: trigger a webhook, see correlation ID in logs.

#### Rollback
Revert wrapper.

---

### Issue: CI/CD has no quality gate

- **Source:** QA.md §14
- **Risk Level:** Critical

#### Safe Fix Strategy
Add a separate GitHub Actions workflow `.github/workflows/ci.yml` that runs `lint`, `tsc --noEmit`, `build`. Keep `deploy-contabo.yml` working as-is. Once CI is stable, **add a `needs: ci` to deploy-contabo** so deploys block on red.

#### Implementation Steps
1. Add `.github/workflows/ci.yml` (lint + typecheck + build, on push and PR).
2. Make typecheck non-blocking initially (`continue-on-error: true`) — Phase 3 fix #16 fixes this once `tsc` is clean.
3. After 2 weeks of green CI: add `needs: ci` to `deploy-contabo.yml`.

#### Risk Assessment
- **Could break:** deploys, if we add `needs: ci` before CI is green. Mitigation: phase it.

#### Testing
Open a PR, verify CI runs.

#### Rollback
Remove `needs: ci`.

---

### Issue: HTTP-only Contabo deployment

- **Source:** QA.md §14 §13
- **Risk Level:** High

#### Safe Fix Strategy
Out of scope for code-level fixes; document the requirement. Procurement/DNS task.

#### Implementation Steps
1. Procure domain → DNS to Contabo IP.
2. Switch deploy to `docker-compose.prod.yml` (already in repo) once domain ready.
3. Use `/api/health?db=true` in deploy healthcheck.

#### Risk Assessment
- **Out of scope** for code PRs; track as ops ticket.

#### Rollback
Stay on `docker-compose.server.yml`.

---

### Issue: `<img>` instead of `next/image`

- **Source:** QA.md §6 §10
- **Risk Level:** Medium

#### Safe Fix Strategy
Per-component replacement. Only where the image source is known to be a same-origin or whitelisted host (avatar URLs).

#### Implementation Steps
1. Inventory `<img>` usages.
2. For avatars from external GitHub URLs, configure `images.remotePatterns` in `next.config.ts`.
3. Replace one-by-one.

#### Risk Assessment
- **Could break:** avatar URLs not whitelisted → broken images. Mitigation: pattern config first.

#### Testing
Visual check on task board, task detail.

#### Rollback
Revert per file.

---

### Issue: Saved-view ownership for system admins without `agentId`

- **Source:** QA.md §3 §9
- **Risk Level:** Medium

#### Safe Fix Strategy
Document the constraint: admin-saved views are global (`scope = 'admin'` rather than per-agent). Add a column or use a sentinel value.

#### Implementation Steps
1. Add nullable `created_by_admin BOOLEAN DEFAULT false` to `saved_views`.
2. Server-side: when admin creates a view, set this flag and skip `agentId` requirement.
3. Visibility: admins see all `created_by_admin = true` views; agents see only their own.

#### Risk Assessment
- **Could break:** existing first-active-agent fallback rows. Mitigation: leave them; only new rows use the flag.

---

### Issue: `middleware.ts` deprecated in Next.js 16

- **Source:** QA.md §6 §14
- **Risk Level:** Medium

#### Safe Fix Strategy
Rename `middleware.ts` → `proxy.ts` per Next 16 conventions when ready. Cosmetic. Defer to Phase 4.

#### Implementation Steps
1. Read Next.js 16 migration doc.
2. Rename file, update export name.
3. Verify auth redirects still work (agents → `/my-dashboard`, unauth → `/login`).

#### Risk Assessment
- **Could break:** route protection if rename misconfigured. Mitigation: smoke test login flows immediately after deploy.

---

### Issue: ESLint scans `backend/vendor`

- **Source:** QA.md §10 §15
- **Risk Level:** High (developer experience), low fix risk

#### Safe Fix Strategy
Add `.eslintignore` or `ignorePatterns` for `backend/vendor` and similar.

#### Implementation Steps
1. Edit `.eslintrc.*` or `eslint.config.*`. Add `ignorePatterns: ['backend/**', 'node_modules/**', '.next/**']`.
2. Run `npm run lint` → should drop from thousands to handful of errors.

#### Risk Assessment
- **Could break:** nothing. Lint config only.

---

### Issue: Activity-log mutation breaks KPI history

- **Source:** QA.md §5 §8
- **Risk Level:** Medium

#### Safe Fix Strategy
Replace hard delete with soft-delete (tombstone): add `deleted_at` column; queries filter on `IS NULL`. KPI queries need to decide whether to honor tombstones — recommend keeping tombstones in KPI calc (since the move *did* happen historically).

#### Implementation Steps
1. Migration `018_activity_log_tombstone.sql`: add `deleted_at TIMESTAMP NULL`. Index on `(task_id, created_at) WHERE deleted_at IS NULL`.
2. Replace delete logic with `UPDATE ... SET deleted_at = NOW()`.
3. KPI queries: keep using all rows (don't filter tombstones), so KPI history is preserved even if admin "deletes."
4. UI: hide tombstoned rows from activity feed.

#### Risk Assessment
- **Could break:** existing admin "delete" UX expectations. Document.

---

### Issue: Agent header prompts notification permission on insecure context

- **Source:** QA.md §6
- **Risk Level:** Medium

#### Safe Fix Strategy
Hide the banner when `window.isSecureContext === false`.

#### Implementation Steps
1. In `notification-permission-banner.tsx`, return null if not secure context.
2. Document that notifications come back once HTTPS lands.

---

### Issue: Manual connect cards not attributable

- **Source:** QA.md §8
- **Risk Level:** Medium

#### Safe Fix Strategy
Documented behavior in CLAUDE.md (`'Unspecified'` bucket). Add a UI badge surfacing this so reporters understand. No code-correctness change needed unless business says so.

---

### Issue: Stale documentation

- **Source:** QA.md §6 §15
- **Risk Level:** Medium

#### Safe Fix Strategy
Move obsolete docs to `docs/archive/` with a header comment saying "historical reference only". Keep `CLAUDE.md`, `docs/taskboard_prd.md`, `docs/n8n_workflow_prd.md` as canonical.

#### Implementation Steps
1. Inventory `docs/`.
2. Move ClickUp/Supabase/Prisma references to `docs/archive/`.
3. Add `docs/README.md` index pointing to current docs.

---

## 4. Cross-Cutting Safety Improvements

### Logging (non-breaking, additive)
- Wrap `console.*` in `src/lib/logger.ts` with timestamp + correlation ID.
- Webhook routes log inbound bytes and verification result on every request.
- Auth callbacks log `signIn` decisions (allowed / denied / reason).
- Migration route logs every action.

### Validation (additive only)
- Zod schemas with `.passthrough()` so unknown fields pass through.
- Adopted route-by-route, never globally swapped.

### Error handling wrappers
- `withRouteHandler(handler)` HOF that catches thrown errors and returns 500 with logged error ID. Adopt route-by-route. Existing routes that already have try/catch don't need it.

### Monitoring additions
- Add `/api/health?db=true` to Contabo deploy healthcheck.
- Slack alert on:
  - 5+ webhook signature failures in 5 min (possible attack or n8n misconfig).
  - any 500 from `/api/migrate`.
  - any failed scheduled migration.
  - DB connection-pool exhaustion.

### Feature flags (env-driven)
| Flag | Purpose | Default |
|------|---------|---------|
| `WEBHOOK_SHADOW_MODE` | Log signature failures without rejecting | `true` initially |
| `STRICT_MIGRATION_AUTH` | Reject query-string secret on migrate | `false` initially |
| `ENFORCE_TASK_AUTHZ` | Apply `requireTaskAccess` (vs shadow) | `false` initially |
| `ENFORCE_JOB_AUTHZ` | Apply `requireJobAccess` (vs shadow) | `false` initially |
| `STRICT_AUTH_MODE` | OAuth fail-closed when `ALLOWED_EMAILS` missing | `true` (after env confirmed) |

---

## 5. Deployment Strategy

### Per-phase rollout
- **Phase 1** (security): one fix per deploy, off-hours, 30-min observation between. Six small deploys.
- **Phase 2** (auth + integrity): bigger but each fix is flag-gated. Deploy in shadow mode → observe 72h → flip flag in env (no redeploy needed).
- **Phase 3** (validation, perf, build): can batch more aggressively since changes are additive. Still off-hours.
- **Phase 4** (polish): standard cadence.

### Pre-deploy checks (every PR)
- `npm run build` succeeds.
- `npx tsc --noEmit` does not get *worse* (count comparison, not zero).
- `npm run lint` does not get *worse*.
- For migrations: pre-flight SELECT to verify no breaking data.

### Deploy mechanism
- Push to `main` triggers `.github/workflows/deploy-contabo.yml`.
- After Phase 3 fix #17, this is gated by `needs: ci`.

### Env reload procedure (for flag flips)
```bash
ssh -i <key> root@157.173.110.62
cd /opt/sales-dashboard
nano .env.production   # change flag
docker compose --env-file .env.production -f docker-compose.server.yml restart app
docker compose --env-file .env.production -f docker-compose.server.yml logs -f app | head -50
```

### Rollback playbook
1. **Code rollback:** `git revert <sha>` on `main`, push. Deploy auto-runs.
2. **Flag rollback:** edit `.env.production`, restart container.
3. **Migration rollback:** every migration includes a rollback `DROP/ALTER` block in its file.

---

## 6. Testing Strategy

### Regression checklist (manual, run after each phase)
- **Authentication**
  - GitHub OAuth login (admin email): success.
  - GitHub OAuth login (non-allowlist): denied.
  - Email/password login (each agent): success.
  - Logout: session cleared.
  - Agent → admin route (`/dashboard`): redirected to `/my-dashboard`.
- **Dashboard data**
  - Admin `/dashboard`: KPIs render, funnel render, recent jobs render.
  - Agent `/my-dashboard`: own data only.
  - Date filters (Today, This Week, custom range): values change.
  - TZ toggle (`?tz=pkt`): values change.
- **Task Board**
  - Admin `/tasks`: board loads, can switch boards.
  - Agent `/my-tasks`: assigned board only.
  - Drag task across columns: position updates, activity log entry, dashboard KPI updates (after `syncJobStatusFromTask` fix).
  - Create task via "+" → all 14 columns work.
  - Edit task: custom fields save.
  - Delete task: removed.
  - Add/remove member: panel updates.
- **n8n ingestion (CRITICAL)**
  - Trigger Vollna test job for one agent. Verify:
    - Task appears in Task Board.
    - Job appears in `jobs` table with correct profile_id and agent.
    - `vollna-auto` tag present.
    - `_proposal` custom field populated.
- **Webhooks (after Phase 1)**
  - Send unsigned request → 401.
  - Send signed request from n8n → 200.
- **Connects**
  - Add purchase as agent (own profile): success.
  - Add purchase as agent (other agent's profile): denied.
  - Delete purchase as agent: denied (admin-only).
- **Forms / mutations**
  - Create agent (admin only): success, password modal shows.
  - Create profile: success, webhook URL shown.
- **API contract verification**
  - Hit each endpoint with current production payloads (captured from `webhook_event_log`).
  - Response shape unchanged (diff with prior captures).

### Critical user flows (must verify each phase)
1. n8n → board → dashboard pipeline end-to-end.
2. Agent login → dashboard → board → task move → dashboard updates.
3. Admin login → settings → create profile → n8n webhook URL works.
4. Connects purchase entry by agent → reflects on bar.

---

## 7. Final Safety Checklist

Before marking each phase complete:

- [ ] `npm run build` succeeds locally and on CI.
- [ ] `npx tsc --noEmit` error count not increased vs baseline.
- [ ] `npm run lint` error count not increased vs baseline.
- [ ] All feature flags default to safe (shadow / off) for the first deploy.
- [ ] Manual regression checklist (§6) executed and passing.
- [ ] n8n test webhook fired post-deploy → task + job land correctly.
- [ ] Logs reviewed for unexpected `would-deny` / `shadow_rejection` spikes (>0.1% of traffic).
- [ ] No API response shapes changed (`webhook_event_log` payload diff is empty).
- [ ] Rollback procedure documented in PR description.
- [ ] Migration (if any) includes a tested rollback block.
- [ ] Slack alert configured for new failure modes introduced by the phase.

---

## Appendix A — Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|-----------|--------|-----------|
| R1 | n8n webhook rejected post-flip due to HMAC mismatch | Medium | High (lost leads) | 48h shadow mode + signature parity test |
| R2 | `ENFORCE_TASK_AUTHZ` denies legitimate agents | Medium | Medium | Pre-flight membership backfill + 72h shadow |
| R3 | Transaction wrapper exhausts pool | Low | High | Short txns, default pool, monitoring |
| R4 | TS fixes introduce runtime regressions | Low | Medium | Module-by-module, no logic changes |
| R5 | Unique index migration fails on existing dupes | Medium | Medium | Pre-flight SELECT; dedupe before index |
| R6 | OAuth fail-closed boots app into deny-all | Low | High | Pre-flight env verification + admin email check |
| R7 | Origin check denies legit non-browser clients | Low | Low | Shadow mode |

---

## Appendix B — Out of Scope (Tracked Separately)

- HTTPS / domain procurement for Contabo (ops ticket).
- Real-time notifications (requires secure context — blocked by HTTPS).
- Outbound webhook delivery system (separate feature).
- Materialized views for dashboard KPIs (perf — deferred until KPI load is measured).
- Full migration of `src/lib/data.ts` away from raw SQL (out of scope; raw SQL stays).
- Replacing polling with SSE/WebSocket (separate architecture decision).
- Move `/api/migrate` out of public app (architectural; covered partially by Phase 1 lockdown).

---

## Appendix C — Phase 1 Suggested Commit Order

1. `chore(docs): scrub credential pattern from devops-sync-plan`
2. `fix(migrate): fail closed when CRON_SECRET missing in production`
3. `fix(webhook/n8n): add shadow signature verification`
4. `fix(webhook/tasks): add shadow unmatched-token rejection`
5. `fix(auth): require ALLOWED_EMAILS in production; never default unknown to admin`
6. `fix(tasks): hoist hooks above conditional return in board-column`

Each commit is single-purpose, single-file (or near-single-file), and reversible.

---

*End of plan. Ship Phase 1 first. Stability over perfection.*
