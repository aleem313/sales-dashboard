import { MobileSidebar } from "./sidebar";

export function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex h-14 items-center gap-4 border-b bg-card px-4 md:px-6">
      <MobileSidebar />
      <div className="flex flex-1 items-center justify-between gap-4">
        {children}
      </div>
    </header>
  );
}
