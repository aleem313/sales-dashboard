# CLAUDE.md

Guidance for Claude Code in this repo. This file is intentionally short — topic-detail lives in `docs/claude/*.md` and is loaded **on demand** (no `@import`). Read the matching topic file only when the task touches that area.

## Project

Rising Lions Analytics Dashboard — Next.js 16 / React 19 / TS 5 / NextAuth v5 / Tailwind 4 / shadcn/ui / Recharts. Real-time analytics for Upwork job automation (proposals, win rates, agent performance, revenue). Data flows in from n8n webhooks, Google Sheets imports, and the internal Task Board.

> **The Task Board is the single source of truth for job status.** ClickUp was fully removed in Milestone 8. Never rely on ClickUp data, APIs, or webhooks.

## Commands

```bash
npm run dev       # localhost:3000
npm run build
npm run lint
```

No test framework. No local dev workflow — all changes must be production-ready.

## Architecture quick-ref

- **Database**: Postgres 17 (Docker sibling container on Contabo) via `pg` — raw SQL through the tagged-template wrapper in `src/lib/db.ts`, no ORM
- **Auth**: NextAuth v5 (GitHub OAuth + email/password credentials)
- **Path alias**: `@/*` → `./src/*`
- **Server components by default**, `"use client"` only for interactivity
- **Mutations** go through `src/lib/actions.ts` (which calls `revalidatePath`)
- **URL state for filters** (not React state)
- **Smart polling**: `<AutoRefresh interval={N} />` — 5s for boards, 15s for dashboards, pauses when tab hidden

## Roles & Routes

- **`admin`** — full access via `(dashboard)/` route group
- **`agent`** — restricted to `(agent)/` route group; all agent routes start with `/my-`
- Middleware (`src/middleware.ts`) enforces auth + redirects agents away from admin routes to `/my-dashboard`

## Key Files

| File | What |
|------|------|
| `src/lib/data.ts` | All DB queries (~1700 lines of raw SQL) |
| `src/lib/actions.ts` | Server actions (mutations + `revalidatePath`) |
| `src/lib/auth.ts` | NextAuth config, session callbacks, role logic |
| `src/lib/types.ts` | TypeScript interfaces |
| `src/lib/seed.ts` | Schema DDL + seed data |
| `src/lib/sheets.ts` | Google Sheets client |
| `src/lib/alerts.ts` | Alert thresholds + Slack webhook |

## Topic detail (READ ON DEMAND — not auto-loaded)

Only read these when the task actually touches the area. Each one is self-contained.

| Read when working on… | File |
|------------------------|------|
| n8n workflows, classifier, webhooks, AI Agent prompts, adding profile nodes, gotchas | `docs/claude/n8n-integration.md` |
| Task Board API, components, kanban behavior, custom fields, connects, snapshots | `docs/claude/task-board.md` |
| Data ingestion, status sync, dashboard count semantics, funnel KPIs, timezone | `docs/claude/data-flow.md` |
| Adding a migration, looking up migration history | `docs/claude/migrations.md` |
| Agent/profile creation, password hashing, n8n mapping endpoint | `docs/claude/agent-profile-mgmt.md` |
| Deployment, Docker, Contabo, CI workflow | `docs/claude/deployment.md` |
| ClickUp legacy/removal rules (rare — only when touching `clickup_*` columns) | `docs/claude/clickup-removal.md` |

## Maintaining these docs (write-back rule)

When this session yields a durable fact — a new gotcha, an architectural decision, a new migration, a renamed column, a workflow change, a "we tried X and it broke because Y" — **edit the matching `docs/claude/*.md` file**, not this index. Future sessions only load topic files on demand, so that's where the knowledge has to live.

Per-topic update triggers:

| When you… | Update |
|-----------|--------|
| Add a migration | `docs/claude/migrations.md` (new row + bump "Latest migration" URL) |
| Edit the n8n workflow, classifier prompt, or hit a new n8n cloud gotcha | `docs/claude/n8n-integration.md` |
| Add a Task Board component, change connects logic, or change a "known pattern" | `docs/claude/task-board.md` |
| Change ingestion shape, dashboard count semantics, or funnel KPI rules | `docs/claude/data-flow.md` |
| Change agent/profile auth, password hashing, or the n8n mapping endpoint | `docs/claude/agent-profile-mgmt.md` |
| Change Docker, Contabo, CI workflow, or env-var contracts | `docs/claude/deployment.md` |
| Touch `clickup_*` columns (rare) | `docs/claude/clickup-removal.md` |

Only edit CLAUDE.md itself when adding a **new topic file** (so the index points at it) or changing a top-level rule (architecture, roles, conversation-continuity). Don't trust commit messages to carry the knowledge forward — they rot first.

## Other reference

| File | Purpose |
|------|---------|
| `docs/plan.md` | Execution plan with milestones |
| `docs/cline.md` | Project history, progress tracking, resume instructions |
| `docs/task_board_cases.md` | Task Board cases & edge cases (dev scoping + QA) |
| `docs/task_board_ui_audit.md` | UI audit: 12 components, issues, role matrix |
| `docs/agent-guide/AGENT_USER_GUIDE.md` | End-user guide for agents |
| `docs/n8n_workflow_prd.md` | Parent workflow PRD |
| `docs/n8n_relevancy_classifier_core_prd.md` | Classifier sub-workflow PRD |
| `docs/job_relevancy_criteria_prd.md` | Relevancy criteria PRD (rules + reason enum) |
| `docs/relevancy/mode_a_prompt.md` | Canonical classifier prompt |

## Conversation Continuity

Read `docs/cline.md` first in new conversations. Update it after each feature (status table + detail section). Execution plan lives in `docs/plan.md` (v3.1, ClickUp removal). Mark items `[x]` as completed.

## Git Commits

Do not add `Co-Authored-By` lines to commit messages.
