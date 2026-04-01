"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TaskFullView } from "./task-full-view";
import type { BoardColumn } from "@/lib/task-data";

interface TaskDetailModalProps {
  taskId: string | null;
  columns: BoardColumn[];
  isAdmin: boolean;
  agentId?: string | null;
  onClose: () => void;
}

export function TaskDetailModal({ taskId, columns, isAdmin, agentId, onClose }: TaskDetailModalProps) {
  return (
    <Dialog open={!!taskId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[95vw] w-[95vw] h-[90vh] max-h-[90vh] p-0 overflow-hidden sm:max-w-[95vw]"
      >
        <DialogTitle className="sr-only">Task Detail</DialogTitle>
        {taskId && (
          <TaskFullView
            taskId={taskId}
            columns={columns}
            isAdmin={isAdmin}
            agentId={agentId}
            backUrl=""
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
