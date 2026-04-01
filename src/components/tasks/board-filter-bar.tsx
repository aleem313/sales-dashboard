"use client";

import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import { useBoardStore } from "@/lib/stores/board-store";
import { MoreFilters } from "./custom-field-filter";
import type { BoardColumn, ProjectMember, TaskTag, CustomFieldDefinition } from "@/lib/task-data";

interface BoardFilterBarProps {
  columns: BoardColumn[];
  members: ProjectMember[];
  tags?: TaskTag[];
  customFields?: CustomFieldDefinition[];
}

export function BoardFilterBar({ columns, members, tags, customFields }: BoardFilterBarProps) {
  const store = useBoardStore();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Sync URL params to store on mount
  useEffect(() => {
    const assignee = searchParams.get("assignee") ?? undefined;
    const priority = searchParams.get("priority") ?? undefined;
    const column = searchParams.get("column") ?? undefined;
    const search = searchParams.get("search") ?? undefined;
    const tag = searchParams.get("tag") ?? undefined;
    if (assignee || priority || column || search || tag) {
      store.setFilters({ assignee, priority, column, search, tag });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateFilter(key: string, value: string | undefined) {
    const newFilters = { ...store.filters, [key]: value || undefined };
    // Remove undefined keys
    Object.keys(newFilters).forEach((k) => {
      if (!newFilters[k as keyof typeof newFilters]) delete newFilters[k as keyof typeof newFilters];
    });
    store.setFilters(newFilters);

    // Update URL
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  const hasFilters = Object.values(store.filters).some(Boolean);

  return (
    <div className="flex items-center gap-2 px-6 py-2 border-b bg-muted/30">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={store.filters.search ?? ""}
          onChange={(e) => updateFilter("search", e.target.value)}
          placeholder="Search tasks..."
          className="h-8 w-[180px] pl-8 text-xs"
        />
      </div>

      {/* Column filter */}
      <Select value={store.filters.column ?? "all"} onValueChange={(v) => updateFilter("column", v === "all" ? undefined : v)}>
        <SelectTrigger className="h-8 w-[130px] text-xs">
          <SelectValue placeholder="All columns" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All columns</SelectItem>
          {columns.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Priority filter */}
      <Select value={store.filters.priority ?? "all"} onValueChange={(v) => updateFilter("priority", v === "all" ? undefined : v)}>
        <SelectTrigger className="h-8 w-[110px] text-xs">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All priorities</SelectItem>
          <SelectItem value="urgent">Urgent</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="low">Low</SelectItem>
        </SelectContent>
      </Select>

      {/* Assignee filter */}
      <Select value={store.filters.assignee ?? "all"} onValueChange={(v) => updateFilter("assignee", v === "all" ? undefined : v)}>
        <SelectTrigger className="h-8 w-[130px] text-xs">
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All assignees</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.agent_id} value={m.agent_id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Label filter */}
      {tags && tags.length > 0 && (
        <Select value={store.filters.tag ?? "all"} onValueChange={(v) => updateFilter("tag", v === "all" ? undefined : v)}>
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue placeholder="Label" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All labels</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Clear filters */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1 text-muted-foreground"
          onClick={() => {
            store.clearFilters();
            store.clearCustomFieldFilters();
            const params = new URLSearchParams(searchParams.toString());
            ["search", "column", "priority", "assignee", "tag"].forEach((k) => params.delete(k));
            router.push(`?${params.toString()}`, { scroll: false });
          }}
        >
          <X className="h-3 w-3" />
          Clear
        </Button>
      )}

      <MoreFilters customFields={customFields ?? []} />
    </div>
  );
}
