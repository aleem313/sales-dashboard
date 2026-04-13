"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  Link2,
  Plus,
  Tag,
  Pencil,
  Reply,
  CornerDownRight,
  Paperclip,
  Upload,
  FileText,
  Image as ImageIcon,
  Download,
  ArrowLeft,
  Search,
  Copy,
} from "lucide-react";
import { cn, copyText } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";
import {
  updateTaskAction,
  moveTaskAction,
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
import { RichTextEditor } from "./rich-text-editor";
import { CustomFieldRenderer } from "./custom-field-renderer";
import { JobDetails } from "./job-details";
import { ProposalBox } from "./proposal-box";
import type { Task, BoardColumn, ProjectMember, ChecklistItem, Comment, ActivityLogEntry, CustomFieldDefinition } from "@/lib/task-data";
import type { Job } from "@/lib/types";

type JobWithMeta = Job & { agent_name?: string | null; profile_name?: string | null };

interface TaskFullViewProps {
  taskId: string;
  columns: BoardColumn[];
  isAdmin: boolean;
  agentId?: string | null;
  backUrl: string;
  onClose?: () => void;
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

export function TaskFullView({ taskId, columns, isAdmin, agentId: currentAgentId, backUrl, onClose }: TaskFullViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Task data
  const [task, setTask] = useState<Task | null>(null);
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityTab, setActivityTab] = useState<"all" | "comments">("all");
  const [attachments, setAttachments] = useState<{ id: string; filename: string; url: string; size_bytes: number; mime_type: string; uploader_id: string; uploader_name: string; created_at: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  // Job data (column 2)
  const [job, setJob] = useState<JobWithMeta | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);

  // Job search
  const [jobSearchOpen, setJobSearchOpen] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [jobSearchResults, setJobSearchResults] = useState<Job[]>([]);
  const [jobSearching, setJobSearching] = useState(false);

  // Edit states
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [newComment, setNewComment] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editCommentText, setEditCommentText] = useState("");
  const [newCheckItem, setNewCheckItem] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Tags
  const [projectTags, setProjectTags] = useState<TaskTag[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  // Custom fields
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDefinition[]>([]);

  // Collapsible sections
  const [fieldsExpanded, setFieldsExpanded] = useState(true);
  const [checklistExpanded, setChecklistExpanded] = useState(true);

  // Time editing
  const [editingTimeEstimate, setEditingTimeEstimate] = useState(false);
  const [editingTimeTracked, setEditingTimeTracked] = useState(false);
  const [timeEstimateDraft, setTimeEstimateDraft] = useState("");
  const [timeTrackedDraft, setTimeTrackedDraft] = useState("");

  const store = useBoardStore();

  // Fetch task
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/tasks/${taskId}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/tasks/${taskId}/activity`).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/tasks/${taskId}/comments`).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/tasks/${taskId}/attachments`).then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([taskData, actData, cmtData, attData]) => {
      if (taskData) {
        setTask(taskData);
        setTitleDraft(taskData.title);
      } else {
        toast.error("Task not found");
      }
      setActivity(actData);
      setComments(cmtData);
      setAttachments(attData);
    }).finally(() => setLoading(false));
  }, [taskId]);

  // Fetch project tags + custom fields when task loads
  useEffect(() => {
    if (!task?.project_id) return;
    fetch(`/api/projects/${task.project_id}/tags`).then((r) => r.json()).then(setProjectTags).catch(() => {});
    fetch(`/api/projects/${task.project_id}/custom-fields`).then((r) => r.json()).then(setCustomFieldDefs).catch(() => {});
  }, [task?.project_id]);

  // Fetch linked job
  const fetchLinkedJob = useCallback(async (jobId: string) => {
    setJobLoading(true);
    setJobError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (res.ok) {
        setJob(await res.json());
      } else {
        setJobError("Failed to load job details");
      }
    } catch {
      setJobError("Failed to load job details");
    } finally {
      setJobLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!task) return;
    const cf = task.custom_fields as Record<string, unknown> | null;
    const linkedJobId = cf?._job_id as string | undefined;
    if (linkedJobId) {
      fetchLinkedJob(linkedJobId);
    }
  }, [task, fetchLinkedJob]);

  // Job search
  useEffect(() => {
    if (!jobSearchQuery.trim()) {
      setJobSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setJobSearching(true);
      try {
        const res = await fetch(`/api/jobs/search?q=${encodeURIComponent(jobSearchQuery)}&limit=10`);
        if (res.ok) setJobSearchResults(await res.json());
      } catch { /* ignore */ }
      setJobSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [jobSearchQuery]);

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

  function linkJob(jobData: Job) {
    if (!task) return;
    const cf = { ...(task.custom_fields as Record<string, unknown> ?? {}), _job_id: jobData.id };
    startTransition(async () => {
      try {
        await updateTaskAction(task.id, { custom_fields: cf });
        setTask((prev) => prev ? { ...prev, custom_fields: cf } : prev);
        setJob(jobData as JobWithMeta);
        setJobSearchOpen(false);
        setJobSearchQuery("");
        toast.success("Job linked");
      } catch {
        toast.error("Failed to link job");
      }
    });
  }

  function unlinkJob() {
    if (!task) return;
    const cf = { ...(task.custom_fields as Record<string, unknown> ?? {}) };
    delete cf._job_id;
    startTransition(async () => {
      try {
        await updateTaskAction(task.id, { custom_fields: cf });
        setTask((prev) => prev ? { ...prev, custom_fields: cf } : prev);
        setJob(null);
        toast.success("Job unlinked");
      } catch {
        toast.error("Failed to unlink job");
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
        const [actRes, cmtRes] = await Promise.all([
          fetch(`/api/tasks/${task.id}/activity`),
          fetch(`/api/tasks/${task.id}/comments`),
        ]);
        if (actRes.ok) setActivity(await actRes.json());
        if (cmtRes.ok) setComments(await cmtRes.json());
      } catch {
        toast.error("Failed to add comment");
      }
    });
  }

  function handleReply(parentId: string) {
    if (!task || !replyText.trim()) return;
    startTransition(async () => {
      try {
        await createCommentAction(task.id, replyText.trim(), parentId);
        setReplyText("");
        setReplyTo(null);
        const [cmtRes, actRes] = await Promise.all([
          fetch(`/api/tasks/${task.id}/comments`),
          fetch(`/api/tasks/${task.id}/activity`),
        ]);
        if (cmtRes.ok) setComments(await cmtRes.json());
        if (actRes.ok) setActivity(await actRes.json());
      } catch {
        toast.error("Failed to add reply");
      }
    });
  }

  async function handleEditComment(commentId: string) {
    if (!task || !editCommentText.trim()) return;
    startTransition(async () => {
      try {
        await fetch(`/api/tasks/${task.id}/comments/${commentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: editCommentText.trim() }),
        });
        setEditingComment(null);
        setEditCommentText("");
        const cmtRes = await fetch(`/api/tasks/${task.id}/comments`);
        if (cmtRes.ok) setComments(await cmtRes.json());
      } catch {
        toast.error("Failed to edit comment");
      }
    });
  }

  async function handleDeleteComment(commentId: string) {
    if (!task) return;
    startTransition(async () => {
      try {
        await fetch(`/api/tasks/${task.id}/comments/${commentId}`, { method: "DELETE" });
        const [cmtRes, actRes] = await Promise.all([
          fetch(`/api/tasks/${task.id}/comments`),
          fetch(`/api/tasks/${task.id}/activity`),
        ]);
        if (cmtRes.ok) setComments(await cmtRes.json());
        if (actRes.ok) setActivity(await actRes.json());
      } catch {
        toast.error("Failed to delete comment");
      }
    });
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !task) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10MB)");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/tasks/${task.id}/attachments`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        toast.error(err.error ?? "Upload failed");
      } else {
        toast.success("File uploaded");
        const attRes = await fetch(`/api/tasks/${task.id}/attachments`);
        if (attRes.ok) setAttachments(await attRes.json());
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    if (!task) return;
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    try {
      await fetch(`/api/tasks/${task.id}/attachments?attachmentId=${attachmentId}`, { method: "DELETE" });
    } catch {
      toast.error("Failed to delete attachment");
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  function handleToggleCheckItem(itemId: string, isChecked: boolean) {
    if (!task) return;
    setTask((prev) => {
      if (!prev) return prev;
      const items = (prev.checklist_items ?? []).map((i) =>
        i.id === itemId ? { ...i, is_checked: isChecked } : i
      );
      const done = items.filter((i) => i.is_checked).length;
      return { ...prev, checklist_items: items, checklist_done: done };
    });
    startTransition(async () => {
      try {
        await toggleChecklistItemAction(itemId, isChecked);
      } catch {
        toast.error("Failed to toggle item");
        const res = await fetch(`/api/tasks/${task.id}`);
        if (res.ok) setTask(await res.json());
      }
    });
  }

  function handleDeleteCheckItem(itemId: string) {
    if (!task) return;
    setTask((prev) => {
      if (!prev) return prev;
      const items = (prev.checklist_items ?? []).filter((i) => i.id !== itemId);
      return { ...prev, checklist_items: items, checklist_total: items.length, checklist_done: items.filter((i) => i.is_checked).length };
    });
    startTransition(async () => {
      try {
        await deleteChecklistItemAction(itemId);
      } catch {
        toast.error("Failed to delete item");
        const res = await fetch(`/api/tasks/${task.id}`);
        if (res.ok) setTask(await res.json());
      }
    });
  }

  async function handleBulkAddCheckItems(titles: string[]) {
    if (!task) return;
    startTransition(async () => {
      try {
        for (const title of titles) {
          await addChecklistItemAction(task.id, title);
        }
        toast.success(`Added ${titles.length} items`);
        const res = await fetch(`/api/tasks/${task.id}`);
        if (res.ok) setTask(await res.json());
      } catch {
        toast.error("Failed to add items");
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
        if (onClose) onClose();
        else router.push(backUrl);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete task");
      }
    });
  }

  function handleCopyLink() {
    const basePath = window.location.pathname.startsWith("/my-") ? "/my-tasks" : "/tasks";
    const url = `${window.location.origin}${basePath}?task=${task?.id}`;
    copyText(url).then((ok) => {
      if (ok) toast.success("Link copied");
      else toast.error("Copy failed");
    });
  }

  function saveTimeEstimate() {
    const mins = parseTimeInput(timeEstimateDraft);
    if (mins !== null && mins >= 0) updateCustomField("_time_estimate_minutes", mins);
    setEditingTimeEstimate(false);
  }

  function saveTimeTracked() {
    const mins = parseTimeInput(timeTrackedDraft);
    if (mins !== null && mins >= 0) updateCustomField("_time_tracked_minutes", mins);
    setEditingTimeTracked(false);
  }

  // Derived values
  const cf = (task?.custom_fields ?? {}) as Record<string, unknown>;
  const timeEstimate = (cf._time_estimate_minutes as number) || 0;
  const timeTracked = (cf._time_tracked_minutes as number) || 0;
  const currentColumn = columns.find((c) => c.id === task?.column_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-muted-foreground">Task not found</p>
        <Button variant="outline" onClick={() => onClose ? onClose() : router.push(backUrl)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          {onClose ? "Close" : "Back to Board"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b px-6 py-3 bg-card/50 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => onClose ? onClose() : router.push(backUrl)}>
            <ArrowLeft className="h-4 w-4" />
            {onClose ? "Close" : "Back"}
          </Button>
          <Separator orientation="vertical" className="h-5" />
          {/* Status badge */}
          <Select value={task.column_id} onValueChange={(colId) => {
            if (colId === task.column_id) return;
            const prevColumnId = task.column_id;
            setTask((prev) => prev ? { ...prev, column_id: colId } : prev);
            store.moveTask(task.id, colId, 0);
            startTransition(async () => {
              try {
                await moveTaskAction(task.id, colId);
                const col = columns.find((c) => c.id === colId);
                toast.success(`Moved to ${col?.name ?? "column"}`);
              } catch {
                setTask((prev) => prev ? { ...prev, column_id: prevColumnId } : prev);
                store.moveTask(task.id, prevColumnId, 0);
                toast.error("Failed to update status");
              }
            });
          }}>
            <SelectTrigger
              className="h-7 w-fit text-xs font-medium gap-1.5 px-2.5 rounded-full"
              style={{
                backgroundColor: (currentColumn?.color ?? "#6b7280") + "18",
                color: currentColumn?.color ?? "#6b7280",
                borderColor: (currentColumn?.color ?? "#6b7280") + "40",
              }}
            >
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
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={handleCopyLink} title="Copy link">
            <Link2 className="h-3.5 w-3.5" />
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteConfirmOpen(true)} disabled={isPending} title="Delete task">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={onClose} title="Close">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* 3-Column Grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-0 min-h-full">

          {/* ═══ COLUMN 1: Task Fields ═══ */}
          <div className="xl:col-span-4 md:col-span-1 border-r overflow-y-auto p-5 space-y-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 bg-background pb-2 z-10">Task Details</h2>

            {/* Title */}
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
              <h1
                className="text-lg font-semibold cursor-pointer hover:text-primary transition-colors"
                onClick={() => { setTitleDraft(task.title); setEditingTitle(true); }}
              >
                {task.title}
              </h1>
            )}

            {/* Field rows */}
            <div className="space-y-0">
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
                  onChange={(e) => updateField("due_date", e.target.value ? new Date(e.target.value).toISOString() : null)}
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
                  onChange={(e) => updateField("start_date", e.target.value ? new Date(e.target.value).toISOString() : null)}
                  className="h-7 text-xs w-[190px] border-0 bg-transparent hover:bg-muted/50 px-2"
                />
                {task.start_date && (
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground" onClick={() => updateField("start_date", null)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </FieldRow>

              {/* Time Estimate */}
              <FieldRow icon={<Clock className="h-4 w-4" />} label="Time Est.">
                {editingTimeEstimate ? (
                  <Input value={timeEstimateDraft} onChange={(e) => setTimeEstimateDraft(e.target.value)} onBlur={saveTimeEstimate}
                    onKeyDown={(e) => { if (e.key === "Enter") saveTimeEstimate(); if (e.key === "Escape") setEditingTimeEstimate(false); }}
                    placeholder="e.g. 2h 30m" className="h-7 text-xs w-[120px] px-2" autoFocus />
                ) : (
                  <button onClick={() => { setTimeEstimateDraft(timeEstimate > 0 ? formatMinutes(timeEstimate) : ""); setEditingTimeEstimate(true); }}
                    className="text-xs px-2 py-1 rounded hover:bg-muted/50 text-muted-foreground transition-colors">
                    {timeEstimate > 0 ? formatMinutes(timeEstimate) : "Set estimate"}
                  </button>
                )}
              </FieldRow>

              {/* Time Tracked */}
              <FieldRow icon={<Timer className="h-4 w-4" />} label="Tracked">
                {editingTimeTracked ? (
                  <Input value={timeTrackedDraft} onChange={(e) => setTimeTrackedDraft(e.target.value)} onBlur={saveTimeTracked}
                    onKeyDown={(e) => { if (e.key === "Enter") saveTimeTracked(); if (e.key === "Escape") setEditingTimeTracked(false); }}
                    placeholder="e.g. 1h 15m" className="h-7 text-xs w-[120px] px-2" autoFocus />
                ) : (
                  <button onClick={() => { setTimeTrackedDraft(timeTracked > 0 ? formatMinutes(timeTracked) : ""); setEditingTimeTracked(true); }}
                    className="text-xs px-2 py-1 rounded hover:bg-muted/50 text-muted-foreground transition-colors">
                    {timeTracked > 0 ? `${formatMinutes(timeTracked)}${timeEstimate > 0 ? ` / ${formatMinutes(timeEstimate)}` : ""}` : "Add time"}
                  </button>
                )}
              </FieldRow>

              {/* Labels/Tags */}
              <FieldRow icon={<Tag className="h-4 w-4" />} label="Labels">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(task.tags ?? []).map((tag) => (
                    <button key={tag.id} onClick={() => toggleTag(tag.id)} disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors hover:opacity-80"
                      style={{ backgroundColor: tag.color + "22", color: tag.color }}>
                      {tag.name}
                      <X className="h-2.5 w-2.5 opacity-50 hover:opacity-100" />
                    </button>
                  ))}
                  <div className="relative">
                    <button onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors" title="Add label">
                      <Plus className="h-2.5 w-2.5" />
                    </button>
                    {tagDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setTagDropdownOpen(false)} />
                        <div className="absolute top-7 left-0 z-50 w-56 rounded-lg border bg-popover shadow-lg p-1.5">
                          <div className="px-1.5 pb-1.5">
                            <Input value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && newTagName.trim()) { e.preventDefault(); handleCreateTag(); }
                                if (e.key === "Escape") setTagDropdownOpen(false);
                              }}
                              placeholder="Search or create..." className="h-7 text-xs" autoFocus />
                          </div>
                          <div className="max-h-[160px] overflow-y-auto">
                            {projectTags
                              .filter((t) => !newTagName || t.name.toLowerCase().includes(newTagName.toLowerCase()))
                              .map((tag) => {
                                const isAssigned = (task.tags ?? []).some((t) => t.id === tag.id);
                                return (
                                  <button key={tag.id} onClick={() => toggleTag(tag.id)}
                                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors">
                                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                                    <span className="truncate">{tag.name}</span>
                                    {isAssigned && <span className="ml-auto text-primary">&#10003;</span>}
                                  </button>
                                );
                              })}
                          </div>
                          {newTagName.trim() && !projectTags.some((t) => t.name.toLowerCase() === newTagName.toLowerCase()) && (
                            <>
                              <Separator className="my-1" />
                              <button onClick={handleCreateTag} disabled={isPending}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-primary hover:bg-muted transition-colors">
                                <Plus className="h-3 w-3" />
                                Create &ldquo;{newTagName.trim()}&rdquo;
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </FieldRow>

              {/* Connects Used */}
              <FieldRow icon={<span className="h-4 w-4 flex items-center justify-center text-xs font-bold text-muted-foreground">#</span>} label="Connects">
                <Input
                  type="number" min={0}
                  value={((task.custom_fields as Record<string, unknown>)?._connects_used as number) ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : parseInt(e.target.value);
                    const newCf = { ...(task.custom_fields ?? {}), _connects_used: val };
                    setTask((prev) => prev ? { ...prev, custom_fields: newCf } : prev);
                  }}
                  onBlur={() => updateField("custom_fields", task.custom_fields)}
                  placeholder="0" className="h-7 text-xs w-[80px] border-0 bg-transparent hover:bg-muted/50 px-2"
                />
              </FieldRow>

              {/* Boosted Connects */}
              <FieldRow icon={<span className="h-4 w-4 flex items-center justify-center text-xs font-bold text-muted-foreground">⚡</span>} label="Boosted">
                <Input
                  type="number" min={0}
                  value={((task.custom_fields as Record<string, unknown>)?._boosted_connects as number) ?? ""}
                  onChange={(e) => {
                    const val = e.target.value === "" ? undefined : parseInt(e.target.value);
                    const newCf = { ...(task.custom_fields ?? {}), _boosted_connects: val };
                    setTask((prev) => prev ? { ...prev, custom_fields: newCf } : prev);
                  }}
                  onBlur={() => updateField("custom_fields", task.custom_fields)}
                  placeholder="0" className="h-7 text-xs w-[80px] border-0 bg-transparent hover:bg-muted/50 px-2"
                />
              </FieldRow>

              {/* Reason — only visible when status column is N/A */}
              {currentColumn?.name === "N/A" && (
                <FieldRow icon={<span className="h-4 w-4 flex items-center justify-center text-xs font-bold text-muted-foreground">?</span>} label="Reason">
                  <ReasonMultiSelect
                    value={((task.custom_fields as Record<string, unknown>)?._reason as string[]) ?? []}
                    onChange={(reasons) => {
                      const newCf = { ...(task.custom_fields ?? {}), _reason: reasons };
                      setTask((prev) => prev ? { ...prev, custom_fields: newCf } : prev);
                      updateCustomField("_reason", reasons);
                    }}
                  />
                </FieldRow>
              )}
            </div>

            <Separator />

            {/* Description */}
            <div>
              <p className="text-sm font-medium mb-2">Description</p>
              <RichTextEditor
                content={task.description ?? ""}
                onChange={(html) => setTask((prev) => prev ? { ...prev, description: html } : prev)}
                onBlur={() => updateField("description", task.description)}
              />
            </div>

            <Separator />

            {/* Subtasks/Checklist */}
            <div>
              <button onClick={() => setChecklistExpanded(!checklistExpanded)}
                className="flex items-center gap-2 w-full text-sm font-medium text-left hover:text-primary transition-colors">
                {checklistExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <ListChecks className="h-4 w-4 text-muted-foreground" />
                Subtasks
                {task.checklist_total != null && task.checklist_total > 0 && (
                  <span className="text-xs text-muted-foreground font-normal">{task.checklist_done}/{task.checklist_total}</span>
                )}
              </button>
              {checklistExpanded && (
                <div className="mt-2 pl-6 space-y-1.5">
                  {task.checklist_total != null && task.checklist_total > 0 && (
                    <div className="w-full h-1.5 bg-muted rounded-full mb-2">
                      <div className={cn("h-full rounded-full transition-all", task.checklist_done === task.checklist_total ? "bg-green-500" : "bg-primary")}
                        style={{ width: `${Math.round(((task.checklist_done ?? 0) / task.checklist_total) * 100)}%` }} />
                    </div>
                  )}
                  {(task.checklist_items ?? []).map((item) => (
                    <div key={item.id} className="group/item flex items-center gap-2">
                      <button onClick={() => handleToggleCheckItem(item.id, !item.is_checked)} disabled={isPending} className="shrink-0">
                        <div className={cn("h-4 w-4 rounded border-2 flex items-center justify-center transition-colors",
                          item.is_checked ? "bg-green-500 border-green-500 text-white" : "border-muted-foreground/40 hover:border-primary")}>
                          {item.is_checked && <CheckSquare className="h-3 w-3" />}
                        </div>
                      </button>
                      <span className={cn("text-xs flex-1 min-w-0 truncate", item.is_checked && "line-through text-muted-foreground")}>{item.title}</span>
                      <button onClick={() => handleDeleteCheckItem(item.id)} disabled={isPending}
                        className="shrink-0 opacity-0 group-hover/item:opacity-100 text-muted-foreground hover:text-destructive transition-all">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <form onSubmit={handleAddCheckItem} className="flex gap-2 pt-1">
                    <Input value={newCheckItem} onChange={(e) => setNewCheckItem(e.target.value)}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
                        if (lines.length > 1) { e.preventDefault(); handleBulkAddCheckItems(lines); }
                      }}
                      placeholder="Add subtask... (paste multiple lines)" className="h-7 text-xs flex-1" />
                    <Button size="sm" type="submit" disabled={isPending || !newCheckItem.trim()} className="h-7 text-xs px-2">Add</Button>
                  </form>
                </div>
              )}
            </div>

            <Separator />

            {/* Attachments */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Attachments</p>
                <label className="ml-auto cursor-pointer">
                  <input type="file" className="hidden" onChange={handleUploadFile} disabled={uploading} />
                  <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <Upload className="h-3 w-3" />
                    {uploading ? "Uploading..." : "Upload"}
                  </span>
                </label>
              </div>
              {attachments.length > 0 ? (
                <div className="space-y-1.5">
                  {attachments.map((att) => (
                    <div key={att.id} className="group/att flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted/50 transition-colors">
                      {att.mime_type?.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <a href={att.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 truncate text-primary hover:underline">{att.filename}</a>
                      <span className="text-muted-foreground shrink-0">{formatFileSize(att.size_bytes)}</span>
                      <a href={att.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-muted-foreground hover:text-foreground" title="Download"><Download className="h-3 w-3" /></a>
                      {(isAdmin || currentAgentId === att.uploader_id) && (
                        <button onClick={() => handleDeleteAttachment(att.id)} className="shrink-0 opacity-0 group-hover/att:opacity-100 text-muted-foreground hover:text-destructive transition-all" title="Delete"><X className="h-3 w-3" /></button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">No attachments</p>
              )}
            </div>

            <Separator />

            {/* Activity/Comments */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Activity</p>
                <div className="ml-auto flex gap-1">
                  <button onClick={() => setActivityTab("all")}
                    className={cn("text-xs px-2 py-0.5 rounded", activityTab === "all" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>All</button>
                  <button onClick={() => setActivityTab("comments")}
                    className={cn("text-xs px-2 py-0.5 rounded", activityTab === "comments" ? "bg-primary/10 text-primary" : "text-muted-foreground")}>Comments</button>
                </div>
              </div>
              <form onSubmit={handleAddComment} className="flex gap-2 mb-4">
                <Input value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Write a comment..." className="h-8 text-sm flex-1" />
                <Button size="sm" type="submit" disabled={isPending || !newComment.trim()} className="h-8"><MessageSquare className="h-3.5 w-3.5" /></Button>
              </form>
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {activityTab === "comments" ? (
                  comments.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No comments yet</p>
                  ) : (
                    comments.map((cmt) => {
                      const isAuthor = currentAgentId === cmt.author_id;
                      const createdAt = new Date(cmt.created_at);
                      const isEdited = cmt.updated_at !== cmt.created_at;
                      const canEdit = isAuthor && (Date.now() - createdAt.getTime()) < 60 * 60 * 1000;
                      const canDelete = isAdmin || canEdit;
                      const isDeleted = cmt.deleted_at != null;
                      return (
                        <div key={cmt.id} className="group/cmt">
                          <div className="flex items-start gap-2">
                            <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white mt-0.5", hashColor(cmt.author_id))}>
                              {cmt.author_avatar ? <img src={cmt.author_avatar} alt={cmt.author_name} className="h-full w-full rounded-full object-cover" /> : getInitials(cmt.author_name)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium">{cmt.author_name}</span>
                                <span className="text-[10px] text-muted-foreground" title={cmt.created_at}>{formatDistanceToNow(createdAt, { addSuffix: true })}</span>
                                {isEdited && !isDeleted && <span className="text-[10px] text-muted-foreground italic">(edited)</span>}
                              </div>
                              {editingComment === cmt.id ? (
                                <div className="mt-1 flex gap-1.5">
                                  <Input value={editCommentText} onChange={(e) => setEditCommentText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleEditComment(cmt.id); if (e.key === "Escape") setEditingComment(null); }}
                                    className="h-7 text-xs flex-1" autoFocus />
                                  <Button size="sm" onClick={() => handleEditComment(cmt.id)} disabled={isPending} className="h-7 text-xs px-2">Save</Button>
                                  <Button size="sm" variant="ghost" onClick={() => setEditingComment(null)} className="h-7 text-xs px-2">Cancel</Button>
                                </div>
                              ) : (
                                <p className={cn("text-xs mt-0.5", isDeleted && "italic text-muted-foreground")}>{isDeleted ? "[deleted]" : cmt.body}</p>
                              )}
                              {!isDeleted && editingComment !== cmt.id && (
                                <div className="flex items-center gap-2 mt-1 opacity-0 group-hover/cmt:opacity-100 transition-opacity">
                                  <button onClick={() => { setReplyTo(replyTo === cmt.id ? null : cmt.id); setReplyText(""); }} className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-0.5"><Reply className="h-3 w-3" /> Reply</button>
                                  {canEdit && <button onClick={() => { setEditingComment(cmt.id); setEditCommentText(cmt.body); }} className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-0.5"><Pencil className="h-3 w-3" /> Edit</button>}
                                  {canDelete && <button onClick={() => handleDeleteComment(cmt.id)} className="text-[10px] text-muted-foreground hover:text-destructive flex items-center gap-0.5"><Trash2 className="h-3 w-3" /> Delete</button>}
                                </div>
                              )}
                              {replyTo === cmt.id && (
                                <div className="mt-2 flex gap-1.5 items-center">
                                  <CornerDownRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                  <Input value={replyText} onChange={(e) => setReplyText(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Enter" && replyText.trim()) handleReply(cmt.id); if (e.key === "Escape") setReplyTo(null); }}
                                    placeholder="Reply..." className="h-7 text-xs flex-1" autoFocus />
                                  <Button size="sm" onClick={() => handleReply(cmt.id)} disabled={isPending || !replyText.trim()} className="h-7 text-xs px-2">Reply</Button>
                                </div>
                              )}
                              {(cmt.reply_count ?? 0) > 0 && <p className="text-[10px] text-muted-foreground mt-1">{cmt.reply_count} {cmt.reply_count === 1 ? "reply" : "replies"}</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )
                ) : (
                  activity.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No activity yet</p>
                  ) : (
                    activity.map((entry) => (
                      <div key={entry.id} className="text-xs border-l-2 border-muted pl-3 py-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{entry.actor_name ?? entry.actor_label}</span>
                          <span className="text-muted-foreground">
                            {entry.action_type === "comment_added" ? "commented"
                              : entry.action_type === "task_created" ? "created this task"
                              : entry.action_type === "task_moved" ? `moved to ${entry.new_value}`
                              : `changed ${entry.field}`}
                          </span>
                        </div>
                        {entry.action_type === "comment_added" && entry.new_value && (
                          <div className="mt-1 text-foreground bg-muted/50 rounded px-2 py-1">{entry.new_value}</div>
                        )}
                        {entry.action_type === "field_changed" && entry.old_value && (
                          <div className="text-muted-foreground mt-0.5">{entry.old_value} &rarr; {entry.new_value}</div>
                        )}
                        <div className="text-muted-foreground/60 mt-0.5" title={entry.created_at}>{formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}</div>
                      </div>
                    ))
                  )
                )}
              </div>
            </div>
          </div>

          {/* ═══ COLUMN 2: Job Details ═══ */}
          <div className="xl:col-span-4 md:col-span-1 border-r overflow-y-auto p-5 space-y-5">
            <div className="flex items-center justify-between sticky top-0 bg-background pb-2 z-10">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Details</h2>
              <div className="flex items-center gap-1">
                {job && (
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground" onClick={unlinkJob}>
                    Unlink
                  </Button>
                )}
                <div className="relative">
                  <Button variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={() => setJobSearchOpen(!jobSearchOpen)}>
                    <Search className="h-3 w-3" />
                    {job ? "Change" : "Link Job"}
                  </Button>
                  {jobSearchOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => { setJobSearchOpen(false); setJobSearchQuery(""); }} />
                      <div className="absolute right-0 top-8 z-50 w-[320px] rounded-lg border bg-popover shadow-lg p-2">
                        <Input value={jobSearchQuery} onChange={(e) => setJobSearchQuery(e.target.value)}
                          placeholder="Search jobs by title..." className="h-8 text-xs mb-2" autoFocus />
                        <div className="max-h-[250px] overflow-y-auto space-y-0.5">
                          {jobSearching && <p className="text-xs text-muted-foreground text-center py-3"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Searching...</p>}
                          {!jobSearching && jobSearchResults.length === 0 && jobSearchQuery && (
                            <p className="text-xs text-muted-foreground text-center py-3">No jobs found</p>
                          )}
                          {jobSearchResults.map((j) => (
                            <button key={j.id} onClick={() => linkJob(j)}
                              className="flex flex-col w-full rounded-md px-2.5 py-2 text-left hover:bg-muted transition-colors gap-0.5">
                              <span className="text-xs font-medium line-clamp-1">{j.job_title}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {j.budget_type} &middot; {j.client_country ?? "Unknown"} &middot; {j.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ── Job Snapshot ── */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">📌 Job Snapshot</h4>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
                <FieldRow icon={<span className="text-sm">🔗</span>} label="Job Link">
                  <div className="flex items-center gap-1 flex-1">
                    <Input value={(cf._job_url as string) ?? job?.job_url ?? ""} onChange={(e) => updateCustomField("_job_url", e.target.value)}
                      placeholder="https://upwork.com/jobs/..." className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2" />
                    {((cf._job_url as string) || job?.job_url) && (
                      <button
                        className="shrink-0 text-muted-foreground hover:text-primary transition-colors p-1 rounded hover:bg-muted/50"
                        title="Copy job URL"
                        onClick={() => {
                          const url = (cf._job_url as string) || job?.job_url || "";
                          copyText(url).then((ok) => {
                            if (ok) toast.success("Job URL copied");
                            else toast.error("Copy failed");
                          });
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </FieldRow>
                <FieldRow icon={<span className="text-sm">💰</span>} label="Budget">
                  <Input value={(cf._budget as string) ?? ""} onChange={(e) => updateCustomField("_budget", e.target.value)}
                    placeholder="Not specified" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                </FieldRow>
                <FieldRow icon={<span className="text-sm">🛠</span>} label="Skills">
                  <Input value={Array.isArray(cf._skills) ? (cf._skills as string[]).join(", ") : (cf._skills as string) ?? ""} onChange={(e) => updateCustomField("_skills", e.target.value)}
                    placeholder="e.g. React, Node.js" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2" />
                </FieldRow>
                <FieldRow icon={<span className="text-sm">📅</span>} label="Posted">
                  <Input value={(cf._posted as string) ?? ""} onChange={(e) => updateCustomField("_posted", e.target.value)}
                    placeholder="e.g. Apr 1, 2026" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                </FieldRow>
              </div>
            </div>

            {/* ── Client Intel ── */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">👤 Client Intel</h4>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
                <FieldRow icon={<span className="text-sm">🌍</span>} label="Location">
                  <Input value={(cf._client_country as string) ?? ""} onChange={(e) => updateCustomField("_client_country", e.target.value)}
                    placeholder="e.g. Netherlands" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                </FieldRow>
                <FieldRow icon={<span className="text-sm">⭐</span>} label="Rating">
                  <Input value={(cf._client_rating as string) ?? ""} onChange={(e) => updateCustomField("_client_rating", e.target.value)}
                    placeholder="No rating yet" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                </FieldRow>
                <FieldRow icon={<span className="text-sm">💵</span>} label="Total Spent">
                  <Input value={(cf._client_spent as string) ?? ""} onChange={(e) => updateCustomField("_client_spent", e.target.value)}
                    placeholder="New client" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                </FieldRow>
                <FieldRow icon={<span className="text-sm">✅</span>} label="Past Hires">
                  <Input value={(cf._client_hires as string) ?? ""} onChange={(e) => updateCustomField("_client_hires", e.target.value)}
                    placeholder="No hires yet" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                </FieldRow>
              </div>
            </div>

            {/* ── Routing Info ── */}
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">🎯 Routing Info</h4>
              <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
                <FieldRow icon={<span className="text-sm">👤</span>} label="Agent">
                  <Input value={(cf._assigned_agent as string) ?? ""} onChange={(e) => updateCustomField("_assigned_agent", e.target.value)}
                    placeholder="Agent name" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                </FieldRow>
                <FieldRow icon={<span className="text-sm">📁</span>} label="Profile">
                  <Input value={(cf._profile_name as string) ?? ""} onChange={(e) => updateCustomField("_profile_name", e.target.value)}
                    placeholder="Profile name" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                </FieldRow>
                <FieldRow icon={<span className="text-sm">🏷</span>} label="Stack">
                  <Input value={(cf._stack as string) ?? ""} onChange={(e) => updateCustomField("_stack", e.target.value)}
                    placeholder="e.g. MERN" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                </FieldRow>
                <FieldRow icon={<span className="text-sm">🆔</span>} label="Job ID">
                  <Input value={(cf._job_id as string) ?? ""} onChange={(e) => updateCustomField("_job_id", e.target.value)}
                    placeholder="~0220..." className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2" />
                </FieldRow>
                <FieldRow icon={<span className="text-sm">🤖</span>} label="Generated">
                  <Input value={(cf._generated as string) ?? ""} onChange={(e) => updateCustomField("_generated", e.target.value)}
                    placeholder="e.g. Apr 1, 2026, 06:04 PM UTC" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2" />
                </FieldRow>
              </div>
            </div>
          </div>

          {/* ═══ COLUMN 3: Proposal ═══ */}
          <div className="xl:col-span-4 md:col-span-2 xl:border-r-0 overflow-y-auto p-5">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider sticky top-0 bg-background pb-2 z-10">Proposal</h2>
            <ProposalBox
              proposal={job?.proposal_text ?? (cf._proposal as string) ?? null}
              onChange={(text) => updateCustomField("_proposal", text)}
              readOnly={false}
            />
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      {deleteConfirmOpen && task && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirmOpen(false)}>
          <div className="bg-card rounded-lg border shadow-lg p-6 max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-2">Delete Task</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Delete &ldquo;{task.title.length > 50 ? task.title.slice(0, 50) + "..." : task.title}&rdquo;? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isPending}>{isPending ? "Deleting..." : "Delete"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Field Row ── */
function FieldRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 min-h-[36px]">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-xs text-muted-foreground w-[80px] shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}

/* ── Assignee Dropdown ── */
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
      <button onClick={() => setOpen(!open)} disabled={disabled}
        className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 hover:border-primary hover:text-primary transition-colors" title="Add assignee">
        <Plus className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(""); }} />
          <div className="absolute left-0 top-8 z-50 w-[220px] rounded-lg border bg-popover shadow-lg p-1.5">
            <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-7 text-xs mb-1.5" autoFocus />
            <div className="max-h-[180px] overflow-y-auto space-y-0.5">
              {filtered.map((m) => {
                const isAssigned = assignedIds.includes(m.agent_id);
                return (
                  <button key={m.agent_id} onClick={() => onToggle(m.agent_id)}
                    className={cn("flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs hover:bg-muted transition-colors", isAssigned && "bg-primary/5")}>
                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white shrink-0", hashColor(m.agent_id))}>
                      {m.avatar_url ? <img src={m.avatar_url} className="h-full w-full rounded-full object-cover" /> : getInitials(m.name)}
                    </span>
                    <span className="flex-1 text-left truncate">{m.name}</span>
                    {isAssigned && <CheckSquare className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="text-xs text-muted-foreground text-center py-2">No members found</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Reason Multi-Select (N/A status only) ──

const REASON_OPTIONS = [
  "Old job",
  "Duplicate",
  "Location loc",
  "Low Higher rate",
  "Language barrier",
  "Too many invites",
  "Video Proposal",
  "Client suspended",
  "Portfolio unavailable",
  "Client Low spending",
  "Bad rating client",
  "Job unavailable",
  "Already hired",
  "Out of stack",
] as const;

function ReasonMultiSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);

  function toggle(option: string) {
    const next = value.includes(option)
      ? value.filter((v) => v !== option)
      : [...value, option];
    onChange(next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 flex-wrap min-h-[28px] w-full text-left text-xs px-2 py-1 rounded border-0 bg-transparent hover:bg-muted/50 transition-colors",
          open && "bg-muted/50"
        )}
      >
        {value.length === 0 ? (
          <span className="text-muted-foreground">Select reasons...</span>
        ) : (
          value.map((v) => (
            <span key={v} className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
              {v}
              <X
                className="h-3 w-3 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={(e) => { e.stopPropagation(); toggle(v); }}
              />
            </span>
          ))
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-56 rounded-md border bg-popover p-1 shadow-md max-h-56 overflow-y-auto">
          {REASON_OPTIONS.map((option) => {
            const selected = value.includes(option);
            return (
              <button
                key={option}
                type="button"
                onClick={() => toggle(option)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent transition-colors",
                  selected && "bg-accent/50"
                )}
              >
                <div className={cn(
                  "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                  selected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
                )}>
                  {selected && <CheckSquare className="h-2.5 w-2.5" />}
                </div>
                {option}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
