"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tag, Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateTagAction, deleteTagAction } from "@/lib/task-actions";
import type { TaskTag } from "@/lib/task-data";

interface LabelsPanelProps {
  tags: TaskTag[];
}

const PALETTE = [
  "#6b7280", "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6", "#06b6d4",
  "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef",
  "#ec4899",
];

export function LabelsPanel({ tags: initialTags }: LabelsPanelProps) {
  const router = useRouter();
  const [tags, setTags] = useState(initialTags);
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TaskTag | null>(null);

  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  function startEdit(tag: TaskTag) {
    setEditingId(tag.id);
    setEditName(tag.name);
    setEditColor(tag.color);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditColor("");
  }

  function handleSaveEdit(tagId: string) {
    const original = tags.find((t) => t.id === tagId);
    if (!original) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      toast.error("Name cannot be empty");
      return;
    }
    if (trimmed === original.name && editColor === original.color) {
      cancelEdit();
      return;
    }
    startTransition(async () => {
      try {
        await updateTagAction(tagId, { name: trimmed, color: editColor });
        setTags((prev) =>
          prev.map((t) => (t.id === tagId ? { ...t, name: trimmed, color: editColor } : t))
        );
        toast.success("Label updated");
        cancelEdit();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to update label");
      }
    });
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startTransition(async () => {
      try {
        await deleteTagAction(target.id);
        setTags((prev) => prev.filter((t) => t.id !== target.id));
        toast.success(`Deleted "${target.name}"`);
        setDeleteTarget(null);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to delete label");
      }
    });
  }

  return (
    <>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Manage Labels">
            <Tag className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent className="w-[380px] sm:w-[420px] flex flex-col">
          <SheetHeader>
            <SheetTitle>Manage Labels ({tags.length})</SheetTitle>
          </SheetHeader>

          <p className="text-xs text-muted-foreground mt-3 px-1">
            Rename or delete labels for this board. New labels are still created from the task drawer.
          </p>

          <div className="flex-1 overflow-y-auto mt-4 space-y-1">
            {tags.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No labels on this board yet.
              </p>
            )}

            {tags.map((tag) => {
              const isEditing = editingId === tag.id;
              return (
                <div
                  key={tag.id}
                  className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted/40"
                >
                  {isEditing ? (
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full shrink-0 border border-border"
                          style={{ backgroundColor: editColor }}
                        />
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8 text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveEdit(tag.id);
                            if (e.key === "Escape") cancelEdit();
                          }}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={() => handleSaveEdit(tag.id)}
                          disabled={isPending || !editName.trim()}
                        >
                          {isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={cancelEdit}
                          disabled={isPending}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-1 ml-5">
                        {PALETTE.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => setEditColor(c)}
                            className={`h-5 w-5 rounded-full border-2 transition ${
                              editColor.toLowerCase() === c.toLowerCase()
                                ? "border-foreground scale-110"
                                : "border-transparent hover:scale-105"
                            }`}
                            style={{ backgroundColor: c }}
                            aria-label={`Pick color ${c}`}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <span
                        className="h-3 w-3 rounded-full shrink-0 border border-border"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="flex-1 text-sm truncate" title={tag.name}>
                        {tag.name}
                      </span>
                      {typeof tag.card_count === "number" && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {tag.card_count} card{tag.card_count === 1 ? "" : "s"}
                        </span>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0"
                        onClick={() => startEdit(tag)}
                        disabled={isPending}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget(tag)}
                        disabled={isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete Label</DialogTitle>
            <DialogDescription>
              Delete <strong>&quot;{deleteTarget?.name}&quot;</strong>?
              {deleteTarget?.card_count ? (
                <>
                  {" "}
                  It will be removed from <strong>{deleteTarget.card_count}</strong> card
                  {deleteTarget.card_count === 1 ? "" : "s"}. The cards themselves stay.
                </>
              ) : (
                <> No cards currently use this label.</>
              )}{" "}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  Deleting...
                </>
              ) : (
                "Delete Label"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
