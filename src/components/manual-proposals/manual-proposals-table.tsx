"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { copyText } from "@/lib/utils";
import type { ManualProposalListRow } from "@/lib/data";

interface Props {
  rows: ManualProposalListRow[];
}

// Best-effort Upwork job URL from the stored external id (e.g. "~0220…") when the
// card never carried a canonical _job_url. Mirrors reject-row's derivation.
function deriveJobUrl(row: ManualProposalListRow): string | null {
  if (row.job_url) return row.job_url;
  if (row.job_external_id) {
    const id = row.job_external_id.startsWith("~") ? row.job_external_id : `~${row.job_external_id}`;
    return `https://www.upwork.com/jobs/${id}`;
  }
  return null;
}

export function ManualProposalsTable({ rows }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [list, setList] = useState<ManualProposalListRow[]>(rows);

  async function handleDelete(row: ManualProposalListRow) {
    if (!confirm("Delete this manual proposal record? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/tasks/${row.task_id}/proposal-feedback`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedback_id: row.feedback_id }),
      });
      if (res.ok || res.status === 204) {
        setList((prev) => prev.filter((r) => r.feedback_id !== row.feedback_id));
        toast.success("Deleted");
      } else {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete");
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-[13.5px]">
        <thead className="bg-muted/50 text-[12px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Time</th>
            <th className="px-3 py-2 text-left font-semibold">Agent</th>
            <th className="px-3 py-2 text-left font-semibold">Profile</th>
            <th className="px-3 py-2 text-left font-semibold">Job / Task</th>
            <th className="px-3 py-2 text-left font-semibold">Note</th>
            <th className="px-3 py-2 text-right font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {list.map((row) => {
            const isOpen = expanded === row.feedback_id;
            const jobUrl = deriveJobUrl(row);
            const author = row.author_name ?? (row.author_role === "admin" ? "Admin" : "Agent");
            return (
              <Fragment key={row.feedback_id}>
                <tr
                  className="border-t border-border hover:bg-muted/30 cursor-pointer align-top"
                  onClick={() => setExpanded(isOpen ? null : row.feedback_id)}
                >
                  <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                    {format(new Date(row.created_at), "MMM d, h:mm a")}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{author}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{row.profile_name ?? "—"}</td>
                  <td className="px-3 py-2.5 max-w-[260px]">
                    <span className="line-clamp-1">{row.task_title ?? "Untitled task"}</span>
                  </td>
                  <td className="px-3 py-2.5 max-w-[280px] text-muted-foreground">
                    <span className="line-clamp-1">{row.note ?? "—"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
                      {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      {isOpen ? "Hide" : "View"}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-t border-border bg-muted/20">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3 text-[12px]">
                          <Link
                            href={`/tasks?task=${row.task_id}`}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <SquareArrowOutUpRight className="h-3.5 w-3.5" /> Open task card
                          </Link>
                          {jobUrl && (
                            <a
                              href={jobUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            >
                              <ExternalLink className="h-3.5 w-3.5" /> Open on Upwork
                            </a>
                          )}
                          <button
                            onClick={() =>
                              copyText(row.proposal_text ?? "").then((ok) =>
                                ok ? toast.success("Copied") : toast.error("Copy failed")
                              )
                            }
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="h-3.5 w-3.5" /> Copy proposal
                          </button>
                          <button
                            onClick={() => handleDelete(row)}
                            className="inline-flex items-center gap-1 text-muted-foreground hover:text-red-600 ml-auto"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Delete
                          </button>
                        </div>

                        {row.note && (
                          <div>
                            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                              Agent note
                            </div>
                            <p className="text-[13px] leading-relaxed">{row.note}</p>
                          </div>
                        )}

                        <div>
                          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1">
                            Proposal
                          </div>
                          <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded bg-background border border-border p-3 text-[13px] leading-relaxed">
                            {row.proposal_text ?? "(empty)"}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
