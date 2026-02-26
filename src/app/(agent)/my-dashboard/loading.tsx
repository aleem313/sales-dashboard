export default function MyDashboardLoading() {
  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-40 bg-muted animate-pulse rounded" />
        <div className="h-4 w-64 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-px bg-border" />
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-6 space-y-3">
            <div className="h-4 w-24 bg-muted animate-pulse rounded" />
            <div className="h-8 w-32 bg-muted animate-pulse rounded" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="h-5 w-40 bg-muted animate-pulse rounded" />
        <div className="h-[350px] bg-muted animate-pulse rounded" />
      </div>
    </div>
  );
}
