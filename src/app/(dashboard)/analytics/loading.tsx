import { Separator } from "@/components/ui/separator";

function ChartSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <div className="h-5 w-36 bg-muted animate-pulse rounded" />
      <div className="h-[350px] bg-muted animate-pulse rounded" />
    </div>
  );
}

export default function AnalyticsLoading() {
  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div>
        <div className="h-7 w-32 bg-muted animate-pulse rounded" />
        <div className="h-4 w-64 bg-muted animate-pulse rounded mt-2" />
      </div>

      <Separator />

      <ChartSkeleton />

      <div className="grid gap-4 md:grid-cols-2">
        <ChartSkeleton />
        <ChartSkeleton />
      </div>

      <ChartSkeleton />
    </div>
  );
}
