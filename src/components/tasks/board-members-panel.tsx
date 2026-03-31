"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Users, UserPlus, X, Shield, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  addBoardMembersAction,
  updateMemberRoleAction,
  removeBoardMemberAction,
} from "@/lib/task-actions";
import type { ProjectMember, TaskAssignee } from "@/lib/task-data";

interface BoardMembersPanelProps {
  projectId: string;
  members: ProjectMember[];
  availableAgents: TaskAssignee[];
  isAdmin: boolean;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export function BoardMembersPanel({
  projectId,
  members: initialMembers,
  availableAgents: initialAvailable,
  isAdmin,
}: BoardMembersPanelProps) {
  const [members, setMembers] = useState(initialMembers);
  const [available, setAvailable] = useState(initialAvailable);
  const [isPending, startTransition] = useTransition();
  const [selectedAgent, setSelectedAgent] = useState<string>("");
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null);

  useEffect(() => {
    setMembers(initialMembers);
    setAvailable(initialAvailable);
  }, [initialMembers, initialAvailable]);

  function handleAddMember() {
    if (!selectedAgent) return;
    startTransition(async () => {
      try {
        await addBoardMembersAction(projectId, [selectedAgent]);
        toast.success("Member added");
        setSelectedAgent("");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to add member");
      }
    });
  }

  function handleRoleChange(agentId: string, role: "admin" | "member") {
    startTransition(async () => {
      try {
        await updateMemberRoleAction(projectId, agentId, role);
        toast.success("Role updated");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to update role");
      }
    });
  }

  function handleConfirmRemove() {
    if (!removeTarget) return;
    startTransition(async () => {
      try {
        await removeBoardMemberAction(projectId, removeTarget.agent_id, true);
        toast.success(`${removeTarget.name} removed from board`);
        setRemoveTarget(null);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to remove member");
      }
    });
  }

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <Users className="h-4 w-4" />
            <span className="text-xs">{members.length}</span>
          </Button>
        </SheetTrigger>
        <SheetContent className="w-[360px] sm:w-[400px]">
          <SheetHeader>
            <SheetTitle>Board Members ({members.length})</SheetTitle>
          </SheetHeader>

          {/* Add member */}
          {isAdmin && available.length > 0 && (
            <div className="flex gap-2 mt-4 mb-4">
              <Select value={selectedAgent} onValueChange={setSelectedAgent}>
                <SelectTrigger className="flex-1 h-9 text-sm">
                  <SelectValue placeholder="Add agent to board..." />
                </SelectTrigger>
                <SelectContent>
                  {available.map((a) => (
                    <SelectItem key={a.agent_id} value={a.agent_id}>
                      <span className="flex items-center gap-2">
                        {a.name}
                        {a.email && <span className="text-muted-foreground text-xs">({a.email})</span>}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-9 px-3" onClick={handleAddMember} disabled={!selectedAgent || isPending}>
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
              </Button>
            </div>
          )}
          {isAdmin && available.length === 0 && (
            <p className="text-xs text-muted-foreground mt-4 mb-3">All agents are already members of this board.</p>
          )}

          {/* Warning: no admin members */}
          {members.filter((m) => m.role === "admin").length === 0 && (
            <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2 mt-3 mb-2">
              <Shield className="h-4 w-4 text-amber-600 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This board has no admin members. The system admin can still manage it, but consider promoting a member to admin.
              </p>
            </div>
          )}

          {/* Member list */}
          <div className="space-y-1 mt-2">
            {members.map((m) => (
              <div
                key={m.agent_id}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary shrink-0">
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.name} className="h-full w-full rounded-full object-cover" />
                  ) : (
                    getInitials(m.name)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {m.name}
                    {!m.active && <span className="text-muted-foreground text-xs ml-1">(inactive)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                </div>
                {isAdmin ? (
                  <Select
                    value={m.role}
                    onValueChange={(role) => handleRoleChange(m.agent_id, role as "admin" | "member")}
                    disabled={isPending}
                  >
                    <SelectTrigger className="w-[95px] h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">
                        <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> Admin</span>
                      </SelectItem>
                      <SelectItem value="member">
                        <span className="flex items-center gap-1"><User className="h-3 w-3" /> Member</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {m.role === "admin" ? "Admin" : "Member"}
                  </Badge>
                )}
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setRemoveTarget(m)}
                    disabled={isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Remove member confirmation dialog */}
      <Dialog open={!!removeTarget} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Remove Member</DialogTitle>
            <DialogDescription>
              Remove <strong>{removeTarget?.name}</strong> from this board? They will be unassigned from all tasks on this board.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmRemove} disabled={isPending}>
              {isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Removing...</>
              ) : (
                "Remove Member"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
