"use client";

import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { TaskCard } from "./task-card";
import type { BoardColumn as ColumnType, Task } from "@/lib/task-data";

interface BoardColumnProps {
  column: ColumnType;
  tasks: Task[];
  onTaskClick?: (taskId: string) => void;
  onAddTask?: (columnId: string) => void;
}

export function BoardColumnComponent({ column, tasks, onTaskClick, onAddTask }: BoardColumnProps) {
  const isOverWip = column.wip_limit != null && tasks.length > column.wip_limit;
  const isAtWip = column.wip_limit != null && tasks.length === column.wip_limit;

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col">
      {/* Column header */}
      <div className="flex items-center gap-2 px-1 pb-3">
        <div
          className="h-2.5 w-2.5 rounded-full shrink-0"
          style={{ backgroundColor: column.color }}
        />
        <h3 className="text-sm font-semibold truncate">{column.name}</h3>
        <span
          className={cn(
            "shrink-0 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium",
            isOverWip
              ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
              : isAtWip
                ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400"
                : "bg-muted text-muted-foreground"
          )}
        >
          {tasks.length}
          {column.wip_limit != null && `/${column.wip_limit}`}
        </span>
        {onAddTask && (
          <button
            onClick={() => onAddTask(column.id)}
            className="ml-auto shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={`Add task to ${column.name}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 overflow-y-auto pr-1 pb-4">
        {tasks.length === 0 ? (
          <button
            onClick={() => onAddTask?.(column.id)}
            className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center hover:border-primary/40 hover:bg-muted/30 transition-colors cursor-pointer"
          >
            <Plus className="h-5 w-5 text-muted-foreground/50 mb-1" />
            <p className="text-xs text-muted-foreground">Add a task</p>
          </button>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick?.(task.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
