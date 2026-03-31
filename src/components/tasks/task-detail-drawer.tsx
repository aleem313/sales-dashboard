"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  CalendarClock,
  User,
  CheckSquare,
  MessageSquare,
  Clock,
  Timer,
  Trash2,
  X,
  Loader2,
  Flag,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Share2,
  Link2,
  Plus,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import {
  updateTaskAction,
  deleteTaskAction,
  setTaskAssigneesAction,
  setTaskTagsAction,
  createTagAction,
  createCommentAction,
  addChecklistItemAction,
  toggleChecklistItemAction,
  deleteChecklistItemAction,
} from "@/lib/task-actions";
import type { TaskTag } from "@/lib/task-data";
import { useBoardStore } from "@/lib/stores/board-store";
import type { Task, BoardColumn, ProjectMember, ChecklistItem, Comment, ActivityLogEntry } from "@/lib/task-data";

interface TaskDetailDrawerProps {
  columns: BoardColumn[];
  isAdmin: boolean;
}

const priorityOptions = [
  { value: "urgent", label: "Urgent", color: "text-red-600", icon: "text-red-500" },
  { value: "high", label: "High", color: "text-orange-600", icon: "text-orange-500" },
  { value: "medium", label: "Medium", color: "text-yellow-600", icon: "text-yellow-500" },
  { value: "low", label: "Low", color: "text-blue-600", icon: "text-blue-500" },
];

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ["bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500", "bg-indigo-500", "bg-teal-500", "bg-amber-500", "bg-cyan-500"];
  return colors[Math.abs(hash) % colors.length];
}

function formatMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function parseTimeInput(value: string): number | null {
  // Accept formats: "2h", "30m", "2h 30m", "2:30", "150" (minutes)
  const hm = value.match(/^(\d+)h\s*(\d+)m$/i);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const hOnly = value.match(/^(\d+)h$/i);
  if (hOnly) return parseInt(hOnly[1]) * 60;
  const mOnly = value.match(/^(\d+)m$/i);
  if (mOnly) return parseInt(mOnly[1]);
  const colon = value.match(/^(\d+):(\d+)$/);
  if (colon) return parseInt(colon[1]) * 60 + parseInt(colon[2]);
  const num = parseInt(value);
  if (!isNaN(num)) return num;
  return null;
}

