import { Header } from "@/components/layout/header";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { ProfileGridCard } from "@/components/profiles/profile-grid-card";
import { getEnhancedProfileStats, getAllAgents, getAllProfiles } from "@/lib/data";
import { parseDateRange } from "@/lib/date-utils";

export const revalidate = 300;

export default async function ProfilesPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string; agent?: string; profile?: string }>;
}) {
  const params = await searchParams;
  const agentId = typeof params.agent === "string" ? params.agent : undefined;
  const profileId = typeof params.profile === "string" ? params.profile : undefined;
  const range = parseDateRange(params);

  const [profiles, allAgents, allProfiles] = await Promise.all([
    getEnhancedProfileStats(range, agentId, profileId),
    getAllAgents(),
    getAllProfiles(),
  ]);

  const active = profiles.length;
  const avgResponseRate =
    active > 0
      ? Math.round(profiles.reduce((s, p) => s + p.response_rate, 0) / active)
      : 0;
  const avgInterviewRate =
    active > 0
      ? Math.round(profiles.reduce((s, p) => s + p.interview_rate, 0) / active)
      : 0;

  const bestNiche = [...profiles].sort(
    (a, b) => b.interview_rate - a.interview_rate
  )[0];
  const weakest = [...profiles].sort(
    (a, b) => a.response_rate - b.response_rate
  )[0];

  // Top 2 profiles by response rate
  const topIds = new Set(
    [...profiles]
      .sort((a, b) => b.response_rate - a.response_rate)
      .slice(0, 2)
      .map((p) => p.id)
  );

  return (
    <>
      <Header
          title="Profile Analytics"
          agents={allAgents}
          profiles={allProfiles}
        />
      <main className="flex-1 overflow-y-auto bg-background p-6 md:p-7">
        <StatRow className="mb-5">
          <StatCard label="Active Profiles" value={active} variant="accent" delta="All operational" />
          <StatCard
            label="Avg Response Rate"
            value={`${avgResponseRate}%`}
            delta="Across all profiles"
          />
          <StatCard
            label="Avg Interview Rate"
            value={`${avgInterviewRate}%`}
            variant="warn"
          />
          <StatCard
            label="Best Niche"
            value={bestNiche?.niche || bestNiche?.stack || "—"}
            variant="green"
            delta={bestNiche ? `${bestNiche.interview_rate}% interview rate` : undefined}
          />
          <StatCard
            label="Weakest Profile"
            value={weakest?.profile_name || "—"}
            variant="warn"
            delta={weakest ? `${weakest.response_rate}% response rate` : undefined}
            deltaDown
          />
        </StatRow>

        <div className="rounded-[10px] border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
            <h3 className="font-heading text-[15px] font-bold tracking-[0.03em]">
              All {active} Profiles · Performance Overview
            </h3>
            <span className="rounded-md bg-[var(--accent-light)] px-2 py-0.5 text-[12px] font-medium uppercase tracking-[0.1em] text-[var(--primary)]">
              This Period
            </span>
          </div>
          <div className="p-[18px]">
            {profiles.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground">
                No profiles found.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {profiles.map((profile) => (
                  <ProfileGridCard
                    key={profile.id}
                    profile={profile}
                    isTop={topIds.has(profile.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
