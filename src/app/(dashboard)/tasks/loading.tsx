export default function TasksLoading() {
  return (
    <div className="flex h-full gap-4 overflow-x-auto px-6 py-4">
      {[1, 2, 3].map((col) => (
        <div key={col} className="w-[280px] shrink-0">
          <div className="mb-3 flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
            <div className="ml-auto h-5 w-8 rounded-full bg-muted animate-pulse" />
          </div>
          <div className="space-y-2">
            {[1, 2, 3].map((card) => (
              <div key={card} className="rounded-lg border bg-card p-3">
                <div className="h-3 w-16 rounded bg-muted animate-pulse mb-2" />
                <div className="h-4 w-full rounded bg-muted animate-pulse mb-1" />
                <div className="h-4 w-2/3 rounded bg-muted animate-pulse mb-3" />
                <div className="flex justify-between">
                  <div className="flex -space-x-1">
                    <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />
                    <div className="h-6 w-6 rounded-full bg-muted animate-pulse" />
                  </div>
                  <div className="h-4 w-12 rounded bg-muted animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
