"use client";

import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  MessageSquare,
  Paperclip,
  CheckSquare,
  Calendar,
} from "lucide-react";
import type { Task } from "@/lib/task-data";

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-700 dark:text-red-400",
  high: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  low: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500",
    "bg-indigo-500", "bg-teal-500", "bg-amber-500", "bg-cyan-500",
  ];
  return colors[Math.abs(hash) % colors.length];
}

function isDueWarning(dueDate: string): "overdue" | "soon" | null {
  const due = new Date(dueDate);
  const now = new Date();
  if (due < now) return "overdue";
  const diff = due.getTime() - now.getTime();
  if (diff < 48 * 60 * 60 * 1000) return "soon";
  return null;
}

interface TaskCardProps {
  task: Task;
  onClick?: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const dueStatus = task.due_date ? isDueWarning(task.due_date) : null;
  const checklistPct =
    task.checklist_total && task.checklist_total > 0
      ? Math.round(((task.checklist_done ?? 0) / task.checklist_total) * 100)
      : null;

  return (
    <div
      onClick={onClick}
      className={cn(
        "group cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition-all",
        "hover:shadow-md hover:border-primary/30"
      )}
    >
      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ backgroundColor: tag.color + "20", color: tag.color }}
            >
              {tag.name}
            </span>
          ))}
          {task.tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground">
              +{task.tags.length - 2}
            </span>
          )}
        </div>
      )}

      {/* Title */}
      <h4 className="text-sm font-medium leading-snug line-clamp-2">
        {task.title}
      </h4>

      {/* Meta row */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {/* Priority */}
        {task.priority && (
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
              priorityColors[task.priority]
            )}
          >
            {task.priority}
          </span>
        )}

        {/* Due date */}
        {task.due_date && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-[11px]",
              dueStatus === "overdue" && "text-red-600 dark:text-red-400 font-medium",
              dueStatus === "soon" && "text-orange-600 dark:text-orange-400",
              !dueStatus && "text-muted-foreground"
            )}
          >
            <Calendar className="h-3 w-3" />
            {formatDistanceToNow(new Date(task.due_date), { addSuffix: true })}
          </span>
        )}
      </div>

      {/* Bottom row: assignees + counts */}
      <div className="mt-2.5 flex items-center justify-between">
        {/* Assignees */}
        <div className="flex -space-x-1.5">
          {(task.assignees ?? []).slice(0, 3).map((a) => (
            <div
              key={a.agent_id}
              title={a.name}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-card",
                hashColor(a.agent_id)
              )}
            >
              {a.avatar_url ? (
                <img src={a.avatar_url} alt={a.name} className="h-full w-full rounded-full object-cover" />
              ) : (
                getInitials(a.name)
              )}
            </div>
          ))}
          {(task.assignees ?? []).length > 3 && (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[9px] font-medium ring-2 ring-card">
              +{(task.assignees ?? []).length - 3}
            </div>
          )}
        </div>

        {/* Counts */}
        <div className="flex items-center gap-2.5 text-muted-foreground">
          {checklistPct !== null && (
            <span className="flex items-center gap-0.5 text-[11px]">
              <CheckSquare className="h-3 w-3" />
              {checklistPct}%
            </span>
          )}
          {(task.comment_count ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[11px]">
              <MessageSquare className="h-3 w-3" />
              {task.comment_count}
            </span>
          )}
          {(task.attachment_count ?? 0) > 0 && (
            <span className="flex items-center gap-0.5 text-[11px]">
              <Paperclip className="h-3 w-3" />
              {task.attachment_count}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
