"use client";

import { useState } from "react";
import { BoardSelector } from "./board-selector";
import { BoardCreateDialog } from "./board-create-dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { ProjectWithMeta } from "@/lib/task-data";

interface BoardSelectorWrapperProps {
  projects: ProjectWithMeta[];
  currentProjectId: string;
  isAdmin: boolean;
  showCreateOnly?: boolean;
}

export function BoardSelectorWrapper({
  projects,
  currentProjectId,
  isAdmin,
  showCreateOnly,
}: BoardSelectorWrapperProps) {
  const [createOpen, setCreateOpen] = useState(false);

  if (showCreateOnly) {
    return (
      <>
        <Button size="sm" className="mt-4 gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create Board
        </Button>
        <BoardCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
      </>
    );
  }

  return (
    <>
      <BoardSelector
        projects={projects}
        currentProjectId={currentProjectId}
        isAdmin={isAdmin}
        onCreateBoard={() => setCreateOpen(true)}
      />
      <BoardCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
