"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar,
  User,
  Tag,
  CheckSquare,
  MessageSquare,
  Clock,
  Trash2,
  X,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import {
  updateTaskAction,
  deleteTaskAction,
  setTaskAssigneesAction,
  createCommentAction,
  addChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
} from "@/lib/task-actions";
import { useBoardStore } from "@/lib/stores/board-store";
import type { Task, BoardColumn, ProjectMember, ChecklistItem, Comment, ActivityLogEntry } from "@/lib/task-data";

interface TaskDetailDrawerProps {
  columns: BoardColumn[];
  isAdmin: boolean;
}

const priorityOptions = [
  { value: "urgent", label: "Urgent", color: "text-red-600" },
  { value: "high", label: "High", color: "text-orange-600" },
  { value: "medium", label: "Medium", color: "text-yellow-600" },
  { value: "low", label: "Low", color: "text-blue-600" },
];

export function TaskDetailDrawer({ columns, isAdmin }: TaskDetailDrawerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskId = searchParams.get("task");
  const [isPending, startTransition] = useTransition();

  // Task data fetched from API
  const [task, setTask] = useState<Task | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activityTab, setActivityTab] = useState<"all" | "comments">("all");

  // Edit states
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [newComment, setNewComment] = useState("");
  const [newCheckItem, setNewCheckItem] = useState("");

  const store = useBoardStore();

  // Fetch task detail when taskId changes
  useEffect(() => {
    if (!taskId) {
      setTask(null);
      return;
    }
    setLoading(true);
    fetch(`/api/tasks/${taskId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setTask(data);
        else toast.error("Task not found");
      })
      .finally(() => setLoading(false));

    // Load checklist, comments, activity
    fetch(`/api/tasks/${taskId}/activity`).then((r) => r.json()).then(setActivity).catch(() => {});
  }, [taskId]);

  // Load checklist when task loads
  useEffect(() => {
    if (!task) return;
    // Checklist data comes from task detail in getTaskById but we need the items
    // Use checklist_total/checklist_done from task for now
    setTitleDraft(task.title);
  }, [task]);

  function close() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("task");
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  }

  // Field update helper
  function updateField(field: string, value: unknown) {
    if (!task) return;
    startTransition(async () => {
      try {
        await updateTaskAction(task.id, { [field]: value });
        setTask((prev) => prev ? { ...prev, [field]: value } : prev);
        store.updateTask(task.id, { [field]: value } as Partial<Task>);
      } catch {
        toast.error(`Failed to update ${field}`);
      }
    });
  }

  // Title save
  function saveTitle() {
    if (!task || !titleDraft.trim() || titleDraft.trim() === task.title) {
      setEditingTitle(false);
      return;
    }
    updateField("title", titleDraft.trim());
    setEditingTitle(false);
  }

  // Assignee toggle
  function toggleAssignee(agentId: string) {
    if (!task) return;
    const currentIds = (task.assignees ?? []).map((a) => a.agent_id);
    const newIds = currentIds.includes(agentId)
      ? currentIds.filter((id) => id !== agentId)
      : [...currentIds, agentId];
    startTransition(async () => {
      try {
        await setTaskAssigneesAction(task.id, newIds);
        // Refresh task
        const res = await fetch(`/api/tasks/${task.id}`);
        if (res.ok) setTask(await res.json());
      } catch {
        toast.error("Failed to update assignees");
      }
    });
  }

  // Add comment
  function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !newComment.trim()) return;
    startTransition(async () => {
      try {
        await createCommentAction(task.id, newComment.trim());
        setNewComment("");
        // Refresh activity
        const res = await fetch(`/api/tasks/${task.id}/activity`);
        if (res.ok) setActivity(await res.json());
      } catch {
        toast.error("Failed to add comment");
      }
    });
  }

  // Add checklist item
  function handleAddCheckItem(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !newCheckItem.trim()) return;
    startTransition(async () => {
      try {
        await addChecklistItemAction(task.id, newCheckItem.trim());
        setNewCheckItem("");
        // Refresh task to get updated counts
        const res = await fetch(`/api/tasks/${task.id}`);
        if (res.ok) setTask(await res.json());
      } catch {
        toast.error("Failed to add checklist item");
      }
    });
  }

  // Delete task
  function handleDelete() {
    if (!task) return;
    startTransition(async () => {
      try {
        await deleteTaskAction(task.id);
        store.removeTask(task.id);
        toast.success("Task deleted");
        close();
      } catch {
        toast.error("Failed to delete task");
      }
    });
  }

  const isOpen = !!taskId;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent className="w-full sm:w-[480px] sm:max-w-[480px] overflow-y-auto p-0">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !task ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-muted-foreground">Task not found</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-6 pt-6 pb-4">
              <SheetHeader>
                <div className="flex items-start justify-between gap-2">
                  {editingTitle ? (
                    <Input
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={(e) => { if (e.key === "Enter") saveTitle(); if (e.key === "Escape") { setTitleDraft(task.title); setEditingTitle(false); } }}
                      autoFocus
                      className="text-lg font-semibold"
                    />
                  ) : (
                    <SheetTitle
                      className="text-lg font-semibold cursor-pointer hover:text-primary transition-colors text-left"
                      onClick={() => { setTitleDraft(task.title); setEditingTitle(true); }}
                    >
                      {task.title}
                    </SheetTitle>
                  )}
                </div>
              </SheetHeader>

              {/* Status + Priority row */}
              <div className="flex items-center gap-3 mt-3">
                <Select value={task.column_id} onValueChange={(colId) => updateField("column_id", colId)}>
                  <SelectTrigger className="h-8 w-[140px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {columns.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                          {c.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={task.priority ?? "none"} onValueChange={(v) => updateField("priority", v === "none" ? null : v)}>
                  <SelectTrigger className="h-8 w-[110px] text-xs">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No priority</SelectItem>
                    {priorityOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <span className={p.color}>{p.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {isAdmin && (
                  <Button variant="ghost" size="icon" className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive" onClick={handleDelete} disabled={isPending}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <Separator />

            {/* Meta section */}
            <div className="px-6 py-4 space-y-3">
              {/* Assignees */}
              <div className="flex items-start gap-3">
                <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1.5">Assignees</p>
                  <div className="flex flex-wrap gap-1.5">
                    {store.members.map((m) => {
                      const isAssigned = (task.assignees ?? []).some((a) => a.agent_id === m.agent_id);
                      return (
                        <button
                          key={m.agent_id}
                          onClick={() => toggleAssignee(m.agent_id)}
                          disabled={isPending}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors border",
                            isAssigned ? "bg-primary/10 text-primary border-primary/30" : "bg-muted/50 text-muted-foreground border-transparent hover:border-muted-foreground/30"
                          )}
                        >
                          {m.name}
                          {isAssigned && <X className="h-3 w-3" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Due date */}
              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground mb-1">Due Date</p>
                  <Input
                    type="datetime-local"
                    value={task.due_date ? format(new Date(task.due_date), "yyyy-MM-dd'T'HH:mm") : ""}
                    onChange={(e) => updateField("due_date", e.target.value || null)}
                    className="h-8 text-xs w-[200px]"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Description</p>
                <textarea
                  value={task.description ?? ""}
                  onChange={(e) => setTask((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                  onBlur={() => updateField("description", task.description)}
                  placeholder="Add a description..."
                  className="w-full min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            <Separator />

            {/* Checklist */}
            <div className="px-6 py-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Checklist</p>
                {task.checklist_total != null && task.checklist_total > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {task.checklist_done}/{task.checklist_total}
                  </span>
                )}
              </div>
              {/* Progress bar */}
              {task.checklist_total != null && task.checklist_total > 0 && (
                <div className="w-full h-1.5 bg-muted rounded-full mb-3">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.round(((task.checklist_done ?? 0) / task.checklist_total) * 100)}%` }}
                  />
                </div>
              )}
              {/* Add item form */}
              <form onSubmit={handleAddCheckItem} className="flex gap-2">
                <Input
                  value={newCheckItem}
                  onChange={(e) => setNewCheckItem(e.target.value)}
                  placeholder="Add checklist item..."
                  className="h-8 text-sm flex-1"
                />
                <Button size="sm" type="submit" disabled={isPending || !newCheckItem.trim()}>
                  Add
                </Button>
              </form>
            </div>

            <Separator />

            {/* Activity / Comments */}
            <div className="px-6 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Activity</p>
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => setActivityTab("all")}
                    className={cn("text-xs px-2 py-0.5 rounded", activityTab === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground")}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setActivityTab("comments")}
                    className={cn("text-xs px-2 py-0.5 rounded", activityTab === "comments" ? "bg-primary/10 text-primary" : "text-muted-foreground")}
                  >
                    Comments
                  </button>
                </div>
              </div>

              {/* Add comment */}
              <form onSubmit={handleAddComment} className="flex gap-2 mb-4">
                <Input
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  className="h-8 text-sm flex-1"
                />
                <Button size="sm" type="submit" disabled={isPending || !newComment.trim()}>
                  <MessageSquare className="h-3.5 w-3.5" />
                </Button>
              </form>

              {/* Activity list */}
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {activity
                  .filter((a) => activityTab === "all" || a.action_type === "comment_added")
                  .map((entry) => (
                    <div key={entry.id} className="text-xs border-l-2 border-muted pl-3 py-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{entry.actor_name ?? entry.actor_label}</span>
                        <span className="text-muted-foreground">
                          {entry.action_type === "comment_added"
                            ? "commented"
                            : entry.action_type === "task_created"
                              ? "created this task"
                              : entry.action_type === "task_moved"
                                ? `moved to ${entry.new_value}`
                                : `changed ${entry.field}`}
                        </span>
                      </div>
                      {entry.action_type === "field_changed" && entry.old_value && (
                        <div className="text-muted-foreground mt-0.5">
                          {entry.old_value} → {entry.new_value}
                        </div>
                      )}
                      <div className="text-muted-foreground/60 mt-0.5" title={entry.created_at}>
                        {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                      </div>
                    </div>
                  ))}
                {activity.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">No activity yet</p>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
