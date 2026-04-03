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
import {
  ArrowLeft,
  Plus,
  X,
  Search,
  Loader2,
  Flag,
  Calendar,
  CalendarClock,
  User,
  Tag,
  Clock,
  Timer,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createTaskAction } from "@/lib/task-actions";
import { RichTextEditor } from "./rich-text-editor";
import { ProposalBox } from "./proposal-box";
import type { BoardColumn, ProjectMember, TaskTag } from "@/lib/task-data";
import type { Job } from "@/lib/types";

type JobWithMeta = Job & { agent_name?: string | null; profile_name?: string | null };

interface TaskCreateFullProps {
  projectId: string;
  columns: BoardColumn[];
  members?: ProjectMember[];
  defaultColumnId?: string;
  backUrl: string;
  onClose?: () => void;
}

function getInitials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ["bg-blue-500", "bg-green-500", "bg-purple-500", "bg-pink-500", "bg-indigo-500", "bg-teal-500", "bg-amber-500", "bg-cyan-500"];
  return colors[Math.abs(hash) % colors.length];
}

export function TaskCreateFull({ projectId, columns, members, defaultColumnId, backUrl, onClose }: TaskCreateFullProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [title, setTitle] = useState("");
  const [columnId, setColumnId] = useState(defaultColumnId ?? columns[0]?.id ?? "");
  const [priority, setPriority] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [timeEstimate, setTimeEstimate] = useState("");
  const [timeTracked, setTimeTracked] = useState("");
  const [connectsUsed, setConnectsUsed] = useState("");
  const [boostedConnects, setBoostedConnects] = useState("");

  // Tags
  const [projectTags, setProjectTags] = useState<TaskTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");

  // Assignee dropdown
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState("");

  // Job Details fields
  const [jobLink, setJobLink] = useState("");
  const [jobBudget, setJobBudget] = useState("");
  const [jobSkills, setJobSkills] = useState("");
  const [jobPosted, setJobPosted] = useState("");
  // Client Info fields
  const [clientLocation, setClientLocation] = useState("");
  const [clientRating, setClientRating] = useState("");
  const [clientSpent, setClientSpent] = useState("");
  const [clientHires, setClientHires] = useState("");
  // Routing Info fields
  const [routingAgent, setRoutingAgent] = useState("");
  const [routingProfile, setRoutingProfile] = useState("");
  const [routingStack, setRoutingStack] = useState("");
  const [routingJobId, setRoutingJobId] = useState("");
  const [routingGenerated, setRoutingGenerated] = useState("");
  // Proposal
  const [proposal, setProposal] = useState("");

  // Job linking (from DB)
  const [job, setJob] = useState<JobWithMeta | null>(null);
  const [jobSearchOpen, setJobSearchOpen] = useState(false);
  const [jobSearchQuery, setJobSearchQuery] = useState("");
  const [jobSearchResults, setJobSearchResults] = useState<Job[]>([]);
  const [jobSearching, setJobSearching] = useState(false);

  // Load project tags
  useEffect(() => {
    fetch(`/api/projects/${projectId}/tags`).then((r) => r.json()).then(setProjectTags).catch(() => {});
  }, [projectId]);

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

  function parseTimeToMinutes(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const hm = value.match(/^(\d+)h\s*(\d+)m$/i);
    if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);
    const hOnly = value.match(/^(\d+)h$/i);
    if (hOnly) return parseInt(hOnly[1]) * 60;
    const mOnly = value.match(/^(\d+)m$/i);
    if (mOnly) return parseInt(mOnly[1]);
    const num = parseInt(value);
    if (!isNaN(num)) return num;
    return undefined;
  }

  function goBack() {
    if (onClose) onClose();
    else router.push(backUrl);
  }

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
        const estMins = parseTimeToMinutes(timeEstimate);
        if (estMins !== undefined) customFields._time_estimate_minutes = estMins;
        const trkMins = parseTimeToMinutes(timeTracked);
        if (trkMins !== undefined) customFields._time_tracked_minutes = trkMins;
        if (connectsUsed) customFields._connects_used = parseInt(connectsUsed) || 0;
        if (boostedConnects) customFields._boosted_connects = parseInt(boostedConnects) || 0;
        // Job Details / Client / Routing / Proposal fields
        if (jobLink) customFields._job_url = jobLink;
        if (jobBudget) customFields._budget = jobBudget;
        if (jobSkills) customFields._skills = jobSkills.split(",").map((s) => s.trim()).filter(Boolean);
        if (jobPosted) customFields._posted = jobPosted;
        if (clientLocation) customFields._client_country = clientLocation;
        if (clientRating) customFields._client_rating = clientRating;
        if (clientSpent) customFields._client_spent = clientSpent;
        if (clientHires) customFields._client_hires = clientHires;
        if (routingAgent) customFields._assigned_agent = routingAgent;
        if (routingProfile) customFields._profile_name = routingProfile;
        if (routingStack) customFields._stack = routingStack;
        if (routingJobId) customFields._job_id = customFields._job_id || routingJobId;
        if (routingGenerated) customFields._generated = routingGenerated;
        if (proposal) customFields._proposal = proposal;

        await createTaskAction({
          project_id: projectId,
          column_id: columnId,
          title: title.trim(),
          description: description.trim() || null,
          priority: priority || null,
          due_date: dueDate || null,
          start_date: startDate || null,
          assignee_ids: assigneeIds.length > 0 ? assigneeIds : undefined,
          tag_ids: selectedTagIds.length > 0 ? selectedTagIds : undefined,
          custom_fields: Object.keys(customFields).length > 0 ? customFields : undefined,
        });
        toast.success("Task created");
        goBack();
      } catch {
        toast.error("Failed to create task");
      }
    });
  }

  function toggleAssignee(agentId: string) {
    setAssigneeIds((prev) =>
      prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]
    );
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTagName.trim() }),
      });
      if (res.ok) {
        const tag = await res.json();
        setProjectTags((prev) => [...prev, tag]);
        setSelectedTagIds((prev) => [...prev, tag.id]);
        setNewTagName("");
      }
    } catch {
      toast.error("Failed to create tag");
    }
  }

  function linkJob(jobData: Job) {
    const j = jobData as JobWithMeta;
    setJob(j);
    setJobSearchOpen(false);
    setJobSearchQuery("");
    if (!title.trim()) setTitle(j.job_title);
    // Auto-fill fields from linked job
    if (j.job_url) setJobLink(j.job_url);
    const budget = j.budget_type === "fixed"
      ? (j.budget_max != null ? `$${j.budget_max}` : "Not specified")
      : (j.hourly_min != null ? `$${j.hourly_min}-$${j.hourly_max}/hr` : "Not specified");
    setJobBudget(budget);
    if (j.skills?.length) setJobSkills(j.skills.join(", "));
    if (j.posted_at) setJobPosted(new Date(j.posted_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }));
    if (j.client_country) setClientLocation(j.client_country);
    if (j.client_rating != null) setClientRating(String(j.client_rating));
    if (j.client_total_spent != null) setClientSpent(`$${j.client_total_spent}`);
    if (j.client_hires != null) setClientHires(String(j.client_hires));
    if (j.agent_name) setRoutingAgent(j.agent_name);
    if (j.profile_name) setRoutingProfile(j.profile_name);
    if (j.job_id) setRoutingJobId(j.job_id);
    if (j.proposal_text) setProposal(j.proposal_text);
  }

  const filteredMembers = (members ?? []).filter((m) =>
    m.name.toLowerCase().includes(assigneeSearch.toLowerCase()) ||
    (m.email ?? "").toLowerCase().includes(assigneeSearch.toLowerCase())
  );

  const currentColumn = columns.find((c) => c.id === columnId);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b px-6 py-3 bg-card/50 shrink-0">
        <div className="flex items-center gap-3">
          <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
            {onClose ? "Close" : "Back"}
          </Button>
          <Separator orientation="vertical" className="h-5" />
          <h2 className="text-sm font-semibold">New Task</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={goBack}>Cancel</Button>
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

              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title..." autoFocus />
              </div>

              {/* Field rows matching task detail view */}
              <div className="space-y-0">
                {/* Status */}
                <FieldRow icon={<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: currentColumn?.color ?? "#6b7280" }} />} label="Status">
                  <Select value={columnId} onValueChange={setColumnId}>
                    <SelectTrigger className="h-7 w-[150px] text-xs border-0 bg-transparent hover:bg-muted/50 px-2">
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
                </FieldRow>

                {/* Priority */}
                <FieldRow icon={<Flag className="h-4 w-4" />} label="Priority">
                  <Select value={priority || "none"} onValueChange={(v) => setPriority(v === "none" ? "" : v)}>
                    <SelectTrigger className="h-7 w-[120px] text-xs border-0 bg-transparent hover:bg-muted/50 px-2">
                      <SelectValue placeholder="Set priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No priority</SelectItem>
                      <SelectItem value="urgent"><span className="text-red-600">Urgent</span></SelectItem>
                      <SelectItem value="high"><span className="text-orange-600">High</span></SelectItem>
                      <SelectItem value="medium"><span className="text-yellow-600">Medium</span></SelectItem>
                      <SelectItem value="low"><span className="text-blue-600">Low</span></SelectItem>
                    </SelectContent>
                  </Select>
                </FieldRow>

                {/* Assignees */}
                <FieldRow icon={<User className="h-4 w-4" />} label="Assignees">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {assigneeIds.map((id) => {
                      const m = (members ?? []).find((m) => m.agent_id === id);
                      if (!m) return null;
                      return (
                        <button key={id} type="button" onClick={() => toggleAssignee(id)}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary/8 text-primary border border-primary/20 px-2 py-0.5 text-xs font-medium hover:bg-primary/15 transition-colors">
                          <span className={cn("flex h-4 w-4 items-center justify-center rounded-full text-[7px] font-bold text-white", hashColor(id))}>
                            {getInitials(m.name)}
                          </span>
                          {m.name}
                          <X className="h-3 w-3 opacity-50 hover:opacity-100" />
                        </button>
                      );
                    })}
                    <div className="relative">
                      <button type="button" onClick={() => setAssigneeDropdownOpen(!assigneeDropdownOpen)}
                        className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30 hover:border-primary hover:text-primary transition-colors" title="Add assignee">
                        <Plus className="h-3 w-3" />
                      </button>
                      {assigneeDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => { setAssigneeDropdownOpen(false); setAssigneeSearch(""); }} />
                          <div className="absolute left-0 top-8 z-50 w-[220px] rounded-lg border bg-popover shadow-lg p-1.5">
                            <Input placeholder="Search..." value={assigneeSearch} onChange={(e) => setAssigneeSearch(e.target.value)} className="h-7 text-xs mb-1.5" autoFocus />
                            <div className="max-h-[180px] overflow-y-auto space-y-0.5">
                              {filteredMembers.map((m) => {
                                const isAssigned = assigneeIds.includes(m.agent_id);
                                return (
                                  <button key={m.agent_id} type="button" onClick={() => toggleAssignee(m.agent_id)}
                                    className={cn("flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs hover:bg-muted transition-colors", isAssigned && "bg-primary/5")}>
                                    <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white shrink-0", hashColor(m.agent_id))}>
                                      {getInitials(m.name)}
                                    </span>
                                    <span className="flex-1 text-left truncate">{m.name}</span>
                                    {isAssigned && <span className="text-primary">&#10003;</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </FieldRow>

                {/* Due Date */}
                <FieldRow icon={<Calendar className="h-4 w-4" />} label="Due Date">
                  <Input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                    className="h-7 text-xs w-[190px] border-0 bg-transparent hover:bg-muted/50 px-2" />
                  {dueDate && (
                    <button type="button" onClick={() => setDueDate("")} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </FieldRow>

                {/* Start Date */}
                <FieldRow icon={<CalendarClock className="h-4 w-4" />} label="Start Date">
                  <Input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                    className="h-7 text-xs w-[190px] border-0 bg-transparent hover:bg-muted/50 px-2" />
                  {startDate && (
                    <button type="button" onClick={() => setStartDate("")} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </FieldRow>

                {/* Time Estimate */}
                <FieldRow icon={<Clock className="h-4 w-4" />} label="Time Est.">
                  <Input value={timeEstimate} onChange={(e) => setTimeEstimate(e.target.value)}
                    placeholder="e.g. 2h 30m" className="h-7 text-xs w-[120px] border-0 bg-transparent hover:bg-muted/50 px-2" />
                </FieldRow>

                {/* Time Tracked */}
                <FieldRow icon={<Timer className="h-4 w-4" />} label="Tracked">
                  <Input value={timeTracked} onChange={(e) => setTimeTracked(e.target.value)}
                    placeholder="e.g. 1h 15m" className="h-7 text-xs w-[120px] border-0 bg-transparent hover:bg-muted/50 px-2" />
                </FieldRow>

                {/* Labels/Tags */}
                <FieldRow icon={<Tag className="h-4 w-4" />} label="Labels">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {selectedTagIds.map((tagId) => {
                      const tag = projectTags.find((t) => t.id === tagId);
                      if (!tag) return null;
                      return (
                        <button key={tagId} type="button" onClick={() => toggleTag(tagId)}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors hover:opacity-80"
                          style={{ backgroundColor: tag.color + "22", color: tag.color }}>
                          {tag.name}
                          <X className="h-2.5 w-2.5 opacity-50 hover:opacity-100" />
                        </button>
                      );
                    })}
                    <div className="relative">
                      <button type="button" onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors" title="Add label">
                        <Plus className="h-2.5 w-2.5" />
                      </button>
                      {tagDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setTagDropdownOpen(false)} />
                          <div className="absolute top-7 left-0 z-50 w-56 rounded-lg border bg-popover shadow-lg p-1.5">
                            <div className="px-1.5 pb-1.5">
                              <Input value={newTagName} onChange={(e) => setNewTagName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && newTagName.trim()) { e.preventDefault(); handleCreateTag(); }
                                  if (e.key === "Escape") setTagDropdownOpen(false);
                                }}
                                placeholder="Search or create..." className="h-7 text-xs" autoFocus />
                            </div>
                            <div className="max-h-[160px] overflow-y-auto">
                              {projectTags
                                .filter((t) => !newTagName || t.name.toLowerCase().includes(newTagName.toLowerCase()))
                                .map((tag) => {
                                  const isSelected = selectedTagIds.includes(tag.id);
                                  return (
                                    <button key={tag.id} type="button" onClick={() => toggleTag(tag.id)}
                                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted transition-colors">
                                      <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                                      <span className="truncate">{tag.name}</span>
                                      {isSelected && <span className="ml-auto text-primary">&#10003;</span>}
                                    </button>
                                  );
                                })}
                            </div>
                            {newTagName.trim() && !projectTags.some((t) => t.name.toLowerCase() === newTagName.toLowerCase()) && (
                              <>
                                <Separator className="my-1" />
                                <button type="button" onClick={handleCreateTag}
                                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-primary hover:bg-muted transition-colors">
                                  <Plus className="h-3 w-3" />
                                  Create &ldquo;{newTagName.trim()}&rdquo;
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </FieldRow>

                {/* Connects Used */}
                <FieldRow icon={<span className="h-4 w-4 flex items-center justify-center text-xs font-bold text-muted-foreground">#</span>} label="Connects">
                  <Input type="number" min={0} value={connectsUsed} onChange={(e) => setConnectsUsed(e.target.value)}
                    placeholder="0" className="h-7 text-xs w-[80px] border-0 bg-transparent hover:bg-muted/50 px-2" />
                </FieldRow>

                {/* Boosted Connects */}
                <FieldRow icon={<span className="h-4 w-4 flex items-center justify-center text-xs font-bold text-muted-foreground">⚡</span>} label="Boosted">
                  <Input type="number" min={0} value={boostedConnects} onChange={(e) => setBoostedConnects(e.target.value)}
                    placeholder="0" className="h-7 text-xs w-[80px] border-0 bg-transparent hover:bg-muted/50 px-2" />
                </FieldRow>
              </div>

              <Separator />

              {/* Description */}
              <div>
                <p className="text-sm font-medium mb-2">Description</p>
                <RichTextEditor
                  content={description}
                  onChange={setDescription}
                  placeholder="Add a description..."
                />
              </div>
            </div>

            {/* ═══ COLUMN 2: Job Details ═══ */}
            <div className="xl:col-span-4 md:col-span-1 border-r overflow-y-auto p-5 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Job Details</h2>
                <div className="flex items-center gap-1">
                  {job && (
                    <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground" onClick={() => setJob(null)}>
                      Unlink
                    </Button>
                  )}
                  <div className="relative">
                    <Button type="button" variant="outline" size="sm" className="h-6 text-xs gap-1" onClick={() => setJobSearchOpen(!jobSearchOpen)}>
                      <Search className="h-3 w-3" />
                      {job ? "Change" : "Link Job"}
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
                                  {j.budget_type} &middot; {j.client_country ?? "Unknown"} &middot; {j.status}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Job Snapshot ── */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">📌 Job Snapshot</h4>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
                  <FieldRow icon={<span className="text-sm">🔗</span>} label="Job Link">
                    <Input value={jobLink} onChange={(e) => setJobLink(e.target.value)} placeholder="https://upwork.com/jobs/..." className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">💰</span>} label="Budget">
                    <Input value={jobBudget} onChange={(e) => setJobBudget(e.target.value)} placeholder="Not specified" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">🛠</span>} label="Skills">
                    <Input value={jobSkills} onChange={(e) => setJobSkills(e.target.value)} placeholder="e.g. React, Node.js" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">📅</span>} label="Posted">
                    <Input value={jobPosted} onChange={(e) => setJobPosted(e.target.value)} placeholder="e.g. Apr 1, 2026" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                  </FieldRow>
                </div>
              </div>

              {/* ── Client Intel ── */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">👤 Client Intel</h4>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
                  <FieldRow icon={<span className="text-sm">🌍</span>} label="Location">
                    <Input value={clientLocation} onChange={(e) => setClientLocation(e.target.value)} placeholder="e.g. Netherlands" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">⭐</span>} label="Rating">
                    <Input value={clientRating} onChange={(e) => setClientRating(e.target.value)} placeholder="No rating yet" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">💵</span>} label="Total Spent">
                    <Input value={clientSpent} onChange={(e) => setClientSpent(e.target.value)} placeholder="New client" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">✅</span>} label="Past Hires">
                    <Input value={clientHires} onChange={(e) => setClientHires(e.target.value)} placeholder="No hires yet" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                  </FieldRow>
                </div>
              </div>

              {/* ── Routing Info ── */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">🎯 Routing Info</h4>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-0">
                  <FieldRow icon={<span className="text-sm">👤</span>} label="Agent">
                    <Input value={routingAgent} onChange={(e) => setRoutingAgent(e.target.value)} placeholder="Agent name" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">📁</span>} label="Profile">
                    <Input value={routingProfile} onChange={(e) => setRoutingProfile(e.target.value)} placeholder="Profile name" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">🏷</span>} label="Stack">
                    <Input value={routingStack} onChange={(e) => setRoutingStack(e.target.value)} placeholder="e.g. MERN" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2 w-[140px]" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">🆔</span>} label="Job ID">
                    <Input value={routingJobId} onChange={(e) => setRoutingJobId(e.target.value)} placeholder="~0220..." className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2" />
                  </FieldRow>
                  <FieldRow icon={<span className="text-sm">🤖</span>} label="Generated">
                    <Input value={routingGenerated} onChange={(e) => setRoutingGenerated(e.target.value)} placeholder="e.g. Apr 1, 2026, 06:04 PM UTC" className="h-7 text-xs border-0 bg-transparent hover:bg-muted/50 px-2" />
                  </FieldRow>
                </div>
              </div>
            </div>

            {/* ═══ COLUMN 3: Proposal ═══ */}
            <div className="xl:col-span-4 md:col-span-2 overflow-y-auto p-5">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Proposal</h2>
              <ProposalBox proposal={proposal || null} onChange={setProposal} readOnly={false} />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Field Row (matching task detail view style) ── */
function FieldRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1.5 min-h-[36px]">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <span className="text-xs text-muted-foreground w-[80px] shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-1 min-w-0">{children}</div>
    </div>
  );
}
