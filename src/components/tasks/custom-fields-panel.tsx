"use client";

import { useState, useTransition } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Settings2,
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  X,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  createCustomFieldAction,
  updateCustomFieldAction,
  archiveCustomFieldAction,
  restoreCustomFieldAction,
  reorderCustomFieldsAction,
} from "@/lib/task-actions";
import type { CustomFieldDefinition } from "@/lib/task-data";

interface CustomFieldsPanelProps {
  projectId: string;
  fields: CustomFieldDefinition[];
  onFieldsChange: () => void;
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: "Text",
  number: "Number",
  dropdown: "Dropdown",
  multi_select: "Multi-select",
  date: "Date",
  boolean: "Boolean",
};

const FIELD_TYPE_COLORS: Record<string, string> = {
  text: "bg-blue-500/15 text-blue-600",
  number: "bg-green-500/15 text-green-600",
  dropdown: "bg-purple-500/15 text-purple-600",
  multi_select: "bg-pink-500/15 text-pink-600",
  date: "bg-orange-500/15 text-orange-600",
  boolean: "bg-teal-500/15 text-teal-600",
};

export function CustomFieldsPanel({ projectId, fields, onFieldsChange }: CustomFieldsPanelProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<CustomFieldDefinition["field_type"]>("text");
  const [newRequired, setNewRequired] = useState(false);
  const [newShowOnCard, setNewShowOnCard] = useState(false);
  const [newOptions, setNewOptions] = useState<string[]>([]);
  const [newOptionDraft, setNewOptionDraft] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRequired, setEditRequired] = useState(false);
  const [editShowOnCard, setEditShowOnCard] = useState(false);
  const [editOptions, setEditOptions] = useState<string[]>([]);
  const [editOptionDraft, setEditOptionDraft] = useState("");

  const [archiveConfirm, setArchiveConfirm] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const activeFields = fields.filter((f) => !f.archived);
  const archivedFields = fields.filter((f) => f.archived);

  function resetAddForm() {
    setAdding(false);
    setNewName("");
    setNewType("text");
    setNewRequired(false);
    setNewShowOnCard(false);
    setNewOptions([]);
    setNewOptionDraft("");
  }

  function handleCreate() {
    if (!newName.trim()) return;
    startTransition(async () => {
      try {
        const needsOptions = newType === "dropdown" || newType === "multi_select";
        await createCustomFieldAction(projectId, {
          name: newName.trim(),
          field_type: newType,
          options: needsOptions ? newOptions : null,
          required: newRequired,
          show_on_card: newShowOnCard,
        });
        toast.success("Field created");
        resetAddForm();
        onFieldsChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to create field");
      }
    });
  }

  function startEdit(field: CustomFieldDefinition) {
    setEditingId(field.id);
    setEditName(field.name);
    setEditRequired(field.required);
    setEditShowOnCard(field.show_on_card);
    setEditOptions((field.options as string[]) ?? []);
    setEditOptionDraft("");
  }

  function handleUpdate() {
    if (!editingId || !editName.trim()) return;
    const field = fields.find((f) => f.id === editingId);
    const needsOptions = field?.field_type === "dropdown" || field?.field_type === "multi_select";
    startTransition(async () => {
      try {
        await updateCustomFieldAction(editingId, {
          name: editName.trim(),
          required: editRequired,
          show_on_card: editShowOnCard,
          options: needsOptions ? editOptions : undefined,
        });
        toast.success("Field updated");
        setEditingId(null);
        onFieldsChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update field");
      }
    });
  }

  function handleArchive(fieldId: string) {
    startTransition(async () => {
      try {
        await archiveCustomFieldAction(fieldId);
        toast.success("Field archived");
        setArchiveConfirm(null);
        onFieldsChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to archive field");
      }
    });
  }

  function handleRestore(fieldId: string) {
    startTransition(async () => {
      try {
        await restoreCustomFieldAction(fieldId);
        toast.success("Field restored");
        onFieldsChange();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to restore field");
      }
    });
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    const ids = activeFields.map((f) => f.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    startTransition(async () => {
      try {
        await reorderCustomFieldsAction(projectId, ids);
        onFieldsChange();
      } catch {
        toast.error("Failed to reorder");
      }
    });
  }

  function handleMoveDown(index: number) {
    if (index === activeFields.length - 1) return;
    const ids = activeFields.map((f) => f.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    startTransition(async () => {
      try {
        await reorderCustomFieldsAction(projectId, ids);
        onFieldsChange();
      } catch {
        toast.error("Failed to reorder");
      }
    });
  }

  const needsOptionsInput = newType === "dropdown" || newType === "multi_select";

  return (
    <>
      <Button variant="ghost" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setOpen(true)}>
        <Settings2 className="h-3.5 w-3.5" />
        Fields
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-[400px] sm:w-[440px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Custom Fields</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            {activeFields.map((field, index) => (
              <div key={field.id} className="rounded-lg border p-3 space-y-2">
                {editingId === field.id ? (
                  <div className="space-y-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Field name"
                      className="h-8 text-sm"
                      maxLength={50}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Required</span>
                      <Switch checked={editRequired} onCheckedChange={setEditRequired} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Show on card</span>
                      <Switch checked={editShowOnCard} onCheckedChange={setEditShowOnCard} />
                    </div>
                    {(field.field_type === "dropdown" || field.field_type === "multi_select") && (
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Options</span>
                        <div className="flex flex-wrap gap-1">
                          {editOptions.map((opt, i) => (
                            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                              {opt}
                              <button onClick={() => setEditOptions(editOptions.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground">
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1">
                          <Input
                            value={editOptionDraft}
                            onChange={(e) => setEditOptionDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && editOptionDraft.trim()) {
                                setEditOptions([...editOptions, editOptionDraft.trim()]);
                                setEditOptionDraft("");
                              }
                            }}
                            placeholder="Add option..."
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} className="h-7 text-xs">Cancel</Button>
                      <Button size="sm" onClick={handleUpdate} disabled={isPending || !editName.trim()} className="h-7 text-xs">
                        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{field.name}</span>
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${FIELD_TYPE_COLORS[field.field_type]}`}>
                          {FIELD_TYPE_LABELS[field.field_type]}
                        </span>
                        {field.required && <span className="text-[10px] text-red-500">Required</span>}
                        {field.show_on_card && <span className="text-[10px] text-muted-foreground">On card</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => handleMoveUp(index)} disabled={index === 0} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleMoveDown(index)} disabled={index === activeFields.length - 1} className="p-1 rounded hover:bg-muted disabled:opacity-30">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => startEdit(field)} className="p-1 rounded hover:bg-muted">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => setArchiveConfirm(field.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive">
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {activeFields.length === 0 && !adding && (
              <p className="text-sm text-muted-foreground text-center py-4">No custom fields defined yet.</p>
            )}

            {adding ? (
              <div className="rounded-lg border border-dashed p-3 space-y-2">
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Field name"
                  className="h-8 text-sm"
                  maxLength={50}
                  autoFocus
                />
                <Select value={newType} onValueChange={(v) => setNewType(v as CustomFieldDefinition["field_type"])}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FIELD_TYPE_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {needsOptionsInput && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Options</span>
                    <div className="flex flex-wrap gap-1">
                      {newOptions.map((opt, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                          {opt}
                          <button onClick={() => setNewOptions(newOptions.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-foreground">
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <Input
                      value={newOptionDraft}
                      onChange={(e) => setNewOptionDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newOptionDraft.trim()) {
                          e.preventDefault();
                          setNewOptions([...newOptions, newOptionDraft.trim()]);
                          setNewOptionDraft("");
                        }
                      }}
                      placeholder="Type option and press Enter..."
                      className="h-7 text-xs"
                    />
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Required</span>
                  <Switch checked={newRequired} onCheckedChange={setNewRequired} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Show on card</span>
                  <Switch checked={newShowOnCard} onCheckedChange={setNewShowOnCard} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={resetAddForm} className="h-7 text-xs">Cancel</Button>
                  <Button size="sm" onClick={handleCreate} disabled={isPending || !newName.trim()} className="h-7 text-xs">
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Create"}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add Field
              </Button>
            )}

            {archivedFields.length > 0 && (
              <div className="pt-2">
                <button
                  onClick={() => setShowArchived(!showArchived)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showArchived ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                  Archived ({archivedFields.length})
                </button>
                {showArchived && (
                  <div className="mt-2 space-y-2">
                    {archivedFields.map((field) => (
                      <div key={field.id} className="flex items-center justify-between rounded-lg border border-dashed p-2 opacity-60">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{field.name}</span>
                          <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${FIELD_TYPE_COLORS[field.field_type]}`}>
                            {FIELD_TYPE_LABELS[field.field_type]}
                          </span>
                        </div>
                        <button onClick={() => handleRestore(field.id)} className="p-1 rounded hover:bg-muted" title="Restore">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog open={!!archiveConfirm} onOpenChange={() => setArchiveConfirm(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Archive Field</DialogTitle>
            <DialogDescription>
              This field will be hidden from the UI but existing values on tasks will be preserved. You can restore it later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setArchiveConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => archiveConfirm && handleArchive(archiveConfirm)} disabled={isPending}>
              {isPending ? "Archiving..." : "Archive"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
