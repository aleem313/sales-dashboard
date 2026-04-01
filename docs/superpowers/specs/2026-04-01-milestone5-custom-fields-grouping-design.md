# Milestone 5: Custom Fields & Grouping — Design Spec

> **Date:** 2026-04-01
> **Status:** Approved
> **Approach:** Bottom-up (backend first, then task UI, management UI, grouping, filters, saved views)

---

## Decisions

| Decision | Choice |
|----------|--------|
| Custom field use case | Generic system, no pre-seeded fields |
| Board grouping DnD | Read-only in non-status modes; DnD only in Status (default) |
| Advanced filters | Extend existing bar + "More Filters" expandable section for custom fields |
| Saved views | Admin-only, board-level (visible to all members) |
| Field reordering | Up/down arrow buttons (no drag) |
| Field management UI | Slide-out sheet from board header |

---

## 5.1 Custom Field Backend

**No migration needed** — `custom_field_definitions` table and `tasks.custom_fields` JSONB already exist (migration 006).

### Data Layer (`task-data.ts`)

| Function | Purpose |
|----------|---------|
| `getCustomFieldDefinitions(projectId)` | Non-archived fields ordered by position |
| `getCustomFieldDefinition(fieldId)` | Single field lookup |
| `createCustomFieldDefinition(projectId, data)` | Insert, auto-set position to max+1 |
| `updateCustomFieldDefinition(fieldId, updates)` | Update name/options/required/show_on_card/position (type immutable) |
| `archiveCustomFieldDefinition(fieldId)` | Sets `archived = true`, values stay in task JSONB |
| `reorderCustomFieldDefinitions(projectId, orderedIds[])` | Bulk position update |

### Server Actions (`task-actions.ts`)

Mirror each data function. Write actions: admin-only (`session.user.role === 'admin'`). Read: any board member.

### API Routes

| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/api/projects/[id]/custom-fields` | Member+ |
| POST | `/api/projects/[id]/custom-fields` | Admin |
| PATCH | `/api/projects/[id]/custom-fields/[fid]` | Admin |
| DELETE | `/api/projects/[id]/custom-fields/[fid]` | Admin (archives, not deletes) |
| PATCH | `/api/projects/[id]/custom-fields/reorder` | Admin |

### Field Type Validation (on task value save)

| Type | Validation |
|------|-----------|
| Text | string, max 500 chars |
| Number | numeric, reject NaN |
| Dropdown | value must be in `options` array |
| Multi-select | all values must be in `options` array |
| Date | valid ISO date string |
| Boolean | true/false only |

---

## 5.2 Custom Field Management UI (Admin)

### Location

Slide-out sheet triggered from a "Fields" button in the board header toolbar (admin-only). Consistent with the existing board members panel pattern.

### Sheet Contents

- **Field list:** Ordered cards — name, type badge, required/optional indicator, show-on-card toggle
- **Per-field actions:** Edit (pencil), Archive (with confirmation)
- **"Add Field" button** expands inline form:
  - Name (text input, required)
  - Type (dropdown: Text, Number, Dropdown, Multi-select, Date, Boolean — **locked after creation**)
  - Options (Dropdown/Multi-select only — add/remove/reorder)
  - Required toggle
  - Show on Card toggle
- **Archived fields:** Collapsed accordion at bottom with "Restore" action
- **Reordering:** Up/down arrow buttons per field (no drag)

---

## 5.3 Custom Fields in Task UI

### Task Detail Drawer

Custom fields render **after Labels/Tags section, before Checklist**.

| Type | Renderer |
|------|----------|
| Text | Inline editable text input (click to edit, blur to save) |
| Number | Number input with increment/decrement |
| Dropdown | Select dropdown from field `options` |
| Multi-select | Multi-select checkboxes in popover |
| Date | Date picker (react-day-picker) |
| Boolean | Toggle switch |

- Required fields: red asterisk on label
- Empty optional fields: "Empty" placeholder, click to set
- Changes save immediately via existing `updateCustomField()` handler

### Task Card Display

Fields with `show_on_card = true`:
- Max 3 fields shown, ordered by field position
- Format: `Label: Value` in muted text, small font
- Position: below tags row, above bottom meta row
- Boolean: check/x icon. Date: formatted. Multi-select: count.

### Data Loading

- `getCustomFieldDefinitions(projectId)` added to board page's `Promise.all()`
- Board store gets `customFields: CustomFieldDefinition[]` property
- Available to drawer and cards

---

## 5.4 Board Grouping

### Group Selector

Dropdown in board header toolbar labeled "Group by:":
- **Status** (default) — current column view
- **Assignee** — one group per assignee + "Unassigned"
- **Priority** — Urgent, High, Medium, Low, None
- **Label** — one group per tag + "No Label"

Persisted in URL: `?group=status|assignee|priority|label`

### Rendering

| Mode | Behavior |
|------|----------|
| Status | Current board-view as-is. DnD enabled. Column management enabled. |
| Non-status | Virtual columns with group headers. **No DnD.** No "+" button. No column management. Cards click-to-open only. |

### Implementation

- Board store: `groupBy: 'status' | 'assignee' | 'priority' | 'label'`
- New function: `getGroupedTasks(tasks, groupBy, columns, members, tags)` returns `{ id, label, icon?, tasks[] }[]`
- `board-view.tsx`: if `groupBy === 'status'`, render current DnD board; otherwise render read-only grouped columns
- `BoardColumn` gets a `readOnly` prop to hide DnD, "+", and header management
- **Filters apply before grouping** — filter by Priority=High + group by Assignee shows assignee columns with only high-priority cards

---

## 5.5 Advanced Filter System

### Existing Filter Bar (Unchanged)

Quick-access dropdowns: Search, Column, Priority, Assignee, Tag.

### "More Filters" Expansion

Button at end of filter bar. Expands section below with custom field filter rows.

Each row: **Field selector** (dropdown of definitions) → **Operator** → **Value input** → **Remove (x)**

"Add Filter" button adds rows. "Clear all" removes all. AND logic between conditions.

### Operators by Type

| Type | Operators |
|------|-----------|
| Text | contains, equals, is empty, is not empty |
| Number | equals, greater than, less than, between, is empty |
| Dropdown | is, is not, is empty |
| Multi-select | contains any, contains all, is empty |
| Date | is, before, after, between, is empty |
| Boolean | is true, is false |

### Implementation

- Board store: `customFieldFilters: { fieldId: string, operator: string, value: unknown }[]`
- URL serialization: `?cf_[fieldId]=[operator]:[value]`
- `getFilteredTasks()` extended to apply custom field filters against `task.custom_fields` JSONB
- Client-side filtering only (task counts are small)

### UX

- "More Filters" button shows badge count when active
- Section collapses on re-click
- Per-row "x" to remove individual conditions

---

## 5.6 Saved Views

### Concept

Admin saves current filter + group as a named view. All board members can load views. No per-user private views.

### UI

- **"Views" dropdown** in board header toolbar
- Lists saved views for current board (name only)
- Click to apply (replaces current URL params)
- **"Save Current View"** at bottom (admin only) — prompts for name
- **"Delete" icon** per view (admin only, with confirmation)
- **"Unsaved changes" indicator** — dot or "(modified)" when current state differs from loaded view

### Data (existing `saved_views` table)

`filters` JSONB:
```json
{
  "column": "col-id",
  "priority": "high",
  "assignee": "agent-id",
  "search": "keyword",
  "tag": "tag-id",
  "customFields": [
    { "fieldId": "cf-id", "operator": "gt", "value": "50" }
  ]
}
```

`sort` JSONB:
```json
{
  "groupBy": "assignee"
}
```

The `shared` column is unused — all views are board-level. `owner_id` tracks creator for display only.

### API Routes

| Method | Endpoint | Access |
|--------|----------|--------|
| GET | `/api/projects/[id]/saved-views` | Member+ |
| POST | `/api/projects/[id]/saved-views` | Admin |
| DELETE | `/api/projects/[id]/saved-views/[vid]` | Admin |

No PATCH — delete and re-save to update.

### Implementation

- Data layer: `getSavedViews(projectId)`, `createSavedView(...)`, `deleteSavedView(viewId)`
- Server actions with admin auth checks
- Board store: `activeViewId: string | null`, `isViewModified: boolean` (computed)
- Loading a view: sets filter/group state in store + updates URL params

---

## Files Affected (Summary)

### New Files
- `src/app/api/projects/[id]/custom-fields/route.ts`
- `src/app/api/projects/[id]/custom-fields/[fid]/route.ts`
- `src/app/api/projects/[id]/custom-fields/reorder/route.ts`
- `src/app/api/projects/[id]/saved-views/route.ts`
- `src/app/api/projects/[id]/saved-views/[vid]/route.ts`
- `src/components/tasks/custom-field-renderer.tsx` (type-specific field renderers)
- `src/components/tasks/custom-fields-panel.tsx` (admin management sheet)
- `src/components/tasks/group-selector.tsx` (group-by dropdown)
- `src/components/tasks/views-dropdown.tsx` (saved views dropdown)
- `src/components/tasks/custom-field-filter.tsx` (filter row component)

### Modified Files
- `src/lib/task-data.ts` — custom field + saved view queries
- `src/lib/task-actions.ts` — custom field + saved view server actions
- `src/lib/stores/board-store.ts` — customFields, groupBy, customFieldFilters, activeViewId, isViewModified
- `src/components/tasks/task-detail-drawer.tsx` — custom field section
- `src/components/tasks/task-card.tsx` — show_on_card fields
- `src/components/tasks/board-view.tsx` — grouping logic + read-only mode
- `src/components/tasks/board-column.tsx` — readOnly prop
- `src/components/tasks/board-filter-bar.tsx` — "More Filters" section
- `src/components/tasks/board-header.tsx` — Fields button, Group selector, Views dropdown
- `src/app/(dashboard)/tasks/page.tsx` — load custom fields + saved views
- `src/app/(agent)/my-tasks/page.tsx` — pass custom fields to components