export function TaskDetailDrawer({ columns, isAdmin }: TaskDetailDrawerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskId = searchParams.get("task");
  const [isPending, startTransition] = useTransition();

  // Task data fetched from API
  const [task, setTask] = useState<Task | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activityTab, setActivityTab] = useState<"all" | "comments">("all");

  // Edit states
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [newComment, setNewComment] = useState("");
  const [newCheckItem, setNewCheckItem] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Tags
  const [projectTags, setProjectTags] = useState<TaskTag[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  // Collapsible sections
  const [fieldsExpanded, setFieldsExpanded] = useState(true);
  const [checklistExpanded, setChecklistExpanded] = useState(true);

  // Time editing
  const [editingTimeEstimate, setEditingTimeEstimate] = useState(false);
  const [editingTimeTracked, setEditingTimeTracked] = useState(false);
  const [timeEstimateDraft, setTimeEstimateDraft] = useState("");
  const [timeTrackedDraft, setTimeTrackedDraft] = useState("");

  const store = useBoardStore();

  // Fetch task detail when taskId changes
  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setChecklistItems([]);
      setActivity([]);
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

    // Load activity
    fetch(`/api/tasks/${taskId}/activity`).then((r) => r.json()).then(setActivity).catch(() => {});
  }, [taskId]);

  // Fetch project tags when task loads
  useEffect(() => {
    if (!task?.project_id) return;
    fetch(`/api/projects/${task.project_id}/tags`).then((r) => r.json()).then(setProjectTags).catch(() => {});
  }, [task?.project_id]);

  // Update title draft when task loads
  useEffect(() => {
    if (!task) return;
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

  // Custom field update
  function updateCustomField(key: string, value: unknown) {
    if (!task) return;
    const cf = { ...(task.custom_fields as Record<string, unknown> ?? {}), [key]: value };
    startTransition(async () => {
      try {
        await updateTaskAction(task.id, { custom_fields: cf });
        setTask((prev) => prev ? { ...prev, custom_fields: cf } : prev);
        store.updateTask(task.id, { custom_fields: cf } as Partial<Task>);
      } catch {
        toast.error("Failed to update field");
      }
    });
  }

  function saveTitle() {
    if (!task || !titleDraft.trim() || titleDraft.trim() === task.title) {
      setEditingTitle(false);
      return;
    }
    updateField("title", titleDraft.trim());
    setEditingTitle(false);
  }

  function toggleAssignee(agentId: string) {
    if (!task) return;
    const currentIds = (task.assignees ?? []).map((a) => a.agent_id);
    const newIds = currentIds.includes(agentId)
      ? currentIds.filter((id) => id !== agentId)
      : [...currentIds, agentId];
    startTransition(async () => {
      try {
        await setTaskAssigneesAction(task.id, newIds);
        const res = await fetch(`/api/tasks/${task.id}`);
        if (res.ok) setTask(await res.json());
      } catch {
        toast.error("Failed to update assignees");
      }
    });
  }

  function toggleTag(tagId: string) {
    if (!task) return;
    const currentIds = (task.tags ?? []).map((t) => t.id);
    const newIds = currentIds.includes(tagId)
      ? currentIds.filter((id) => id !== tagId)
      : [...currentIds, tagId];
    startTransition(async () => {
      try {
        await setTaskTagsAction(task.id, newIds);
        const res = await fetch(`/api/tasks/${task.id}`);
        if (res.ok) setTask(await res.json());
      } catch {
        toast.error("Failed to update tags");
      }
    });
  }

  async function handleCreateTag() {
    if (!task || !newTagName.trim()) return;
    startTransition(async () => {
      try {
        const tag = await createTagAction(task.project_id, newTagName.trim());
        setProjectTags((prev) => [...prev, tag as TaskTag]);
        setNewTagName("");
        // Auto-assign the new tag to this task
        const currentIds = (task.tags ?? []).map((t) => t.id);
        await setTaskTagsAction(task.id, [...currentIds, tag.id]);
        const res = await fetch(`/api/tasks/${task.id}`);
        if (res.ok) setTask(await res.json());
      } catch {
        toast.error("Failed to create tag");
      }
    });
  }

  function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !newComment.trim()) return;
    startTransition(async () => {
      try {
        await createCommentAction(task.id, newComment.trim());
        setNewComment("");
        const res = await fetch(`/api/tasks/${task.id}/activity`);
        if (res.ok) setActivity(await res.json());
      } catch {
        toast.error("Failed to add comment");
      }
    });
  }

  function handleAddCheckItem(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !newCheckItem.trim()) return;
    startTransition(async () => {
      try {
        await addChecklistItemAction(task.id, newCheckItem.trim());
        setNewCheckItem("");
        const res = await fetch(`/api/tasks/${task.id}`);
        if (res.ok) setTask(await res.json());
      } catch {
        toast.error("Failed to add checklist item");
      }
    });
  }

  function handleDelete() {
    if (!task) return;
    setDeleteConfirmOpen(false);
    startTransition(async () => {
      try {
        await deleteTaskAction(task.id);
        store.removeTask(task.id);
        toast.success("Task deleted");
        close();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete task");
      }
    });
  }

  function handleCopyLink() {
    const url = `${window.location.origin}/tasks?task=${task?.id}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Link copied"));
  }

  function saveTimeEstimate() {
    const mins = parseTimeInput(timeEstimateDraft);
    if (mins !== null && mins >= 0) {
      updateCustomField("_time_estimate_minutes", mins);
    }
    setEditingTimeEstimate(false);
  }

  function saveTimeTracked() {
    const mins = parseTimeInput(timeTrackedDraft);
    if (mins !== null && mins >= 0) {
      updateCustomField("_time_tracked_minutes", mins);
    }
    setEditingTimeTracked(false);
  }

  // Derived values
  const cf = (task?.custom_fields ?? {}) as Record<string, unknown>;
  const timeEstimate = (cf._time_estimate_minutes as number) || 0;
  const timeTracked = (cf._time_tracked_minutes as number) || 0;
  const currentColumn = columns.find((c) => c.id === task?.column_id);
  const isOpen = !!taskId;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent className="w-full sm:w-[520px] sm:max-w-[520px] overflow-y-auto p-0">
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
            {/* ── Header ── */}
            <div className="px-6 pt-6 pb-3">
              <SheetHeader>
                <div className="flex items-start justify-between gap-2">
                  {editingTitle ? (
                    <Input
                      value={titleDraft}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={saveTitle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveTitle();
                        if (e.key === "Escape") { setTitleDraft(task.title); setEditingTitle(false); }
                      }}
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
                  {/* Action buttons */}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={handleCopyLink} title="Copy link">
                      <Link2 className="h-3.5 w-3.5" />
                    </Button>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteConfirmOpen(true)} disabled={isPending} title="Delete task">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </SheetHeader>

              {/* Status badge */}
              <div className="mt-3">
                <Select value={task.column_id} onValueChange={(colId) => updateField("column_id", colId)}>
                  <SelectTrigger className="h-7 w-fit text-xs font-medium gap-1.5 px-2.5 rounded-full" style={{ backgroundColor: (currentColumn?.color ?? "#6b7280") + "18", color: currentColumn?.color ?? "#6b7280", borderColor: (currentColumn?.color ?? "#6b7280") + "40" }}>
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: currentColumn?.color ?? "#6b7280" }} />
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
              </div>
            </div>

            <Separator />

            {/* ── Fields section (ClickUp-style rows) ── */}
            <div className="px-6 py-3 space-y-0">

              {/* Assignees */}
              <FieldRow icon={<User className="h-4 w-4" />} label="Assignees">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(task.assignees ?? []).map((a) => (
                    <button
                      key={a.agent_id}
                      onClick={() => toggleAssignee(a.agent_id)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary/8 text-primary border border-primary/20 px-2 py-0.5 text-xs font-medium hover:bg-primary/15 transition-colors"
                    >
                      <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-[7px] font-bold text-white", hashColor(a.agent_id))}>
                        {a.avatar_url ? <img src={a.avatar_url} alt={a.name} className="h-full w-full rounded-full object-cover" /> : getInitials(a.name)}
                      </span>
                      {a.name}
                      <X className="h-3 w-3 opacity-50 hover:opacity-100" />
                    </button>
                  ))}
                  {/* Add assignee dropdown */}
                  <AssigneeDropdown
                    members={store.members}
                    assignedIds={(task.assignees ?? []).map((a) => a.agent_id)}
                    onToggle={toggleAssignee}
                    disabled={isPending}
                  />
                </div>
              </FieldRow>

              {/* Priority */}
              <FieldRow icon={<Flag className="h-4 w-4" />} label="Priority">
                <Select value={task.priority ?? "none"} onValueChange={(v) => updateField("priority", v === "none" ? null : v)}>
                  <SelectTrigger className="h-7 w-[120px] text-xs border-0 bg-transparent hover:bg-muted/50 px-2">
                    <SelectValue placeholder="Set priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No priority</SelectItem>
                    {priorityOptions.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <span className={cn("flex items-center gap-1.5", p.color)}>
                          <Flag className="h-3 w-3" />
                          {p.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FieldRow>

              {/* Due Date */}
              <FieldRow icon={<Calendar className="h-4 w-4" />} label="Due Date">
                <Input
                  type="datetime-local"
                  value={task.due_date ? format(new Date(task.due_date), "yyyy-MM-dd'T'HH:mm") : ""}
                  onChange={(e) => updateField("due_date", e.target.value || null)}
                  className="h-7 text-xs w-[190px] border-0 bg-transparent hover:bg-muted/50 px-2"
                />
                {task.due_date && (
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground" onClick={() => updateField("due_date", null)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </FieldRow>

              {/* Start Date */}
              <FieldRow icon={<CalendarClock className="h-4 w-4" />} label="Start Date">
                <Input
                  type="datetime-local"
                  value={task.start_date ? format(new Date(task.start_date), "yyyy-MM-dd'T'HH:mm") : ""}
                  onChange={(e) => updateField("start_date", e.target.value || null)}
                  className="h-7 text-xs w-[190px] border-0 bg-transparent hover:bg-muted/50 px-2"
                />
                {task.start_date && (
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground" onClick={() => updateField("start_date", null)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </FieldRow>

              {/* Time Estimate */}
              <FieldRow icon={<Clock className="h-4 w-4" />} label="Time Estimate">
                {editingTimeEstimate ? (
                  <Input
                    value={timeEstimateDraft}
                    onChange={(e) => setTimeEstimateDraft(e.target.value)}
                    onBlur={saveTimeEstimate}
                    onKeyDown={(e) => { if (e.key === "Enter") saveTimeEstimate(); if (e.key === "Escape") setEditingTimeEstimate(false); }}
                    placeholder="e.g. 2h 30m"
                    className="h-7 text-xs w-[120px] px-2"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => { setTimeEstimateDraft(timeEstimate > 0 ? formatMinutes(timeEstimate) : ""); setEditingTimeEstimate(true); }}
                    className="text-xs px-2 py-1 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
                  >
                    {timeEstimate > 0 ? formatMinutes(timeEstimate) : "Set estimate"}
                  </button>
                )}
              </FieldRow>

              {/* Time Tracked */}
              <FieldRow icon={<Timer className="h-4 w-4" />} label="Track Time">
                {editingTimeTracked ? (
                  <Input
                    value={timeTrackedDraft}
                    onChange={(e) => setTimeTrackedDraft(e.target.value)}
                    onBlur={saveTimeTracked}
                    onKeyDown={(e) => { if (e.key === "Enter") saveTimeTracked(); if (e.key === "Escape") setEditingTimeTracked(false); }}
                    placeholder="e.g. 1h 15m"
                    className="h-7 text-xs w-[120px] px-2"
                    autoFocus
                  />
                ) : (
                  <button
                    onClick={() => { setTimeTrackedDraft(timeTracked > 0 ? formatMinutes(timeTracked) : ""); setEditingTimeTracked(true); }}
                    className="text-xs px-2 py-1 rounded hover:bg-muted/50 text-muted-foreground transition-colors"
                  >
                    {timeTracked > 0
                      ? `${formatMinutes(timeTracked)}${timeEstimate > 0 ? ` / ${formatMinutes(timeEstimate)}` : ""}`
                      : "Add time"}
                  </button>
                )}
              </FieldRow>

              {/* Labels / Tags */}
              <FieldRow icon={<Tag className="h-4 w-4" />} label="Labels">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(task.tags ?? []).map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors hover:opacity-80"
                      style={{ backgroundColor: tag.color + "22", color: tag.color }}
                    >
                      {tag.name}
                      <X className="h-2.5 w-2.5 opacity-50 hover:opacity-100" />
                    </button>
                  ))}
                  <div className="relative">
                    <button
                      onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      title="Add label"
                    >
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                    {tagDropdownOpen && (
                      <div className="absolute top-7 left-0 z-50 w-56 rounded-lg border bg-popover shadow-lg p-1.5">
                        <div className="px-1.5 pb-1.5">
                          <Input
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && newTagName.trim()) { e.preventDefault(); handleCreateTag(); }
                              if (e.key === "Escape") setTagDropdownOpen(false);
                            }}
                            placeholder="Search or create..."
                            className="h-7 text-xs"
                            autoFocus
                          />
                        </div>
                        <div className="max-h-[160px] overflow-y-auto">
                          {projectTags
                            .filter((t) => !newTagName || t.name.toLowerCase().includes(newTagName.toLowerCase()))
                            .map((tag) => {
                              const isAssigned = (task.tags ?? []).some((t) => t.id === tag.id);
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => { toggleTag(tag.id); }}
                                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors"
                                >
                                  <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                                  <span className="truncate">{tag.name}</span>
                                  {isAssigned && <span className="ml-auto text-primary">✓</span>}
                                </button>
                              );
                            })}
                        </div>
                        {newTagName.trim() && !projectTags.some((t) => t.name.toLowerCase() === newTagName.toLowerCase()) && (
                          <>
                            <Separator className="my-1" />
                            <button
                              onClick={handleCreateTag}
                              disabled={isPending}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-primary hover:bg-muted transition-colors"
                            >
                              <Plus className="h-3 w-3" />
                              Create &ldquo;{newTagName.trim()}&rdquo;
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </FieldRow>
            </div>

            <Separator />

            {/* ── Custom Fields section (expandable) ── */}
            <div className="px-6 py-3">
              <button
                onClick={() => setFieldsExpanded(!fieldsExpanded)}
                className="flex items-center gap-2 w-full text-sm font-medium text-left hover:text-primary transition-colors"
              >
                {fieldsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Fields
                <span className="text-xs text-muted-foreground font-normal">
                  {Object.keys(cf).filter((k) => !k.startsWith("_")).length > 0
                    ? `(${Object.keys(cf).filter((k) => !k.startsWith("_")).length})`
                    : ""}
                </span>
              </button>

              {fieldsExpanded && (
                <div className="mt-2 space-y-2 pl-6">
                  {/* Show non-internal custom fields */}
                  {Object.entries(cf)
                    .filter(([k]) => !k.startsWith("_"))
                    .map(([key, value]) => (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-[100px] truncate">{key}</span>
                        <Input
                          value={String(value ?? "")}
                          onChange={(e) => {
                            const newCf = { ...cf, [key]: e.target.value };
                            setTask((prev) => prev ? { ...prev, custom_fields: newCf } : prev);
                          }}
                          onBlur={() => updateCustomField(key, cf[key])}
                          className="h-7 text-xs flex-1 border-0 bg-transparent hover:bg-muted/50 px-2"
                        />
                      </div>
                    ))}

                  {/* Add custom field placeholder */}
                  <button className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 mt-1">
                    <Plus className="h-3 w-3" />
                    Add field
                  </button>
                </div>
              )}
            </div>

            <Separator />

            {/* ── Description ── */}
            <div className="px-6 py-3">
              <p className="text-sm font-medium mb-2">Description</p>
              <textarea
                value={task.description ?? ""}
                onChange={(e) => setTask((prev) => prev ? { ...prev, description: e.target.value } : prev)}
                onBlur={() => updateField("description", task.description)}
                placeholder="Add a description..."
                className="w-full min-h-[80px] rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              />
            </div>

            <Separator />

            {/* ── Subtasks / Checklist ── */}
            <div className="px-6 py-3">
              <button
                onClick={() => setChecklistExpanded(!checklistExpanded)}
                className="flex items-center gap-2 w-full text-sm font-medium text-left hover:text-primary transition-colors"
              >
                {checklistExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <ListChecks className="h-4 w-4 text-muted-foreground" />
                Subtasks
                {task.checklist_total != null && task.checklist_total > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">
                    {task.checklist_done}/{task.checklist_total}
                  </span>
                )}
              </button>

              {checklistExpanded && (
                <div className="mt-2 pl-6">
                  {/* Progress bar */}
                  {task.checklist_total != null && task.checklist_total > 0 && (
                    <div className="w-full h-1.5 bg-muted rounded-full mb-3">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          task.checklist_done === task.checklist_total ? "bg-green-500" : "bg-primary"
                        )}
                        style={{ width: `${Math.round(((task.checklist_done ?? 0) / task.checklist_total) * 100)}%` }}
                      />
                    </div>
                  )}

                  {/* Add item form */}
                  <form onSubmit={handleAddCheckItem} className="flex gap-2">
                    <Input
                      value={newCheckItem}
                      onChange={(e) => setNewCheckItem(e.target.value)}
                      placeholder="Add subtask..."
                      className="h-7 text-xs flex-1"
                    />
                    <Button size="sm" type="submit" disabled={isPending || !newCheckItem.trim()} className="h-7 text-xs px-2">
                      Add
                    </Button>
                  </form>
                </div>
              )}
            </div>

            <Separator />

            {/* ── Activity / Comments ── */}
            <div className="px-6 py-3">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
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
                <Button size="sm" type="submit" disabled={isPending || !newComment.trim()} className="h-8">
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
                      {entry.action_type === "comment_added" && entry.new_value && (
                        <div className="mt-1 text-foreground bg-muted/50 rounded px-2 py-1">
                          {entry.new_value}
                        </div>
                      )}
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

        {/* Delete confirmation overlay */}
        {deleteConfirmOpen && task && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirmOpen(false)}>
            <div className="bg-card rounded-lg border shadow-lg p-6 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold mb-2">Delete Task</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Delete &ldquo;{task.title.length > 50 ? task.title.slice(0, 50) + "..." : task.title}&rdquo;? This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>
                  {isPending ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ── Field Row component (ClickUp-style icon + label + value) ── */
function FieldRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 min-h-[36px]">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-xs text-muted-foreground w-[90px] shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}

/* ── Assignee Dropdown (ClickUp-style popover) ── */
function AssigneeDropdown({ members, assignedIds, onToggle, disabled }: {
  members: ProjectMember[];
  assignedIds: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = members.filter((m) =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    (m.email ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 hover:border-primary hover:text-primary transition-colors"
        title="Add assignee"
      >
        <Plus className="h-3 w-3" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(""); }} />
          <div className="absolute left-0 top-8 z-50 w-[220px] rounded-lg border bg-popover shadow-lg p-1.5">
            <Input
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs mb-1.5"
              autoFocus
            />
            <div className="max-h-[180px] overflow-y-auto space-y-0.5">
              {filtered.map((m) => {
                const isAssigned = assignedIds.includes(m.agent_id);
                return (
                  <button
                    key={m.agent_id}
                    onClick={() => onToggle(m.agent_id)}
                    className={cn(
                      "flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs hover:bg-muted transition-colors",
                      isAssigned && "bg-primary/5"
                    )}
                  >
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white shrink-0", hashColor(m.agent_id))}>
                      {m.avatar_url ? <img src={m.avatar_url} className="h-full w-full rounded-full object-cover" /> : getInitials(m.name)}
                    </span>
                    <span className="flex-1 text-left truncate">{m.name}</span>
                    {isAssigned && <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">No members found</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
