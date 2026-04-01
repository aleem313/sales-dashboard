"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Settings,
  Trash2,
  Pencil,
  MoreHorizontal,
  Users,
  KanbanSquare,
} from "lucide-react";
import { toast } from "sonner";
import { updateBoardAction, deleteBoardAction } from "@/lib/task-actions";
import type { Project, ProjectMember, TaskAssignee, ProjectWithMeta, CustomFieldDefinition } from "@/lib/task-data";
import { BoardSelectorWrapper } from "./board-selector-wrapper";
import { BoardMembersPanel } from "./board-members-panel";
import { TaskCreateModal } from "./task-create-modal";
import { CustomFieldsPanel } from "./custom-fields-panel";
import { GroupSelector } from "./group-selector";
import { ViewsDropdown } from "./views-dropdown";
import type { BoardColumn } from "@/lib/task-data";

interface BoardHeaderProps {
  project: Project;
  projects: ProjectWithMeta[];
  columns: BoardColumn[];
  members: ProjectMember[];
  availableAgents: TaskAssignee[];
  isAdmin: boolean;
  customFields?: CustomFieldDefinition[];
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

const avatarColors = [
  "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500",
  "bg-indigo-500", "bg-teal-500", "bg-amber-500", "bg-cyan-500",
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function BoardHeader({
  project,
  projects,
  columns,
  members,
  availableAgents,
  isAdmin,
  customFields,
}: BoardHeaderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newName, setNewName] = useState(project.name);
  const [confirmName, setConfirmName] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  // Count tasks for delete warning
  const totalTasks = columns.reduce((sum, c) => sum + (c.task_count ?? 0), 0);

  function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    startTransition(async () => {
      try {
        await updateBoardAction(project.id, { name: newName.trim() });
        toast.success("Board renamed");
        setRenameOpen(false);
        setMenuOpen(false);
      } catch {
        toast.error("Failed to rename board");
      }
    });
  }

  function handleDelete() {
    if (totalTasks > 0 && confirmName !== project.name) {
      toast.error("Type the board name to confirm deletion");
      return;
    }
    startTransition(async () => {
      try {
        await deleteBoardAction(project.id);
        toast.success(`Board "${project.name}" deleted`);
        setDeleteOpen(false);
        setMenuOpen(false);
        router.push("/tasks");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete board");
      }
    });
  }

  return (
    <div className="flex items-center justify-between border-b px-4 py-2 gap-3 bg-card/50">
      {/* Left: Board selector + info */}
      <div className="flex items-center gap-3 min-w-0">
        <KanbanSquare className="h-4 w-4 text-muted-foreground shrink-0" />
        <BoardSelectorWrapper
          projects={projects}
          currentProjectId={project.id}
          isAdmin={isAdmin}
        />

        {/* Member avatars */}
        <div className="hidden sm:flex items-center">
          <div className="flex -space-x-1.5">
            {members.slice(0, 5).map((m) => (
              <div
                key={m.agent_id}
                title={`${m.name} (${m.role})`}
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-card ${hashColor(m.agent_id)}`}
              >
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt={m.name} className="h-full w-full rounded-full object-cover" />
                ) : (
                  getInitials(m.name)
                )}
              </div>
            ))}
            {members.length > 5 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[9px] font-medium ring-2 ring-card">
                +{members.length - 5}
              </div>
            )}
          </div>
        </div>

        {/* Members panel trigger */}
        <BoardMembersPanel
          projectId={project.id}
          members={members}
          availableAgents={availableAgents}
          isAdmin={isAdmin}
        />
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <GroupSelector />
        <ViewsDropdown projectId={project.id} isAdmin={isAdmin} />
        {isAdmin && customFields && (
          <CustomFieldsPanel
            projectId={project.id}
            fields={customFields}
            onFieldsChange={() => router.refresh()}
          />
        )}
        <TaskCreateModal projectId={project.id} columns={columns} members={members} />

        {isAdmin && (
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
                onClick={() => {
                  setNewName(project.name);
                  setRenameOpen(true);
                  setMenuOpen(false);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                Rename Board
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                onClick={() => {
                  setConfirmName("");
                  setDeleteOpen(true);
                  setMenuOpen(false);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Board
              </button>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Rename Dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename Board</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRename} className="space-y-4 mt-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending || !newName.trim()}>
                {isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Board</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{project.name}</strong>
              {totalTasks > 0 && (
                <> and all <strong>{totalTasks} task{totalTasks !== 1 ? "s" : ""}</strong>, comments, and attachments</>
              )}. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {totalTasks > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Type <strong>{project.name}</strong> to confirm:
                </p>
                <Input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={project.name}
                  autoFocus
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isPending || (totalTasks > 0 && confirmName !== project.name)}
              >
                {isPending ? "Deleting..." : "Delete Board"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
