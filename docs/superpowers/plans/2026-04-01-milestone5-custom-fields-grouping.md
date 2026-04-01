# Milestone 5: Custom Fields & Grouping — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-defined custom fields per board, board grouping views, extended filtering with custom field conditions, and admin-managed saved views.

**Architecture:** Bottom-up — data layer first, then API routes, then UI components. Custom fields use the existing `custom_field_definitions` table and `tasks.custom_fields` JSONB column (migration 006). No new migration needed. Board grouping renders virtual columns in read-only mode. Saved views serialize filter+group state to the existing `saved_views` table.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, @vercel/postgres (raw SQL), Zustand, shadcn/ui, Tailwind CSS 4, lucide-react, date-fns, sonner

**Spec:** `docs/superpowers/specs/2026-04-01-milestone5-custom-fields-grouping-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/app/api/projects/[id]/custom-fields/route.ts` | GET list / POST create custom field definitions |
| `src/app/api/projects/[id]/custom-fields/[fid]/route.ts` | PATCH update / DELETE archive field definition |
| `src/app/api/projects/[id]/custom-fields/reorder/route.ts` | PATCH bulk reorder field positions |
| `src/app/api/projects/[id]/saved-views/route.ts` | GET list / POST create saved views |
| `src/app/api/projects/[id]/saved-views/[vid]/route.ts` | DELETE saved view |
| `src/components/tasks/custom-field-renderer.tsx` | Type-specific renderers for all 6 field types (used in drawer + card) |
| `src/components/tasks/custom-fields-panel.tsx` | Admin slide-out sheet for field management |
| `src/components/tasks/group-selector.tsx` | Group-by dropdown for board header |
| `src/components/tasks/views-dropdown.tsx` | Saved views dropdown for board header |
| `src/components/tasks/custom-field-filter.tsx` | Single custom field filter row + "More Filters" container |

### Modified Files
| File | Changes |
|------|---------|
| `src/lib/task-data.ts` | Add `CustomFieldDefinition` and `SavedView` types + 9 new query functions |
| `src/lib/task-actions.ts` | Add 8 new server actions for custom fields + saved views |
| `src/lib/stores/board-store.ts` | Add `customFields`, `groupBy`, `customFieldFilters`, `activeViewId`, computed `isViewModified` |
| `src/components/tasks/task-detail-drawer.tsx` | Add custom field section after Labels |
| `src/components/tasks/task-card.tsx` | Show `show_on_card` custom fields |
| `src/components/tasks/board-view.tsx` | Add grouping logic, read-only mode for non-status groups |
| `src/components/tasks/board-column.tsx` | Add `readOnly` prop |
| `src/components/tasks/board-filter-bar.tsx` | Add "More Filters" expandable section |
| `src/components/tasks/board-header.tsx` | Add Fields button, GroupSelector, ViewsDropdown |
| `src/app/(dashboard)/tasks/page.tsx` | Load custom fields + saved views, pass to components |
| `src/app/(agent)/my-tasks/page.tsx` | Load custom fields, pass to components |

---

## Task 1: Custom Field Types & Data Layer

**Files:**
- Modify: `src/lib/task-data.ts`

- [ ] **Step 1: Add CustomFieldDefinition and SavedView types**

Add after the existing `TaskTag` interface (around line 46):

```typescript
export interface CustomFieldDefinition {
  id: string;
  project_id: string;
  name: string;
  field_type: "text" | "number" | "dropdown" | "multi_select" | "date" | "boolean";
  options: string[] | null;
  required: boolean;
  position: number;
  archived: boolean;
  show_on_card: boolean;
  created_at: string;
}

export interface SavedView {
  id: string;
  project_id: string;
  owner_id: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown>;
  created_at: string;
  owner_name?: string;
}
```

- [ ] **Step 2: Add getCustomFieldDefinitions query**

```typescript
export async function getCustomFieldDefinitions(
  projectId: string,
  includeArchived = false
): Promise<CustomFieldDefinition[]> {
  const result = includeArchived
    ? await sql`
        SELECT * FROM custom_field_definitions
        WHERE project_id = ${projectId}
        ORDER BY position ASC, created_at ASC
      `
    : await sql`
        SELECT * FROM custom_field_definitions
        WHERE project_id = ${projectId} AND archived = false
        ORDER BY position ASC, created_at ASC
      `;
  return result.rows as CustomFieldDefinition[];
}
```

- [ ] **Step 3: Add createCustomFieldDefinition query**

```typescript
export async function createCustomFieldDefinition(
  projectId: string,
  data: {
    name: string;
    field_type: CustomFieldDefinition["field_type"];
    options?: string[] | null;
    required?: boolean;
    show_on_card?: boolean;
  }
): Promise<CustomFieldDefinition> {
  // Get max position
  const posResult = await sql`
    SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
    FROM custom_field_definitions
    WHERE project_id = ${projectId}
  `;
  const nextPos = posResult.rows[0].next_pos as number;

  const result = await sql`
    INSERT INTO custom_field_definitions (project_id, name, field_type, options, required, position, show_on_card)
    VALUES (
      ${projectId},
      ${data.name},
      ${data.field_type},
      ${data.options ? JSON.stringify(data.options) : null},
      ${data.required ?? false},
      ${nextPos},
      ${data.show_on_card ?? false}
    )
    RETURNING *
  `;
  return result.rows[0] as CustomFieldDefinition;
}
```

- [ ] **Step 4: Add updateCustomFieldDefinition query**

```typescript
export async function updateCustomFieldDefinition(
  fieldId: string,
  fields: {
    name?: string;
    options?: string[] | null;
    required?: boolean;
    show_on_card?: boolean;
  }
): Promise<CustomFieldDefinition | null> {
  const result = await sql`
    UPDATE custom_field_definitions SET
      name = COALESCE(${fields.name ?? null}, name),
      options = COALESCE(${fields.options !== undefined ? JSON.stringify(fields.options) : null}, options),
      required = COALESCE(${fields.required ?? null}, required),
      show_on_card = COALESCE(${fields.show_on_card ?? null}, show_on_card)
    WHERE id = ${fieldId} AND archived = false
    RETURNING *
  `;
  return (result.rows[0] as CustomFieldDefinition) ?? null;
}
```

- [ ] **Step 5: Add archiveCustomFieldDefinition query**

```typescript
export async function archiveCustomFieldDefinition(fieldId: string): Promise<boolean> {
  const result = await sql`
    UPDATE custom_field_definitions SET archived = true WHERE id = ${fieldId} RETURNING id
  `;
  return result.rows.length > 0;
}

export async function restoreCustomFieldDefinition(fieldId: string): Promise<boolean> {
  const result = await sql`
    UPDATE custom_field_definitions SET archived = false WHERE id = ${fieldId} RETURNING id
  `;
  return result.rows.length > 0;
}
```

- [ ] **Step 6: Add reorderCustomFieldDefinitions query**

```typescript
export async function reorderCustomFieldDefinitions(
  projectId: string,
  orderedIds: string[]
): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await sql`
      UPDATE custom_field_definitions
      SET position = ${i + 1}
      WHERE id = ${orderedIds[i]} AND project_id = ${projectId}
    `;
  }
}
```

- [ ] **Step 7: Add saved view queries**

```typescript
export async function getSavedViews(projectId: string): Promise<SavedView[]> {
  const result = await sql`
    SELECT sv.*, a.name AS owner_name
    FROM saved_views sv
    LEFT JOIN agents a ON a.id = sv.owner_id
    WHERE sv.project_id = ${projectId}
    ORDER BY sv.created_at ASC
  `;
  return result.rows as SavedView[];
}

export async function createSavedView(data: {
  project_id: string;
  owner_id: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown>;
}): Promise<SavedView> {
  const result = await sql`
    INSERT INTO saved_views (project_id, owner_id, name, filters, sort)
    VALUES (
      ${data.project_id},
      ${data.owner_id},
      ${data.name},
      ${JSON.stringify(data.filters)},
      ${JSON.stringify(data.sort)}
    )
    RETURNING *
  `;
  return result.rows[0] as SavedView;
}

export async function deleteSavedView(viewId: string): Promise<boolean> {
  const result = await sql`DELETE FROM saved_views WHERE id = ${viewId} RETURNING id`;
  return result.rows.length > 0;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/task-data.ts
git commit -m "feat(m5): add custom field + saved view types and data layer queries"
```

