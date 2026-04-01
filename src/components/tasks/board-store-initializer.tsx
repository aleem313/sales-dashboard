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
  const store = useBoardStore();
  const searchParams = useSearchParams();

  useEffect(() => {
    store.setCustomFields(customFields);
    store.setSavedViews(savedViews);

    // Sync groupBy from URL
    const group = searchParams.get("group");
    if (group && ["assignee", "priority", "label"].includes(group)) {
      store.setGroupBy(group as "assignee" | "priority" | "label");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFields, savedViews]);

  return null;
}
