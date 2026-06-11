# Proposal Feedback + AI Regenerate + Training Capture

**Status:** SHIPPED 2026-06-09 (commits `d951e81` feature, `2cf7558` UI reorder). Deployed to Contabo, migration 024 applied, n8n workflow live.

This doc is the single background reference for the feature. Read it before changing any part of the proposal feedback / regenerate flow.

---

## 1. What it does

On the task detail view (`TaskFullView`), under the proposal, agents/admins can:

1. **Flag a bad AI proposal** — tick canonical problem categories + an optional free-text note → **Save feedback**.
2. **Regenerate an improved proposal** — same form, **Regenerate** button → the dashboard calls an n8n webhook that re-runs the Claude Haiku proposal writer with the previous proposal + the feedback injected, and writes the new text back onto the card.
3. **Build a training corpus** — every feedback submission and every regeneration is stored append-only in `proposal_feedback` as a self-contained `(original_proposal, categories[], note) → regenerated_proposal` record.

Modelled on two existing flows: the **relevancy feedback** flow (`RelevancyPanel` + `relevancy-feedback-form.tsx` + `/api/tasks/[id]/relevancy-feedback`) for UI/auth, and the **manual evaluator** (`/api/relevancy/evaluate-task` → n8n `job-evaluate-manual`) for the n8n LLM call pattern.

> The dashboard NEVER calls an LLM directly — all AI runs in n8n. There is no `@anthropic-ai/sdk` in the app.

---

## 2. Architecture / flow

```
Task detail (task-full-view.tsx, COLUMN 3)
  ├─ ProposalBox            renders job?.proposal_text ?? cf._proposal (editable)
  ├─ RelevancyPanel         AI Relevancy verdict (self-hides if no score — see §8)
  └─ ProposalFeedbackPanel  (this feature)
       ├─ category chips + note
       ├─ [Save feedback]  → POST /api/tasks/[id]/proposal-feedback   → row status='feedback'
       ├─ [Regenerate]     → POST /api/proposals/regenerate
       │      → n8n webhook proposal-regenerate (Claude Haiku) → { proposal, model }
       │      → setTaskProposalText(card._proposal = new) + row status='regenerated' applied=true
       │      → onProposalApplied() updates the open view live
       └─ History (newest first): View / Copy / Restore / Delete per row
```