---

## Task 2: Server Actions for Custom Fields & Saved Views

**Files:**
- Modify: `src/lib/task-actions.ts`

- [ ] **Step 1: Add imports**

Add to the existing import block from `@/lib/task-data`:

```typescript
import {
  // ... existing imports ...
  getCustomFieldDefinitions,
  createCustomFieldDefinition,
  updateCustomFieldDefinition,
  archiveCustomFieldDefinition,
  restoreCustomFieldDefinition,
  reorderCustomFieldDefinitions,
  getSavedViews,
  createSavedView,
  deleteSavedView,
} from "@/lib/task-data";
```

- [ ] **Step 2: Add custom field server actions**

Add at the end of the file, after the TAG ACTIONS section:

```typescript
// ============================================================
// CUSTOM FIELD ACTIONS
// ============================================================

export async function getCustomFieldDefinitionsAction(projectId: string, includeArchived = false) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return await getCustomFieldDefinitions(projectId, includeArchived);
}

export async function createCustomFieldAction(
  projectId: string,
  data: {
    name: string;
    field_type: "text" | "number" | "dropdown" | "multi_select" | "date" | "boolean";
    options?: string[] | null;
    required?: boolean;
    show_on_card?: boolean;
  }
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  if (!data.name?.trim()) throw new Error("Name is required");

  const field = await createCustomFieldDefinition(projectId, {
    ...data,
    name: data.name.trim(),
  });
  revalidateBoard();
  return field;
}

export async function updateCustomFieldAction(
  fieldId: string,
  fields: {
    name?: string;
    options?: string[] | null;
    required?: boolean;
    show_on_card?: boolean;
  }
) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const field = await updateCustomFieldDefinition(fieldId, fields);
  if (!field) throw new Error("Field not found");
  revalidateBoard();
  return field;
}

export async function archiveCustomFieldAction(fieldId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const archived = await archiveCustomFieldDefinition(fieldId);
  if (!archived) throw new Error("Field not found");
  revalidateBoard();
}

export async function restoreCustomFieldAction(fieldId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const restored = await restoreCustomFieldDefinition(fieldId);
  if (!restored) throw new Error("Field not found");
  revalidateBoard();
}

export async function reorderCustomFieldsAction(projectId: string, orderedIds: string[]) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  await reorderCustomFieldDefinitions(projectId, orderedIds);
  revalidateBoard();
}
```

- [ ] **Step 3: Add saved view server actions**

```typescript
// ============================================================
// SAVED VIEW ACTIONS
// ============================================================

export async function getSavedViewsAction(projectId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return await getSavedViews(projectId);
}

export async function createSavedViewAction(data: {
  project_id: string;
  name: string;
  filters: Record<string, unknown>;
  sort: Record<string, unknown>;
}) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  if (!data.name?.trim()) throw new Error("Name is required");

  // Use agentId if available, otherwise find one for system admin
  let ownerId = session.user.agentId;
  if (!ownerId) {
    const { sql } = await import("@vercel/postgres");
    const agent = await sql`SELECT id FROM agents WHERE active = true LIMIT 1`;
    if (agent.rows.length === 0) throw new Error("No active agents");
    ownerId = agent.rows[0].id as string;
  }

  const view = await createSavedView({
    ...data,
    name: data.name.trim(),
    owner_id: ownerId,
  });
  revalidateBoard();
  return view;
}

export async function deleteSavedViewAction(viewId: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  if (session.user.role !== "admin") throw new Error("Admin only");

  const deleted = await deleteSavedView(viewId);
  if (!deleted) throw new Error("View not found");
  revalidateBoard();
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/task-actions.ts
git commit -m "feat(m5): add server actions for custom fields and saved views"
```

---

## Task 3: API Routes for Custom Fields & Saved Views

**Files:**
- Create: `src/app/api/projects/[id]/custom-fields/route.ts`
- Create: `src/app/api/projects/[id]/custom-fields/[fid]/route.ts`
- Create: `src/app/api/projects/[id]/custom-fields/reorder/route.ts`
- Create: `src/app/api/projects/[id]/saved-views/route.ts`
- Create: `src/app/api/projects/[id]/saved-views/[vid]/route.ts`

- [ ] **Step 1: Create custom fields list/create route**

Create `src/app/api/projects/[id]/custom-fields/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getCustomFieldDefinitions, createCustomFieldDefinition, isProjectMember } from "@/lib/task-data";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  if (session.user.agentId) {
    const isMember = await isProjectMember(projectId, session.user.agentId);
    if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const includeArchived = req.nextUrl.searchParams.get("archived") === "true";
  const fields = await getCustomFieldDefinitions(projectId, includeArchived);
  return NextResponse.json(fields);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { id: projectId } = await params;
  const body = await req.json();

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 422 });
  }

  const validTypes = ["text", "number", "dropdown", "multi_select", "date", "boolean"];
  if (!validTypes.includes(body.field_type)) {
    return NextResponse.json({ error: "Invalid field type" }, { status: 422 });
  }

  const field = await createCustomFieldDefinition(projectId, {
    name: body.name.trim(),
    field_type: body.field_type,
    options: body.options ?? null,
    required: body.required ?? false,
    show_on_card: body.show_on_card ?? false,
  });
  return NextResponse.json(field, { status: 201 });
}
```

- [ ] **Step 2: Create custom field single-item route**

Create `src/app/api/projects/[id]/custom-fields/[fid]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { updateCustomFieldDefinition, archiveCustomFieldDefinition } from "@/lib/task-data";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fid: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { fid } = await params;
  const body = await req.json();

  const field = await updateCustomFieldDefinition(fid, {
    name: body.name,
    options: body.options,
    required: body.required,
    show_on_card: body.show_on_card,
  });
  if (!field) return NextResponse.json({ error: "Field not found" }, { status: 404 });
  return NextResponse.json(field);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; fid: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { fid } = await params;
  const archived = await archiveCustomFieldDefinition(fid);
  if (!archived) return NextResponse.json({ error: "Field not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Create reorder route**

Create `src/app/api/projects/[id]/custom-fields/reorder/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reorderCustomFieldDefinitions } from "@/lib/task-data";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { id: projectId } = await params;
  const body = await req.json();

  if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return NextResponse.json({ error: "orderedIds array required" }, { status: 422 });
  }

  await reorderCustomFieldDefinitions(projectId, body.orderedIds);
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Create saved views routes**

Create `src/app/api/projects/[id]/saved-views/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSavedViews, createSavedView, isProjectMember } from "@/lib/task-data";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: projectId } = await params;

  if (session.user.agentId) {
    const isMember = await isProjectMember(projectId, session.user.agentId);
    if (!isMember) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const views = await getSavedViews(projectId);
  return NextResponse.json(views);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { id: projectId } = await params;
  const body = await req.json();

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 422 });
  }

  // Resolve owner
  let ownerId = session.user.agentId;
  if (!ownerId) {
    const { sql } = await import("@vercel/postgres");
    const agent = await sql`SELECT id FROM agents WHERE active = true LIMIT 1`;
    if (agent.rows.length === 0) return NextResponse.json({ error: "No active agents" }, { status: 500 });
    ownerId = agent.rows[0].id as string;
  }

  const view = await createSavedView({
    project_id: projectId,
    owner_id: ownerId,
    name: body.name.trim(),
    filters: body.filters ?? {},
    sort: body.sort ?? {},
  });
  return NextResponse.json(view, { status: 201 });
}
```

- [ ] **Step 5: Create saved view delete route**

