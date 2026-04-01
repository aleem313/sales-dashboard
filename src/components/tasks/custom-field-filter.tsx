"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Plus, Filter } from "lucide-react";
import { useBoardStore } from "@/lib/stores/board-store";
import type { CustomFieldDefinition } from "@/lib/task-data";

interface MoreFiltersProps {
  customFields: CustomFieldDefinition[];
}

const OPERATORS_BY_TYPE: Record<string, { value: string; label: string }[]> = {
  text: [
    { value: "contains", label: "contains" },
    { value: "equals", label: "equals" },
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
  ],
  number: [
    { value: "equals", label: "equals" },
    { value: "gt", label: "greater than" },
    { value: "lt", label: "less than" },
    { value: "is_empty", label: "is empty" },
  ],
  dropdown: [
    { value: "is", label: "is" },
    { value: "is_not", label: "is not" },
    { value: "is_empty", label: "is empty" },
  ],
  multi_select: [
    { value: "contains_any", label: "contains any" },
    { value: "contains_all", label: "contains all" },
    { value: "is_empty", label: "is empty" },
  ],
  date: [
    { value: "is", label: "is" },
    { value: "before", label: "before" },
    { value: "after", label: "after" },
    { value: "is_empty", label: "is empty" },
  ],
  boolean: [
    { value: "is_true", label: "is true" },
    { value: "is_false", label: "is false" },
  ],
};

function needsValueInput(operator: string): boolean {
  return !["is_empty", "is_not_empty", "is_true", "is_false"].includes(operator);
}

export function MoreFilters({ customFields }: MoreFiltersProps) {
  const store = useBoardStore();
  const filters = store.customFieldFilters;
  const expanded = filters.length > 0;

  if (customFields.length === 0) return null;

  function addFilter() {
    const firstField = customFields[0];
    const ops = OPERATORS_BY_TYPE[firstField.field_type] ?? [];
    store.addCustomFieldFilter({
      fieldId: firstField.id,
      operator: ops[0]?.value ?? "equals",
      value: "",
    });
  }

  function updateFilter(index: number, updates: Partial<{ fieldId: string; operator: string; value: unknown }>) {
    const newFilters = [...filters];
    newFilters[index] = { ...newFilters[index], ...updates };

    if (updates.fieldId) {
      const field = customFields.find((f) => f.id === updates.fieldId);
      const ops = OPERATORS_BY_TYPE[field?.field_type ?? "text"] ?? [];
      newFilters[index].operator = ops[0]?.value ?? "equals";
      newFilters[index].value = "";
    }

    store.setCustomFieldFilters(newFilters);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            if (filters.length === 0) addFilter();
            else store.clearCustomFieldFilters();
          }}
        >
          <Filter className="h-3.5 w-3.5" />
          More Filters
          {filters.length > 0 && (
            <span className="ml-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
              {filters.length}
            </span>
          )}
        </Button>
        {filters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={() => store.clearCustomFieldFilters()}
          >
            Clear all
          </Button>
        )}
      </div>

      {expanded && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          {filters.map((filter, index) => {
            const field = customFields.find((f) => f.id === filter.fieldId);
            const operators = OPERATORS_BY_TYPE[field?.field_type ?? "text"] ?? [];
            const showValue = needsValueInput(filter.operator);

            return (
              <div key={index} className="flex items-center gap-2">
                <Select value={filter.fieldId} onValueChange={(v) => updateFilter(index, { fieldId: v })}>
                  <SelectTrigger className="h-7 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {customFields.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filter.operator} onValueChange={(v) => updateFilter(index, { operator: v })}>
                  <SelectTrigger className="h-7 w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {operators.map((op) => (
                      <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {showValue && (
                  <>
                    {field?.field_type === "dropdown" ? (
                      <Select value={String(filter.value ?? "")} onValueChange={(v) => updateFilter(index, { value: v })}>
                        <SelectTrigger className="h-7 w-[120px] text-xs">
                          <SelectValue placeholder="Value..." />
                        </SelectTrigger>
                        <SelectContent>
                          {((field.options as string[]) ?? []).map((opt) => (
                            <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : field?.field_type === "date" ? (
                      <Input
                        type="date"
                        value={String(filter.value ?? "")}
                        onChange={(e) => updateFilter(index, { value: e.target.value })}
                        className="h-7 w-[130px] text-xs"
                      />
                    ) : (
                      <Input
                        type={field?.field_type === "number" ? "number" : "text"}
                        value={String(filter.value ?? "")}
                        onChange={(e) => updateFilter(index, { value: field?.field_type === "number" ? parseFloat(e.target.value) || "" : e.target.value })}
                        placeholder="Value..."
                        className="h-7 w-[120px] text-xs"
                      />
                    )}
                  </>
                )}

                <button
                  onClick={() => store.removeCustomFieldFilter(index)}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}

          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addFilter}>
            <Plus className="h-3 w-3" />
            Add condition
          </Button>
        </div>
      )}
    </div>
  );
}
