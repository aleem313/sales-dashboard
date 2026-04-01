"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TaskCreateModal } from "./task-create-modal";
import type { BoardColumn, ProjectMember } from "@/lib/task-data";

interface NewTaskButtonProps {
  projectId: string;
  columns: BoardColumn[];
  members?: ProjectMember[];
}

export function NewTaskButton({ projectId, columns, members }: NewTaskButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New Task
      </Button>
      <TaskCreateModal
        open={open}
        projectId={projectId}
        columns={columns}
        members={members}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
