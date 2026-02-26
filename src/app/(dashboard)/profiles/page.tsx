import { Separator } from "@/components/ui/separator";
import { ProfileCard } from "@/components/profile-card";
import { getProfileStats } from "@/lib/data";

export const revalidate = 300;

export default async function ProfilesPage() {
  const profiles = await getProfileStats();

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profiles</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Performance tracking for all {profiles.length} Upwork profiles.
        </p>
      </div>

      <Separator />

      {profiles.length === 0 ? (
        <p className="text-muted-foreground">No profiles found. Add profiles in Settings.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {profiles.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} />
          ))}
        </div>
      )}
    </div>
  );
}
