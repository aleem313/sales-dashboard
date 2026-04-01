"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bookmark, Trash2, Plus, Loader2, Circle } from "lucide-react";
import { toast } from "sonner";
import { useBoardStore } from "@/lib/stores/board-store";
import { createSavedViewAction, deleteSavedViewAction } from "@/lib/task-actions";
import type { SavedView } from "@/lib/task-data";

interface ViewsDropdownProps {
  projectId: string;
  isAdmin: boolean;
}

export function ViewsDropdown({ projectId, isAdmin }: ViewsDropdownProps) {
  const store = useBoardStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const views = store.savedViews;
  const isModified = store.getIsViewModified();

  function loadView(view: SavedView) {
    const viewFilters = view.filters as Record<string, unknown>;
    const viewSort = view.sort as Record<string, unknown>;

    store.setFilters({
      column: viewFilters.column as string | undefined,
      priority: viewFilters.priority as string | undefined,
      assignee: viewFilters.assignee as string | undefined,
      search: viewFilters.search as string | undefined,
      tag: viewFilters.tag as string | undefined,
    });

    const cfFilters = (viewFilters.customFields ?? []) as { fieldId: string; operator: string; value: unknown }[];
    store.setCustomFieldFilters(cfFilters);

    const groupBy = (viewSort.groupBy as string) ?? "status";
    store.setGroupBy(groupBy as "status" | "assignee" | "priority" | "label");

    store.setActiveViewId(view.id);

    const params = new URLSearchParams();
    const boardParam = searchParams.get("board");
    if (boardParam) params.set("board", boardParam);
    if (viewFilters.column) params.set("column", viewFilters.column as string);
    if (viewFilters.priority) params.set("priority", viewFilters.priority as string);
    if (viewFilters.assignee) params.set("assignee", viewFilters.assignee as string);
    if (viewFilters.search) params.set("search", viewFilters.search as string);
    if (viewFilters.tag) params.set("tag", viewFilters.tag as string);
    if (groupBy !== "status") params.set("group", groupBy);
    router.push(`?${params.toString()}`, { scroll: false });

    setOpen(false);
  }

  function handleSave() {
    if (!saveName.trim()) return;
    startTransition(async () => {
      try {
        const view = await createSavedViewAction({
          project_id: projectId,
          name: saveName.trim(),
          filters: {
            ...store.filters,
            customFields: store.customFieldFilters,
          },
          sort: {
            groupBy: store.groupBy,
          },
        });
        store.setSavedViews([...views, view]);
        store.setActiveViewId(view.id);
        toast.success("View saved");
        setSaveOpen(false);
        setSaveName("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save view");
      }
    });
  }

  function handleDelete(viewId: string) {
    startTransition(async () => {
      try {
        await deleteSavedViewAction(viewId);
        store.setSavedViews(views.filter((v) => v.id !== viewId));
        if (store.activeViewId === viewId) store.setActiveViewId(null);
        toast.success("View deleted");
        setDeleteConfirm(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to delete view");
      }
    });
  }

  const activeView = views.find((v) => v.id === store.activeViewId);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5">
            <Bookmark className="h-3.5 w-3.5" />
            {activeView ? (
              <span className="flex items-center gap-1">
                {activeView.name}
                {isModified && <Circle className="h-1.5 w-1.5 fill-orange-500 text-orange-500" />}
              </span>
            ) : (
              "Views"
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          {views.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">No saved views</p>
          )}
          {views.map((view) => (
            <div key={view.id} className="flex items-center group">
              <button
                onClick={() => loadView(view)}
                className="flex-1 text-left rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors truncate"
              >
                {view.name}
                {store.activeViewId === view.id && (
                  <span className="ml-1 text-[10px] text-muted-foreground">(active)</span>
                )}
              </button>
              {isAdmin && (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(view.id); }}
                  className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-destructive transition-all"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          {isAdmin && (
            <>
              <div className="my-1 border-t" />
              <button
                onClick={() => { setOpen(false); setSaveOpen(true); setSaveName(""); }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Save Current View
              </button>
            </>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Save View</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <Input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="View name..."
              maxLength={50}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={isPending || !saveName.trim()}>
                {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>Delete View</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">This saved view will be permanently deleted.</p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} disabled={isPending}>
              {isPending ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
