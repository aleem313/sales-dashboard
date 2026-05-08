"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, History as HistoryIcon, Upload, ExternalLink, Star } from "lucide-react";
import { toast } from "sonner";
import type { UpworkProfileSnapshot, UpworkProfileSnapshotHistoryRow } from "@/lib/types";

type Tab = "current" | "history" | "upload";

interface Props {
  profileUuid: string;     // profiles.id (UUID) — used in API URL
  profileName: string;     // for display in sheet title
  hasSnapshot: boolean;    // whether a current snapshot exists
  isAdmin: boolean;        // controls Upload tab visibility
}

export function ProfileUpworkSnapshotSheet({ profileUuid, profileName, hasSnapshot, isAdmin }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(hasSnapshot ? "current" : "upload");
  const [snapshot, setSnapshot] = useState<UpworkProfileSnapshot | null>(null);
  const [history, setHistory] = useState<UpworkProfileSnapshotHistoryRow[]>([]);
  const [viewingSnapshotId, setViewingSnapshotId] = useState<string | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");

  const apiBase = `/api/profiles/${profileUuid}/upwork-snapshot`;

  // Lazy-load current snapshot when sheet opens or tab switches to "current".
  useEffect(() => {
    if (!open) return;
    if (tab !== "current") return;
    if (snapshot && !viewingSnapshotId) return;
    void loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  // Lazy-load history when tab switches to "history".
  useEffect(() => {
    if (!open) return;
    if (tab !== "history") return;
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  async function loadCurrent() {
    setLoadingCurrent(true);
    try {
      const url = viewingSnapshotId ? `${apiBase}?snapshotId=${viewingSnapshotId}` : apiBase;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { snapshot: UpworkProfileSnapshot | null };
      setSnapshot(json.snapshot);
    } catch (err) {
      toast.error(`Failed to load snapshot: ${(err as Error).message}`);
    } finally {
      setLoadingCurrent(false);
    }
  }

  async function loadHistory() {
    setLoadingHistory(true);
    try {
      const r = await fetch(`${apiBase}?history=1`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as { history: UpworkProfileSnapshotHistoryRow[] };
      setHistory(json.history);
    } catch (err) {
      toast.error(`Failed to load history: ${(err as Error).message}`);
    } finally {
      setLoadingHistory(false);
    }
  }

  function viewHistoricalSnapshot(id: string) {
    setViewingSnapshotId(id);
    setTab("current");
    // current tab will load via effect once tab changes; force-trigger by clearing snapshot
    setSnapshot(null);
  }

  function viewLiveSnapshot() {
    setViewingSnapshotId(null);
    setSnapshot(null);
    setTab("current");
  }

  async function submitUpload(rawJson: unknown) {
    setUploading(true);
    setUploadError(null);
    try {
      const r = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rawJson),
      });
      const responseJson = (await r.json()) as { ok?: boolean; replaced?: boolean; error?: string };
      if (!r.ok || !responseJson.ok) {
        throw new Error(responseJson.error ?? `HTTP ${r.status}`);
      }
      toast.success(
        `Snapshot saved · ${responseJson.replaced ? "replaced previous" : "first snapshot for this profile"}`
      );
      setPasteText("");
      // Refresh both panels.
      setSnapshot(null);
      setViewingSnapshotId(null);
      setTab("current");
      await loadCurrent();
      await loadHistory();
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      await submitUpload(parsed);
    } catch (err) {
      setUploadError(`Could not parse file: ${(err as Error).message}`);
    }
    e.target.value = ""; // reset input
  }

  async function handlePasteSubmit() {
    if (!pasteText.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(pasteText);
    } catch (err) {
      setUploadError(`Pasted text is not valid JSON: ${(err as Error).message}`);
      return;
    }
    await submitUpload(parsed);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs">
          <FileText className="h-3 w-3" />
          {hasSnapshot ? "Snapshot" : "No snapshot"}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-3xl flex flex-col">
        <SheetHeader>
          <SheetTitle>
            Upwork Snapshot · {profileName}
          </SheetTitle>
        </SheetHeader>

        {/* Tab strip */}
        <div className="flex gap-1 border-b mt-4">
          <TabButton active={tab === "current"} onClick={() => { setViewingSnapshotId(null); setTab("current"); }}>
            <FileText className="h-3.5 w-3.5" /> Current
          </TabButton>
          <TabButton active={tab === "history"} onClick={() => setTab("history")}>
            <HistoryIcon className="h-3.5 w-3.5" /> History
          </TabButton>
          {isAdmin && (
            <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
              <Upload className="h-3.5 w-3.5" /> Upload
            </TabButton>
          )}
        </div>

        <div className="flex-1 overflow-y-auto pt-4">
          {tab === "current" && (
            <CurrentTab
              snapshot={snapshot}
              loading={loadingCurrent}
              viewingHistorical={viewingSnapshotId !== null}
              onBackToLive={viewLiveSnapshot}
            />
          )}
          {tab === "history" && (
            <HistoryTab
              history={history}
              loading={loadingHistory}
              onSelect={viewHistoricalSnapshot}
            />
          )}
          {tab === "upload" && isAdmin && (
            <UploadTab
              uploading={uploading}
              error={uploadError}
              pasteText={pasteText}
              setPasteText={setPasteText}
              onFile={handleFileUpload}
              onPasteSubmit={handlePasteSubmit}
              onClearError={() => setUploadError(null)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function CurrentTab({
  snapshot,
  loading,
  viewingHistorical,
  onBackToLive,
}: {
  snapshot: UpworkProfileSnapshot | null;
  loading: boolean;
  viewingHistorical: boolean;
  onBackToLive: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading snapshot…
      </div>
    );
  }
  if (!snapshot) {
    return (
      <p className="text-sm text-muted-foreground py-6">
        No snapshot for this profile yet. Switch to the Upload tab to add one.
      </p>
    );
  }

  const data = (snapshot.data ?? {}) as SnapshotData;
  const identity = data.identity ?? {};
  const stats = data.stats ?? {};
  const skills = Array.isArray(data.skills) ? data.skills : [];
  const portfolio = Array.isArray(data.portfolio) ? data.portfolio : [];
  const workHistory = Array.isArray(data.workHistory) ? data.workHistory : [];
  const feedback = Array.isArray(data.feedback) ? data.feedback : [];

  return (
    <div className="space-y-5 pb-6 text-sm">
      {viewingHistorical && (
        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 flex items-center justify-between text-xs">
          <span>Viewing a historical snapshot from {formatDate(snapshot.extracted_at)}.</span>
          <Button size="sm" variant="ghost" onClick={onBackToLive} className="h-6 text-xs">
            Back to live
          </Button>
        </div>
      )}

      {/* Identity + extracted timestamp */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-semibold text-base">{identity.name ?? snapshot.name ?? "—"}</h3>
          <span className="text-xs text-muted-foreground shrink-0">
            extracted {formatDate(snapshot.extracted_at)}
          </span>
        </div>
        {identity.title && <p className="text-muted-foreground">{identity.title}</p>}
        <div className="flex flex-wrap gap-2 mt-1.5">
          {identity.location?.city && identity.location?.country && (
            <Badge variant="outline" className="text-xs">
              {identity.location.city}, {identity.location.country}
            </Badge>
          )}
          {identity.contractorTier != null && (
            <Badge variant="outline" className="text-xs">Tier {identity.contractorTier}</Badge>
          )}
          {identity.profileUrl && (
            <a
              href={identity.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="h-3 w-3" /> View on Upwork
            </a>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Rating" value={stats.rating != null ? `${stats.rating} ★` : "—"} />
        <Stat label="JSS" value={stats.jobSuccessScore != null ? `${stats.jobSuccessScore}` : "—"} />
        <Stat label="Hourly" value={stats.hourlyRate?.amount != null ? `$${stats.hourlyRate.amount}` : "—"} />
        <Stat label="Top Rated" value={stats.topRatedStatus ?? "—"} />
        <Stat label="Jobs" value={stats.totalJobsWorked != null ? `${stats.totalJobsWorked}` : "—"} />
        <Stat label="Hours" value={stats.totalHoursActual != null ? `${stats.totalHoursActual}` : "—"} />
        <Stat label="Last Worked" value={stats.lastWorkedOn ? formatDateOnly(stats.lastWorkedOn) : "—"} />
        <Stat label="Member Since" value={stats.memberSince ? formatDateOnly(stats.memberSince) : "—"} />
      </div>

      {/* Description */}
      {data.description && (
        <details className="rounded-md border bg-muted/30 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Description ({data.description.length} chars)
          </summary>
          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed">{data.description}</p>
        </details>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <Section title={`Skills (${skills.length})`}>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s, i) => (
              <Badge key={i} variant="secondary" className="text-xs">
                {s.name}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {/* Portfolio */}
      {portfolio.length > 0 && (
        <Section title={`Portfolio (${portfolio.length})`}>
          <div className="space-y-2">
            {portfolio.map((p, i) => (
              <div key={i} className="rounded-md border p-3 space-y-1">
                <div className="font-medium">{p.title ?? "Untitled"}</div>
                {p.description && (
                  <p className="text-xs text-muted-foreground line-clamp-3">{p.description}</p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Work history */}
      {workHistory.length > 0 && (
        <Section title={`Work History (${workHistory.length})`}>
          <div className="space-y-3">
            {workHistory.map((w, i) => (
              <div key={i} className="rounded-md border p-3 space-y-1.5 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{w.title ?? "Untitled"}</span>
                  <Badge variant="outline" className="text-[10px] shrink-0">{w.status ?? w.type ?? "?"}</Badge>
                </div>
                <div className="text-muted-foreground">
                  {w.startedOn && formatDateOnly(w.startedOn)}
                  {w.endedOn && ` – ${formatDateOnly(w.endedOn)}`}
                  {w.totalHours != null && ` · ${w.totalHours} hrs`}
                </div>
                {w.feedback?.comment && (
                  <p className="italic text-muted-foreground">
                    {w.feedback.score != null && (
                      <span className="not-italic font-medium text-foreground">{w.feedback.score}★ </span>
                    )}
                    &ldquo;{w.feedback.comment}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Feedback */}
      {feedback.length > 0 && (
        <Section title={`Client Feedback (${feedback.length})`}>
          <div className="space-y-3">
            {feedback.map((f, i) => (
              <div key={i} className="rounded-md border p-3 space-y-1.5 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{f.jobTitle ?? "Untitled"}</span>
                  <span className="shrink-0 inline-flex items-center gap-0.5">
                    <Star className="h-3 w-3 fill-current text-amber-500" />
                    <span>{f.rating ?? "?"}</span>
                  </span>
                </div>
                <div className="text-muted-foreground">
                  {f.date}
                  {f.clientName && ` · ${f.clientName}`}
                  {f.truncated && " · truncated"}
                </div>
                {f.comment && <p className="italic">{f.comment}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function HistoryTab({
  history,
  loading,
  onSelect,
}: {
  history: UpworkProfileSnapshotHistoryRow[];
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading history…
      </div>
    );
  }
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">No snapshots yet.</p>;
  }
  return (
    <div className="space-y-2 pb-6 text-sm">
      <p className="text-xs text-muted-foreground">
        Click a row to view that snapshot. The first row (badged &ldquo;current&rdquo;) is the live snapshot — same as the Current tab.
      </p>
      <div className="rounded-md border divide-y">
        {history.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(row.id)}
            className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors flex items-center gap-3 text-xs"
          >
            <div className="flex-1">
              <div className="font-medium">{formatDate(row.extracted_at)}</div>
              <div className="text-muted-foreground">
                {row.rating != null ? `${row.rating}★` : "—"} ·
                {" "}JSS {row.job_success_score ?? "—"} ·
                {" "}{row.total_jobs_worked ?? "?"} jobs ·
                {" "}{row.total_hours ?? "?"} hrs
              </div>
            </div>
            {row.is_current && <Badge variant="default" className="text-[10px]">current</Badge>}
          </button>
        ))}
      </div>
    </div>
  );
}

function UploadTab({
  uploading,
  error,
  pasteText,
  setPasteText,
  onFile,
  onPasteSubmit,
  onClearError,
}: {
  uploading: boolean;
  error: string | null;
  pasteText: string;
  setPasteText: (s: string) => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPasteSubmit: () => void;
  onClearError: () => void;
}) {
  return (
    <div className="space-y-4 pb-6 text-sm">
      <p className="text-xs text-muted-foreground">
        Upload a JSON produced by <code className="rounded bg-muted px-1">docs/profiles/extract-profile.js</code>.
        The current snapshot is preserved as history; the new one becomes the live snapshot.
      </p>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-3 py-2 flex items-start justify-between gap-3 text-xs">
          <span className="text-red-700 dark:text-red-400">{error}</span>
          <button onClick={onClearError} className="text-muted-foreground hover:text-foreground shrink-0">×</button>
        </div>
      )}

      {/* File upload */}
      <div className="rounded-md border border-dashed p-4 space-y-2">
        <label className="text-xs font-medium">Upload JSON file</label>
        <input
          type="file"
          accept="application/json,.json"
          onChange={onFile}
          disabled={uploading}
          className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-primary/90 file:cursor-pointer disabled:opacity-50"
        />
      </div>

      <div className="text-center text-xs text-muted-foreground">— or —</div>

      {/* Paste textarea */}
      <div className="rounded-md border p-4 space-y-2">
        <label className="text-xs font-medium">Paste JSON</label>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder='Paste the contents of e.g. Shayan.json here…'
          rows={8}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-xs font-mono"
          disabled={uploading}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={onPasteSubmit}
            disabled={uploading || !pasteText.trim()}
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
            Save snapshot
          </Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatDateOnly(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

// Minimal shape for the JSONB blob — mirrors docs/profiles/extract-profile.js output.
// Kept loose (any) on the parent SnapshotData type so the component renders gracefully
// when fields are missing (e.g. on profiles where the extractor found no work history).
type SnapshotData = {
  identity?: {
    name?: string;
    title?: string;
    profileUrl?: string;
    contractorTier?: number;
    location?: { city?: string; country?: string };
  };
  description?: string;
  stats?: {
    rating?: number;
    jobSuccessScore?: number;
    topRatedStatus?: string;
    totalJobsWorked?: number;
    totalHoursActual?: number;
    lastWorkedOn?: string;
    memberSince?: string;
    hourlyRate?: { amount?: number };
  };
  skills?: Array<{ name?: string }>;
  portfolio?: Array<{ title?: string; description?: string }>;
  workHistory?: Array<{
    title?: string;
    type?: string;
    status?: string;
    startedOn?: string;
    endedOn?: string;
    totalHours?: number;
    feedback?: { score?: number; comment?: string };
  }>;
  feedback?: Array<{
    jobTitle?: string;
    date?: string;
    rating?: number;
    clientName?: string;
    comment?: string;
    truncated?: boolean;
  }>;
};
