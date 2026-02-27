"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import {
  Menu,
  X,
  LayoutDashboard,
  Filter,
  Users,
  UserCircle,
  Zap,
  Bell,
  Radio,
  Gauge,
  Briefcase,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeCount?: number;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const adminNavSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/pipeline", label: "Pipeline", icon: Filter },
    ],
  },
  {
    label: "Performance",
    items: [
      { href: "/agents", label: "Agents", icon: Users },
      { href: "/profiles", label: "Profiles", icon: UserCircle },
    ],
  },
  {
    label: "Resources",
    items: [
      { href: "/connects", label: "Connects", icon: Zap },
      { href: "/alerts", label: "Alerts", icon: Bell },
    ],
  },
  {
    label: "Live",
    items: [
      { href: "/jobs", label: "Job Feed", icon: Radio },
    ],
  },
];

const agentNavSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { href: "/my-dashboard", label: "My Dashboard", icon: Gauge },
      { href: "/my-jobs", label: "My Jobs", icon: Briefcase },
      { href: "/my-performance", label: "My Performance", icon: TrendingUp },
    ],
  },
];

function SidebarNav({
  sections,
  pathname,
  onNavigate,
}: {
  sections: NavSection[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3 py-4">
      {sections.map((section) => (
        <div key={section.label} className="mb-1">
          <div className="px-2 pb-1 pt-3 text-[13.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {section.label}
          </div>
          {section.items.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[15px] font-medium transition-colors",
                  isActive
                    ? "bg-[var(--accent-light)] text-[var(--primary)] font-semibold"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
                {item.badgeCount != null && item.badgeCount > 0 && (
                  <span className="ml-auto rounded-full bg-destructive/15 px-1.5 py-0.5 text-[12px] text-destructive">
                    {item.badgeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function useNavSections() {
  const pathname = usePathname();
  const isAgentRoute =
    pathname.startsWith("/my-dashboard") ||
    pathname.startsWith("/my-jobs") ||
    pathname.startsWith("/my-performance");
  return isAgentRoute ? agentNavSections : adminNavSections;
}

function SidebarLogo({ homeHref, onClick }: { homeHref: string; onClick?: () => void }) {
  return (
    <div className="border-b border-border px-5 pb-5 pt-6">
      <Link href={homeHref} onClick={onClick} className="flex items-center gap-3">
        <Image src="/logo.png" alt="Rising Lions" width={32} height={32} className="rounded-lg" />
        <div>
          <div className="text-[15px] font-bold text-foreground">
            Rising Lions
          </div>
          <div className="text-[13.5px] text-muted-foreground">
            Analytics Dashboard
          </div>
        </div>
      </Link>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const sections = useNavSections();
  const homeHref = sections === agentNavSections ? "/my-dashboard" : "/dashboard";

  return (
    <aside className="hidden w-[232px] shrink-0 flex-col border-r border-border bg-card md:flex">
      <SidebarLogo homeHref={homeHref} />
      <div className="flex-1 overflow-y-auto">
        <SidebarNav sections={sections} pathname={pathname} />
      </div>
      <div className="border-t border-border px-5 py-4">
        <div className="flex items-center gap-2 text-[13.5px] text-accent-green">
          <div className="h-1.5 w-1.5 rounded-full bg-accent-green animate-pulse-glow" />
          All systems operational
        </div>
      </div>
    </aside>
  );
}

export function MobileSidebar() {
  const pathname = usePathname();
  const sections = useNavSections();
  const homeHref = sections === agentNavSections ? "/my-dashboard" : "/dashboard";
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[232px] bg-card p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex items-center justify-between">
          <SidebarLogo homeHref={homeHref} onClick={() => setOpen(false)} />
          <Button
            variant="ghost"
            size="icon"
            className="mr-3"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <SidebarNav
          sections={sections}
          pathname={pathname}
          onNavigate={() => setOpen(false)}
        />
        <div className="border-t border-border px-5 py-4">
          <div className="flex items-center gap-2 text-[13.5px] text-accent-green">
            <div className="h-1.5 w-1.5 rounded-full bg-accent-green animate-pulse-glow" />
            All systems operational
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
