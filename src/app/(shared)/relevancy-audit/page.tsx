import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import {
  getAllAgents,
  getAllProfiles,
  listAgentFeedback,
  listRelevancyAuditRejects,
} from "@/lib/data";
import { AuditFilters } from "@/components/relevancy-audit/audit-filters";
import { RejectsTable } from "@/components/relevancy-audit/rejects-table";
import { AgentFeedbackTable } from "@/components/relevancy-audit/agent-feedback-table";
import { AutoRefresh } from "@/components/auto-refresh";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface SearchParams {
  range?: string;
  from?: string;
  to?: string;
  profile_ids?: string;
  hide_overridden?: string;
}

// Default window: last 24 hours (vs the dashboard's "today" default — the audit
// page is for catching just-shipped wrong-rejects, so 24h gives the admin
// rolling visibility without paging back to midnight).
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
  return { from: new Date(now.getTime() - 24 * 60 * 60 * 1000), to: now };
}

export default async function RelevancyAuditPage({
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

  // Default = true; only the literal string "false" disables hide-overridden.
  const hideOverridden = params.hide_overridden !== "false";

  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  // Agents see only their own feedback rows. Admins see all.
  const scopeAgentId = isAdmin ? null : (session?.user?.agentId ?? null);

  const [agents, profiles, rejects, agentFeedback] = await Promise.all([
    getAllAgents(),
    getAllProfiles(),
    listRelevancyAuditRejects({ from, to, profileIds, hideOverridden }),
    listAgentFeedback({ scopeAgentId, limit: 100 }),
  ]);

  return (
    <>
      {/* Auto-refresh every 15s so newly classified rejects appear without a
          manual reload. Pauses when the tab is hidden (default) so we don't
          burn the DB doing nothing useful. */}
      <AutoRefresh interval={15000} />
      <Header
        title="Relevancy Audit"
        agents={agents}
        profiles={profiles}
        hideFilters
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="container mx-auto px-4 py-6 space-y-6">
          <div className="space-y-1">
            <p className="text-[13px] text-muted-foreground">
              Review classifier rejects from the last 24 hours (or chosen window).
              Mark any that look wrong so we can calibrate before flipping the
              classifier to Active mode.
            </p>
          </div>

          <Separator />

          <AuditFilters
            profiles={profiles}
            selectedProfileIds={profileIds ?? []}
            hideOverridden={hideOverridden}
          />

          <div className="flex items-center justify-between text-[13px] text-muted-foreground">
            <span>
              {rejects.total === 0
                ? "No rejected verdicts in this window."
                : `${rejects.total} reject${rejects.total === 1 ? "" : "s"} in window${
                    rejects.rows.length < rejects.total
                      ? ` (showing top ${rejects.rows.length})`
                      : ""
                  }`}
            </span>
          </div>

          {rejects.rows.length === 0 ? (
            <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
              No rejected verdicts in this window. Try a wider date range or
              toggling &ldquo;Hide overridden&rdquo;.
            </div>
          ) : (
            <RejectsTable rows={rejects.rows} />
          )}

          <Separator />

          <div className="space-y-2">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">
                Agent Feedback on AI Classifications
              </h2>
              <p className="text-[13px] text-muted-foreground">
                {isAdmin
                  ? "Agents flagging specific reasons as wrong, with their comments. Use this signal to recalibrate the classifier prompt."
                  : "Your previously flagged classifications. The criteria team reviews these to recalibrate the AI."}
              </p>
            </div>
            {agentFeedback.length === 0 ? (
              <div className="rounded-md border border-border p-6 text-center text-[13px] text-muted-foreground">
                {isAdmin
                  ? "No agent feedback recorded yet."
                  : "You haven't flagged any classifications yet. Open a task card and click 'Mark wrong' in the AI Relevancy panel."}
              </div>
            ) : (
              <AgentFeedbackTable rows={agentFeedback} showAgent={isAdmin} />
            )}
          </div>
        </div>
      </main>
    </>
  );
}
