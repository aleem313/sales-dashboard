import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent, formatNumber } from "@/lib/utils";
import type { ProfileStats } from "@/lib/types";

export function ProfileCard({ profile }: { profile: ProfileStats }) {
  return (
    <Link href={`/profiles/${profile.id}`}>
      <Card className="hover:border-primary/50 transition-colors">
        <CardContent className="pt-6">
          <div className="space-y-3">
            <div>
              <h3 className="font-semibold">{profile.profile_name}</h3>
              {profile.stack && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {profile.stack.split(", ").map((s) => (
                    <Badge key={s} variant="outline" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {profile.total_jobs === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs received yet</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Total Jobs</p>
                  <p className="font-medium">{formatNumber(profile.total_jobs)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Win Rate</p>
                  <p className="font-medium">
                    {profile.win_rate_pct !== null ? formatPercent(profile.win_rate_pct) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Avg Won Value</p>
                  <p className="font-medium">
                    {profile.avg_won_value !== null
                      ? formatCurrency(profile.avg_won_value)
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Revenue</p>
                  <p className="font-medium">{formatCurrency(profile.total_revenue)}</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
