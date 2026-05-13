"use client";

import { useState } from "react";
import { RejectRow } from "./reject-row";
import type { RelevancyAuditRejectRow } from "@/lib/data";

interface RejectsTableProps {
  rows: RelevancyAuditRejectRow[];
}

export function RejectsTable({ rows }: RejectsTableProps) {
  // Single-row-expanded state. Clicking the currently-open row collapses it;
  // clicking another row swaps the focus.
  const [expandedScoreId, setExpandedScoreId] = useState<number | null>(null);

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <table className="w-full text-[13.5px]">
        <thead className="bg-muted/50 text-[12px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Time</th>
            <th className="px-3 py-2 text-left font-semibold">Profile</th>
            <th className="px-3 py-2 text-left font-semibold">Job</th>
            <th className="px-3 py-2 text-right font-semibold">Score</th>
            <th className="px-3 py-2 text-left font-semibold">Tier</th>
            <th className="px-3 py-2 text-left font-semibold">Reasons</th>
            <th className="px-3 py-2 text-left font-semibold">Mode</th>
            <th className="px-3 py-2 text-right font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <RejectRow
              key={row.score_id}
              row={row}
              expanded={expandedScoreId === row.score_id}
              onToggleExpand={() =>
                setExpandedScoreId((id) => (id === row.score_id ? null : row.score_id))
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
