import type { EnhancedProfileStats } from "@/lib/types";
import { CyberBadge } from "@/components/ui/cyber-badge";

interface TopProfilesTableProps {
  profiles: EnhancedProfileStats[];
}

const nicheBadgeVariant = (niche: string | null) => {
  if (!niche) return "muted" as const;
  const n = niche.toLowerCase();
  if (n.includes("saas") || n.includes("dev")) return "blue" as const;
  if (n.includes("ai") || n.includes("ml")) return "purple" as const;
  if (n.includes("design")) return "warn" as const;
  if (n.includes("auto")) return "green" as const;
  return "muted" as const;
};

export function TopProfilesTable({ profiles }: TopProfilesTableProps) {
  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <h3 className="font-heading text-[15px] font-bold tracking-[0.03em]">
          Top Performing Profiles
        </h3>
        <span className="rounded-md bg-accent-green/10 px-2 py-0.5 text-[12px] font-medium uppercase tracking-[0.1em] text-accent-green">
          Win Rate
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="border-b border-border px-3 py-2.5 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Profile
              </th>
              <th className="border-b border-border px-3 py-2.5 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Niche
              </th>
              <th className="border-b border-border px-3 py-2.5 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Proposals
              </th>
              <th className="border-b border-border px-3 py-2.5 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Interview %
              </th>
              <th className="border-b border-border px-3 py-2.5 text-left text-[12px] font-normal uppercase tracking-[0.15em] text-muted-foreground">
                Won
              </th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="hover:bg-secondary">
                <td className="border-b border-border px-3 py-2.5 text-[13.5px] font-semibold">
                  {p.profile_name}
                </td>
                <td className="border-b border-border px-3 py-2.5 text-[13.5px]">
                  <CyberBadge variant={nicheBadgeVariant(p.niche)}>
                    {p.niche || "—"}
                  </CyberBadge>
                </td>
                <td className="border-b border-border px-3 py-2.5 text-[13.5px]">
                  {p.total_jobs}
                </td>
                <td className="border-b border-border px-3 py-2.5 text-[13.5px]" style={{ color: p.interview_rate >= 30 ? "var(--accent-green)" : p.interview_rate >= 15 ? "var(--accent-warn)" : "var(--foreground)" }}>
                  {p.interview_rate}%
                </td>
                <td className="border-b border-border px-3 py-2.5 font-mono-data text-[13.5px] font-bold text-accent-green">
                  {p.won}
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[13.5px] text-muted-foreground">
                  No profile data yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