Order in the column is **Proposal → AI Relevancy → Improve this proposal** (the feedback panel is intentionally last so it doesn't push the relevancy section below the fold — that was commit `2cf7558`).

---

## 3. Database — migration 024 (`proposal_feedback`)

Files: `src/lib/migrations/024_proposal_feedback.sql` (+ `_down.sql`). Also inlined as `run024()` in `src/app/api/migrate/route.ts` (the migrate route runs inline SQL; the `.sql` file is the source-of-truth companion). Applied on Contabo via `…/api/migrate?v=024&secret=<CRON_SECRET>`. Idempotent.

Append-only log — **one row per feedback submission AND per regeneration attempt**. The card's `custom_fields._proposal` holds only the currently-applied text; this table holds the full lineage.

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | |
| `task_id` | UUID NOT NULL | FK `tasks(id)` ON DELETE CASCADE |
| `job_external_id` | TEXT | from card `_job_id`, for training-export joins |
| `profile_id` | TEXT | FK `profiles(profile_id)` |
| `agent_id` | UUID | FK `agents(id)` — NULL for admin authors |
| `admin_id` | TEXT | NextAuth `session.user.id` — set for admin authors |
| `author_role` | TEXT | CHECK `('agent','admin')` |
| `categories` | TEXT[] | canonical labels (see §4) |
| `note` | TEXT | free-text, ≤2000 chars (capped app-side) |
| `original_proposal` | TEXT | proposal at feedback time = **training input** |
| `regenerated_proposal` | TEXT | AI output = **training target**; NULL for feedback-only |
| `model` | TEXT | model that produced the regeneration |
| `status` | TEXT | CHECK `('feedback','regenerated','regen_failed')`, default `feedback` |
| `applied` | BOOLEAN | was regenerated text written back to the card |
| `request_id` | UUID | correlates to the n8n call |
| `created_at` | TIMESTAMPTZ | default NOW() |

Indexes: `idx_pf_task (task_id, created_at DESC)`, `idx_pf_profile`, `idx_pf_status`, `idx_pf_regen (created_at DESC) WHERE status='regenerated'` (powers the rate limiter).

**Training-export query** (the whole point of the corpus):
```sql
SELECT categories, note, original_proposal, regenerated_proposal, model, created_at
FROM proposal_feedback
WHERE status = 'regenerated'
ORDER BY created_at DESC;
```

---

## 4. Canonical categories — `src/lib/proposal-feedback-reasons.ts`

`PROPOSAL_FEEDBACK_OPTIONS` (11) + `PROPOSAL_FEEDBACK_SET` (server-side validation):
Weak or generic hook · Hallucinated portfolio/experience · Missed a job requirement · Inaccurate claim about client/job · Wrong tone — not human · Too long · Too short · Broke formatting rules · Irrelevant to the job · Repetitive / filler · Wrong or missing screening answer.

Separate from `relevancy-reasons.ts` (those are job-level N/A reasons; these are proposal-level defects). To add/rename a category, edit this file only — the n8n side just receives them as text in the feedback block, so no workflow change is needed.

---

## 5. Data layer — `src/lib/data.ts`

(Defined near the manual-eval helpers; `ProposalFeedbackRow` / `ProposalFeedbackInsert` interfaces live here, following the `AgentFeedbackRow` convention — NOT in types.ts.)

- `insertProposalFeedback(row: ProposalFeedbackInsert): { id, created_at }` — single INSERT. Nullable UUIDs use `${value}::uuid` with a null binding → `NULL::uuid` (the `sql` wrapper does **not** support nested `sql` fragments — don't try `${x ? sql\`…\` : null}`).
- `listProposalFeedbackForTask(taskId): ProposalFeedbackRow[]` — newest first, LIMIT 100, LEFT JOIN agents for `author_name`.
- `deleteProposalFeedback({ feedbackId, taskId, agentId, isAdmin }): "deleted" | "not_found" | "forbidden"` — admin deletes any; agent deletes only own; path/row mismatch → not_found.
- `checkProposalRegenRateLimit({ requestedBy, agentId?, perHour=30, perDay=150 }): ManualEvalRateLimitResult` — counts `proposal_feedback` rows with `status='regenerated'` for this author over 1h/1d windows. Reuses the `ManualEvalRateLimitResult` shape.
- `getTaskProposalContext(taskId): { exists, proposal, profileId, profileName, jobExternalId } | null` — one query: reads `_proposal`, resolves `profile_id` from `_profile_id` or `_profile_name`→`profiles.profile_name`, reads `_job_id`.
- `setTaskProposalText(taskId, text)` — targeted `jsonb_set` on `_proposal` (no read-modify-write, won't race other custom-field edits).

---

## 6. API routes

### `POST/GET/DELETE /api/tasks/[id]/proposal-feedback`  (feedback-only, no LLM)
Auth: `assertCanFlagTaskRelevancy` (agent assigned or task unassigned; admins always). Admin-without-agent-row → `author_role='admin'`, `admin_id` set, `agent_id` NULL.
- **GET** → `{ feedback: ProposalFeedbackRow[] }` (full history).
- **POST** `{ categories: string[], note? }` → validates categories against `PROPOSAL_FEEDBACK_SET`, note ≤2000; captures current `_proposal` as `original_proposal`; inserts `status='feedback'`; → 201 `{ feedback_id, created_at }`.
- **DELETE** `{ feedback_id }` → 204 / 404 / 403.

### `POST /api/proposals/regenerate`  (the LLM call)
Body `{ task_id, categories: string[], note? }`. Steps: auth gate → `getTaskProposalContext` (404 if no proposal / unresolved profile) → `getUpworkProfileSnapshot` (404 `profile_snapshot_missing`) → `checkProposalRegenRateLimit` (429 + `Retry-After`) → POST to n8n with 60s `AbortController` timeout → on success insert `status='regenerated'` + `setTaskProposalText` + return `{ proposal, model, feedback_id, request_id }`; on n8n failure insert `status='regen_failed'` and return 502/504 (card left untouched).
- Token: `process.env.PROPOSAL_REGEN_TOKEN || process.env.RELEVANCY_MANUAL_EVAL_TOKEN`.
- Webhook base: `process.env.N8N_WEBHOOK_BASE || "https://ikonicdev.app.n8n.cloud/webhook"`, path `proposal-regenerate`.
- Error codes: 400 bad input · 401 unauth · 403 not_assigned · 404 task_not_found/no_proposal/profile_not_resolved/profile_snapshot_missing · 429 rate_limited · 500 token_not_configured · 502 n8n unreachable/returned-error/no-proposal · 504 timeout.

---

## 7. n8n workflow — `proposal-regenerate`

- **ID:** `4NNx4qKfYknmqWrr` · 11 nodes · **ACTIVE** on ikonicdev.app.n8n.cloud. Additive — does not touch the parent `EWnZg3svZWwcIRs4` or classifier `hi71jhPU8tmq7hEp`.
- **URL:** `POST https://ikonicdev.app.n8n.cloud/webhook/proposal-regenerate` (httpHeaderAuth).
- **Credential:** reuses the EXISTING `RELEVANCY_MANUAL_EVAL_TOKEN` httpHeaderAuth credential (id `ugRJmVZfkSF6h316`) — same one `job-evaluate-manual` uses. So the dashboard's `PROPOSAL_REGEN_TOKEN` (falling back to `RELEVANCY_MANUAL_EVAL_TOKEN`) authenticates with **no new env var**. Claude model uses `Aleem Anthropic account` (id `fVtEWZhGXzEBZDoS`).
- **Request body it expects:** `{ task_id, profile_id, original_proposal, feedback_categories[], feedback_note, requested_by, request_id }`.
- **Response:** `{ proposal: <string>, model: 'claude-haiku-4-5-20251001' }`.
- **Flow:** R1 Webhook → R2 Validate (UUID task_id + non-empty profile_id + original_proposal) → R3 Load Job Payload (`GET /api/tasks/:id/job-payload`, onError→422 task_not_found) → R4 Load Profile Mapping (`GET /api/profiles/mapping`, match `entry.profile_id===profile_id`) → R5 Build Proposal Input (clone of parent `Build GPT Input` profile+job sections, then appends `=== PREVIOUS PROPOSAL ===` + `=== AGENT FEEDBACK ===` block) → AI Agent - Proposal Writer (Claude Haiku 4.5, temp 0.2, `maxTokens 4096`, `retryOnFail` 2×2s on the AGENT node, the parent's ~13.7KB "NEVER REFUSE" systemMessage VERBATIM + Structured Output Parser `autoFix`) → R7 Respond.
- **GOTCHA:** with `autoFix:true` the Structured Output Parser needs its OWN `ai_languageModel` edge — the Claude model must feed BOTH the agent AND the parser (mirrors the parent; smoke-test exec 20312 errored "A Model sub-node must be connected" until that edge was added).
- **Smoke test:** exec `20313`, 8.7s, 200, task `978f9fe1-…` (Saim) → fully rewritten proposal addressing injected feedback.
- **Snapshot:** `docs/proposal-regenerate (09-06-2026 working).json`. Owner agent: `n8n-workflow-keeper`.
- **Prompt-drift risk:** the proposal-writer system prompt is currently DUPLICATED between the parent and this workflow. If you edit the writer prompt in the parent, mirror it here (or factor both into a shared sub-workflow). Hand prompt/model/threshold edits to the `n8n-workflow-keeper` agent.

---

## 8. UI — `src/components/tasks/proposal-feedback-panel.tsx`

- Props: `{ taskId, currentProposal, viewerRole, viewerAgentId, onProposalApplied }`.
- `enabled = !!currentProposal && (admin || agentId)`. If no proposal yet, shows a dashed "becomes available once a proposal has been generated" hint.
- Category chips + note (2000 char counter). **Save feedback** and **Regenerate** both require ≥1 category. Regenerate shows a spinner (~8–10s) and on success calls `onProposalApplied(newText)`.
- **History** list: status badge, author + time, model, categories, note. Regenerated rows get **View / Copy / Restore**. **Restore** calls `onProposalApplied(row.regenerated_proposal)` (does NOT revert via the regenerate route — just re-applies that text to the card). Each row a viewer owns shows a **trash** delete.
- Wired in `task-full-view.tsx` (COLUMN 3) with `onProposalApplied={(text) => { updateCustomField("_proposal", text); setJob(prev => prev ? {...prev, proposal_text: text} : prev); }}` — persists to the card AND updates the shadowing `job.proposal_text` so the open view reflects it.

**Display precedence quirk:** `ProposalBox` and the panel read `job?.proposal_text ?? cf._proposal`. Regenerate writes to the card's `_proposal` (Task Board = source of truth per CLAUDE.md). For typical n8n-auto cards `_proposal` is the live value; if a card has a linked job with its own `proposal_text`, that shadows the card text in the display (the `setJob` in `onProposalApplied` keeps the open view consistent).

**RelevancyPanel self-hide (unrelated but adjacent):** `relevancy-panel.tsx:179` `if (scoreId === null && dlqId === null) return null;` — the AI Relevancy section only renders on cards that carry a `_relevancy_score_id`/`_relevancy_dlq_id`. Manually-created cards never show it. This is not affected by this feature.

---

## 9. Permissions & deletion

- **Admin:** delete any feedback/regeneration row on the task.
- **Agent:** delete only their own (`agent_id` match); server returns 403 otherwise.
- **Hard delete** — removes the training record permanently (no soft-delete). Deleting a `regenerated` row does NOT revert the proposal text already applied to the card.
- Minor UI quirk: the trash icon currently shows for an agent on ANY agent-authored row; the server enforces ownership (a non-owner click → 403 toast).

---

## 10. Env vars

- `PROPOSAL_REGEN_TOKEN` — OPTIONAL. Documented in `.env.relevancy.example`. If unset, the regenerate route falls back to `RELEVANCY_MANUAL_EVAL_TOKEN`, which is the token the n8n webhook actually validates against — so **no env change was needed** to ship.
- Reuses existing `N8N_WEBHOOK_BASE`.

---

## 11. How to make common changes

| Change | Where |
|--------|-------|
| Add/rename a feedback category | `src/lib/proposal-feedback-reasons.ts` (UI + validation auto-follow; no n8n change) |
| Tune regen rate limit | `checkProposalRegenRateLimit` defaults in `data.ts` (currently 30/hr, 150/day) |
| Change regen timeout | `N8N_TIMEOUT_MS` in `src/app/api/proposals/regenerate/route.ts` (60s) |
| Change the regen model / writer prompt | the n8n `proposal-regenerate` workflow (n8n-workflow-keeper) — and mirror the parent's prompt to avoid drift; the dashboard surfaces whatever `model` n8n returns |
| Soft-delete instead of hard-delete | add `deleted_at` to `proposal_feedback`, filter in `listProposalFeedbackForTask`, change `deleteProposalFeedback` to UPDATE |
| Admin training-export UI (not built) | new read-only page over `proposal_feedback WHERE status='regenerated'`; schema already supports it |

---

## 12. Key files

| File | Role |
|------|------|
| `src/lib/migrations/024_proposal_feedback.sql` (+ `_down`) | table DDL |
| `src/app/api/migrate/route.ts` | `run024()` + allowlist/dispatch |
| `src/lib/proposal-feedback-reasons.ts` | canonical categories |
| `src/lib/data.ts` | insert/list/delete + rate limit + context + writeback (search "PROPOSAL FEEDBACK + REGENERATION") |
| `src/app/api/tasks/[id]/proposal-feedback/route.ts` | feedback-only GET/POST/DELETE |
| `src/app/api/proposals/regenerate/route.ts` | regenerate (n8n call) |
| `src/components/tasks/proposal-feedback-panel.tsx` | UI panel + history |
| `src/components/tasks/task-full-view.tsx` | wiring (COLUMN 3) |
| `.env.relevancy.example` | `PROPOSAL_REGEN_TOKEN` |
| `docs/proposal-regenerate (09-06-2026 working).json` | n8n workflow snapshot |
| docs/claude/{migrations,data-flow,n8n-integration}.md | topic-doc write-backs |
| `src/app/api/tasks/[id]/manual-proposal/route.ts` | manual-proposal POST (§13) |
| `src/components/tasks/manual-proposal-panel.tsx` | "Your own proposal" card panel (§13) |
| `src/app/(dashboard)/manual-proposals/page.tsx` | admin review list page (§13) |
| `src/components/manual-proposals/manual-proposals-table.tsx` | admin list table (§13) |
| `src/lib/data.ts` → `listManualProposals` | admin list query (§13) |

---

## 13. Manual proposal capture ("I wrote my own proposal") — migration 025

**Added 2026-06-11.** Agents sometimes write a proposal by hand instead of using the AI draft. The
`ProposalBox` is editable, but a hand-edit there is *silent* — nothing records that the agent wrote
their own, and an admin can't see it as a distinct event or use it for training. This adds a
separate **"Your own proposal"** panel that records the hand-written proposal.

**Product shape (confirmed with stakeholder):**
- **Record only** — saving does **NOT** change the card's `_proposal` / `ProposalBox`. It is purely
  an additional recorded artifact (`applied=false`). This is the key difference from Regenerate,
  which overwrites the card.
- **Reuses `proposal_feedback`** via a new `status='manual'` (migration 025 extends the status CHECK).
  The pasted text goes in `regenerated_proposal` (the training-target slot), `original_proposal` =
  the card `_proposal` at paste time (may be NULL — an agent may write their own where the AI made
  none), `categories='{}'`, `model=NULL`.
- **Optional note** alongside the paste box.

**Storage:** no new table/columns. Migration 025 = drop+recreate `proposal_feedback_status_check` to
add `'manual'` (`run025()` in the migrate route + `025_proposal_feedback_manual.sql`). The three
`status` unions in `data.ts` (`ProposalFeedbackRow`, `ProposalFeedbackInsert`, the inline list-query
type) gained `'manual'`. `insertProposalFeedback` / `listProposalFeedbackForTask` /
`deleteProposalFeedback` are reused unchanged.

**Routes:**
- **POST `/api/tasks/[id]/manual-proposal`** `{ proposal_text, note? }` — same `assertCanFlagTaskRelevancy`
  gate and admin/agent author split as the feedback route; `proposal_text` required, ≤20000 chars;
  `note` ≤2000; resolves `getTaskProposalContext` (404 only if the task is missing, NOT if there's no
  proposal); inserts `status='manual'`, `applied=false`; → 201 `{ feedback_id, created_at }`.
- **GET / DELETE reuse `/api/tasks/[id]/proposal-feedback`** — manual rows live in the same table, so
  the shared GET returns them and the shared DELETE (admin-any / agent-own) removes them. No new
  GET/DELETE was added.

**UI — `manual-proposal-panel.tsx`** (in `task-full-view.tsx` COLUMN 3, directly under `ProposalBox`):
- Available whenever `admin || agentId` — **independent of whether a system proposal exists** (unlike
  `ProposalFeedbackPanel`, which is gated on `currentProposal`).
- Collapsed by default: an "I wrote my own proposal" button expands to a paste textarea + optional
  note + "Save my proposal". History below shows only `status==='manual'` rows with a violet
  **Manual** badge, author/time, note, and the text behind View/Copy. Delete (admin-any / agent-own)
  hits the shared DELETE. No "Restore" (record-only — promoting a manual proposal to the card is
  intentionally not offered).
- **Disjoint timelines:** `ProposalFeedbackPanel.loadHistory` filters `status !== 'manual'` so manual
  rows never appear in the AI feedback/regenerate timeline (and vice-versa).

**Admin review page — `/manual-proposals`** (added 2026-06-11, same day): a cross-task admin list of
all `status='manual'` rows, so admins don't have to open each card. Admin-only (route group
`(dashboard)/manual-proposals`, plus `/manual-proposals` added to `ADMIN_ROUTES` + the matcher in
`src/middleware.ts`; sidebar link in the "Relevancy" section). Mirrors `/relevancy-audit`: server
component, `AutoRefresh` 15s, reuses `AuditFilters` (`basePath="/manual-proposals"`,
`showHideOverridden={false}` → date-range + profile filter only), default window **30 days** (manual
proposals are low-volume). Data: `listManualProposals({ from, to, profileIds, limit=200 })` in
`data.ts` (returns `{ rows: ManualProposalListRow[], total }`, joins tasks for title/`_job_url` and
agents for author name). Table: `src/components/manual-proposals/manual-proposals-table.tsx` —
expandable rows (Time · Agent · Profile · Job/Task · Note) revealing the full proposal text with
Copy, "Open task card" (`/tasks?task=<id>`), "Open on Upwork", and Delete (admin deletes any via the
shared `DELETE /api/tasks/[id]/proposal-feedback`). Read-only otherwise — no new GET endpoint.

**Training-export note:** manual rows are human-written targets but the §3 export query filters
`status='regenerated'`. To include them, broaden to `status IN ('regenerated','manual')`. Deferred —
not wired yet.
