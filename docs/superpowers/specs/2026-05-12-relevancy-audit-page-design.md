# Relevancy Audit Page — Design

**Date:** 2026-05-12
**Status:** Brainstormed, ready for implementation plan
**Scope:** Admin dashboard → new `/relevancy-audit` page + new API + small migration 020

## Problem

Phase 7 of the Upwork Relevancy Scoring rollout shipped today (parent workflow `EWnZg3svZWwcIRs4` now invokes the classifier sub-workflow `hi71jhPU8tmq7hEp` in Shadow mode). The classifier scores every Vollna-ingested job and writes a row to `relevancy_scores` with `effective_decision ∈ {proceed, reject, review}`.

In Shadow mode (current default), the verdict is logged but does **not** change routing — every job still gets a Claude proposal and lands on the taskboard with `_relevancy_*` custom_fields stamped on the card. The score is visible via the new Relevancy panel below the proposal section.

Before the admin trusts the classifier enough to flip `system_settings.relevancy.classifier_mode` from `'shadow'` to `'active'` — which causes jobs with `effective_decision='reject'` to be silently dropped (K4 End audit-only) — they need a way to **review the would-be-rejects and flag any that the classifier got wrong.**

Today the only way to see those rejects is to scroll the entire taskboard and read the Relevancy panel on each card. That's not a workflow that scales. There is also no way to capture admin disagreement with a classifier decision in a structured form that can later inform prompt tuning / threshold calibration.

## Goal

A new admin-only page at `/relevancy-audit` that:

1. Lists all classifier verdicts where `effective_decision = 'reject'` within a chosen time window.
2. For each row, surfaces enough context to judge whether the reject is correct (score, tier, top rejection reason, link to job on Upwork, expandable detail with gates and summary).
3. Lets the admin click a single button to **mark the verdict as a wrong reject**, with an optional free-text note explaining why. The override persists to the `relevancy_overrides` table for later use in calibration.

## Non-goals (out of v1)

