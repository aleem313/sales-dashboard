"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { BoardColumnComponent } from "./board-column";
import { TaskCardContent } from "./task-card";
import { useBoardStore, sortTasksForColumn } from "@/lib/stores/board-store";
import { moveTaskAction, deleteTaskAction, updateColumnAction, deleteColumnAction, createColumnAction, reorderColumnsAction } from "@/lib/task-actions";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Undo2, Plus, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskDetailModal } from "./task-detail-modal";
import { TaskCreateModal } from "./task-create-modal";
import { NotificationPermissionBanner } from "./notification-permission-banner";
import { useNewTaskNotifier } from "@/hooks/use-new-task-notifier";
import type { BoardColumn, Task, ProjectMember, CustomFieldDefinition } from "@/lib/task-data";

interface BoardViewProps {
  columns: BoardColumn[];
  tasks: Task[];
  projectId?: string;
  members?: ProjectMember[];
  isAdmin?: boolean;
  agentId?: string | null;
  customFields?: CustomFieldDefinition[];
}

/** Sortable wrapper for a column — only renders drag handle for admins */
function SortableColumn({
  column,
  children,
  isAdmin,
}: {
  column: BoardColumn;
  children: React.ReactNode;
  isAdmin?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `sortable-col-${column.id}`,
    data: { type: "column-sortable", columnId: column.id },
    disabled: !isAdmin,
  });

  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, scaleX: 1, scaleY: 1 } : null),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("flex h-full shrink-0 flex-col", isDragging && "opacity-50")}
    >
      {isAdmin && (
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-center h-5 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors mb-0.5"
          title="Drag to reorder column"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
      )}
      {children}
    </div>
  );
}

