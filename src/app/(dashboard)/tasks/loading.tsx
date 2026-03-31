export default function TasksLoading() {
  return (
    <>
      {/* Board header skeleton */}
      <div className="flex items-center justify-between border-b px-4 py-2.5 gap-3 bg-card/50">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 rounded bg-muted animate-pulse" />
          <div className="h-8 w-[200px] rounded bg-muted animate-pulse" />
          <div className="hidden sm:flex -space-x-1.5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-6 w-6 rounded-full bg-muted animate-pulse ring-2 ring-card" />
            ))}
          </div>
          <div className="h-7 w-8 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-8 w-24 rounded bg-muted animate-pulse" />
      </div>

      {/* Board columns skeleton */}
      <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
        {[1, 2, 3, 4].map((col) => (
          <div key={col} className="w-[280px] shrink-0">
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-muted animate-pulse" />
              <div className="h-4 w-20 rounded bg-muted animate-pulse" />
              <div className="ml-auto h-5 w-6 rounded-full bg-muted animate-pulse" />
              <div className="h-5 w-5 rounded bg-muted animate-pulse" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: col === 1 ? 3 : col === 4 ? 1 : 2 }).map((_, i) => (
                <div key={i} className="rounded-lg border bg-card p-3">
                  <div className="h-3 w-16 rounded bg-muted animate-pulse mb-2" />
                  <div className="h-4 w-full rounded bg-muted animate-pulse mb-1" />
                  <div className="h-4 w-2/3 rounded bg-muted animate-pulse mb-3" />
                  <div className="flex justify-between">
                    <div className="flex -space-x-1">
                      <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />
                      {col < 3 && <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />}
                    </div>
                    <div className="h-4 w-10 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
