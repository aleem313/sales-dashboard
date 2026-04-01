"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TaskCreateFull } from "./task-create-full";
import type { BoardColumn, ProjectMember } from "@/lib/task-data";

interface TaskCreateModalProps {
  open: boolean;
  projectId: string;
  columns: BoardColumn[];
  members?: ProjectMember[];
  defaultColumnId?: string;
  onClose: () => void;
}

export function TaskCreateModal({ open, projectId, columns, members, defaultColumnId, onClose }: TaskCreateModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[95vw] w-[95vw] h-[90vh] max-h-[90vh] p-0 overflow-hidden sm:max-w-[95vw]"
      >
        <DialogTitle className="sr-only">New Task</DialogTitle>
        <TaskCreateFull
          projectId={projectId}
          columns={columns}
          members={members}
          defaultColumnId={defaultColumnId}
          backUrl=""
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
