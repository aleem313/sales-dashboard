import type { ConnectROI } from "@/lib/types";
import { CyberBadge } from "@/components/ui/cyber-badge";

interface ConnectROITableProps {
  data: ConnectROI[];
}

function roiSignal(roi: ConnectROI) {
  if (roi.wins === 0) {
    return roi.connects_spent > 80
      ? { label: "PAUSE", variant: "danger" as const }
      : { label: "REVIEW", variant: "danger" as const };
  }
  const costPerWin = roi.cost_per_win ?? Infinity;
  if (costPerWin <= 100) return { label: "INVEST MORE", variant: "green" as const };
  if (costPerWin <= 150) return { label: "OPTIMIZE", variant: "warn" as const };
  return { label: "REVIEW", variant: "danger" as const };
}

export function ConnectROITable({ data }: ConnectROITableProps) {
  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[13px] font-bold tracking-[0.03em]">
          Connect ROI by Niche
        </h3>
        <span className="rounded-md bg-accent-green/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.1em] text-accent-green">
          Optimization View
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Niche", "Connects Spent", "Wins", "Cost / Win", "ROI Signal"].map(
                (h) => (
                  <th
                    key={h}
                    className="border-b border-border px-3 py-2.5 text-left text-[9px] font-normal uppercase tracking-[0.15em] text-muted-foreground"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const signal = roiSignal(row);
              return (
                <tr key={row.niche} className="hover:bg-secondary">
                  <td className="border-b border-border px-3 py-2.5 text-[11px]">
                    {row.niche}
                  </td>
                  <td className="border-b border-border px-3 py-2.5 text-[11px]">
                    {row.connects_spent}
                  </td>
                  <td
                    className="border-b border-border px-3 py-2.5 text-[11px]"
                    style={{ color: row.wins > 0 ? "var(--accent-green)" : undefined }}
                  >
                    {row.wins}
                  </td>
                  <td
                    className="border-b border-border px-3 py-2.5 text-[11px]"
                    style={{
                      color: row.cost_per_win
                        ? row.cost_per_win <= 100
                          ? "var(--accent-green)"
                          : "var(--accent-warn)"
                        : "var(--destructive)",
                    }}
                  >
                    {row.cost_per_win ?? "∞"}
                  </td>
                  <td className="border-b border-border px-3 py-2.5 text-[11px]">
                    <CyberBadge variant={signal.variant}>
                      {signal.label}
                    </CyberBadge>
                  </td>
                </tr>
              );
            })}
            {data.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-[11px] text-muted-foreground"
                >
                  No connects data yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