export function BoardView({ columns: serverColumns, tasks, projectId, members, isAdmin, agentId, customFields }: BoardViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  useNewTaskNotifier(tasks, { enabled: !isAdmin });
  const [addToColumn, setAddToColumn] = useState<string | null>(null);
  const [modalTaskId, setModalTaskId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDefaultColumn, setCreateDefaultColumn] = useState<string | undefined>(undefined);

  // Auto-open modal from ?task= URL param (e.g. shared link)
  useEffect(() => {
    const taskParam = searchParams.get("task");
    if (taskParam && !modalTaskId) {
      setModalTaskId(taskParam);
      // Clean up URL param without navigation
      const url = new URL(window.location.href);
      url.searchParams.delete("task");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams, modalTaskId]);

  // Local column order state — synced from server, reorderable by DnD
  const [columnOrder, setColumnOrder] = useState<BoardColumn[]>(serverColumns);
  useEffect(() => {
    setColumnOrder(serverColumns);
  }, [serverColumns]);

  // Initialize Zustand store from server data
  const store = useBoardStore();
  useEffect(() => {
    store.initBoard({
      columns: serverColumns,
      tasks,
      members: members ?? [],
      projectId: projectId ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverColumns, tasks, members, projectId]);

  // Open create modal when column "+" is clicked
  useEffect(() => {
    if (addToColumn && projectId) {
      setCreateDefaultColumn(addToColumn);
      setCreateModalOpen(true);
      setAddToColumn(null);
    }
  }, [addToColumn, projectId]);

  // DnD sensors
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(pointerSensor, touchSensor);

  // Active drag state for overlay
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeColumn, setActiveColumn] = useState<BoardColumn | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    if (data?.type === "task") {
      const task = data.task as Task;
      setActiveTask(task);
      store.setActiveTask(task.id);
      store.savePreviousState(task.id);
    } else if (data?.type === "column-sortable") {
      setActiveColumn(columnOrder.find((c) => c.id === data.columnId) ?? null);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !active) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // Only handle task drags here (not column drags)
    if (activeData?.type !== "task") return;

    // Determine target column
    let targetColumnId: string | null = null;
    let targetIndex = 0;

    if (overData?.type === "column") {
      targetColumnId = overData.columnId as string;
      targetIndex = store.getTasksByColumn(targetColumnId).length;
    } else if (overData?.type === "column-sortable") {
      targetColumnId = overData.columnId as string;
      targetIndex = store.getTasksByColumn(targetColumnId).length;
    } else if (overData?.type === "task") {
      const overTask = overData.task as Task;
      targetColumnId = overTask.column_id;
      const colTasks = store.getTasksByColumn(targetColumnId);
      targetIndex = colTasks.findIndex((t) => t.id === overTask.id);
    }

    if (targetColumnId && active.id !== over.id) {
      const task = store.tasks.find((t) => t.id === active.id);
      if (task) {
        // Move optimistically — both cross-column AND same-column reorders
        store.moveTask(task.id, targetColumnId, targetIndex);
      }
    }
  }

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);
      setActiveColumn(null);

      if (!over || !active) {
        store.setActiveTask(null);
        store.revertMove();
        return;
      }

      const activeData = active.data.current;

      // ── Column reorder ──
      if (activeData?.type === "column-sortable") {
        store.setActiveTask(null);
        const overData = over.data.current;
        if (overData?.type !== "column-sortable" || active.id === over.id) return;

        const activeColId = activeData.columnId as string;
        const overColId = overData.columnId as string;

        const oldIndex = columnOrder.findIndex((c) => c.id === activeColId);
        const newIndex = columnOrder.findIndex((c) => c.id === overColId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

        const reordered = arrayMove(columnOrder, oldIndex, newIndex);
        setColumnOrder(reordered);

        try {
          await reorderColumnsAction(projectId!, reordered.map((c) => c.id));
          toast.success("Columns reordered");
        } catch {
          setColumnOrder(columnOrder); // revert
          toast.error("Failed to reorder columns");
        }
        return;
      }

      // ── Task drag ──
      if (activeData?.type !== "task") return;

      const task = store.tasks.find((t) => t.id === active.id);
      if (!task) return;

      // Determine final column and position
      let targetColumnId = task.column_id;
      let targetIndex = 0;

      const overData = over.data.current;
      if (overData?.type === "column") {
        targetColumnId = overData.columnId as string;
        targetIndex = store.getTasksByColumn(targetColumnId).length;
      } else if (overData?.type === "column-sortable") {
        targetColumnId = overData.columnId as string;
        targetIndex = store.getTasksByColumn(targetColumnId).length;
      } else if (overData?.type === "task") {
        const overTask = overData.task as Task;
        targetColumnId = overTask.column_id;
        const colTasks = store.getTasksByColumn(targetColumnId);
        targetIndex = colTasks.findIndex((t) => t.id === overTask.id);
      }

      // Optimistic move already happened in handleDragOver
      // Now persist to server
      const prev = store.previousState;

      // Calculate position for server
      const colTasks = store.getTasksByColumn(targetColumnId).filter((t) => t.id !== task.id);
      let newPosition: number;
      if (colTasks.length === 0) {
        newPosition = 1000;
      } else if (targetIndex <= 0) {
        newPosition = colTasks[0].position - 1000;
      } else if (targetIndex >= colTasks.length) {
        newPosition = colTasks[colTasks.length - 1].position + 1000;
      } else {
        newPosition = Math.floor((colTasks[targetIndex - 1].position + colTasks[targetIndex].position) / 2);
      }

      try {
        await moveTaskAction(task.id, targetColumnId, newPosition);

        // Clear drag lock so initBoard can run with fresh server data
        store.setActiveTask(null);

        // Update the store position to match what was persisted
        store.updateTask(task.id, { position: newPosition, column_id: targetColumnId });

        // Undo toast
        if (prev && (prev.columnId !== targetColumnId || prev.position !== newPosition)) {
          const col = columnOrder.find((c) => c.id === targetColumnId);
          toast(`Moved to ${col?.name ?? "column"}`, {
            icon: <Undo2 className="h-4 w-4" />,
            duration: 5000,
            action: {
              label: "Undo",
              onClick: async () => {
                store.moveTask(task.id, prev.columnId, 0);
                try {
                  await moveTaskAction(task.id, prev.columnId, prev.position);
                } catch {
                  toast.error("Failed to undo");
                }
              },
            },
          });
        }
      } catch {
        store.setActiveTask(null);
        store.revertMove();
        toast.error("Failed to move task");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnOrder, projectId]
  );

  function handleTaskClick(taskId: string) {
    setModalTaskId(taskId);
  }

  // Context menu: move task to another column
  async function handleContextMoveTask(taskId: string, columnId: string) {
    store.savePreviousState(taskId);
    store.moveTask(taskId, columnId, 0);
    try {
      await moveTaskAction(taskId, columnId);
      const col = columnOrder.find((c) => c.id === columnId);
      toast.success(`Moved to ${col?.name ?? "column"}`);
    } catch {
      store.revertMove();
      toast.error("Failed to move task");
    }
  }

  // Context menu: delete task
  async function handleContextDeleteTask(taskId: string) {
    store.removeTask(taskId);
    try {
      await deleteTaskAction(taskId);
      toast.success("Task deleted");
    } catch {
      toast.error("Failed to delete task");
    }
  }

  // Column management handlers
  async function handleUpdateColumn(columnId: string, fields: { name?: string; color?: string; is_done?: boolean; wip_limit?: number | null }) {
    try {
      await updateColumnAction(columnId, fields);
      toast.success("Column updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update column");
    }
  }

  async function handleDeleteColumn(columnId: string, moveTasksTo?: string) {
    try {
      await deleteColumnAction(columnId, moveTasksTo);
      toast.success("Column deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete column");
    }
  }

  // Add new column
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");

  async function handleAddColumn() {
    if (!newColumnName.trim() || !projectId) return;
    try {
      await createColumnAction(projectId, newColumnName.trim());
      setNewColumnName("");
      setAddingColumn(false);
      toast.success("Column created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create column");
    }
  }

  // Use store tasks grouped by column — respects active filters.
  // Display order (universal across all columns):
  //   1. priority (urgent → high → medium → low → none)
  //   2. last_status_at DESC (most recent task_moved; falls back to created_at)
  //   3. created_at DESC
  // Internal drag math (inside DnD handlers) still uses position via store.getTasksByColumn.
  const filteredTasks = store.getFilteredTasks();
  const getColumnTasks = (columnId: string) => {
    const col = columnOrder.find((c) => c.id === columnId);
    return sortTasksForColumn(
      filteredTasks.filter((t) => t.column_id === columnId),
      col?.name
    );
  };

  // Grouping support
  const isGroupedView = store.groupBy !== "status";
  const groupedData = isGroupedView ? store.getGroupedTasks() : [];

  if (isGroupedView) {
    return (
      <>
        {!isAdmin && <NotificationPermissionBanner />}
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
        <TaskDetailModal
          taskId={modalTaskId}
          columns={serverColumns}
          isAdmin={isAdmin ?? false}
          agentId={agentId}
          onClose={() => setModalTaskId(null)}
        />
        <TaskCreateModal
          open={createModalOpen}
          projectId={projectId ?? ""}
          columns={serverColumns}
          members={members}
          defaultColumnId={createDefaultColumn}
          onClose={() => setCreateModalOpen(false)}
        />
      </>
    );
  }

  // Column sortable IDs
  const columnSortableIds = columnOrder.map((c) => `sortable-col-${c.id}`);

  return (
    <>
      {!isAdmin && <NotificationPermissionBanner />}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
          <SortableContext items={columnSortableIds} strategy={horizontalListSortingStrategy}>
            {columnOrder.map((column) => (
              <SortableColumn key={column.id} column={column} isAdmin={isAdmin}>
                <BoardColumnComponent
                  column={column}
                  tasks={getColumnTasks(column.id)}
                  allColumns={columnOrder}
                  isAdmin={isAdmin}
                  onTaskClick={handleTaskClick}
                  onAddTask={(colId) => setAddToColumn(colId)}
                  onMoveTask={handleContextMoveTask}
                  onDeleteTask={handleContextDeleteTask}
                  onUpdateColumn={isAdmin ? handleUpdateColumn : undefined}
                  onDeleteColumn={isAdmin ? handleDeleteColumn : undefined}
                />
              </SortableColumn>
            ))}
          </SortableContext>

          {/* Add Status button (admin only) */}
          {isAdmin && projectId && (
            <div className="flex h-full w-[280px] shrink-0 flex-col">
              {addingColumn ? (
                <div className="px-1 pb-3">
                  <Input
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddColumn();
                      if (e.key === "Escape") { setAddingColumn(false); setNewColumnName(""); }
                    }}
                    onBlur={() => { if (!newColumnName.trim()) setAddingColumn(false); }}
                    placeholder="Column name..."
                    className="h-8 text-sm"
                    maxLength={50}
                    autoFocus
                  />
                </div>
              ) : (
                <button
                  onClick={() => setAddingColumn(true)}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-muted-foreground/25 px-4 py-2.5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  Add Status
                </button>
              )}
            </div>
          )}

          {columnOrder.length === 0 && !isAdmin && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-xl bg-muted/50 p-8">
                <h3 className="text-lg font-semibold">No columns yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">An admin needs to set up columns for this board.</p>
              </div>
            </div>
          )}
        </div>

        {/* Drag overlay — ghost card or column */}
        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="w-[264px] opacity-90 rotate-[2deg]">
              <TaskCardContent
                task={activeTask}
                columnColor={columnOrder.find((c) => c.id === activeTask.column_id)?.color}
                isDragging
              />
            </div>
          )}
          {activeColumn && (
            <div className="w-[280px] opacity-80 rotate-[1deg] rounded-lg border bg-card/90 p-3 shadow-lg">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: activeColumn.color }} />
                <span className="text-sm font-semibold">{activeColumn.name}</span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <TaskDetailModal
        taskId={modalTaskId}
        columns={serverColumns}
        isAdmin={isAdmin ?? false}
        agentId={agentId}
        onClose={() => setModalTaskId(null)}
      />
      <TaskCreateModal
        open={createModalOpen}
        projectId={projectId ?? ""}
        columns={serverColumns}
        members={members}
        defaultColumnId={createDefaultColumn}
        onClose={() => setCreateModalOpen(false)}
      />
    </>
  );
}
