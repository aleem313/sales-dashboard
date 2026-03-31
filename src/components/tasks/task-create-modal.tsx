"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { createTaskAction } from "@/lib/task-actions";
import type { BoardColumn, ProjectMember } from "@/lib/task-data";

interface TaskCreateModalProps {
  projectId: string;
  columns: BoardColumn[];
  defaultColumnId?: string;
  members?: ProjectMember[];
  triggerOpen?: boolean;
  onClose?: () => void;
}

export function TaskCreateModal({
  projectId,
  columns,
  defaultColumnId,
  members,
  triggerOpen,
  onClose,
}: TaskCreateModalProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState("");
  const [columnId, setColumnId] = useState(defaultColumnId ?? columns[0]?.id ?? "");
  const [priority, setPriority] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  useEffect(() => {
    if (triggerOpen) {
      setColumnId(defaultColumnId ?? columns[0]?.id ?? "");
      setOpen(true);
    }
  }, [triggerOpen, defaultColumnId, columns]);

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen);
    if (!isOpen) {
      onClose?.();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    startTransition(async () => {
      try {
        await createTaskAction({
          project_id: projectId,
          column_id: columnId,
          title: title.trim(),
          description: description.trim() || null,
          priority: priority || null,
          due_date: dueDate || null,
          assignee_ids: assigneeIds.length > 0 ? assigneeIds : undefined,
        });
        toast.success("Task created");
        handleOpenChange(false);
        resetForm();
      } catch {
        toast.error("Failed to create task");
      }
    });
  }

  function resetForm() {
    setTitle("");
    setPriority("");
    setDueDate("");
    setDescription("");
    setAssigneeIds([]);
    setColumnId(defaultColumnId ?? columns[0]?.id ?? "");
  }

  function addAssignee(agentId: string) {
    if (!assigneeIds.includes(agentId)) {
      setAssigneeIds([...assigneeIds, agentId]);
    }
  }

  function removeAssignee(agentId: string) {
    setAssigneeIds(assigneeIds.filter((id) => id !== agentId));
  }

  const availableMembers = (members ?? []).filter((m) => !assigneeIds.includes(m.agent_id));
  const selectedMembers = (members ?? []).filter((m) => assigneeIds.includes(m.agent_id));

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-4 mt-2">
      <div className="space-y-2">
        <Label htmlFor="title">Title *</Label>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title..."
          autoFocus
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="column">Column</Label>
          <Select value={columnId} onValueChange={setColumnId}>
            <SelectTrigger id="column">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {columns.map((col) => (
                <SelectItem key={col.id} value={col.id}>
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                    {col.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger id="priority">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Assignees */}
      {members && members.length > 0 && (
        <div className="space-y-2">
          <Label>Assignees</Label>
          {selectedMembers.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selectedMembers.map((m) => (
                <span
                  key={m.agent_id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                >
                  {m.name}
                  <button
                    type="button"
                    onClick={() => removeAssignee(m.agent_id)}
                    className="hover:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {availableMembers.length > 0 && (
            <Select value="" onValueChange={addAssignee}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder="Add assignee..." />
              </SelectTrigger>
              <SelectContent>
                {availableMembers.map((m) => (
                  <SelectItem key={m.agent_id} value={m.agent_id}>
                    {m.name} {m.email ? `(${m.email})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="due_date">Due Date</Label>
        <Input
          id="due_date"
          type="datetime-local"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating..." : "Create Task"}
        </Button>
      </div>
    </form>
  );

  if (triggerOpen !== undefined) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
          </DialogHeader>
          {formContent}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Create Task</DialogTitle>
        </DialogHeader>
        {formContent}
      </DialogContent>
    </Dialog>
  );
}
