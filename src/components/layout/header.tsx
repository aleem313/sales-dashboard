import { MobileSidebar } from "./sidebar";
import { HeaderControls } from "./header-controls";
import { ActiveFilterBar } from "./active-filter-bar";
import type { Agent, Profile } from "@/lib/types";

interface HeaderProps {
  title?: string;
  subtitle?: string;
  agents?: Agent[];
  profiles?: Profile[];
  hideFilters?: boolean;
  hideAgentFilter?: boolean;
  hideDatePicker?: boolean;
}

export function Header({ title, agents = [], profiles = [], hideFilters, hideAgentFilter, hideDatePicker }: HeaderProps) {
  return (
    <>
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3 md:px-7">
        <div className="flex items-center gap-4">
          <MobileSidebar />
          <div>
            <h1 className="text-lg font-bold text-foreground">
              {title ?? "Dashboard Overview"}
            </h1>
            <p className="text-[13.5px] text-muted-foreground">
              Updated just now
            </p>
          </div>
        </div>
        <HeaderControls agents={agents} profiles={profiles} hideFilters={hideFilters} hideAgentFilter={hideAgentFilter} hideDatePicker={hideDatePicker} />
      </header>
      {!hideFilters && <ActiveFilterBar agents={agents} profiles={profiles} />}
    </>
  );
}
