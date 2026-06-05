"use client";

import { formatDistanceToNow } from "date-fns";
import type { AgentFeedbackListRow } from "@/lib/data";
import { OVERALL_DECISION_FLAG } from "@/components/tasks/relevancy-feedback-form";

interface Props {
  rows: AgentFeedbackListRow[];
  // When false (agent viewer), hide the agent column since every row is theirs.
  showAgent: boolean;
}

function relativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export function AgentFeedbackTable({ rows, showAgent }: Props) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-[13.5px]">
        <thead className="bg-muted/50 text-[12px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">When</th>
            {showAgent && (
              <th className="px-3 py-2 text-left font-semibold">Agent</th>
            )}
            <th className="px-3 py-2 text-left font-semibold">Job</th>
            <th className="px-3 py-2 text-left font-semibold">Verdict</th>
            <th className="px-3 py-2 text-left font-semibold">Flagged as wrong</th>
            <th className="px-3 py-2 text-left font-semibold">Comment</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const reasons = row.override_reason ?? [];
            const flaggedDecision = reasons.includes(OVERALL_DECISION_FLAG);
            const specificReasons = reasons.filter((r) => r !== OVERALL_DECISION_FLAG);
            const taskHref = row.task_id ? `/tasks/${row.task_id}` : null;
            return (
              <tr key={row.feedback_id} className="border-t border-border align-top">
                <td className="px-3 py-2 text-[12.5px] text-muted-foreground whitespace-nowrap">
                  {relativeTime(row.created_at)}
                </td>
                {showAgent && (
                  <td className="px-3 py-2 text-[13px] whitespace-nowrap">
                    {row.agent_name ?? "—"}
                  </td>
                )}
                <td className="px-3 py-2 max-w-[280px]">
                  <div className="flex items-center gap-2">
                    {taskHref ? (
                      <a
                        href={taskHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-foreground hover:underline underline-offset-2 truncate"
                        title={row.job_title ?? row.task_title ?? ""}
                      >
                        {row.job_title ?? row.task_title ?? `Score #${row.score_id}`}
                      </a>
                    ) : (
                      <span className="text-muted-foreground truncate">
                        {row.job_title ?? `Score #${row.score_id}`}
                      </span>
                    )}
                    {row.job_url && (
                      <a
                        href={row.job_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-blue-600 hover:underline whitespace-nowrap"
                      >
                        Upwork ↗
                      </a>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Score #{row.score_id}</div>
                </td>
                <td className="px-3 py-2 text-[12.5px]">
                  <span
                    className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      row.classifier_decision === "reject"
                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : row.classifier_decision === "proceed"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {row.classifier_decision}
                  </span>
                </td>
                <td className="px-3 py-2 text-[12.5px]">
                  <div className="flex flex-wrap gap-1">
                    {specificReasons.map((r) => (
                      <span
                        key={r}
                        className="inline-flex rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                      >
                        {r}
                      </span>
                    ))}
                    {flaggedDecision && (
                      <span className="inline-flex rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                        overall decision
                      </span>
                    )}
                    {reasons.length === 0 && (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-[12.5px] max-w-[300px]">
                  {row.note ? (
                    <span className="italic text-foreground/80">&ldquo;{row.note}&rdquo;</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
