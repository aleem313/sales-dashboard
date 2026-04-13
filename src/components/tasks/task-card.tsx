"use client";

import { forwardRef, useState } from "react";
import { cn, copyText } from "@/lib/utils";
import { format } from "date-fns";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MessageSquare,
  Paperclip,
  CheckSquare,
  Calendar,
  Flag,
  Clock,
  CalendarClock,
  MoreHorizontal,
  Pencil,
  ArrowRight,
  Link2,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { CustomFieldRenderer } from "./custom-field-renderer";
import type { Task, BoardColumn, CustomFieldDefinition } from "@/lib/task-data";

const priorityConfig: Record<string, { color: string; bg: string; label: string }> = {
  urgent: { color: "text-red-600 dark:text-red-400", bg: "bg-red-500/15", label: "Urgent" },
  high: { color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-500/15", label: "High" },
  medium: { color: "text-yellow-600 dark:text-yellow-500", bg: "bg-yellow-500/15", label: "Medium" },
  low: { color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500/15", label: "Low" },
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

function formatDueDate(dueDate: string): string {
  const date = new Date(dueDate);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays < -1) return format(date, "MMM d");
  if (diffDays <= 7) return format(date, "EEE");
  return format(date, "MMM d");
}

interface TaskCardProps {
  task: Task;
  columnColor?: string;
  onClick?: () => void;
  isDragging?: boolean;
  columns?: BoardColumn[];
  isAdmin?: boolean;
  onMoveTask?: (taskId: string, columnId: string) => void;
  onDeleteTask?: (taskId: string) => void;
  customFields?: CustomFieldDefinition[];
}

export const TaskCardContent = forwardRef<HTMLDivElement, TaskCardProps & { style?: React.CSSProperties }>(
  ({ task, columnColor, onClick, isDragging, style, columns, isAdmin, onMoveTask, onDeleteTask, customFields, ...props }, ref) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const dueStatus = task.due_date ? isDueWarning(task.due_date) : null;
    const assignees = task.assignees ?? [];
    const tags = task.tags ?? [];
    const checklistTotal = task.checklist_total ?? 0;
    const checklistDone = task.checklist_done ?? 0;
    const commentCount = task.comment_count ?? 0;
    const attachmentCount = task.attachment_count ?? 0;
    const cf = (task.custom_fields ?? {}) as Record<string, unknown>;
    const timeEstimate = cf._time_estimate_minutes as number | undefined;
    const timeTracked = cf._time_tracked_minutes as number | undefined;
    const jobUrl = (cf._job_url as string) || "";
    const hasMetaRow = task.priority || task.due_date || task.start_date || timeEstimate;
    const hasBottomRow = assignees.length > 0 || checklistTotal > 0 || commentCount > 0 || attachmentCount > 0;

    function formatMinutes(mins: number): string {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (h === 0) return `${m}m`;
      if (m === 0) return `${h}h`;
      return `${h}h ${m}m`;
    }

    function handleCopyLink(e: React.MouseEvent) {
      e.stopPropagation();
      const url = `${window.location.origin}/tasks?task=${task.id}`;
      copyText(url).then((ok) => {
        if (ok) toast.success("Link copied");
        else toast.error("Copy failed");
      });
    }

    return (
      <div
        ref={ref}
        style={style}
        onClick={onClick}
        className={cn(
          "group relative cursor-pointer rounded-lg border bg-card shadow-sm transition-all touch-manipulation overflow-hidden",
          "hover:shadow-md hover:border-primary/30",
          isDragging && "opacity-50 shadow-lg ring-2 ring-primary/30"
        )}
        {...props}
      >
        {/* Context menu trigger — visible on hover */}
        {columns && columns.length > 0 && (
          <div
            className={cn(
              "absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity",
              menuOpen && "opacity-100"
            )}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button className="flex h-6 w-6 items-center justify-center rounded-md bg-card border shadow-sm hover:bg-muted transition-colors">
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClick?.(); setMenuOpen(false); }}>
                  <Pencil className="h-3.5 w-3.5 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <ArrowRight className="h-3.5 w-3.5 mr-2" />
                    Move to
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {columns.filter((c) => c.id !== task.column_id).map((c) => (
                      <DropdownMenuItem
                        key={c.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoveTask?.(task.id, c.id);
                          setMenuOpen(false);
                        }}
                      >
                        <span className="h-2 w-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem onClick={handleCopyLink}>
                  <Link2 className="h-3.5 w-3.5 mr-2" />
                  Copy Link
                </DropdownMenuItem>
                {isAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTask?.(task.id);
                        setMenuOpen(false);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Status color bar (left border) */}
        <div className="flex">
          <div
            className="w-1 shrink-0 rounded-l-lg"
            style={{ backgroundColor: columnColor ?? "#6b7280" }}
          />

          <div className="flex-1 p-3 min-w-0">
            {/* Tags/Labels */}
            {tags.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {tags.slice(0, 3).map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-tight"
                    style={{ backgroundColor: tag.color + "22", color: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span className="text-[10px] text-muted-foreground self-center">
                    +{tags.length - 3}
                  </span>
                )}
              </div>
            )}

            {/* Title */}
            <h4 className="text-sm font-medium leading-snug line-clamp-2 mb-1.5">
              {task.title}
            </h4>

            {/* Job link copy button */}
            {jobUrl && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <button
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
                  title="Copy job URL"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyText(jobUrl).then((ok) => {
                      if (ok) toast.success("Job URL copied");
                      else toast.error("Copy failed");
                    });
                  }}
                >
                  <ExternalLink className="h-3 w-3" />
                  <span className="truncate max-w-[140px]">Copy Job URL</span>
                </button>
              </div>
            )}

            {/* Meta fields row — ClickUp style icon+value pairs */}
            {hasMetaRow && (
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                {/* Priority flag */}
                {task.priority && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 text-[11px] font-medium",
                      priorityConfig[task.priority]?.color
                    )}
                    title={`Priority: ${priorityConfig[task.priority]?.label}`}
                  >
                    <Flag className="h-3 w-3" />
                    <span className="hidden sm:inline">{priorityConfig[task.priority]?.label}</span>
                  </span>
                )}

                {/* Due date */}
                {task.due_date && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 text-[11px]",
                      dueStatus === "overdue" && "text-red-600 dark:text-red-400 font-medium",
                      dueStatus === "soon" && "text-orange-600 dark:text-orange-400 font-medium",
                      !dueStatus && "text-muted-foreground"
                    )}
                    title={`Due: ${format(new Date(task.due_date), "MMM d, yyyy")}`}
                  >
                    <Calendar className="h-3 w-3" />
                    {formatDueDate(task.due_date)}
                  </span>
                )}

                {/* Start date */}
                {task.start_date && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"
                    title={`Start: ${format(new Date(task.start_date), "MMM d, yyyy")}`}
                  >
                    <CalendarClock className="h-3 w-3" />
                    {format(new Date(task.start_date), "MMM d")}
                  </span>
                )}

                {/* Time estimate */}
                {timeEstimate && timeEstimate > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground"
                    title={`Estimate: ${formatMinutes(timeEstimate)}${timeTracked ? ` / Tracked: ${formatMinutes(timeTracked)}` : ""}`}
                  >
                    <Clock className="h-3 w-3" />
                    {timeTracked && timeTracked > 0
                      ? `${formatMinutes(timeTracked)}/${formatMinutes(timeEstimate)}`
                      : formatMinutes(timeEstimate)}
                  </span>
                )}
              </div>
            )}

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

            {/* Bottom row: assignees + counts */}
            {hasBottomRow && (
              <div className="flex items-center justify-between mt-1">
                {/* Assignee avatars */}
                <div className="flex -space-x-1.5">
                  {assignees.slice(0, 3).map((a) => (
                    <div
                      key={a.agent_id}
                      title={a.name}
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-card",
                        hashColor(a.agent_id)
                      )}
                    >
                      {a.avatar_url ? (
                        <img
                          src={a.avatar_url}
                          alt={a.name}
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        getInitials(a.name)
                      )}
                    </div>
                  ))}
                  {assignees.length > 3 && (
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[9px] font-medium ring-2 ring-card">
                      +{assignees.length - 3}
                    </div>
                  )}
                </div>

                {/* Counts: checklist, comments, attachments */}
                <div className="flex items-center gap-2 text-muted-foreground">
                  {checklistTotal > 0 && (
                    <span
                      className={cn(
                        "flex items-center gap-0.5 text-[11px]",
                        checklistDone === checklistTotal && checklistTotal > 0 && "text-green-600 dark:text-green-400"
                      )}
                      title={`Subtasks: ${checklistDone}/${checklistTotal}`}
                    >
                      <CheckSquare className="h-3 w-3" />
                      {checklistDone}/{checklistTotal}
                    </span>
                  )}
                  {commentCount > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px]" title={`${commentCount} comments`}>
                      <MessageSquare className="h-3 w-3" />
                      {commentCount}
                    </span>
                  )}
                  {attachmentCount > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px]" title={`${attachmentCount} attachments`}>
                      <Paperclip className="h-3 w-3" />
                      {attachmentCount}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);
TaskCardContent.displayName = "TaskCardContent";

/** Sortable wrapper for dnd-kit — entire card is draggable */
export function SortableTaskCard({ task, columnColor, onClick, columns, isAdmin, onMoveTask, onDeleteTask, customFields }: TaskCardProps) {
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
      columnColor={columnColor}
      onClick={onClick}
      isDragging={isDragging}
      columns={columns}
      isAdmin={isAdmin}
      onMoveTask={onMoveTask}
      onDeleteTask={onDeleteTask}
      customFields={customFields}
      {...attributes}
      {...listeners}
    />
  );
}

/** Non-sortable version for use in overlay */
export function TaskCard({ task, columnColor, onClick }: TaskCardProps) {
  return <TaskCardContent task={task} columnColor={columnColor} onClick={onClick} />;
}
