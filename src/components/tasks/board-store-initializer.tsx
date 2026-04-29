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
  const setCustomFieldFilters = useBoardStore((s) => s.setCustomFieldFilters);
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

    // Hydrate date custom-field filters from URL so the in-memory filter state
    // matches the SQL predicate already applied by the server query.
    const cfCreated = searchParams.get("cf_created");
    const cfUpdated = searchParams.get("cf_updated");
    const cfDueAfter = searchParams.get("cf_due_after");
    const cfDueBefore = searchParams.get("cf_due_before");
    const seeded: { fieldId: string; operator: string; value: unknown }[] = [];
    if (cfCreated) seeded.push({ fieldId: "_created_at", operator: "in_range", value: cfCreated });
    if (cfUpdated) seeded.push({ fieldId: "_updated_at", operator: "in_range", value: cfUpdated });
    if (cfDueAfter) seeded.push({ fieldId: "_due_date", operator: "after", value: cfDueAfter });
    if (cfDueBefore) seeded.push({ fieldId: "_due_date", operator: "before", value: cfDueBefore });
    if (seeded.length > 0) setCustomFieldFilters(seeded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFields, savedViews]);

  return null;
}
