"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Layers } from "lucide-react";
import { useBoardStore } from "@/lib/stores/board-store";

export function GroupSelector() {
  const store = useBoardStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const groupBy = value as "status" | "assignee" | "priority" | "label";
    store.setGroupBy(groupBy);

    const params = new URLSearchParams(searchParams.toString());
    if (groupBy === "status") params.delete("group");
    else params.set("group", groupBy);
    router.push(`?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex items-center gap-1.5">
      <Layers className="h-3.5 w-3.5 text-muted-foreground" />
      <Select value={store.groupBy} onValueChange={handleChange}>
        <SelectTrigger className="h-7 w-[120px] text-xs border-none bg-transparent shadow-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="status">Status</SelectItem>
          <SelectItem value="assignee">Assignee</SelectItem>
          <SelectItem value="priority">Priority</SelectItem>
          <SelectItem value="label">Label</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
