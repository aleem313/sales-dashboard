export default function ProfileDetailLoading() {
  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-7 w-56 bg-muted animate-pulse rounded" />
          <div className="h-5 w-16 bg-muted animate-pulse rounded-full" />
        </div>
        <div className="flex flex-wrap gap-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-5 w-20 bg-muted animate-pulse rounded-full" />
          ))}
        </div>
        <div className="h-4 w-36 bg-muted animate-pulse rounded" />
      </div>

      <div className="h-px bg-border" />

      {/* KPI cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-4 space-y-2">
            <div className="h-3 w-20 bg-muted animate-pulse rounded" />
            <div className="h-6 w-16 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>

      {/* Volume chart (full width) */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="h-5 w-40 bg-muted animate-pulse rounded" />
        <div className="h-[350px] bg-muted animate-pulse rounded" />
      </div>

      {/* Two charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {[1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-6 space-y-4">
            <div className="h-5 w-36 bg-muted animate-pulse rounded" />
            <div className="h-[350px] bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>

      {/* Jobs table */}
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="h-4 w-32 bg-muted animate-pulse rounded" />
        <div className="space-y-3">
          <div className="flex gap-4">
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            <div className="h-4 w-16 bg-muted animate-pulse rounded" />
            <div className="h-4 w-20 bg-muted animate-pulse rounded" />
          </div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 w-48 bg-muted animate-pulse rounded" />
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              <div className="h-4 w-16 bg-muted animate-pulse rounded" />
              <div className="h-4 w-20 bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
