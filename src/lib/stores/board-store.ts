import { create } from "zustand";
import type { BoardColumn, Task, ProjectMember, CustomFieldDefinition, SavedView } from "@/lib/task-data";
import { getDateRangeFromPreset, type PresetValue } from "@/components/date-range-picker";
import { PAGE_SIZE } from "@/lib/board-filters";

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * Universal sort:
 *   1. Priority (urgent → high → medium → low → null)
 *   2. last_status_at DESC  (most recent column move; falls back to created_at)
 *   3. created_at DESC
 */
export function sortTasksForColumn(tasks: Task[], _columnName?: string | undefined): Task[] {
  const lastStatus = (t: Task) =>
    new Date((t.last_status_at ?? t.created_at) as string).getTime();
  const created = (t: Task) => new Date(t.created_at).getTime();

  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority ?? ""] ?? 99;
    const pb = PRIORITY_RANK[b.priority ?? ""] ?? 99;
    if (pa !== pb) return pa - pb;
    const la = lastStatus(a);
    const lb = lastStatus(b);
    if (la !== lb) return lb - la;
    return created(b) - created(a);
  });
}

interface BoardState {
  // Data
  columns: BoardColumn[];
  tasks: Task[];
  members: ProjectMember[];
  projectId: string | null;

  // Drag state
  isDragging: boolean;
  activeTaskId: string | null;
  previousState: { taskId: string; columnId: string; position: number } | null;

  // Filters
  filters: {
    assignee?: string;
    priority?: string;
    column?: string;
    search?: string;
    tag?: string;
  };

  // Pagination state (per column)
  columnCounts: Record<string, number>;
  columnLoadedCount: Record<string, number>;
  columnHasMore: Record<string, boolean>;
  columnLoading: Record<string, boolean>;
  /** Bumped on filter change so in-flight load-more requests can self-cancel. */
  paginationVersion: number;

  // Paged actions
  initBoardPaged: (data: {
    columns: BoardColumn[];
    buckets: Record<string, { tasks: Task[]; totalCount: number; hasMore: boolean }>;
    members: ProjectMember[];
    projectId: string;
    customFields?: CustomFieldDefinition[];
  }) => void;
  loadMoreForColumn: (columnId: string, query: string) => Promise<void>;
  adjustColumnCount: (columnId: string, delta: number) => void;
  resetPagination: () => void;
  refreshBoard: (query: string) => Promise<void>;

  // Custom fields
  customFields: CustomFieldDefinition[];

  // Grouping
  groupBy: "status" | "assignee" | "priority" | "label";

  // Custom field filters
  customFieldFilters: { fieldId: string; operator: string; value: unknown }[];

  // Saved views
  savedViews: SavedView[];
  activeViewId: string | null;

  // Actions
  initBoard: (data: {
    columns: BoardColumn[];
    tasks: Task[];
    members: ProjectMember[];
    projectId: string;
    customFields?: CustomFieldDefinition[];
  }) => void;

  // Task mutations
  addTask: (task: Task) => void;
  updateTask: (taskId: string, fields: Partial<Task>) => void;
  removeTask: (taskId: string) => void;

  // Drag-drop
  moveTask: (taskId: string, toColumnId: string, toIndex: number) => void;
  setActiveTask: (taskId: string | null) => void;
  savePreviousState: (taskId: string) => void;
  revertMove: () => void;

  // Filters
  setFilters: (filters: BoardState["filters"]) => void;
  clearFilters: () => void;

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

  // Helpers
  getTasksByColumn: (columnId: string) => Task[];
  getFilteredTasks: () => Task[];
  getGroupedTasks: () => { id: string; label: string; color?: string; tasks: Task[] }[];
}

