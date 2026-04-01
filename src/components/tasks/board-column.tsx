"use client";

import { useState, useRef, useEffect } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, MoreHorizontal, Pencil, Palette, Gauge, CheckCircle2, Trash2 } from "lucide-react";
import { SortableTaskCard } from "./task-card";
import { toast } from "sonner";
import type { BoardColumn as ColumnType, Task } from "@/lib/task-data";

const PRESET_COLORS = [
  "#6b7280", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#0ea5e9",
];

interface BoardColumnProps {
  column: ColumnType;
  tasks: Task[];
  allColumns?: ColumnType[];
  isAdmin?: boolean;
  onTaskClick?: (taskId: string) => void;
  onAddTask?: (columnId: string) => void;
  onMoveTask?: (taskId: string, columnId: string) => void;
  onDeleteTask?: (taskId: string) => void;
  onUpdateColumn?: (columnId: string, fields: { name?: string; color?: string; is_done?: boolean; wip_limit?: number | null }) => void;
  onDeleteColumn?: (columnId: string, moveTasksTo?: string) => void;
}

export function BoardColumnComponent({
  column, tasks, allColumns, isAdmin,
  onTaskClick, onAddTask, onMoveTask, onDeleteTask,
  onUpdateColumn, onDeleteColumn,
}: BoardColumnProps) {
  const isOverWip = column.wip_limit != null && tasks.length > column.wip_limit;
  const isAtWip = column.wip_limit != null && tasks.length === column.wip_limit;

  const { setNodeRef, isOver } = useDroppable({
    id: `column-${column.id}`,
    data: { type: "column", columnId: column.id },
  });

  const taskIds = tasks.map((t) => t.id);

  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameName, setRenameName] = useState(column.name);
  const renameRef = useRef<HTMLInputElement>(null);

  // Color picker state
  const [colorOpen, setColorOpen] = useState(false);

  // WIP limit state
  const [wipOpen, setWipOpen] = useState(false);
  const [wipValue, setWipValue] = useState(column.wip_limit?.toString() ?? "");

  // Delete state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string>("");

  useEffect(() => {
    if (isRenaming) renameRef.current?.focus();
  }, [isRenaming]);

  function handleRenameSubmit() {
    const trimmed = renameName.trim();
    if (trimmed && trimmed !== column.name) {
      onUpdateColumn?.(column.id, { name: trimmed });
    }
    setIsRenaming(false);
  }

  function handleColorChange(color: string) {
    onUpdateColumn?.(column.id, { color });
    setColorOpen(false);
  }

  function handleWipSubmit() {
    const num = wipValue === "" || wipValue === "0" ? null : parseInt(wipValue);
    if (num !== null && isNaN(num)) return;
    onUpdateColumn?.(column.id, { wip_limit: num });
    setWipOpen(false);
  }

  function handleToggleDone() {
    onUpdateColumn?.(column.id, { is_done: !column.is_done });
  }

  function handleDelete() {
    if (tasks.length > 0 && !moveTarget) {
      toast.error("Select a column to move tasks to");
      return;
    }
    onDeleteColumn?.(column.id, tasks.length > 0 ? moveTarget : undefined);
    setDeleteOpen(false);
  }

  const otherColumns = (allColumns ?? []).filter((c) => c.id !== column.id);

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col">
      {/* Column header */}
      <div className="group/header flex items-center gap-2 px-1 pb-3">
        <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: column.color }} />

        {isRenaming ? (
          <input
            ref={renameRef}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameSubmit();
              if (e.key === "Escape") { setRenameName(column.name); setIsRenaming(false); }
            }}
            className="h-6 flex-1 min-w-0 rounded border px-1.5 text-sm font-semibold bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            maxLength={50}
          />
        ) : (
          <h3
            className={cn("text-sm font-semibold truncate", isAdmin && "cursor-pointer")}
            onDoubleClick={() => { if (isAdmin) { setRenameName(column.name); setIsRenaming(true); } }}
            title={isAdmin ? "Double-click to rename" : column.name}
          >
            {column.name}
            {column.is_done && <CheckCircle2 className="inline ml-1 h-3 w-3 text-green-500" />}
          </h3>
        )}

        <span
          className={cn(
            "shrink-0 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium",
            isOverWip ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400"
              : isAtWip ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          {tasks.length}{column.wip_limit != null && `/${column.wip_limit}`}
        </span>

        {/* Admin column menu */}
        {isAdmin && onUpdateColumn && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/header:opacity-100 hover:bg-muted hover:text-foreground transition-all">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => { setRenameName(column.name); setIsRenaming(true); }}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setColorOpen(true)}>
                <Palette className="h-3.5 w-3.5 mr-2" />
                Change Color
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setWipValue(column.wip_limit?.toString() ?? ""); setWipOpen(true); }}>
                <Gauge className="h-3.5 w-3.5 mr-2" />
                Set WIP Limit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleToggleDone}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                {column.is_done ? "Unmark as Done" : "Mark as Done"}
              </DropdownMenuItem>
              {onDeleteColumn && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => { setMoveTarget(""); setDeleteOpen(true); }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" />
                    Delete Column
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {onAddTask && (
          <button onClick={() => onAddTask(column.id)} className="ml-auto shrink-0 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors" title={`Add task to ${column.name}`}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Droppable card area */}
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 space-y-2 overflow-y-auto pr-1 pb-4 rounded-lg transition-colors min-h-[80px]",
          isOver && "bg-primary/5 ring-2 ring-primary/20 ring-inset"
        )}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.length === 0 ? (
            <button
              onClick={() => onAddTask?.(column.id)}
              className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-muted-foreground/25 py-8 text-center hover:border-primary/40 hover:bg-muted/30 transition-colors cursor-pointer"
            >
              <Plus className="h-5 w-5 text-muted-foreground/50 mb-1" />
              <p className="text-xs text-muted-foreground">Add a task</p>
            </button>
          ) : (
            tasks.map((task) => (
              <SortableTaskCard
                key={task.id}
                task={task}
                columnColor={column.color}
                onClick={() => onTaskClick?.(task.id)}
                columns={allColumns}
                isAdmin={isAdmin}
                onMoveTask={onMoveTask}
                onDeleteTask={onDeleteTask}
              />
            ))
          )}
        </SortableContext>
      </div>

      {/* Color picker dialog */}
      <Dialog open={colorOpen} onOpenChange={setColorOpen}>
        <DialogContent className="sm:max-w-[320px]">
          <DialogHeader>
            <DialogTitle>Column Color</DialogTitle>
            <DialogDescription>Choose a color for this column.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-6 gap-2 mt-2">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => handleColorChange(color)}
                className={cn(
                  "h-8 w-8 rounded-full border-2 transition-transform hover:scale-110",
                  column.color === color ? "border-foreground ring-2 ring-primary" : "border-transparent"
                )}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* WIP limit dialog */}
      <Dialog open={wipOpen} onOpenChange={setWipOpen}>
        <DialogContent className="sm:max-w-[320px]">
          <DialogHeader>
            <DialogTitle>WIP Limit</DialogTitle>
            <DialogDescription>Set to 0 or empty to remove the limit.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleWipSubmit(); }} className="space-y-4 mt-2">
            <Input
              type="number"
              min={0}
              max={999}
              value={wipValue}
              onChange={(e) => setWipValue(e.target.value)}
              placeholder="No limit"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setWipOpen(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete column dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Column</DialogTitle>
            <DialogDescription>
              Delete &ldquo;{column.name}&rdquo;
              {tasks.length > 0 && <> and move its <strong>{tasks.length}</strong> task{tasks.length !== 1 ? "s" : ""} to another column</>}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {tasks.length > 0 && (
              <Select value={moveTarget} onValueChange={setMoveTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Move tasks to..." />
                </SelectTrigger>
                <SelectContent>
                  {otherColumns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={tasks.length > 0 && !moveTarget}
              >
                Delete Column
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
