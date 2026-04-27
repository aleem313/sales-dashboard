"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { X, Plus, Filter, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBoardStore } from "@/lib/stores/board-store";
import type { CustomFieldDefinition } from "@/lib/task-data";

// Preset options mirror DateRangePicker (top navbar).
const DATE_PRESETS: { value: string; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "6m", label: "Last 6 months" },
  { value: "1y", label: "1 year" },
];

// Virtual field for Reason (N/A status). Uses _reason key in custom_fields.
const REASON_OPTIONS = [
  "Old job", "Duplicate", "Location loc", "Low Higher rate",
  "Language barrier", "Too many invites", "Video Proposal",
  "Client suspended", "Portfolio unavailable", "Client Low spending",
  "Bad rating client", "Job unavailable", "Already hired", "Out of stack",
];

const REASON_VIRTUAL_FIELD: CustomFieldDefinition = {
  id: "_reason",
  project_id: "",
  name: "Reason",
  field_type: "multi_select",
  options: REASON_OPTIONS,
  required: false,
  position: 9999,
  archived: false,
  show_on_card: false,
  created_at: "",
};

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
  // Built-in Created At / Updated At fields use a preset dropdown matching the top navbar.
  date_preset: [
    { value: "in_range", label: "in range" },
    { value: "is_empty", label: "is empty" },
    { value: "is_not_empty", label: "is not empty" },
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

  // Inject virtual fields for built-in date fields + Reason.
  // Created At / Updated At use the date_preset type so the value picker becomes
  // a preset dropdown (Today, Yesterday, Last 7 days, …) matching the top navbar.
  const DUE_DATE_VIRTUAL: CustomFieldDefinition = {
    id: "_due_date", project_id: "", name: "Due Date", field_type: "date",
    options: null, required: false, position: 9997, archived: false, show_on_card: false, created_at: "",
  };
  const CREATED_AT_VIRTUAL: CustomFieldDefinition = {
    id: "_created_at", project_id: "", name: "Created At",
    field_type: "date_preset" as CustomFieldDefinition["field_type"],
    options: null, required: false, position: 9998, archived: false, show_on_card: false, created_at: "",
  };
  const UPDATED_AT_VIRTUAL: CustomFieldDefinition = {
    id: "_updated_at", project_id: "", name: "Updated At",
    field_type: "date_preset" as CustomFieldDefinition["field_type"],
    options: null, required: false, position: 9998, archived: false, show_on_card: false, created_at: "",
  };
  const allFields = [...customFields, DUE_DATE_VIRTUAL, CREATED_AT_VIRTUAL, UPDATED_AT_VIRTUAL, REASON_VIRTUAL_FIELD];

  if (allFields.length === 0) return null;

  function addFilter() {
    const firstField = allFields[0];
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
      const field = allFields.find((f) => f.id === updates.fieldId);
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
            const field = allFields.find((f) => f.id === filter.fieldId);
            const operators = OPERATORS_BY_TYPE[field?.field_type ?? "text"] ?? [];
            const showValue = needsValueInput(filter.operator);

            return (
              <div key={index} className="flex items-center gap-2">
                <Select value={filter.fieldId} onValueChange={(v) => updateFilter(index, { fieldId: v })}>
                  <SelectTrigger className="h-7 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allFields.map((f) => (
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
                    {field?.field_type === "multi_select" ? (
                      <MultiSelectFilterValue
                        options={(field.options as string[]) ?? []}
                        value={Array.isArray(filter.value) ? filter.value as string[] : []}
                        onChange={(v) => updateFilter(index, { value: v })}
                      />
                    ) : field?.field_type === "dropdown" ? (
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
                    ) : (field?.field_type as string) === "date_preset" ? (
                      <Select
                        value={String(filter.value ?? "")}
                        onValueChange={(v) => updateFilter(index, { value: v })}
                      >
                        <SelectTrigger className="h-7 w-[140px] text-xs">
                          <SelectValue placeholder="Select range..." />
                        </SelectTrigger>
                        <SelectContent>
                          {DATE_PRESETS.map((p) => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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

/** Multi-select value picker for filter conditions */
function MultiSelectFilterValue({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);

  function toggle(opt: string) {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 w-[160px] text-xs justify-start font-normal truncate">
          {value.length === 0
            ? "Select values..."
            : value.length <= 2
              ? value.join(", ")
              : `${value.length} selected`}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-1 max-h-56 overflow-y-auto" align="start">
        {options.map((opt) => {
          const selected = value.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={cn(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent transition-colors",
                selected && "bg-accent/50"
              )}
            >
              <div className={cn(
                "h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                selected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
              )}>
                {selected && <Check className="h-2.5 w-2.5" />}
              </div>
              {opt}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