- Showing `proceed` or `review` verdicts (those are already on the taskboard with the Relevancy panel).
- Showing Claude proposal refusals (`_proposalOk: false`). The proposal layer should not be a relevancy filter — that's the classifier's job. Tracked as a separate workstream (modify Claude system prompt so it always drafts, regardless of fit).
- Showing `relevancy_scores_dlq` rows (those are operational failures, not relevancy decisions).
- Showing Process Job operational rejections (`no_profile`, `rejected`).
- Acting on overrides automatically — i.e., closing the calibration loop. v1 only captures override data; the calibration loop (re-prompting, threshold adjustment, Phase 9 Task Card Evaluator integration) is later work.
- Creating a board card retroactively when an admin marks a reject as wrong. In Shadow mode the card already exists (Route Verdict's `shadow_any` branch always builds GPT + creates board task). In Active mode, the card won't exist, but that's a Phase 9 concern.
- Aggregate stats / charts / leaderboards.
- Bulk override / select-multiple actions.
- Filtering on score range, tier, classifier mode, or rejection-reason category. Date range + profile + override-status are enough for v1.

## Approach

### Where it lives

- New page: `src/app/(dashboard)/relevancy-audit/page.tsx`. Admin route group. Sits beside `/dashboard`, `/pipeline`, `/jobs`, etc.
- Sidebar nav entry: "Relevancy Audit" in `useNavSections()` admin section. No agent equivalent.
- Server component fetches the initial dataset using default filters (last 24h, all profiles, hide overridden). Client component handles filter interaction + override mutations.

### What's shown

**Top bar — filters (sticky):**

- **Date range** picker. Default = last 24h. Presets: Today / Last 24h / Last 7d / Custom. Reuses `<DateRangePicker>` already in use on `/dashboard`.
- **Profile** multi-select dropdown. Default = all profiles. Options pulled from `profiles WHERE active = true`.
- **Hide overridden** toggle. Default = ON (hide rows the admin has already flagged). Lets admin focus on unreviewed rejects.

**Table — one row per `relevancy_scores` row where `effective_decision = 'reject'`:**

| Column | Source | Format |
|---|---|---|
| Time | `evaluated_at` | Relative ("2h ago"), tooltip = absolute time |
| Profile | `profile_id` → join `profiles.profile_name` | Plain text + small color dot |
| Job | `job_external_id` + the linked task's title | Title text + external-link icon → opens `https://www.upwork.com/jobs/~<job_external_id>` in new tab |
| Score | `total_score` | Big number, color-coded (red <40, amber 40-59, blue 60-79, emerald ≥80). May be `null` on deterministic-reject — show "—" |
| Tier | `tier` | Badge ("reject", "marginal", etc.) |
| Top reason | `rejection_reasons[0]` | Outline badge with red border. When `rejection_reasons` is NULL/empty (rare on reject path — e.g. threshold flip with no LLM reason emitted), render an "(unspecified)" placeholder badge. |
| Mode | `classifier_mode_at_decision` | Small badge: amber "Shadow" / emerald "Active" |
| Threshold flip | `threshold_flipped` | Tiny "⚡ flipped" indicator when true (LLM proceeded but score < min, flipped to reject) |
| Action | derived from `relevancy_overrides` LEFT JOIN | Button "Mark as wrong reject" OR badge "✓ Flagged (note)" |

**Row click → inline expansion:**

When admin clicks anywhere on the row (except the action button or job link), the row expands vertically to reveal:
- **Summary** (`relevancy_scores.summary`): the LLM's qualitative one-paragraph feedback.
- **Gates pass/fail**: 11 rows, one per gate. Format: `1. Stack Match — pass: <evidence>` / `7. Job Availability — fail: <evidence>`. Visual pass=green-check, fail=red-x.
- **Components** (`relevancy_scores.components` JSON): table of 7 rubric components with their sub-scores.
- **Confidence**: a 0-100% bar.
- **Confidence warnings** (if any): `confidence_warnings` array as a list of small amber chips.
- **Snapshot used**: `snapshot_id` UUID (small + copy button).
- **Score ID**: `relevancy_scores.id` (small + copy button).

A single row stays expanded at a time (click another row to collapse the current).

### The override flow

When admin clicks "**Mark as wrong reject**" on a row:

1. The button area transforms in place into a small inline panel containing:
   - A textarea labeled "Why is this a wrong reject? (optional)" with placeholder text "Add a note for future calibration… (e.g. 'client mentioned AI integration despite the stack mismatch')."
   - Two buttons: **Save** (primary) and **Cancel**.
2. On Save:
   - POST to `/api/relevancy-audit/overrides` with `{ score_id, note }`.
   - On 200: the inline panel collapses, the row's action cell now shows a "✓ Flagged" badge (with the note text under the badge when row is expanded), and if "Hide overridden" toggle is ON, the row fades out and is removed from the visible list. Toast: "Override saved."
   - On 4xx/5xx: red inline error message, panel stays open with the note preserved.
3. On Cancel: panel collapses, no save, button reverts to "Mark as wrong reject."

**Re-opening an override:**

Clicking on a "✓ Flagged" badge expands the same inline panel, pre-filled with the saved note. The Save button changes to "Update," and a third button "Remove override" appears. Remove → DELETE `/api/relevancy-audit/overrides/[id]` → row's action reverts to the "Mark as wrong reject" button.

### Schema changes — migration 020

The existing `relevancy_overrides` table (migration 018) was designed for AGENT overrides via taskboard column moves. It has constraints that don't fit the admin-from-audit-page flow:

- `task_id UUID NOT NULL` — admin overrides in Active mode (future) won't have a task. Even in Shadow mode the spec is "agent moved this card" which doesn't apply to admin from an audit page.
- `classifier_decision TEXT NOT NULL` — fine to keep, copy from `relevancy_scores.decision`.
- `agent_action TEXT NOT NULL` — phrased for taskboard moves ('moved_to_na', etc.). Doesn't describe admin's "I disagree" action.
- `agent_id UUID REFERENCES agents(id)` — admins don't have rows in `agents` table (per CLAUDE.md, admin auth is via `ADMIN_CREDENTIALS` env var).
- `override_reason TEXT[]` — designed as a multi-select from PRD §6.2 reason labels. We want free-text instead.

**Migration 020** (`020_relevancy_overrides_admin.sql`):

```sql
ALTER TABLE relevancy_overrides
  ADD COLUMN IF NOT EXISTS override_type TEXT NOT NULL DEFAULT 'agent_move'
    CHECK (override_type IN ('agent_move', 'admin_audit')),
  ADD COLUMN IF NOT EXISTS admin_id TEXT,
  ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE relevancy_overrides ALTER COLUMN task_id DROP NOT NULL;
ALTER TABLE relevancy_overrides ALTER COLUMN agent_action DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_overrides_type ON relevancy_overrides (override_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_overrides_admin ON relevancy_overrides (admin_id, created_at DESC) WHERE override_type = 'admin_audit';
```

Down script `020_relevancy_overrides_admin_down.sql` rolls back the three new columns + restores NOT NULL constraints. Existing `agent_move` rows have `override_type = 'agent_move'` set by the default; no data migration required.

Idempotent — safe to re-run.

### Persisting an admin override

When admin POSTs an override:

```sql
INSERT INTO relevancy_overrides (
  score_id, task_id, classifier_decision, agent_action, agent_id,
  override_type, admin_id, note, source, created_at
) VALUES (
  $score_id,
  $task_id,                   -- resolved server-side via tasks.custom_fields->>'_relevancy_score_id' = score_id::text, NULL if not found
  $classifier_decision,       -- copied from relevancy_scores.decision
  NULL,                       -- now-nullable
  NULL,                       -- no agent for admin overrides
  'admin_audit',
  $admin_session_user_id,     -- session.user.id from server-side auth check
  $note,                      -- nullable; from request body
  $source,                    -- copied from relevancy_scores.source
  NOW()
);
```

### API routes

**New routes under `src/app/api/relevancy-audit/`:**

#### `GET /api/relevancy-audit/rejects`

Query params:
- `from` (ISO date, default = now - 24h)
- `to` (ISO date, default = now)
- `profile_ids` (comma-separated list of `profiles.profile_id`, optional)
- `hide_overridden` (boolean, default = true)

Returns:
```json
{
  "rows": [
    {
      "score_id": 7,
      "evaluated_at": "...",
      "profile_id": "shayan",
      "profile_name": "Shayan",
      "job_external_id": "022054169865710768036",
      "job_title": "...",     // looked up from joined task
      "task_id": "uuid",       // nullable
      "total_score": 32,
      "tier": "marginal",
      "decision": "reject",
      "effective_decision": "reject",
      "threshold_flipped": false,
      "rejection_reasons": ["Out of stack"],
      "classifier_mode_at_decision": "shadow",
      "override": null OR {
        "override_id": 5,
        "note": "client mentioned AI in description...",
        "created_at": "..."
      }
    }
  ],
  "total": 42
}
```

SQL shape:
```sql
SELECT
  rs.id AS score_id,
  rs.evaluated_at,
  rs.profile_id,
  p.profile_name,
  rs.job_external_id,
  COALESCE(t.title, 'Untitled') AS job_title,
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
  AND rs.evaluated_at BETWEEN $from AND $to
  AND ($profile_ids IS NULL OR rs.profile_id = ANY($profile_ids))
  AND ($hide_overridden = FALSE OR ro.id IS NULL)
ORDER BY rs.evaluated_at DESC
LIMIT 200
```

Pagination: simple `LIMIT 200` for v1, no cursor. If a single 24h window exceeds 200 rejects we'll add cursor pagination later.

#### `GET /api/relevancy-audit/rejects/[id]`

Returns the full `relevancy_scores` row JSON for the expand-row detail view. Includes `gates_passed`, `gates_failed`, `gates_evidence`, `components`, `summary`, `confidence`, `confidence_warnings`, `snapshot_id`.

#### `POST /api/relevancy-audit/overrides`

Body: `{ score_id: bigint, note?: string }`

Server-side:
1. Auth check — must be admin (`session.user.role === 'admin'`).
2. Look up `relevancy_scores` row by `score_id`. Reject 404 if not found.
3. Look up `task_id` via `SELECT id FROM tasks WHERE custom_fields->>'_relevancy_score_id' = $1` (nullable).
4. Insert `relevancy_overrides` row with `override_type='admin_audit'`, `admin_id=session.user.id`, `note=trim(body.note) || null`, copy `classifier_decision` from the score, copy `source` from the score.
5. Return `{ override_id, created_at }`.

`revalidatePath('/relevancy-audit')` so the table re-renders on next visit.

#### `DELETE /api/relevancy-audit/overrides/[id]`

Server-side:
1. Auth check — admin only.
2. Verify the override row exists AND has `override_type = 'admin_audit'` AND `admin_id = session.user.id` (admins can only delete their own overrides).
3. Hard DELETE the row.
4. Return 204.

`revalidatePath('/relevancy-audit')`.

### Data dependencies on existing systems

- **`relevancy_scores`**: written by the classifier sub-workflow via `POST /api/relevancy-scores` (built in Phase 6 part A). Already producing rows in Shadow mode.
- **`profiles`**: read-only join for display name.
- **`tasks`**: read-only join via `custom_fields->>'_relevancy_score_id'` to surface the job title and link to board card.
- **`relevancy_overrides`**: new schema additions per migration 020.

### Permissions

- Page is in `(dashboard)/` route group → already gated by admin middleware (`src/middleware.ts`).
- API routes verify `session.user.role === 'admin'` on every call.
- Agent role gets 403 on any `/api/relevancy-audit/*` route.

### UI components

- `src/app/(dashboard)/relevancy-audit/page.tsx` — server component, parses search params, fetches initial data.
- `src/components/relevancy-audit/audit-filters.tsx` — date range + profile multi-select + hide-overridden toggle.
- `src/components/relevancy-audit/rejects-table.tsx` — the main table + row expansion logic.
- `src/components/relevancy-audit/reject-row.tsx` — one row + its expanded detail + override action.
- `src/components/relevancy-audit/override-panel.tsx` — the inline note textarea + save/cancel/remove buttons.
- Reuses: `<Badge>` from `ui/badge`, `<DateRangePicker>` from existing dashboard, `<MultiSelect>` if available (otherwise plain `<select multiple>`).

No new third-party dependencies.

### Caching & freshness

- Initial server-rendered page: no cache (`export const dynamic = 'force-dynamic'`). Each navigation re-queries.
- After an override action, the client-side state updates optimistically (fade row out if "hide overridden" is on), and `revalidatePath('/relevancy-audit')` is called server-side so a subsequent navigation re-renders with fresh data.
- No real-time subscription (no SSE/WebSocket). Manual refresh via the existing `<AutoRefresh>` component is optional — add later if useful.

### Error handling

- `relevancy_scores` table empty / no rows in date range → show "No rejected verdicts in this window. Try a wider date range." empty state.
- Override save fails (DB error, network) → inline red error in the override panel, do not collapse. User can retry.
- Task lookup returns NULL (e.g., the task was deleted, or in Active mode the card was never created) → row still renders, the "Job" column shows just the `job_external_id` link without a title; the external-link icon still works.
- Snapshot_id NULL (deterministic reject path) → omit "Snapshot used" line in the expanded detail.

## Acceptance criteria

1. Admin opens `/relevancy-audit` and sees a list of jobs the classifier rejected in the last 24h, default-filtered to all profiles, hiding any they've already flagged.
2. Admin changes the date range to "Last 7d" and the list updates accordingly.
3. Admin filters to a single profile (e.g. Shayan) and the list narrows.
4. Admin clicks a row → row expands and shows the LLM's summary, the 11 gates with evidence, the components scoring, and the confidence bar.
5. Admin clicks "Mark as wrong reject" → inline panel appears, types a note, clicks Save → toast confirms, row gets "✓ Flagged" badge, and (if hide-overridden is on) the row fades out.
6. Admin toggles "Hide overridden" OFF → previously flagged rows reappear with their "✓ Flagged" badges and notes visible in the expanded detail.
7. Admin clicks "✓ Flagged" on a previously-flagged row → panel re-opens with note pre-filled, can update or click "Remove override" to delete.
8. Agent (non-admin) navigating to `/relevancy-audit` is redirected to `/my-dashboard` per existing middleware behavior.
9. Migration 020 runs cleanly on Contabo (idempotent re-run safe).
10. Override data verifiable in DB: `SELECT * FROM relevancy_overrides WHERE override_type = 'admin_audit'` returns the flagged rows with `admin_id`, `note`, and a populated `task_id` for any rows where the score's task exists.

## Open questions (deferred)

- Should there be a per-row link "View card on board" → opens the task detail modal in a new tab? Easy to add later; not in v1 because admin's primary action here is judgment, not navigation.
- Should the override panel let admin pick from a structured reason list (`override_reason TEXT[]` field) in addition to / instead of free-text? Today's design uses free-text only. If we find admins write the same handful of reasons over and over, we can add a structured dropdown later. v1's simplicity wins.
- Eventual feedback loop into the classifier — Phase 9 work, not v1.

## Files added / modified

**Added:**
- `src/app/(dashboard)/relevancy-audit/page.tsx`
- `src/components/relevancy-audit/audit-filters.tsx`
- `src/components/relevancy-audit/rejects-table.tsx`
- `src/components/relevancy-audit/reject-row.tsx`
- `src/components/relevancy-audit/override-panel.tsx`
- `src/app/api/relevancy-audit/rejects/route.ts` (GET)
- `src/app/api/relevancy-audit/rejects/[id]/route.ts` (GET)
- `src/app/api/relevancy-audit/overrides/route.ts` (POST)
- `src/app/api/relevancy-audit/overrides/[id]/route.ts` (DELETE)
- `src/lib/migrations/020_relevancy_overrides_admin.sql`
- `src/lib/migrations/020_relevancy_overrides_admin_down.sql`

**Modified:**
- `src/lib/sidebar-nav.ts` (or wherever `useNavSections()` lives) — add the "Relevancy Audit" admin-only entry.
- `src/app/api/migrate/route.ts` — register migration 020.
- `CLAUDE.md` — add migration 020 row to the migration version history table.
