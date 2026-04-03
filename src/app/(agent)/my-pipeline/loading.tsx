export default function Loading() {
  return (
    <div className="flex-1 overflow-y-auto bg-background p-6">
      <div className="h-8 w-48 bg-muted animate-pulse rounded mb-6" />
      <div className="grid grid-cols-5 gap-4 mb-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-muted animate-pulse rounded-xl" />
    </div>
  );
}
