"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useBoardStore } from "@/lib/stores/board-store";
import type { CustomFieldDefinition, SavedView } from "@/lib/task-data";

interface BoardStoreInitializerProps {
  customFields: CustomFieldDefinition[];
  savedViews: SavedView[];
}

export function BoardStoreInitializer({ customFields, savedViews }: BoardStoreInitializerProps) {
  const setCustomFields = useBoardStore((s) => s.setCustomFields);
  const setSavedViews = useBoardStore((s) => s.setSavedViews);
  const setGroupBy = useBoardStore((s) => s.setGroupBy);
  const searchParams = useSearchParams();

  useEffect(() => {
    setCustomFields(customFields);
    setSavedViews(savedViews);

    // Sync groupBy from URL (reset to "status" when no group param)
    const group = searchParams.get("group");
    if (group && ["assignee", "priority", "label"].includes(group)) {
      setGroupBy(group as "assignee" | "priority" | "label");
    } else {
      setGroupBy("status");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFields, savedViews]);

  return null;
}
