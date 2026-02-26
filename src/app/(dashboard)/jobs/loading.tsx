export default function JobsLoading() {
  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-16 bg-muted animate-pulse rounded" />
        <div className="h-4 w-56 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-px bg-border" />

      {/* Filter bar skeleton */}
      <div className="flex flex-wrap items-center gap-2">
        {[48, 150, 150, 150, 130, 120].map((w, i) => (
          <div
            key={i}
            className="h-9 bg-muted animate-pulse rounded-md"
            style={{ width: `${w}px` }}
          />
        ))}
      </div>

      {/* Table skeleton */}
      <div className="rounded-md border">
        <div className="border-b px-4 py-3 flex gap-4">
          {["flex-1", "w-24 hidden sm:block", "w-24 hidden md:block", "w-28 hidden md:block", "w-20", "w-24 hidden lg:block"].map(
            (cls, i) => (
              <div key={i} className={`h-4 bg-muted animate-pulse rounded ${cls}`} />
            )
          )}
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="border-b px-4 py-3 flex gap-4">
            <div className="h-4 flex-1 bg-muted animate-pulse rounded" />
            <div className="h-4 w-24 hidden sm:block bg-muted animate-pulse rounded" />
            <div className="h-4 w-24 hidden md:block bg-muted animate-pulse rounded" />
            <div className="h-4 w-28 hidden md:block bg-muted animate-pulse rounded" />
            <div className="h-5 w-16 bg-muted animate-pulse rounded-full" />
            <div className="h-4 w-24 hidden lg:block bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
