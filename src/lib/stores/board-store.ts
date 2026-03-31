import { create } from "zustand";
import type { BoardColumn, Task, ProjectMember } from "@/lib/task-data";

interface BoardState {
  // Data
  columns: BoardColumn[];
  tasks: Task[];
  members: ProjectMember[];
  projectId: string | null;

  // Drag state
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

  // Actions
  initBoard: (data: {
    columns: BoardColumn[];
    tasks: Task[];
    members: ProjectMember[];
    projectId: string;
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

  // Helpers
  getTasksByColumn: (columnId: string) => Task[];
  getFilteredTasks: () => Task[];
}

export const useBoardStore = create<BoardState>((set, get) => ({
  columns: [],
  tasks: [],
  members: [],
  projectId: null,
  activeTaskId: null,
  previousState: null,
  filters: {},

  initBoard: (data) => {
    set({
      columns: data.columns,
      tasks: data.tasks,
      members: data.members,
      projectId: data.projectId,
      activeTaskId: null,
      previousState: null,
    });
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
    set({ activeTaskId: taskId });
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

  getTasksByColumn: (columnId) => {
    return get()
      .getFilteredTasks()
      .filter((t) => t.column_id === columnId)
      .sort((a, b) => a.position - b.position);
  },

  getFilteredTasks: () => {
    const { tasks, filters } = get();
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
      return true;
    });
  },
}));
