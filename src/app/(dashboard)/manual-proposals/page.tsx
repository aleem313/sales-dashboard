import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import { getAllAgents, getAllProfiles, listManualProposals } from "@/lib/data";
import { AuditFilters } from "@/components/relevancy-audit/audit-filters";
import { ManualProposalsTable } from "@/components/manual-proposals/manual-proposals-table";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

interface SearchParams {
  range?: string;
  from?: string;
  to?: string;
  profile_ids?: string;
}

// Default window: last 30 days. Manual proposals are low-volume (one per agent
// who chose to hand-write instead of using the AI draft), so a wider default than
// the relevancy-audit page's 24h gives the admin useful visibility without paging.
function resolveWindow(params: SearchParams): { from: Date; to: Date } {
  const now = new Date();
  if (params.from && params.to) {
    const f = new Date(params.from);
    const t = new Date(params.to);
    if (!isNaN(f.getTime()) && !isNaN(t.getTime())) {
      return { from: f, to: t };
    }
  }
  if (params.range) {
    const ms: Record<string, number> = {
      today: 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "14d": 14 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    const span = ms[params.range];
    if (span) return { from: new Date(now.getTime() - span), to: now };
  }
  return { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };
}

export default async function ManualProposalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { from, to } = resolveWindow(params);

  const profileIdsRaw = typeof params.profile_ids === "string" ? params.profile_ids : "";
  const profileIds = profileIdsRaw
    ? profileIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  const [agents, profiles, manual] = await Promise.all([
    getAllAgents(),
    getAllProfiles(),
    listManualProposals({ from, to, profileIds }),
  ]);

  return (
    <>
      <AutoRefresh interval={15000} />
      <Header title="Manual Proposals" agents={agents} profiles={profiles} hideFilters />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="container mx-auto px-4 py-6 space-y-6">
          <div className="space-y-1">
            <p className="text-[13px] text-muted-foreground">
              Proposals agents wrote by hand and pasted onto a card (instead of using the AI
              draft). These are recorded for review and training — they do not change the
              proposal shown on the card.
            </p>
          </div>

          <Separator />

          <AuditFilters
            profiles={profiles}
            selectedProfileIds={profileIds ?? []}
            hideOverridden={false}
            basePath="/manual-proposals"
            showHideOverridden={false}
          />

          <div className="flex items-center justify-between text-[13px] text-muted-foreground">
            <span>
              {manual.total === 0
                ? "No manual proposals in this window."
                : `${manual.total} manual proposal${manual.total === 1 ? "" : "s"} in window${
                    manual.rows.length < manual.total
                      ? ` (showing top ${manual.rows.length})`
                      : ""
                  }`}
            </span>
          </div>

          {manual.rows.length === 0 ? (
            <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
              No manual proposals in this window. Try a wider date range.
            </div>
          ) : (
            <ManualProposalsTable rows={manual.rows} />
          )}
        </div>
      </main>
    </>
  );
}
