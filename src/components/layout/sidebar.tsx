"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  Settings,
  Menu,
  X,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useState } from "react";

const adminNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agents", icon: Users },
  { href: "/profiles", label: "Profiles", icon: Briefcase },
  { href: "/jobs", label: "Jobs", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

const agentNavItems = [
  { href: "/my-dashboard", label: "My Dashboard", icon: LayoutDashboard },
  { href: "/my-jobs", label: "My Jobs", icon: FileText },
  { href: "/my-performance", label: "My Performance", icon: BarChart3 },
];

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function useNavItems() {
  const pathname = usePathname();
  const isAgentRoute =
    pathname.startsWith("/my-dashboard") ||
    pathname.startsWith("/my-jobs") ||
    pathname.startsWith("/my-performance");
  return isAgentRoute ? agentNavItems : adminNavItems;
}

export function Sidebar() {
  const pathname = usePathname();
  const navItems = useNavItems();
  const homeHref = navItems === agentNavItems ? "/my-dashboard" : "/dashboard";

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:bg-card">
      <div className="flex h-14 items-center border-b px-4">
        <Link href={homeHref} className="flex items-center gap-2 font-semibold">
          <Briefcase className="h-5 w-5" />
          <span>Vollna Analytics</span>
        </Link>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <NavLinks items={navItems} pathname={pathname} />
      </div>
    </aside>
  );
}

export function MobileSidebar() {
  const pathname = usePathname();
  const navItems = useNavItems();
  const homeHref = navItems === agentNavItems ? "/my-dashboard" : "/dashboard";
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-60 p-0">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-14 items-center border-b px-4">
          <Link
            href={homeHref}
            className="flex items-center gap-2 font-semibold"
            onClick={() => setOpen(false)}
          >
            <Briefcase className="h-5 w-5" />
            <span>Vollna Analytics</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-3">
          <NavLinks items={navItems} pathname={pathname} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