export const useBoardStore = create<BoardState>((set, get) => ({
  columns: [],
  tasks: [],
  members: [],
  projectId: null,
  isDragging: false,
  activeTaskId: null,
  previousState: null,
  filters: {},
  columnCounts: {},
  columnLoadedCount: {},
  columnHasMore: {},
  columnLoading: {},
  paginationVersion: 0,
  customFields: [],
  groupBy: "status",
  customFieldFilters: [],
  savedViews: [],
  activeViewId: null,

  initBoard: (data) => {
    // Skip re-init during active drag to prevent optimistic state from being reset
    if (get().isDragging) return;
    set({
      columns: data.columns,
      tasks: data.tasks,
      members: data.members,
      projectId: data.projectId,
      customFields: data.customFields ?? get().customFields,
      activeTaskId: null,
      previousState: null,
    });
  },

  initBoardPaged: (data) => {
    if (get().isDragging) return;
    const tasks: Task[] = [];
    const counts: Record<string, number> = {};
    const loaded: Record<string, number> = {};
    const hasMore: Record<string, boolean> = {};
    for (const [cid, bucket] of Object.entries(data.buckets)) {
      counts[cid] = bucket.totalCount;
      loaded[cid] = bucket.tasks.length;
      hasMore[cid] = bucket.hasMore;
      tasks.push(...bucket.tasks);
    }
    // Columns absent from buckets (no tasks at all under filters) still need zero counts
    for (const col of data.columns) {
      if (!(col.id in counts)) {
        counts[col.id] = 0;
        loaded[col.id] = 0;
        hasMore[col.id] = false;
      }
    }
    set((s) => ({
      columns: data.columns,
      tasks,
      members: data.members,
      projectId: data.projectId,
      customFields: data.customFields ?? s.customFields,
      activeTaskId: null,
      previousState: null,
      columnCounts: counts,
      columnLoadedCount: loaded,
      columnHasMore: hasMore,
      columnLoading: {},
      paginationVersion: s.paginationVersion + 1,
    }));
  },

  loadMoreForColumn: async (columnId, query) => {
    const state = get();
    if (state.isDragging) return;
    if (state.columnLoading[columnId]) return;
    if (!state.columnHasMore[columnId]) return;
    if (!state.projectId) return;

    const versionAtStart = state.paginationVersion;
    set((s) => ({ columnLoading: { ...s.columnLoading, [columnId]: true } }));

    try {
      const offset = state.columnLoadedCount[columnId] ?? 0;
      const url = `/api/projects/${state.projectId}/columns/${columnId}/tasks?offset=${offset}&limit=${PAGE_SIZE}${
        query ? `&${query}` : ""
      }`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = (await res.json()) as { tasks: Task[]; hasMore: boolean };

      // Drop the result if filters changed under us. Clear loading flag so the
      // sentinel doesn't get stuck in a spinner state if a future caller bumps
      // paginationVersion without also wiping columnLoading.
      if (get().paginationVersion !== versionAtStart) {
        set((s) => ({ columnLoading: { ...s.columnLoading, [columnId]: false } }));
        return;
      }

      set((s) => {
        const existingIds = new Set(s.tasks.map((t) => t.id));
        const fresh = data.tasks.filter((t) => !existingIds.has(t.id));
        return {
          tasks: [...s.tasks, ...fresh],
          columnLoadedCount: {
            ...s.columnLoadedCount,
            [columnId]: (s.columnLoadedCount[columnId] ?? 0) + fresh.length,
          },
          columnHasMore: { ...s.columnHasMore, [columnId]: data.hasMore },
          columnLoading: { ...s.columnLoading, [columnId]: false },
        };
      });
    } catch {
      set((s) => ({ columnLoading: { ...s.columnLoading, [columnId]: false } }));
    }
  },

  adjustColumnCount: (columnId, delta) => {
    set((s) => ({
      columnCounts: {
        ...s.columnCounts,
        [columnId]: Math.max(0, (s.columnCounts[columnId] ?? 0) + delta),
      },
      columnLoadedCount: {
        ...s.columnLoadedCount,
        [columnId]: Math.max(0, (s.columnLoadedCount[columnId] ?? 0) + delta),
      },
    }));
  },

  resetPagination: () => {
    set((s) => ({
      columnCounts: {},
      columnLoadedCount: {},
      columnHasMore: {},
      columnLoading: {},
      paginationVersion: s.paginationVersion + 1,
    }));
  },

  refreshBoard: async (query) => {
    const state = get();
    if (state.isDragging || !state.projectId) return;

    // For each column, refetch [0 .. min(50, max(INITIAL, loaded))] so scroll-loaded
    // tail is preserved AND we don't exceed the API's 50-row cap.
    const columnIds = state.columns.map((c) => c.id);
    const versionAtStart = state.paginationVersion;

    await Promise.all(
      columnIds.map(async (cid) => {
        const want = Math.min(50, Math.max(5, state.columnLoadedCount[cid] ?? 0));
        const url = `/api/projects/${state.projectId}/columns/${cid}/tasks?offset=0&limit=${want}&includeCount=1${
          query ? `&${query}` : ""
        }`;
        try {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) return;
          const data = (await res.json()) as { tasks: Task[]; hasMore: boolean; totalCount?: number };
          if (get().paginationVersion !== versionAtStart) return;

          set((s) => {
            // Replace tasks for this column with the fresh slice; preserve other columns intact.
            const otherTasks = s.tasks.filter((t) => t.column_id !== cid);
            return {
              tasks: [...otherTasks, ...data.tasks],
              columnLoadedCount: { ...s.columnLoadedCount, [cid]: data.tasks.length },
              columnHasMore: { ...s.columnHasMore, [cid]: data.hasMore },
              columnCounts:
                typeof data.totalCount === "number"
                  ? { ...s.columnCounts, [cid]: data.totalCount }
                  : s.columnCounts,
            };
          });
        } catch {
          /* swallow — next tick will retry */
        }
      })
    );
  },

  addTask: (task) => {
    set((state) => ({ tasks: [...state.tasks, task] }));
  },

  updateTask: (taskId, fields) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, ...fields } : t
      ),
    }));
  },

  removeTask: (taskId) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
    }));
  },

  moveTask: (taskId, toColumnId, toIndex) => {
    set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) return state;

      // Remove from current position
      const otherTasks = state.tasks.filter((t) => t.id !== taskId);

      // Get tasks in target column sorted by position
      const targetColumnTasks = otherTasks
        .filter((t) => t.column_id === toColumnId)
        .sort((a, b) => a.position - b.position);

      // Calculate new position
      let newPosition: number;
      if (targetColumnTasks.length === 0) {
        newPosition = 1000;
      } else if (toIndex <= 0) {
        newPosition = targetColumnTasks[0].position - 1000;
      } else if (toIndex >= targetColumnTasks.length) {
        newPosition = targetColumnTasks[targetColumnTasks.length - 1].position + 1000;
      } else {
        const before = targetColumnTasks[toIndex - 1].position;
        const after = targetColumnTasks[toIndex].position;
        newPosition = Math.floor((before + after) / 2);
      }

      const updatedTask = {
        ...task,
        column_id: toColumnId,
        position: newPosition,
      };

      return {
        tasks: [...otherTasks, updatedTask],
      };
    });
  },

  setActiveTask: (taskId) => {
    set({ activeTaskId: taskId, isDragging: taskId !== null });
  },

  savePreviousState: (taskId) => {
    const task = get().tasks.find((t) => t.id === taskId);
    if (task) {
      set({
        previousState: {
          taskId: task.id,
          columnId: task.column_id,
          position: task.position,
        },
      });
    }
  },

  revertMove: () => {
    const prev = get().previousState;
    if (!prev) return;
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === prev.taskId
          ? { ...t, column_id: prev.columnId, position: prev.position }
          : t
      ),
      previousState: null,
    }));
  },

  setFilters: (filters) => {
    set({ filters });
  },

  clearFilters: () => {
    set({ filters: {} });
  },

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

  getTasksByColumn: (columnId) => {
    return get()
      .getFilteredTasks()
      .filter((t) => t.column_id === columnId)
      .sort((a, b) => a.position - b.position);
  },

  getFilteredTasks: () => {
    const { tasks, filters, customFieldFilters } = get();
    return tasks.filter((t) => {
      if (filters.column && t.column_id !== filters.column) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (
        filters.assignee &&
        !(t.assignees ?? []).some((a) => a.agent_id === filters.assignee)
      )
        return false;
      if (
        filters.search &&
        !t.title.toLowerCase().includes(filters.search.toLowerCase())
      )
        return false;
      if (
        filters.tag &&
        !(t.tags ?? []).some((tag) => tag.id === filters.tag)
      )
        return false;

      // Custom field filters (including virtual fields for due_date, created_at, updated_at)
      for (const cf of customFieldFilters) {
        const cfValues = (t.custom_fields ?? {}) as Record<string, unknown>;
        // Virtual fields map to task-level properties
        const val = cf.fieldId === "_due_date" ? t.due_date
          : cf.fieldId === "_created_at" ? t.created_at
          : cf.fieldId === "_updated_at" ? t.updated_at
          : cfValues[cf.fieldId];

        switch (cf.operator) {
          case "in_range": {
            // Used by Created At / Updated At preset dropdown.
            if (!val || !cf.value) return false;
            try {
              const { from, to } = getDateRangeFromPreset(cf.value as PresetValue);
              const ts = new Date(String(val)).getTime();
              if (ts < from.getTime() || ts > to.getTime()) return false;
            } catch {
              return false;
            }
            break;
          }
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

  getGroupedTasks: () => {
    const { groupBy, columns, members } = get();
    const filtered = get().getFilteredTasks();

    if (groupBy === "status") {
      return columns.map((col) => ({
        id: col.id,
        label: col.name,
        color: col.color,
        tasks: sortTasksForColumn(
          filtered.filter((t) => t.column_id === col.id),
          col.name
        ),
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
}));
