import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase } from "lucide-react";
import { formatNumber, formatCurrency } from "@/lib/utils";
import type { ProfileStats } from "@/lib/types";

export function TopProfiles({ profiles }: { profiles: ProfileStats[] }) {
  if (profiles.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Top Profiles by Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No profile data yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          Top Profiles by Volume
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {profiles.map((profile, i) => (
          <div key={profile.id} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium leading-none">{profile.profile_name}</p>
                <p className="text-xs text-muted-foreground">
                  {profile.stack ?? "No stack"} &middot; {formatCurrency(profile.total_revenue)}
                </p>
              </div>
            </div>
            <span className="text-sm font-semibold">
              {formatNumber(profile.total_jobs)} jobs
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
