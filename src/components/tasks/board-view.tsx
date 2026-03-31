"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BoardColumnComponent } from "./board-column";
import { TaskCreateModal } from "./task-create-modal";
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

  // Group tasks by column
  const tasksByColumn = new Map<string, Task[]>();
  for (const col of columns) {
    tasksByColumn.set(col.id, []);
  }
  for (const task of tasks) {
    const list = tasksByColumn.get(task.column_id);
    if (list) list.push(task);
  }

  function handleTaskClick(taskId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("task", taskId);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <>
      {/* Board columns — scrollable */}
      <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
        {columns.map((column) => (
          <BoardColumnComponent
            key={column.id}
            column={column}
            tasks={tasksByColumn.get(column.id) ?? []}
            onTaskClick={handleTaskClick}
            onAddTask={(colId) => setAddToColumn(colId)}
          />
        ))}

        {columns.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="rounded-xl bg-muted/50 p-8">
              <h3 className="text-lg font-semibold">No columns yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                An admin needs to set up columns for this board.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Per-column task creation modal — rendered OUTSIDE scroll container */}
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
