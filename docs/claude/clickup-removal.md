# ClickUp Removal (IMPORTANT — for AI/dev agents)

ClickUp integration has been **fully removed** as of Milestone 8. The following no longer exist:

| Removed | Was |
|---------|-----|
| `src/lib/clickup.ts` | ClickUp API client |
| `src/app/api/webhook/clickup/` | ClickUp webhook handler |
| `src/app/api/sync/clickup/` | ClickUp sync endpoint |
| `src/app/api/auth/clickup/` | ClickUp OAuth routes |
| ClickUp cron (previously in `vercel.json`) | Daily sync at 00:00 UTC |
| `triggerClickUpSync()` | Server action |
| `triggerClickUpFullSync()` | Server action |

**Rules for future development:**
1. **Never** add ClickUp API calls, webhooks, or sync logic
2. **Never** rely on `clickup_task_id` or `clickup_task_url` for new features — they are legacy
3. **Always** use Task Board as the source of truth for job status
4. Job status changes happen ONLY via Task Board column moves (`moveTaskAction` → `syncJobStatusFromTask`)
5. The `jobs.status` column contains the same values as board column names (e.g., "Proposal Submitted", "In Chat", "Won", "Lost")
6. **Board columns** (14 total): Todo, Proposal Submitted, Proposal Views, Prototype Required, Prototype Done, Prototype Submitted, In Chat, Meeting Scheduled, Meeting Done, Negotiation, Lost, On Hold, N/A, Won
7. **Pipeline Now grouping**: Todo | In Progress (Proposal Submitted, Proposal Views, Prototype Required/Done/Submitted, In Chat, On Hold) | Meetings (Meeting Scheduled/Done) | Negotiation
8. KPI calculations in `data.ts` depend on these exact status strings — if board columns are renamed, update the KPI queries

For dashboard count / funnel semantics, see `docs/claude/data-flow.md`.
