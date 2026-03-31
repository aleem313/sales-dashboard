"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  MessageSquare,
  Paperclip,
  CheckSquare,
  Calendar,
  GripVertical,
} from "lucide-react";
import type { Task } from "@/lib/task-data";

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-700 dark:text-red-400",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  low: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
};

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ["bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500", "bg-indigo-500", "bg-teal-500", "bg-amber-500", "bg-cyan-500"];
  return colors[Math.abs(hash) % colors.length];
}

function isDueWarning(dueDate: string): "overdue" | "soon" | null {
  const due = new Date(dueDate);
  const now = new Date();
  if (due < now) return "overdue";
  if (due.getTime() - now.getTime() < 48 * 60 * 60 * 1000) return "soon";
  return null;
}

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
  isDragging?: boolean;
}

export const TaskCardContent = forwardRef<HTMLDivElement, TaskCardProps & { dragHandleProps?: Record<string, unknown>; style?: React.CSSProperties }>(
  ({ task, onClick, isDragging, dragHandleProps, style, ...props }, ref) => {
    const dueStatus = task.due_date ? isDueWarning(task.due_date) : null;
    const checklistPct =
      task.checklist_total && task.checklist_total > 0
        ? Math.round(((task.checklist_done ?? 0) / task.checklist_total) * 100)
        : null;

    return (
      <div
        ref={ref}
        style={style}
        onClick={onClick}
        className={cn(
          "group cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-all",
          "hover:shadow-md hover:border-primary/30",
          isDragging && "opacity-50 shadow-lg ring-2 ring-primary/30"
        )}
        {...props}
      >
        {/* Tags */}
        {task.tags && task.tags.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {task.tags.slice(0, 2).map((tag) => (
              <span key={tag.id} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: tag.color + "20", color: tag.color }}>
                {tag.name}
              </span>
            ))}
            {task.tags.length > 2 && <span className="text-[10px] text-muted-foreground">+{task.tags.length - 2}</span>}
          </div>
        )}

        {/* Title row with drag handle */}
        <div className="flex items-start gap-1">
          {dragHandleProps && (
            <button {...dragHandleProps} className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground" onClick={(e) => e.stopPropagation()}>
              <GripVertical className="h-3.5 w-3.5" />
            </button>
          )}
          <h4 className="text-sm font-medium leading-snug line-clamp-2 flex-1">{task.title}</h4>
        </div>

        {/* Meta row */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {task.priority && (
            <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", priorityColors[task.priority])}>
              {task.priority}
            </span>
          )}
          {task.due_date && (
            <span className={cn("inline-flex items-center gap-1 text-[11px]", dueStatus === "overdue" && "text-red-600 dark:text-red-400 font-medium", dueStatus === "soon" && "text-orange-600 dark:text-orange-400", !dueStatus && "text-muted-foreground")}>
              <Calendar className="h-3 w-3" />
              {formatDistanceToNow(new Date(task.due_date), { addSuffix: true })}
            </span>
          )}
        </div>

        {/* Bottom row */}
        <div className="mt-2.5 flex items-center justify-between">
          <div className="flex -space-x-1.5">
            {(task.assignees ?? []).slice(0, 3).map((a) => (
              <div key={a.agent_id} title={a.name} className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-card", hashColor(a.agent_id))}>
                {a.avatar_url ? <img src={a.avatar_url} alt={a.name} className="h-full w-full rounded-full object-cover" /> : getInitials(a.name)}
              </div>
            ))}
            {(task.assignees ?? []).length > 3 && <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[9px] font-medium ring-2 ring-card">+{(task.assignees ?? []).length - 3}</div>}
          </div>
          <div className="flex items-center gap-2.5 text-muted-foreground">
            {checklistPct !== null && <span className="flex items-center gap-0.5 text-[11px]"><CheckSquare className="h-3 w-3" />{checklistPct}%</span>}
            {(task.comment_count ?? 0) > 0 && <span className="flex items-center gap-0.5 text-[11px]"><MessageSquare className="h-3 w-3" />{task.comment_count}</span>}
            {(task.attachment_count ?? 0) > 0 && <span className="flex items-center gap-0.5 text-[11px]"><Paperclip className="h-3 w-3" />{task.attachment_count}</span>}
          </div>
        </div>
      </div>
    );
  }
);
TaskCardContent.displayName = "TaskCardContent";

/** Sortable wrapper for dnd-kit */
export function SortableTaskCard({ task, onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: "task", task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <TaskCardContent
      ref={setNodeRef}
      style={style}
      task={task}
      onClick={onClick}
      isDragging={isDragging}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  );
}

/** Non-sortable version for use in overlay */
export function TaskCard({ task, onClick }: TaskCardProps) {
  return <TaskCardContent task={task} onClick={onClick} />;
}
