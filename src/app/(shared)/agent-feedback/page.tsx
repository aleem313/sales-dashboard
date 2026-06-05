import { Header } from "@/components/layout/header";
import { Separator } from "@/components/ui/separator";
import { getAllAgents, getAllProfiles, listAgentFeedback } from "@/lib/data";
import { AuditFilters } from "@/components/relevancy-audit/audit-filters";
import { AgentFeedbackTable } from "@/components/relevancy-audit/agent-feedback-table";
import { AutoRefresh } from "@/components/auto-refresh";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface SearchParams {
  range?: string;
  from?: string;
  to?: string;
  profile_ids?: string;
}

// Default window: last 24 hours — same as the Relevancy Audit page, so "same
// filters" means the same default windowing too. The picker widens it.
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

export default async function AgentFeedbackPage({
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

  const session = await auth();
  const isAdmin = session?.user?.role === "admin";
  // Agents see only their own feedback rows. Admins see all.
  const scopeAgentId = isAdmin ? null : (session?.user?.agentId ?? null);

  const [agents, profiles, agentFeedback] = await Promise.all([
    getAllAgents(),
    getAllProfiles(),
    listAgentFeedback({ scopeAgentId, from, to, profileIds, limit: 100 }),
  ]);

  return (
    <>
      {/* Auto-refresh every 15s so newly flagged classifications appear without a
          manual reload. Pauses when the tab is hidden (default). */}
      <AutoRefresh interval={15000} />
      <Header
        title="Agent Feedback"
        agents={agents}
        profiles={profiles}
        hideFilters
      />
      <main className="flex-1 overflow-y-auto bg-background">
        <div className="container mx-auto px-4 py-6 space-y-6">
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

          <Separator />

          <AuditFilters
            profiles={profiles}
            selectedProfileIds={profileIds ?? []}
            hideOverridden={false}
            basePath="/agent-feedback"
            showHideOverridden={false}
          />

          {agentFeedback.length === 0 ? (
            <div className="rounded-md border border-border p-6 text-center text-[13px] text-muted-foreground">
              {isAdmin
                ? "No agent feedback in this window. Try a wider date range."
                : "You haven't flagged any classifications in this window. Open a task card and click 'Mark wrong' in the AI Relevancy panel, or widen the date range."}
            </div>
          ) : (
            <AgentFeedbackTable rows={agentFeedback} showAgent={isAdmin} />
          )}
        </div>
      </main>
    </>
  );
}
