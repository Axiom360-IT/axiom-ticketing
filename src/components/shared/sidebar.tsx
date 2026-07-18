"use client";

import type { BrandingConfig } from "@/lib/branding/presets";
import type { Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { SidebarContent } from "./sidebar-content";
import { useSidebar } from "./sidebar-context";

/**
 * Desktop admin sidebar — a fixed column, hidden below the `md` breakpoint
 * where the mobile drawer (`MobileNav`, opened from the topbar hamburger)
 * takes over. Both render the same `SidebarContent`.
 *
 * Collapses to a 64px icon rail (`mini`). The collapse state lives in
 * `SidebarProvider` (shared with the topbar toggle) and is read here to drive
 * the column width; the mobile drawer never receives `mini`, so it stays
 * fully expanded.
 */
export function Sidebar({
  branding,
  permissions,
}: {
  branding: BrandingConfig;
  permissions: Permission[];
}) {
  const { mini } = useSidebar();

  return (
    <aside
      className={cn(
        "hidden md:flex shrink-0 flex-col h-screen sticky top-0 bg-slate-900 text-slate-100 transition-[width] duration-200",
        mini ? "w-16" : "w-60",
      )}
    >
      <SidebarContent
        branding={branding}
        permissions={permissions}
        mini={mini}
      />
    </aside>
  );
}
