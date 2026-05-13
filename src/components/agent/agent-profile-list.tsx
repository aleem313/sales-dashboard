import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UserCircle, Star, FileText } from "lucide-react";
import { ProfileUpworkSnapshotSheet } from "@/components/settings/profile-upwork-snapshot";
import type { Profile } from "@/lib/types";

type SnapshotSummary = {
  extractedAt: string;
  name: string | null;
  rating: number | null;
  jobSuccessScore: number | null;
  totalJobsWorked: number | null;
};

export function AgentProfileList({
  profiles,
  snapshotSummaries,
}: {
  profiles: Profile[];
  snapshotSummaries: Record<string, SnapshotSummary>;
}) {
  if (profiles.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No profiles are assigned to you yet. Ask an admin to assign one.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 px-4 py-3 text-sm">
        <p className="font-medium mb-1">Keep your profile snapshots fresh</p>
        <p className="text-muted-foreground text-xs">
          The relevancy classifier scores jobs against your most recent Upwork
          profile snapshot. When you update your profile on Upwork (new skills,
          new portfolio, new feedback), upload a fresh snapshot here so the
          classifier sees the updated data. Click <strong>Snapshot</strong> on
          any profile, switch to the Upload tab, and follow the instructions.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {profiles.map((profile) => {
          const summary = snapshotSummaries[profile.profile_id];
          const hasSnapshot = !!summary;
          return (
            <Card key={profile.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    <CardTitle className="text-base flex items-center gap-2">
                      <UserCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate">{profile.profile_name}</span>
                    </CardTitle>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.platform && (
                        <Badge variant="outline" className="text-[10px]">
                          {profile.platform}
                        </Badge>
                      )}
                      {profile.stack && (
                        <Badge variant="secondary" className="text-[10px]">
                          {profile.stack}
                        </Badge>
                      )}
                      {!profile.active && (
                        <Badge variant="destructive" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {hasSnapshot ? (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate">
                        {summary.name ?? "—"}
                      </span>
                      <span className="text-muted-foreground shrink-0">
                        {formatRelative(summary.extractedAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                        {summary.rating != null ? summary.rating.toFixed(2) : "—"}
                      </span>
                      <span>
                        JSS {summary.jobSuccessScore ?? "—"}
                      </span>
                      <span>
                        {summary.totalJobsWorked ?? "?"} jobs
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span>No snapshot uploaded yet. Click Snapshot to add one.</span>
                  </div>
                )}

                <div className="flex justify-end">
                  <ProfileUpworkSnapshotSheet
                    profileUuid={profile.id}
                    profileName={profile.profile_name}
                    hasSnapshot={hasSnapshot}
                    isAdmin={false}
                  />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  } catch {
    return iso;
  }
}
