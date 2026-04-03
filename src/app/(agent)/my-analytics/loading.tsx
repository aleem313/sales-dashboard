export default function Loading() {
  return (
    <div className="flex-1 overflow-y-auto bg-background p-6">
      <div className="h-8 w-48 bg-muted animate-pulse rounded mb-6" />
      <div className="space-y-6">
        <div className="h-64 bg-muted animate-pulse rounded-xl" />
        <div className="grid grid-cols-2 gap-6">
          <div className="h-48 bg-muted animate-pulse rounded-xl" />
          <div className="h-48 bg-muted animate-pulse rounded-xl" />
        </div>
        <div className="h-48 bg-muted animate-pulse rounded-xl" />
      </div>
    </div>
  );
}
