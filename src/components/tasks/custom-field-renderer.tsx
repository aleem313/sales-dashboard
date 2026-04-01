"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, Check } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { CustomFieldDefinition } from "@/lib/task-data";

interface CustomFieldRendererProps {
  field: CustomFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  compact?: boolean;
}

export function CustomFieldRenderer({ field, value, onChange, compact }: CustomFieldRendererProps) {
  if (compact) {
    return <CompactFieldValue field={field} value={value} />;
  }

  switch (field.field_type) {
    case "text":
      return <TextField value={value} onChange={onChange} />;
    case "number":
      return <NumberField value={value} onChange={onChange} />;
    case "dropdown":
      return <DropdownField field={field} value={value} onChange={onChange} />;
    case "multi_select":
      return <MultiSelectField field={field} value={value} onChange={onChange} />;
    case "date":
      return <DateField value={value} onChange={onChange} />;
    case "boolean":
      return <BooleanField value={value} onChange={onChange} />;
    default:
      return null;
  }
}

function TextField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value ?? "")); setEditing(true); }}
        className="text-sm text-left w-full min-h-[32px] px-2 py-1 rounded hover:bg-muted transition-colors"
      >
        {value ? String(value) : <span className="text-muted-foreground">Empty</span>}
      </button>
    );
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== String(value ?? "")) onChange(draft || null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { setEditing(false); if (draft !== String(value ?? "")) onChange(draft || null); }
        if (e.key === "Escape") { setEditing(false); setDraft(String(value ?? "")); }
      }}
      maxLength={500}
      className="h-8 text-sm"
      autoFocus
    />
  );
}

function NumberField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value != null ? String(value) : ""); setEditing(true); }}
        className="text-sm text-left w-full min-h-[32px] px-2 py-1 rounded hover:bg-muted transition-colors"
      >
        {value != null ? String(value) : <span className="text-muted-foreground">Empty</span>}
      </button>
    );
  }

  return (
    <Input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        const num = parseFloat(draft);
        if (!isNaN(num)) onChange(num);
        else if (draft === "") onChange(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          setEditing(false);
          const num = parseFloat(draft);
          if (!isNaN(num)) onChange(num);
          else if (draft === "") onChange(null);
        }
        if (e.key === "Escape") { setEditing(false); }
      }}
      className="h-8 text-sm"
      autoFocus
    />
  );
}

function DropdownField({ field, value, onChange }: { field: CustomFieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
  const options = (field.options ?? []) as string[];
  return (
    <Select value={String(value ?? "")} onValueChange={(v) => onChange(v === "_clear" ? null : v)}>
      <SelectTrigger className="h-8 text-sm">
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="_clear">
          <span className="text-muted-foreground">None</span>
        </SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultiSelectField({ field, value, onChange }: { field: CustomFieldDefinition; value: unknown; onChange: (v: unknown) => void }) {
  const options = (field.options ?? []) as string[];
  const selected = Array.isArray(value) ? (value as string[]) : [];

  function toggle(opt: string) {
    const newVal = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    onChange(newVal.length > 0 ? newVal : null);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-8 text-sm justify-start font-normal w-full">
          {selected.length > 0 ? selected.join(", ") : <span className="text-muted-foreground">Select...</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-muted transition-colors"
          >
            <div className={cn(
              "flex h-4 w-4 items-center justify-center rounded border",
              selected.includes(opt) && "bg-primary border-primary"
            )}>
              {selected.includes(opt) && <Check className="h-3 w-3 text-primary-foreground" />}
            </div>
            {opt}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function DateField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const dateValue = value ? new Date(String(value)) : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="h-8 text-sm justify-start font-normal w-full">
          <CalendarIcon className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
          {dateValue ? format(dateValue, "MMM d, yyyy") : <span className="text-muted-foreground">Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={(date) => onChange(date ? date.toISOString().split("T")[0] : null)}
        />
      </PopoverContent>
    </Popover>
  );
}

function BooleanField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  return (
    <Switch
      checked={value === true}
      onCheckedChange={(checked) => onChange(checked)}
    />
  );
}

function CompactFieldValue({ field, value }: { field: CustomFieldDefinition; value: unknown }) {
  if (value === null || value === undefined || value === "") return null;

  let display: string;
  switch (field.field_type) {
    case "boolean":
      display = value === true ? "Yes" : "No";
      break;
    case "date":
      display = format(new Date(String(value)), "MMM d");
      break;
    case "multi_select":
      display = Array.isArray(value) ? `${value.length} selected` : String(value);
      break;
    default:
      display = String(value);
  }

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[120px]">
      <span className="font-medium">{field.name}:</span>
      <span>{display}</span>
    </span>
  );
}
