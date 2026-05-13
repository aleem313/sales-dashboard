"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronDown, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { DateRangePicker } from "@/components/date-range-picker";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

interface AuditFiltersProps {
  profiles: Profile[];
  selectedProfileIds: string[];
  hideOverridden: boolean;
}

export function AuditFilters({
  profiles,
  selectedProfileIds,
  hideOverridden,
}: AuditFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string[]>(selectedProfileIds);

  // Reset the pending selection from props whenever the popover opens, so
  // we always start with whatever the URL currently has (handles back/forward
  // nav and external URL changes without an effect).
  function handleOpenChange(next: boolean) {
    if (next) setPendingSelection(selectedProfileIds);
    setOpen(next);
  }

  function pushParams(mutate: (p: URLSearchParams) => void) {
    const p = new URLSearchParams(searchParams.toString());
    mutate(p);
    const qs = p.toString();
    router.push(qs ? `/relevancy-audit?${qs}` : "/relevancy-audit");
  }

  function toggleProfile(id: string) {
    setPendingSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function applyProfileFilter() {
    pushParams((p) => {
      if (pendingSelection.length === 0) p.delete("profile_ids");
      else p.set("profile_ids", pendingSelection.join(","));
    });
    setOpen(false);
  }

  function clearProfileFilter() {
    setPendingSelection([]);
    pushParams((p) => p.delete("profile_ids"));
    setOpen(false);
  }

  function toggleHideOverridden(checked: boolean) {
    pushParams((p) => {
      // hide_overridden defaults to true server-side; only persist when user
      // explicitly sets it to false (keeps URLs clean).
      if (checked) p.delete("hide_overridden");
      else p.set("hide_overridden", "false");
    });
  }

  const profileButtonLabel =
    selectedProfileIds.length === 0
      ? "All profiles"
      : selectedProfileIds.length === 1
      ? profiles.find((p) => p.profile_id === selectedProfileIds[0])?.profile_name ??
        selectedProfileIds[0]
      : `${selectedProfileIds.length} profiles`;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
      <DateRangePicker />

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "inline-flex items-center gap-2 rounded-[7px] border border-border bg-transparent px-3 py-1.5 text-[13.5px] font-semibold text-muted-foreground transition-all hover:border-[var(--primary)] hover:text-foreground focus:border-[var(--primary)] focus:text-foreground focus:outline-none cursor-pointer min-w-[160px]",
              open && "border-[var(--primary)] text-foreground",
              selectedProfileIds.length > 0 && "text-foreground"
            )}
          >
            <Filter className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{profileButtonLabel}</span>
            <ChevronDown className="ml-auto h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-0" align="start" sideOffset={8}>
          <div className="border-b border-border px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Filter by profile
            </p>
          </div>
          <div className="max-h-[280px] overflow-y-auto p-1">
            {profiles.length === 0 ? (
              <div className="px-3 py-4 text-center text-[13px] text-muted-foreground">
                No profiles available
              </div>
            ) : (
              profiles.map((p) => {
                const isChecked = pendingSelection.includes(p.profile_id);
                return (
                  <button
                    key={p.profile_id}
                    onClick={() => toggleProfile(p.profile_id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded border border-border",
                        isChecked && "border-primary bg-primary text-primary-foreground"
                      )}
                    >
                      {isChecked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate">{p.profile_name}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearProfileFilter}
              disabled={selectedProfileIds.length === 0 && pendingSelection.length === 0}
            >
              Clear
            </Button>
            <Button size="sm" onClick={applyProfileFilter}>
              Apply
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex items-center gap-2">
        <label
          htmlFor="hide-overridden"
          className="text-[13px] font-medium text-muted-foreground"
        >
          Hide overridden
        </label>
        <Switch
          id="hide-overridden"
          checked={hideOverridden}
          onCheckedChange={toggleHideOverridden}
        />
      </div>
    </div>
  );
}
