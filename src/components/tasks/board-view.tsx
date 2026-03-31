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
import { BoardColumnComponent } from "./board-column";
import { TaskCardContent } from "./task-card";
import { TaskCreateModal } from "./task-create-modal";
import { useBoardStore } from "@/lib/stores/board-store";
import { moveTaskAction } from "@/lib/task-actions";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import type { BoardColumn, Task, ProjectMember } from "@/lib/task-data";

interface BoardViewProps {
  columns: BoardColumn[];
  tasks: Task[];
  projectId?: string;
  members?: ProjectMember[];
}

export function BoardView({ columns, tasks, projectId, members }: BoardViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [addToColumn, setAddToColumn] = useState<string | null>(null);

  // Initialize Zustand store from server data
  const store = useBoardStore();
  useEffect(() => {
    store.initBoard({
      columns,
      tasks,
      members: members ?? [],
      projectId: projectId ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, tasks, members, projectId]);

  // DnD sensors
  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 8 } });
  const touchSensor = useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } });
  const sensors = useSensors(pointerSensor, touchSensor);

  // Active drag state for overlay
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const task = event.active.data.current?.task as Task | undefined;
    if (task) {
      setActiveTask(task);
      store.setActiveTask(task.id);
      store.savePreviousState(task.id);
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !active) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    if (activeData?.type !== "task") return;

    // Determine target column
    let targetColumnId: string | null = null;
    let targetIndex = 0;

    if (overData?.type === "column") {
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
      if (task && task.column_id !== targetColumnId) {
        store.moveTask(task.id, targetColumnId, targetIndex);
      }
    }
  }

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActiveTask(null);
      store.setActiveTask(null);

      if (!over || !active) {
        store.revertMove();
        return;
      }

      const activeData = active.data.current;
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

        // Undo toast
        if (prev && (prev.columnId !== targetColumnId || prev.position !== newPosition)) {
          const col = columns.find((c) => c.id === targetColumnId);
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
        store.revertMove();
        toast.error("Failed to move task");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns]
  );

  function handleTaskClick(taskId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("task", taskId);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  // Use store tasks grouped by column — respects active filters
  const filteredTasks = store.getFilteredTasks();
  const getColumnTasks = (columnId: string) => {
    return filteredTasks
      .filter((t) => t.column_id === columnId)
      .sort((a, b) => a.position - b.position);
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
          {columns.map((column) => (
            <BoardColumnComponent
              key={column.id}
              column={column}
              tasks={getColumnTasks(column.id)}
              onTaskClick={handleTaskClick}
              onAddTask={(colId) => setAddToColumn(colId)}
            />
          ))}

          {columns.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="rounded-xl bg-muted/50 p-8">
                <h3 className="text-lg font-semibold">No columns yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">An admin needs to set up columns for this board.</p>
              </div>
            </div>
          )}
        </div>

        {/* Drag overlay — ghost card */}
        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="w-[264px] opacity-90 rotate-[2deg]">
              <TaskCardContent
                task={activeTask}
                columnColor={columns.find((c) => c.id === activeTask.column_id)?.color}
                isDragging
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Per-column task creation modal */}
      {projectId && addToColumn && (
        <TaskCreateModal
          projectId={projectId}
          columns={columns}
          defaultColumnId={addToColumn}
          members={members}
          triggerOpen={!!addToColumn}
          onClose={() => setAddToColumn(null)}
        />
      )}
    </>
  );
}