Create `src/app/api/projects/[id]/saved-views/[vid]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deleteSavedView } from "@/lib/task-data";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; vid: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { vid } = await params;
  const deleted = await deleteSavedView(vid);
  if (!deleted) return NextResponse.json({ error: "View not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/[id]/custom-fields/ src/app/api/projects/[id]/saved-views/
git commit -m "feat(m5): add API routes for custom fields and saved views"
```

---

## Task 4: Extend Board Store

**Files:**
- Modify: `src/lib/stores/board-store.ts`

- [ ] **Step 1: Add new imports and extend the state interface**

Replace the entire file with the extended version. Add to imports:

```typescript
import { create } from "zustand";
import type { BoardColumn, Task, ProjectMember, CustomFieldDefinition, SavedView } from "@/lib/task-data";
```

Add to the `BoardState` interface after the existing `filters` block:

```typescript
  // Custom fields
  customFields: CustomFieldDefinition[];

  // Grouping
  groupBy: "status" | "assignee" | "priority" | "label";

  // Custom field filters
  customFieldFilters: { fieldId: string; operator: string; value: unknown }[];

  // Saved views
  savedViews: SavedView[];
  activeViewId: string | null;
```

- [ ] **Step 2: Add new actions to the interface**

Add after the existing action declarations:

```typescript
  // Custom fields
  setCustomFields: (fields: CustomFieldDefinition[]) => void;

  // Grouping
  setGroupBy: (groupBy: BoardState["groupBy"]) => void;

  // Custom field filters
  setCustomFieldFilters: (filters: BoardState["customFieldFilters"]) => void;
  addCustomFieldFilter: (filter: { fieldId: string; operator: string; value: unknown }) => void;
  removeCustomFieldFilter: (index: number) => void;
  clearCustomFieldFilters: () => void;

  // Saved views
  setSavedViews: (views: SavedView[]) => void;
  setActiveViewId: (viewId: string | null) => void;
  getIsViewModified: () => boolean;

  // Extended helpers
  getGroupedTasks: () => { id: string; label: string; color?: string; tasks: Task[] }[];
```

- [ ] **Step 3: Add initial state values**

Add to the initial state in `create<BoardState>`:

```typescript
  customFields: [],
  groupBy: "status",
  customFieldFilters: [],
  savedViews: [],
  activeViewId: null,
```

- [ ] **Step 4: Update initBoard to accept customFields**

Update the `initBoard` function signature and body:

```typescript
  initBoard: (data) => {
    set({
      columns: data.columns,
      tasks: data.tasks,
      members: data.members,
      projectId: data.projectId,
      customFields: data.customFields ?? [],
      activeTaskId: null,
      previousState: null,
    });
  },
```

Also update the `initBoard` parameter type in the interface:

```typescript
  initBoard: (data: {
    columns: BoardColumn[];
    tasks: Task[];
    members: ProjectMember[];
    projectId: string;
    customFields?: CustomFieldDefinition[];
  }) => void;
```

- [ ] **Step 5: Add action implementations**

```typescript
  setCustomFields: (fields) => set({ customFields: fields }),

  setGroupBy: (groupBy) => set({ groupBy }),

  setCustomFieldFilters: (filters) => set({ customFieldFilters: filters }),
  addCustomFieldFilter: (filter) => set((state) => ({
    customFieldFilters: [...state.customFieldFilters, filter],
  })),
  removeCustomFieldFilter: (index) => set((state) => ({
    customFieldFilters: state.customFieldFilters.filter((_, i) => i !== index),
  })),
  clearCustomFieldFilters: () => set({ customFieldFilters: [] }),

  setSavedViews: (views) => set({ savedViews: views }),
  setActiveViewId: (viewId) => set({ activeViewId: viewId }),

  getIsViewModified: () => {
    const { activeViewId, savedViews, filters, groupBy, customFieldFilters } = get();
    if (!activeViewId) return false;
    const view = savedViews.find((v) => v.id === activeViewId);
    if (!view) return false;
    const viewFilters = view.filters as Record<string, unknown>;
    const viewSort = view.sort as Record<string, unknown>;
    // Compare current state to saved view
    const currentState = JSON.stringify({ filters, groupBy, customFieldFilters });
    const savedState = JSON.stringify({
      filters: {
        column: viewFilters.column,
        priority: viewFilters.priority,
        assignee: viewFilters.assignee,
        search: viewFilters.search,
        tag: viewFilters.tag,
      },
      groupBy: viewSort.groupBy ?? "status",
      customFieldFilters: viewFilters.customFields ?? [],
    });
    return currentState !== savedState;
  },
```

- [ ] **Step 6: Extend getFilteredTasks to include custom field filters**

Replace the existing `getFilteredTasks` with:

```typescript
  getFilteredTasks: () => {
    const { tasks, filters, customFieldFilters } = get();
    return tasks.filter((t) => {
      // Standard filters
      if (filters.column && t.column_id !== filters.column) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (
        filters.assignee &&
        !(t.assignees ?? []).some((a) => a.agent_id === filters.assignee)
      ) return false;
      if (
        filters.search &&
        !t.title.toLowerCase().includes(filters.search.toLowerCase())
      ) return false;
      if (
        filters.tag &&
        !(t.tags ?? []).some((tag) => tag.id === filters.tag)
      ) return false;

      // Custom field filters
      for (const cf of customFieldFilters) {
        const cfValues = (t.custom_fields ?? {}) as Record<string, unknown>;
        const val = cfValues[cf.fieldId];

        switch (cf.operator) {
          case "equals":
            if (String(val ?? "") !== String(cf.value)) return false;
            break;
          case "contains":
            if (!String(val ?? "").toLowerCase().includes(String(cf.value).toLowerCase())) return false;
            break;
          case "gt":
            if (Number(val) <= Number(cf.value)) return false;
            break;
          case "lt":
            if (Number(val) >= Number(cf.value)) return false;
            break;
          case "is":
            if (val !== cf.value) return false;
            break;
          case "is_not":
            if (val === cf.value) return false;
            break;
          case "before":
            if (!val || new Date(String(val)) >= new Date(String(cf.value))) return false;
            break;
          case "after":
            if (!val || new Date(String(val)) <= new Date(String(cf.value))) return false;
            break;
          case "is_true":
            if (val !== true) return false;
            break;
          case "is_false":
            if (val !== false) return false;
            break;
          case "is_empty":
            if (val !== undefined && val !== null && val !== "") return false;
            break;
          case "is_not_empty":
            if (val === undefined || val === null || val === "") return false;
            break;
          case "contains_any": {
            const arr = Array.isArray(val) ? val : [];
            const targets = Array.isArray(cf.value) ? cf.value : [];
            if (!targets.some((t: unknown) => arr.includes(t))) return false;
            break;
          }
          case "contains_all": {
            const arr2 = Array.isArray(val) ? val : [];
            const targets2 = Array.isArray(cf.value) ? cf.value : [];
            if (!targets2.every((t: unknown) => arr2.includes(t))) return false;
            break;
          }
        }
      }

      return true;
    });
  },
```

- [ ] **Step 7: Add getGroupedTasks implementation**

