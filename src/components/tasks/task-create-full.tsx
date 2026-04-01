"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, X, Search, Loader2, ExternalLink, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createTaskAction } from "@/lib/task-actions";
import { RichTextEditor } from "./rich-text-editor";
import { JobDetails } from "./job-details";
import { ProposalBox } from "./proposal-box";
import type { BoardColumn, ProjectMember } from "@/lib/task-data";
import type { Job } from "@/lib/types";

type JobWithMeta = Job & { agent_name?: string | null; profile_name?: string | null };

interface TaskCreateFullProps {
  projectId: string;
  columns: BoardColumn[];
  members?: ProjectMember[];
  defaultColumnId?: string;
  backUrl: string;
}

export function TaskCreateFull({ projectId, columns, members, defaultColumnId, backUrl }: TaskCreateFullProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [title, setTitle] = useState("");
  const [columnId, setColumnId] = useState(defaultColumnId ?? columns[0]?.id ?? "");
  const [priority, setPriority] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  // Job linking
  const [job, setJob] = useState<JobWithMeta | null>(null);
  const [jobSearchOpen, setJobSearchOpen] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [jobSearchResults, setJobSearchResults] = useState<Job[]>([]);
  const [jobSearching, setJobSearching] = useState(false);

  // Job search debounce
  useEffect(() => {
    if (!jobSearchQuery.trim()) {
      setJobSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setJobSearching(true);
      try {
        const res = await fetch(`/api/jobs/search?q=${encodeURIComponent(jobSearchQuery)}&limit=10`);
        if (res.ok) setJobSearchResults(await res.json());
      } catch { /* ignore */ }
      setJobSearching(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [jobSearchQuery]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    startTransition(async () => {
      try {
        const customFields: Record<string, unknown> = {};
        if (job) customFields._job_id = job.id;

        await createTaskAction({
          project_id: projectId,
          column_id: columnId,
          title: title.trim(),
          description: description.trim() || null,
          priority: priority || null,
          due_date: dueDate || null,
          assignee_ids: assigneeIds.length > 0 ? assigneeIds : undefined,
          custom_fields: Object.keys(customFields).length > 0 ? customFields : undefined,
        });
        toast.success("Task created");
        router.push(backUrl);
      } catch {
        toast.error("Failed to create task");
      }
    });
  }

  function addAssignee(agentId: string) {
    if (!assigneeIds.includes(agentId)) setAssigneeIds([...assigneeIds, agentId]);
  }

  function removeAssignee(agentId: string) {
    setAssigneeIds(assigneeIds.filter((id) => id !== agentId));
  }

  function linkJob(jobData: Job) {
    setJob(jobData as JobWithMeta);
    setJobSearchOpen(false);
    setJobSearchQuery("");
    // Auto-fill title from job if empty
    if (!title.trim()) setTitle(jobData.job_title);
  }

  const availableMembers = (members ?? []).filter((m) => !assigneeIds.includes(m.agent_id));
  const selectedMembers = (members ?? []).filter((m) => assigneeIds.includes(m.agent_id));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b px-6 py-3 bg-card/50 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => router.push(backUrl)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <h2 className="text-sm font-semibold">New Task</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push(backUrl)}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={isPending || !title.trim()}>
            {isPending ? "Creating..." : "Create Task"}
          </Button>
        </div>
      </div>

      {/* 3-Column Grid */}
      <div className="flex-1 overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-0 min-h-full">

            {/* ═══ COLUMN 1: Task Fields ═══ */}
            <div className="xl:col-span-4 md:col-span-1 border-r overflow-y-auto p-5 space-y-4">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Task Details</h2>

              <div className="space-y-4">
                {/* Title */}
                <div className="space-y-2">
                  <Label htmlFor="title">Title *</Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title..." autoFocus />
                </div>

                {/* Column + Priority */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="column">Status</Label>
                    <Select value={columnId} onValueChange={setColumnId}>
                      <SelectTrigger id="column">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col.id} value={col.id}>
                            <span className="flex items-center gap-2">
                              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: col.color }} />
                              {col.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="priority">Priority</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger id="priority">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="urgent">Urgent</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Assignees */}
                {members && members.length > 0 && (
                  <div className="space-y-2">
                    <Label>Assignees</Label>
                    {selectedMembers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {selectedMembers.map((m) => (
                          <span key={m.agent_id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                            {m.name}
                            <button type="button" onClick={() => removeAssignee(m.agent_id)} className="hover:text-destructive transition-colors">
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    {availableMembers.length > 0 && (
                      <Select value="" onValueChange={addAssignee}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Add assignee..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableMembers.map((m) => (
                            <SelectItem key={m.agent_id} value={m.agent_id}>
                              {m.name} {m.email ? `(${m.email})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}

                {/* Due Date */}
                <div className="space-y-2">
                  <Label htmlFor="due_date">Due Date</Label>
                  <Input id="due_date" type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <Label>Description</Label>
                  <RichTextEditor
                    content={description}
                    onChange={setDescription}
                    placeholder="Add a description..."
                  />
                </div>
              </div>
            </div>

            {/* ═══ COLUMN 2: Job Details ═══ */}
            <div className="xl:col-span-4 md:col-span-1 border-r overflow-y-auto p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Details</h2>
                <div className="relative">
                  <Button type="button" variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={() => setJobSearchOpen(!jobSearchOpen)}>
                    <Search className="h-3 w-3" />
                    {job ? "Change Job" : "Link Job"}
                  </Button>
                  {jobSearchOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => { setJobSearchOpen(false); setJobSearchQuery(""); }} />
                      <div className="absolute right-0 top-8 z-50 w-[320px] rounded-lg border bg-popover shadow-lg p-2">
                        <Input value={jobSearchQuery} onChange={(e) => setJobSearchQuery(e.target.value)}
                          placeholder="Search jobs by title..." className="h-8 text-xs mb-2" autoFocus />
                        <div className="max-h-[250px] overflow-y-auto space-y-0.5">
                          {jobSearching && <p className="text-xs text-muted-foreground text-center py-3"><Loader2 className="h-3 w-3 animate-spin inline mr-1" />Searching...</p>}
                          {!jobSearching && jobSearchResults.length === 0 && jobSearchQuery && (
                            <p className="text-xs text-muted-foreground text-center py-3">No jobs found</p>
                          )}
                          {jobSearchResults.map((j) => (
                            <button type="button" key={j.id} onClick={() => linkJob(j)}
                              className="flex flex-col w-full rounded-md px-2.5 py-2 text-left hover:bg-muted transition-colors gap-0.5">
                              <span className="text-xs font-medium line-clamp-1">{j.job_title}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {j.budget_type} &middot; {j.client_country ?? "Unknown"} &middot; {j.clickup_status}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {job && (
                <div className="mb-2">
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground" onClick={() => setJob(null)}>
                    Unlink Job
                  </Button>
                </div>
              )}
              <JobDetails job={job} />
            </div>

            {/* ═══ COLUMN 3: Proposal ═══ */}
            <div className="xl:col-span-4 md:col-span-2 overflow-y-auto p-5">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Proposal</h2>
              <ProposalBox proposal={job?.proposal_text ?? null} />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
