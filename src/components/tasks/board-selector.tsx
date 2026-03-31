"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { ProjectWithMeta } from "@/lib/task-data";

interface BoardSelectorProps {
  projects: ProjectWithMeta[];
  currentProjectId: string;
  isAdmin: boolean;
  onCreateBoard?: () => void;
  /** Base path for board switching — defaults to /tasks, use /my-tasks for agents */
  basePath?: string;
}

export function BoardSelector({
  projects,
  currentProjectId,
  isAdmin,
  onCreateBoard,
  basePath = "/tasks",
}: BoardSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleBoardChange(projectId: string) {
    if (projectId === "__create__") {
      onCreateBoard?.();
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    params.set("board", projectId);
    router.push(`${basePath}?${params.toString()}`);
    try { localStorage.setItem("last_board_id", projectId); } catch {}
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={currentProjectId} onValueChange={handleBoardChange}>
        <SelectTrigger className="w-[200px] h-8 text-sm">
          <SelectValue placeholder="Select board" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <span className="flex items-center gap-2">
                {p.name}
                <span className="text-xs text-muted-foreground">
                  ({p.task_count ?? 0})
                </span>
              </span>
            </SelectItem>
          ))}
          {isAdmin && (
            <SelectItem value="__create__" className="text-primary font-medium">
              <span className="flex items-center gap-1">
                <Plus className="h-3 w-3" />
                New Board
              </span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