```typescript
  getGroupedTasks: () => {
    const { groupBy, columns, members } = get();
    const filtered = get().getFilteredTasks();

    if (groupBy === "status") {
      return columns.map((col) => ({
        id: col.id,
        label: col.name,
        color: col.color,
        tasks: filtered.filter((t) => t.column_id === col.id).sort((a, b) => a.position - b.position),
      }));
    }

    if (groupBy === "assignee") {
      const groups: { id: string; label: string; color?: string; tasks: Task[] }[] = [];
      const assigned = new Set<string>();

      for (const member of members) {
        const memberTasks = filtered.filter((t) =>
          (t.assignees ?? []).some((a) => a.agent_id === member.agent_id)
        );
        groups.push({ id: member.agent_id, label: member.name, tasks: memberTasks });
        memberTasks.forEach((t) => assigned.add(t.id));
      }

      const unassigned = filtered.filter((t) => !assigned.has(t.id));
      if (unassigned.length > 0) {
        groups.push({ id: "_unassigned", label: "Unassigned", color: "#6b7280", tasks: unassigned });
      }
      return groups;
    }

    if (groupBy === "priority") {
      const levels = [
        { key: "urgent", label: "Urgent", color: "#ef4444" },
        { key: "high", label: "High", color: "#f97316" },
        { key: "medium", label: "Medium", color: "#eab308" },
        { key: "low", label: "Low", color: "#3b82f6" },
        { key: null, label: "No Priority", color: "#6b7280" },
      ];
      return levels.map((p) => ({
        id: p.key ?? "_none",
        label: p.label,
        color: p.color,
        tasks: filtered.filter((t) => (t.priority ?? null) === p.key),
      }));
    }

    if (groupBy === "label") {
      // Collect all unique tags from filtered tasks
      const tagMap = new Map<string, { name: string; color: string; tasks: Task[] }>();
      const noLabel: Task[] = [];

      for (const task of filtered) {
        const tags = task.tags ?? [];
        if (tags.length === 0) {
          noLabel.push(task);
        } else {
          for (const tag of tags) {
            if (!tagMap.has(tag.id)) {
              tagMap.set(tag.id, { name: tag.name, color: tag.color, tasks: [] });
            }
            tagMap.get(tag.id)!.tasks.push(task);
          }
        }
      }

      const groups = Array.from(tagMap.entries()).map(([id, data]) => ({
        id,
        label: data.name,
        color: data.color,
        tasks: data.tasks,
      }));

      if (noLabel.length > 0) {
        groups.push({ id: "_no_label", label: "No Label", color: "#6b7280", tasks: noLabel });
      }
      return groups;
    }

    return [];
  },
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/stores/board-store.ts
git commit -m "feat(m5): extend board store with custom fields, grouping, filters, saved views"
```

---

## Task 5: Custom Field Renderer Component

**Files:**
- Create: `src/components/tasks/custom-field-renderer.tsx`

- [ ] **Step 1: Create the component file**

```typescript
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, Check } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { CustomFieldDefinition } from "@/lib/task-data";

interface CustomFieldRendererProps {
  field: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean; // For card display
}

export function CustomFieldRenderer({ field, value, onChange, compact }: CustomFieldRendererProps) {
  if (compact) {
    return <CompactFieldValue field={field} value={value} />;
  }

  switch (field.field_type) {
    case "text":
      return <TextField value={value} onChange={onChange} />;
    case "number":
      return <NumberField value={value} onChange={onChange} />;
    case "dropdown":
      return <DropdownField field={field} value={value} onChange={onChange} />;
    case "multi_select":
      return <MultiSelectField field={field} value={value} onChange={onChange} />;
    case "date":
      return <DateField value={value} onChange={onChange} />;
    case "boolean":
      return <BooleanField value={value} onChange={onChange} />;
    default:
      return null;
  }
}

function TextField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value ?? "")); setEditing(true); }}
        className="text-sm text-left w-full min-h-[32px] px-2 py-1 rounded hover:bg-muted transition-colors"
      >
        {value ? String(value) : <span className="text-muted-foreground">Empty</span>}
      </button>
    );
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== String(value ?? "")) onChange(draft || null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { setEditing(false); if (draft !== String(value ?? "")) onChange(draft || null); }
        if (e.key === "Escape") { setEditing(false); setDraft(String(value ?? "")); }
      }}
      maxLength={500}
      className="h-8 text-sm"
      autoFocus
    />
  );
}

function NumberField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true); }}
        className="text-sm text-left w-full min-h-[32px] px-2 py-1 rounded hover:bg-muted transition-colors"
      >
        {value != null ? String(value) : <span className="text-muted-foreground">Empty</span>}
      </button>
    );
  }

  return (
    <Input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const num = parseFloat(draft);
        if (!isNaN(num)) onChange(num);
        else if (draft === "") onChange(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          setEditing(false);
          const num = parseFloat(draft);
          if (!isNaN(num)) onChange(num);
          else if (draft === "") onChange(null);
        }
        if (e.key === "Escape") { setEditing(false); }
      }}
      className="h-8 text-sm"
      autoFocus
    />
  );
}

function DropdownField({ field, value, onChange }: { field: CustomFieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
  const options = (field.options ?? []) as string[];
  return (
    <Select value={String(value ?? "")} onValueChange={(v) => onChange(v === "_clear" ? null : v)}>
      <SelectTrigger className="h-8 text-sm">
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="_clear">
          <span className="text-muted-foreground">None</span>
        </SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiSelectField({ field, value, onChange }: { field: CustomFieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
  const options = (field.options ?? []) as string[];
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggle(opt: string) {
    const newVal = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    onChange(newVal.length > 0 ? newVal : null);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-8 text-sm justify-start font-normal w-full">
          {selected.length > 0 ? selected.join(", ") : <span className="text-muted-foreground">Select...</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            <div className={cn(
              "flex h-4 w-4 items-center justify-center rounded border",
              selected.includes(opt) && "bg-primary border-primary"
            )}>
              {selected.includes(opt) && <Check className="h-3 w-3 text-primary-foreground" />}
            </div>
            {opt}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function DateField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const dateValue = value ? new Date(String(value)) : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-8 text-sm justify-start font-normal w-full">
          <CalendarIcon className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
          {dateValue ? format(dateValue, "MMM d, yyyy") : <span className="text-muted-foreground">Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={(date) => onChange(date ? date.toISOString().split("T")[0] : null)}
        />
      </PopoverContent>
    </Popover>
  );
}

function BooleanField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  return (
    <Switch
      checked={value === true}
      onCheckedChange={(checked) => onChange(checked)}
    />
  );
}

/** Compact display for task cards */
function CompactFieldValue({ field, value }: { field: CustomFieldDefinition; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;

  let display: string;
  switch (field.field_type) {
    case "boolean":
      display = value === true ? "Yes" : "No";
      break;
    case "date":
      display = format(new Date(String(value)), "MMM d");
      break;
    case "multi_select":
      display = Array.isArray(value) ? `${value.length} selected` : String(value);
      break;
    default:
      display = String(value);
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[120px]">
      <span className="font-medium">{field.name}:</span>
      <span>{display}</span>
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/tasks/custom-field-renderer.tsx
git commit -m "feat(m5): add custom field type-specific renderer component"
```

---

## Task 6: Custom Fields in Task Detail Drawer

**Files:**
- Modify: `src/components/tasks/task-detail-drawer.tsx`

- [ ] **Step 1: Add import for CustomFieldRenderer and store access**

Add to the existing imports at the top:

```typescript
import { CustomFieldRenderer } from "./custom-field-renderer";
import type { CustomFieldDefinition } from "@/lib/task-data";
```

- [ ] **Step 2: Add custom field definitions state**

Add after the existing `projectTags` state (around line 139):

```typescript
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);
```

- [ ] **Step 3: Fetch custom field definitions when task loads**

Add a useEffect after the existing projectTags fetch (around line 182):

```typescript
  // Fetch custom field definitions
  useEffect(() => {
    if (!task?.project_id) return;
    fetch(`/api/projects/${task.project_id}/custom-fields`)
      .then((r) => r.json())
      .then(setCustomFieldDefs)
      .catch(() => {});
  }, [task?.project_id]);
```

- [ ] **Step 4: Add custom fields section in the drawer body**

Insert the custom fields section after the Labels/Tags section and before the Checklist section. Find the `{/* Checklist */}` comment and insert before it:

