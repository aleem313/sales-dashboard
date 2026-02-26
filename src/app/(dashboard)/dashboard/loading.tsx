export default function DashboardLoading() {
  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 bg-muted animate-pulse rounded" />
          <div className="h-4 w-64 bg-muted animate-pulse rounded" />
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-14 bg-muted animate-pulse rounded" />
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      {/* KPI cards skeleton */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-6 space-y-3">
            <div className="flex justify-between">
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <div className="h-4 w-4 bg-muted animate-pulse rounded" />
            </div>
            <div className="h-8 w-32 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>

      {/* Revenue chart skeleton */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="h-5 w-40 bg-muted animate-pulse rounded" />
        <div className="h-[350px] bg-muted animate-pulse rounded" />
      </div>

      {/* Two charts skeleton */}
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-6 space-y-4">
            <div className="h-5 w-36 bg-muted animate-pulse rounded" />
            <div className="h-[350px] bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>

      {/* Three cards skeleton */}
      <div className="grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-6 space-y-4">
            <div className="h-5 w-40 bg-muted animate-pulse rounded" />
            <div className="space-y-3">
              {[1, 2, 3].map((j) => (
                <div key={j} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-6 w-6 bg-muted animate-pulse rounded-full" />
                    <div className="space-y-1">
                      <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                      <div className="h-3 w-32 bg-muted animate-pulse rounded" />
                    </div>
                  </div>
                  <div className="h-4 w-12 bg-muted animate-pulse rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="h-5 w-32 bg-muted animate-pulse rounded" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            <div className="h-4 w-16 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
