export default function MyPerformanceLoading() {
  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-44 bg-muted animate-pulse rounded" />
        <div className="h-4 w-56 bg-muted animate-pulse rounded" />
      </div>
      <div className="h-px bg-border" />
      {[1, 2].map((i) => (
        <div key={i} className="rounded-xl border bg-card p-6 space-y-4">
          <div className="h-5 w-40 bg-muted animate-pulse rounded" />
          <div className="h-[350px] bg-muted animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