```tsx
            {/* Custom Fields */}
            {customFieldDefs.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Custom Fields
                </h4>
                <div className="space-y-2">
                  {customFieldDefs.map((field) => {
                    const cfValues = (task.custom_fields ?? {}) as Record<string, unknown>;
                    const val = cfValues[field.id];
                    return (
                      <div key={field.id} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-28 shrink-0 truncate" title={field.name}>
                          {field.name}
                          {field.required && <span className="text-red-500 ml-0.5">*</span>}
                        </span>
                        <div className="flex-1 min-w-0">
                          <CustomFieldRenderer
                            field={field}
                            value={val}
                            onChange={(newVal) => updateCustomField(field.id, newVal)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/task-detail-drawer.tsx
git commit -m "feat(m5): add custom fields section to task detail drawer"
```

---

## Task 7: Custom Fields on Task Card

**Files:**
- Modify: `src/components/tasks/task-card.tsx`

- [ ] **Step 1: Add import**

Add to imports:

```typescript
import { CustomFieldRenderer } from "./custom-field-renderer";
import type { CustomFieldDefinition } from "@/lib/task-data";
```

- [ ] **Step 2: Add customFields prop**

Add to the `TaskCardProps` interface:

```typescript
  customFields?: CustomFieldDefinition[];
```

Also add to the `TaskCardContent` destructured props and the `SortableTaskCard` component (pass it through).

- [ ] **Step 3: Add custom field display to card**

Inside `TaskCardContent`, after the existing meta row and before the bottom row (`hasBottomRow`), add:

```tsx
            {/* Custom fields on card */}
            {(() => {
              const showFields = (customFields ?? []).filter((f) => f.show_on_card).slice(0, 3);
              if (showFields.length === 0) return null;
              const cfValues = (task.custom_fields ?? {}) as Record<string, unknown>;
              const visibleFields = showFields.filter((f) => {
                const v = cfValues[f.id];
                return v !== null && v !== undefined && v !== "";
              });
              if (visibleFields.length === 0) return null;
              return (
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {visibleFields.map((f) => (
                    <CustomFieldRenderer
                      key={f.id}
                      field={f}
                      value={cfValues[f.id]}
                      onChange={() => {}}
                      compact
                    />
                  ))}
                </div>
              );
            })()}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tasks/task-card.tsx
git commit -m "feat(m5): show custom fields on task cards"
```

---

## Task 8: Custom Fields Management Panel

**Files:**
- Create: `src/components/tasks/custom-fields-panel.tsx`

- [ ] **Step 1: Create the panel component**

```typescript
"use client";

import { useState, useTransition } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Settings2,
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createCustomFieldAction,
  updateCustomFieldAction,
  archiveCustomFieldAction,
  restoreCustomFieldAction,
  reorderCustomFieldsAction,
} from "@/lib/task-actions";
import type { CustomFieldDefinition } from "@/lib/task-data";

interface CustomFieldsPanelProps {
  projectId: string;
  fields: CustomFieldDefinition[];
  onFieldsChange: () => void;
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  number: "Number",
  dropdown: "Dropdown",
  multi_select: "Multi-select",
  date: "Date",
  boolean: "Boolean",
};

const FIELD_TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-500/15 text-blue-600",
  number: "bg-green-500/15 text-green-600",
  dropdown: "bg-purple-500/15 text-purple-600",
  multi_select: "bg-pink-500/15 text-pink-600",
  date: "bg-orange-500/15 text-orange-600",
  boolean: "bg-teal-500/15 text-teal-600",
};

export function CustomFieldsPanel({ projectId, fields, onFieldsChange }: CustomFieldsPanelProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Add form
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<CustomFieldDefinition["field_type"]>("text");
  const [newRequired, setNewRequired] = useState(false);
  const [newShowOnCard, setNewShowOnCard] = useState(false);
  const [newOptions, setNewOptions] = useState<string[]>([]);
  const [newOptionDraft, setNewOptionDraft] = useState("");

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRequired, setEditRequired] = useState(false);
  const [editShowOnCard, setEditShowOnCard] = useState(false);
  const [editOptions, setEditOptions] = useState<string[]>([]);
  const [editOptionDraft, setEditOptionDraft] = useState("");

  // Archive confirm
  const [archiveConfirm, setArchiveConfirm] = useState<string | null>(null);

  // Archived section
  const [showArchived, setShowArchived] = useState(false);

  const activeFields = fields.filter((f) => !f.archived);
  const archivedFields = fields.filter((f) => f.archived);

  function resetAddForm() {
    setAdding(false);
    setNewName("");
    setNewType("text");
    setNewRequired(false);
    setNewShowOnCard(false);
    setNewOptions([]);
    setNewOptionDraft("");
  }

  function handleCreate() {
    if (!newName.trim()) return;
    startTransition(async () => {
      try {
        const needsOptions = newType === "dropdown" || newType === "multi_select";
        await createCustomFieldAction(projectId, {
          name: newName.trim(),
          field_type: newType,
          options: needsOptions ? newOptions : null,
          required: newRequired,
          show_on_card: newShowOnCard,
        });
        toast.success("Field created");
        resetAddForm();
        onFieldsChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create field");
      }
    });
  }

  function startEdit(field: CustomFieldDefinition) {
    setEditingId(field.id);
    setEditName(field.name);
    setEditRequired(field.required);
    setEditShowOnCard(field.show_on_card);
    setEditOptions((field.options as string[]) ?? []);
    setEditOptionDraft("");
  }

  function handleUpdate() {
    if (!editingId || !editName.trim()) return;
    const field = fields.find((f) => f.id === editingId);
    const needsOptions = field?.field_type === "dropdown" || field?.field_type === "multi_select";
    startTransition(async () => {
      try {
        await updateCustomFieldAction(editingId, {
          name: editName.trim(),
          required: editRequired,
          show_on_card: editShowOnCard,
          options: needsOptions ? editOptions : undefined,
        });
        toast.success("Field updated");
        setEditingId(null);
        onFieldsChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update field");
      }
    });
  }

  function handleArchive(fieldId: string) {
    startTransition(async () => {
      try {
        await archiveCustomFieldAction(fieldId);
        toast.success("Field archived");
        setArchiveConfirm(null);
        onFieldsChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to archive field");
      }
    });
  }

  function handleRestore(fieldId: string) {
    startTransition(async () => {
      try {
        await restoreCustomFieldAction(fieldId);
        toast.success("Field restored");
        onFieldsChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to restore field");
      }
    });
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const ids = activeFields.map((f) => f.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    startTransition(async () => {
      try {
        await reorderCustomFieldsAction(projectId, ids);
        onFieldsChange();
      } catch {
        toast.error("Failed to reorder");
      }
    });
  }

  function handleMoveDown(index: number) {
    if (index === activeFields.length - 1) return;
    const ids = activeFields.map((f) => f.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    startTransition(async () => {
      try {
        await reorderCustomFieldsAction(projectId, ids);
        onFieldsChange();
      } catch {
        toast.error("Failed to reorder");
      }
    });
  }

  const needsOptionsInput = newType === "dropdown" || newType === "multi_select";

  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOpen(true)}>
        <Settings2 className="h-3.5 w-3.5" />
        Fields
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[400px] sm:w-[440px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Custom Fields</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            {/* Active fields */}
            {activeFields.map((field, index) => (
              <div key={field.id} className="rounded-lg border p-3 space-y-2">
                {editingId === field.id ? (
                  /* Edit mode */
                  <div className="space-y-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Field name"
                      className="h-8 text-sm"
                      maxLength={50}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Required</span>
                      <Switch checked={editRequired} onCheckedChange={setEditRequired} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Show on card</span>
                      <Switch checked={editShowOnCard} onCheckedChange={setEditShowOnCard} />
                    </div>
                    {(field.field_type === "dropdown" || field.field_type === "multi_select") && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Options</span>
                        <div className="flex flex-wrap gap-1">
                          {editOptions.map((opt, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                              {opt}
                              <button onClick={() => setEditOptions(editOptions.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <Input
                            value={editOptionDraft}
                            onChange={(e) => setEditOptionDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && editOptionDraft.trim()) {
                                setEditOptions([...editOptions, editOptionDraft.trim()]);
                                setEditOptionDraft("");
                              }
                            }}
                            placeholder="Add option..."
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} className="h-7 text-xs">Cancel</Button>
                      <Button size="sm" onClick={handleUpdate} disabled={isPending || !editName.trim()} className="h-7 text-xs">
                        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Display mode */
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{field.name}</span>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${FIELD_TYPE_COLORS[field.field_type]}`}>
                          {FIELD_TYPE_LABELS[field.field_type]}
                        </span>
                        {field.required && <span className="text-[10px] text-red-500">Required</span>}
                        {field.show_on_card && <span className="text-[10px] text-muted-foreground">On card</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => handleMoveUp(index)} disabled={index === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleMoveDown(index)} disabled={index === activeFields.length - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => startEdit(field)} className="p-1 rounded hover:bg-muted">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setArchiveConfirm(field.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive">
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {activeFields.length === 0 && !adding && (
              <p className="text-sm text-muted-foreground text-center py-4">No custom fields defined yet.</p>
            )}

            {/* Add field form */}
            {adding ? (
              <div className="rounded-lg border border-dashed p-3 space-y-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Field name"
                  className="h-8 text-sm"
                  maxLength={50}
                  autoFocus
                />
                <Select value={newType} onValueChange={(v) => setNewType(v as CustomFieldDefinition["field_type"])}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FIELD_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsOptionsInput && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Options</span>
                    <div className="flex flex-wrap gap-1">
                      {newOptions.map((opt, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                          {opt}
                          <button onClick={() => setNewOptions(newOptions.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <Input
                      value={newOptionDraft}
                      onChange={(e) => setNewOptionDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newOptionDraft.trim()) {
                          e.preventDefault();
                          setNewOptions([...newOptions, newOptionDraft.trim()]);
                          setNewOptionDraft("");
                        }
                      }}
                      placeholder="Type option and press Enter..."
                      className="h-7 text-xs"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Required</span>
                  <Switch checked={newRequired} onCheckedChange={setNewRequired} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Show on card</span>
                  <Switch checked={newShowOnCard} onCheckedChange={setNewShowOnCard} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={resetAddForm} className="h-7 text-xs">Cancel</Button>
                  <Button size="sm" onClick={handleCreate} disabled={isPending || !newName.trim()} className="h-7 text-xs">
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add Field
              </Button>
            )}

            {/* Archived fields */}
            {archivedFields.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showArchived ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                  Archived ({archivedFields.length})
                </button>
                {showArchived && (
                  <div className="mt-2 space-y-2">
                    {archivedFields.map((field) => (
                      <div key={field.id} className="flex items-center justify-between rounded-lg border border-dashed p-2 opacity-60">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{field.name}</span>
                          <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${FIELD_TYPE_COLORS[field.field_type]}`}>
                            {FIELD_TYPE_LABELS[field.field_type]}
                          </span>
                        </div>
                        <button onClick={() => handleRestore(field.id)} className="p-1 rounded hover:bg-muted" title="Restore">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Archive confirmation */}
      <Dialog open={!!archiveConfirm} onOpenChange={() => setArchiveConfirm(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Archive Field</DialogTitle>
            <DialogDescription>
              This field will be hidden from the UI but existing values on tasks will be preserved. You can restore it later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setArchiveConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => archiveConfirm && handleArchive(archiveConfirm)} disabled={isPending}>
              {isPending ? "Archiving..." : "Archive"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/tasks/custom-fields-panel.tsx
git commit -m "feat(m5): add custom field management panel (admin)"
```

---

## Task 9: Group Selector & Board Grouping in Board View

**Files:**
- Create: `src/components/tasks/group-selector.tsx`
- Modify: `src/components/tasks/board-view.tsx`
- Modify: `src/components/tasks/board-column.tsx`

- [ ] **Step 1: Create GroupSelector component**

Create `src/components/tasks/group-selector.tsx`:

```typescript
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Layers } from "lucide-react";
import { useBoardStore } from "@/lib/stores/board-store";

export function GroupSelector() {
  const store = useBoardStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const groupBy = value as "status" | "assignee" | "priority" | "label";
    store.setGroupBy(groupBy);

    const params = new URLSearchParams(searchParams.toString());
    if (groupBy === "status") params.delete("group");
    else params.set("group", groupBy);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
      <Select value={store.groupBy} onValueChange={handleChange}>
        <SelectTrigger className="h-7 w-[120px] text-xs border-none bg-transparent shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="status">Status</SelectItem>
          <SelectItem value="assignee">Assignee</SelectItem>
          <SelectItem value="priority">Priority</SelectItem>
          <SelectItem value="label">Label</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 2: Add readOnly prop to BoardColumnComponent**

In `src/components/tasks/board-column.tsx`, add `readOnly?: boolean` to `BoardColumnProps` interface.

When `readOnly` is true, hide:
- The column header dropdown menu (admin actions)
- The "+" add task button
- The droppable/sortable wrappers (render plain task cards without dnd)

Add this conditional at the start of the component render:

```typescript
  // In BoardColumnComponent, after destructuring props:
  if (readOnly) {
    return (
      <div className="flex h-full w-[280px] shrink-0 flex-col">
        <div className="flex items-center gap-2 px-1 pb-3">
          <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: column.color }} />
          <h3 className="text-sm font-semibold truncate">{column.name}</h3>
          <span className="ml-auto text-xs text-muted-foreground rounded-full bg-muted px-2 py-0.5">
            {tasks.length}
          </span>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {tasks.map((task) => (
            <TaskCardContent
              key={task.id}
              task={task}
              columnColor={column.color}
              onClick={() => onTaskClick?.(task.id)}
            />
          ))}
          {tasks.length === 0 && (
            <div className="rounded-lg border border-dashed p-4 text-center">
              <p className="text-xs text-muted-foreground">No tasks</p>
            </div>
          )}
        </div>
      </div>
    );
  }
```

Add `TaskCardContent` to the imports if not already imported:
```typescript
import { SortableTaskCard, TaskCardContent } from "./task-card";
```

- [ ] **Step 3: Add grouped view to board-view.tsx**

In `src/components/tasks/board-view.tsx`, after the existing render logic, add a conditional that checks `store.groupBy`:

After the line `const filteredTasks = store.getFilteredTasks();` (around line 347), add:

```typescript
  const isGroupedView = store.groupBy !== "status";
  const groupedData = isGroupedView ? store.getGroupedTasks() : [];
```

Then wrap the return statement so the DndContext only renders in status mode. Before the existing `return (<> <DndContext ...>`, add:

```tsx
  if (isGroupedView) {
    return (
      <>
        <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
          {groupedData.map((group) => (
            <BoardColumnComponent
              key={group.id}
              column={{
                id: group.id,
                project_id: projectId ?? "",
                name: group.label,
                position: 0,
                color: group.color ?? "#6b7280",
                is_done: false,
                wip_limit: null,
                created_at: "",
                task_count: group.tasks.length,
              }}
              tasks={group.tasks}
              readOnly
              onTaskClick={handleTaskClick}
            />
          ))}
          {groupedData.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-xl bg-muted/50 p-8">
                <h3 className="text-lg font-semibold">No tasks match</h3>
                <p className="mt-1 text-sm text-muted-foreground">Try adjusting your filters.</p>
              </div>
            </div>
          )}
        </div>
        {/* Per-column task creation modal — not shown in grouped view */}
      </>
    );
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tasks/group-selector.tsx src/components/tasks/board-view.tsx src/components/tasks/board-column.tsx
git commit -m "feat(m5): add board grouping — group by assignee, priority, label"
```

---

## Task 10: "More Filters" for Custom Fields

**Files:**
- Create: `src/components/tasks/custom-field-filter.tsx`
- Modify: `src/components/tasks/board-filter-bar.tsx`

- [ ] **Step 1: Create CustomFieldFilter component**

Create `src/components/tasks/custom-field-filter.tsx`:

```typescript
"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Plus, ChevronDown, ChevronRight, Filter } from "lucide-react";
import { useBoardStore } from "@/lib/stores/board-store";
import type { CustomFieldDefinition } from "@/lib/task-data";

interface MoreFiltersProps {
  customFields: CustomFieldDefinition[];
}

const OPERATORS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  text: [
    { value: "contains", label: "contains" },
    { value: "equals", label: "equals" },
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
  ],
  number: [
    { value: "equals", label: "equals" },
    { value: "gt", label: "greater than" },
    { value: "lt", label: "less than" },
    { value: "is_empty", label: "is empty" },
  ],
  dropdown: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "is_empty", label: "is empty" },
  ],
  multi_select: [
    { value: "contains_any", label: "contains any" },
    { value: "contains_all", label: "contains all" },
    { value: "is_empty", label: "is empty" },
  ],
  date: [
    { value: "is", label: "is" },
    { value: "before", label: "before" },
    { value: "after", label: "after" },
    { value: "is_empty", label: "is empty" },
  ],
  boolean: [
    { value: "is_true", label: "is true" },
    { value: "is_false", label: "is false" },
  ],
};

function needsValueInput(operator: string): boolean {
  return !["is_empty", "is_not_empty", "is_true", "is_false"].includes(operator);
}

export function MoreFilters({ customFields }: MoreFiltersProps) {
  const store = useBoardStore();
  const filters = store.customFieldFilters;
  const expanded = filters.length > 0;

  if (customFields.length === 0) return null;

  function addFilter() {
    const firstField = customFields[0];
    const ops = OPERATORS_BY_TYPE[firstField.field_type] ?? [];
    store.addCustomFieldFilter({
      fieldId: firstField.id,
      operator: ops[0]?.value ?? "equals",
      value: "",
    });
  }

  function updateFilter(index: number, updates: Partial<{ fieldId: string; operator: string; value: unknown }>) {
    const newFilters = [...filters];
    newFilters[index] = { ...newFilters[index], ...updates };

    // Reset operator and value when field changes
    if (updates.fieldId) {
      const field = customFields.find((f) => f.id === updates.fieldId);
      const ops = OPERATORS_BY_TYPE[field?.field_type ?? "text"] ?? [];
      newFilters[index].operator = ops[0]?.value ?? "equals";
      newFilters[index].value = "";
    }

    store.setCustomFieldFilters(newFilters);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            if (filters.length === 0) addFilter();
            else store.clearCustomFieldFilters();
          }}
        >
          <Filter className="h-3.5 w-3.5" />
          More Filters
          {filters.length > 0 && (
            <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {filters.length}
            </span>
          )}
        </Button>
        {filters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => store.clearCustomFieldFilters()}
          >
            Clear all
          </Button>
        )}
      </div>

      {expanded && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          {filters.map((filter, index) => {
            const field = customFields.find((f) => f.id === filter.fieldId);
            const operators = OPERATORS_BY_TYPE[field?.field_type ?? "text"] ?? [];
            const showValue = needsValueInput(filter.operator);

            return (
              <div key={index} className="flex items-center gap-2">
                {/* Field selector */}
                <Select value={filter.fieldId} onValueChange={(v) => updateFilter(index, { fieldId: v })}>
                  <SelectTrigger className="h-7 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {customFields.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Operator */}
                <Select value={filter.operator} onValueChange={(v) => updateFilter(index, { operator: v })}>
                  <SelectTrigger className="h-7 w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => (
                      <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Value input */}
                {showValue && (
                  <>
                    {field?.field_type === "dropdown" ? (
                      <Select value={String(filter.value ?? "")} onValueChange={(v) => updateFilter(index, { value: v })}>
                        <SelectTrigger className="h-7 w-[120px] text-xs">
                          <SelectValue placeholder="Value..." />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options as string[] ?? []).map((opt) => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field?.field_type === "date" ? (
                      <Input
                        type="date"
                        value={String(filter.value ?? "")}
                        onChange={(e) => updateFilter(index, { value: e.target.value })}
                        className="h-7 w-[130px] text-xs"
                      />
                    ) : (
                      <Input
                        type={field?.field_type === "number" ? "number" : "text"}
                        value={String(filter.value ?? "")}
                        onChange={(e) => updateFilter(index, { value: field?.field_type === "number" ? parseFloat(e.target.value) || "" : e.target.value })}
                        placeholder="Value..."
                        className="h-7 w-[120px] text-xs"
                      />
                    )}
                  </>
                )}

                {/* Remove */}
                <button
                  onClick={() => store.removeCustomFieldFilter(index)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addFilter}>
            <Plus className="h-3 w-3" />
            Add condition
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Integrate into BoardFilterBar**

In `src/components/tasks/board-filter-bar.tsx`:

Add import:
```typescript
import { MoreFilters } from "./custom-field-filter";
import type { CustomFieldDefinition } from "@/lib/task-data";
```

Add `customFields?: CustomFieldDefinition[]` to `BoardFilterBarProps`.

Add `<MoreFilters customFields={customFields ?? []} />` after the existing Clear button, before the closing `</div>`.

Update the clear filters handler to also clear custom field filters:
```typescript
onClick={() => {
  store.clearFilters();
  store.clearCustomFieldFilters();
  // ... existing URL param cleanup
}}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/tasks/custom-field-filter.tsx src/components/tasks/board-filter-bar.tsx
git commit -m "feat(m5): add 'More Filters' section with custom field conditions"
```

---

## Task 11: Saved Views Dropdown

**Files:**
- Create: `src/components/tasks/views-dropdown.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bookmark, Trash2, Plus, Loader2, Circle } from "lucide-react";
import { toast } from "sonner";
import { useBoardStore } from "@/lib/stores/board-store";
import { createSavedViewAction, deleteSavedViewAction } from "@/lib/task-actions";
import type { SavedView } from "@/lib/task-data";

interface ViewsDropdownProps {
  projectId: string;
  isAdmin: boolean;
}

export function ViewsDropdown({ projectId, isAdmin }: ViewsDropdownProps) {
  const store = useBoardStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const views = store.savedViews;
  const isModified = store.getIsViewModified();

  function loadView(view: SavedView) {
    const viewFilters = view.filters as Record<string, unknown>;
    const viewSort = view.sort as Record<string, unknown>;

    // Apply filters
    store.setFilters({
      column: viewFilters.column as string | undefined,
      priority: viewFilters.priority as string | undefined,
      assignee: viewFilters.assignee as string | undefined,
      search: viewFilters.search as string | undefined,
      tag: viewFilters.tag as string | undefined,
    });

    // Apply custom field filters
    const cfFilters = (viewFilters.customFields ?? []) as { fieldId: string; operator: string; value: unknown }[];
    store.setCustomFieldFilters(cfFilters);

    // Apply grouping
    const groupBy = (viewSort.groupBy as string) ?? "status";
    store.setGroupBy(groupBy as "status" | "assignee" | "priority" | "label");

    // Set active view
    store.setActiveViewId(view.id);

    // Update URL
    const params = new URLSearchParams();
    const boardParam = searchParams.get("board");
    if (boardParam) params.set("board", boardParam);
    if (viewFilters.column) params.set("column", viewFilters.column as string);
    if (viewFilters.priority) params.set("priority", viewFilters.priority as string);
    if (viewFilters.assignee) params.set("assignee", viewFilters.assignee as string);
    if (viewFilters.search) params.set("search", viewFilters.search as string);
    if (viewFilters.tag) params.set("tag", viewFilters.tag as string);
    if (groupBy !== "status") params.set("group", groupBy);
    router.push(`?${params.toString()}`, { scroll: false });

    setOpen(false);
  }

  function handleSave() {
    if (!saveName.trim()) return;
    startTransition(async () => {
      try {
        const view = await createSavedViewAction({
          project_id: projectId,
          name: saveName.trim(),
          filters: {
            ...store.filters,
            customFields: store.customFieldFilters,
          },
          sort: {
            groupBy: store.groupBy,
          },
        });
        store.setSavedViews([...views, view]);
        store.setActiveViewId(view.id);
        toast.success("View saved");
        setSaveOpen(false);
        setSaveName("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save view");
      }
    });
  }

  function handleDelete(viewId: string) {
    startTransition(async () => {
      try {
        await deleteSavedViewAction(viewId);
        store.setSavedViews(views.filter((v) => v.id !== viewId));
        if (store.activeViewId === viewId) store.setActiveViewId(null);
        toast.success("View deleted");
        setDeleteConfirm(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete view");
      }
    });
  }

  const activeView = views.find((v) => v.id === store.activeViewId);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5">
            <Bookmark className="h-3.5 w-3.5" />
            {activeView ? (
              <span className="flex items-center gap-1">
                {activeView.name}
                {isModified && <Circle className="h-1.5 w-1.5 fill-orange-500 text-orange-500" />}
              </span>
            ) : (
              "Views"
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          {views.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">No saved views</p>
          )}
          {views.map((view) => (
            <div key={view.id} className="flex items-center group">
              <button
                onClick={() => loadView(view)}
                className="flex-1 text-left rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors truncate"
              >
                {view.name}
                {store.activeViewId === view.id && (
                  <span className="ml-1 text-[10px] text-muted-foreground">(active)</span>
                )}
              </button>
              {isAdmin && (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(view.id); }}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-destructive transition-all"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {isAdmin && (
            <>
              <div className="my-1 border-t" />
              <button
                onClick={() => { setOpen(false); setSaveOpen(true); setSaveName(""); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Save Current View
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Save View</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="View name..."
              maxLength={50}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={isPending || !saveName.trim()}>
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Delete View</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This saved view will be permanently deleted.</p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} disabled={isPending}>
              {isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/tasks/views-dropdown.tsx
git commit -m "feat(m5): add saved views dropdown with load/save/delete"
```

---

## Task 12: Wire Everything Into Board Header & Pages

**Files:**
- Modify: `src/components/tasks/board-header.tsx`
- Modify: `src/app/(dashboard)/tasks/page.tsx`
- Modify: `src/app/(agent)/my-tasks/page.tsx`

- [ ] **Step 1: Add Fields, Group, and Views to BoardHeader**

In `src/components/tasks/board-header.tsx`:

Add imports:
```typescript
import { CustomFieldsPanel } from "./custom-fields-panel";
import { GroupSelector } from "./group-selector";
import { ViewsDropdown } from "./views-dropdown";
import type { CustomFieldDefinition } from "@/lib/task-data";
```

Add to `BoardHeaderProps`:
```typescript
  customFields: CustomFieldDefinition[];
  onCustomFieldsChange: () => void;
```

In the right-side actions area (before the TaskCreateModal), add:

```tsx
        <GroupSelector />
        <ViewsDropdown projectId={project.id} isAdmin={isAdmin} />
        {isAdmin && (
          <CustomFieldsPanel
            projectId={project.id}
            fields={customFields}
            onFieldsChange={onCustomFieldsChange}
          />
        )}
```

- [ ] **Step 2: Update tasks/page.tsx to load and pass custom fields + saved views**

In `src/app/(dashboard)/tasks/page.tsx`:

Add imports:
```typescript
import { getCustomFieldDefinitions, getSavedViews } from "@/lib/task-data";
```

Update the `Promise.all` to include custom fields and saved views:
```typescript
  const [columns, tasks, members, available, tags, customFields, savedViews] = await Promise.all([
    getProjectColumns(project.id),
    getProjectTasks(project.id),
    getProjectMembers(project.id),
    isAdmin ? getAvailableAgents(project.id) : Promise.resolve([]),
    getProjectTags(project.id),
    getCustomFieldDefinitions(project.id),
    getSavedViews(project.id),
  ]);
```

Create a client wrapper component to handle `onCustomFieldsChange` (reloads custom fields via router.refresh):
- Pass `customFields` to `BoardHeader`, `BoardFilterBar`, `BoardView`, and `TaskDetailDrawer`
- Pass `savedViews` to a client-side initializer that feeds the board store

Add `customFields` prop to `BoardFilterBar`:
```tsx
<BoardFilterBar columns={columns} members={members} tags={tags} customFields={customFields} />
```

Add `customFields` and `savedViews` props to `BoardHeader`:
```tsx
<BoardHeader
  project={project}
  projects={finalProjects}
  columns={columns}
  members={members}
  availableAgents={available}
  isAdmin={isAdmin}
  customFields={customFields}
  onCustomFieldsChange={() => {}} // Will use router.refresh()
/>
```

Add a `BoardInitializer` client component at the top of the render to sync customFields, savedViews, and groupBy from URL into the store:

```tsx
<BoardInitializer customFields={customFields} savedViews={savedViews} />
```

Create `BoardInitializer` inline (or a small new component) that calls `store.setCustomFields()` and `store.setSavedViews()` on mount.

- [ ] **Step 3: Update my-tasks/page.tsx similarly**

In `src/app/(agent)/my-tasks/page.tsx`:

Add custom fields to the data loading:
```typescript
import { getCustomFieldDefinitions } from "@/lib/task-data";

// In the Promise.all:
const [allTasks, columns, members, customFields] = await Promise.all([
  getAgentTasksAcrossBoards(agentId),
  getProjectColumns(project.id),
  getProjectMembers(project.id),
  getCustomFieldDefinitions(project.id),
]);
```

Pass `customFields` to `BoardView` and `TaskDetailDrawer`.

- [ ] **Step 4: Commit**

```bash
git add src/components/tasks/board-header.tsx src/app/(dashboard)/tasks/page.tsx src/app/(agent)/my-tasks/page.tsx
git commit -m "feat(m5): wire custom fields, grouping, and saved views into board pages"
```

---

## Task 13: Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run build to check for TypeScript errors**

```bash
npm run build
```

Expected: Build succeeds with no type errors. Fix any issues found.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: No new lint errors.

- [ ] **Step 3: Fix any build/lint issues**

Address any compilation errors, missing imports, type mismatches. Common issues:
- Missing shadcn/ui components (Switch, Calendar) — add with `npx shadcn@latest add switch calendar`
- Import path issues
- Type mismatches between store and component props

- [ ] **Step 4: Commit fixes if any**

```bash
git add -A
git commit -m "fix(m5): resolve build and lint issues"
```

---

## Task 14: Update Documentation

**Files:**
- Modify: `plan.md`
- Modify: `cline.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Mark M5 items as complete in plan.md**

Mark all items under sections 5.1 through 5.6 as `[x]`.

- [ ] **Step 2: Update cline.md milestone table**

Add Milestone 5 section with status DONE for each sub-feature. Add implementation log with new files and modified files.

- [ ] **Step 3: Update CLAUDE.md if needed**

Add custom field API routes to the API routes table. Add new key files to the task management key files table.

- [ ] **Step 4: Commit docs**

```bash
git add plan.md cline.md CLAUDE.md
git commit -m "docs: update M5 status in plan, cline, and CLAUDE.md"
```

---

## Summary

| Task | Description | Est. Files |
|------|-------------|------------|
| 1 | Data layer types + queries | 1 modified |
| 2 | Server actions | 1 modified |
| 3 | API routes | 5 created |
| 4 | Board store extension | 1 modified |
| 5 | Custom field renderer | 1 created |
| 6 | Task detail drawer integration | 1 modified |
| 7 | Task card integration | 1 modified |
| 8 | Custom fields management panel | 1 created |
| 9 | Group selector + board grouping | 1 created, 2 modified |
| 10 | More filters section | 1 created, 1 modified |
| 11 | Saved views dropdown | 1 created |
| 12 | Wire into pages + header | 3 modified |
| 13 | Build verification | 0 |
| 14 | Documentation update | 3 modified |

**Total: 10 new files, 10 modified files, 14 tasks**
