import type { BrandingConfig } from "@/lib/branding/presets";
import type { Permission } from "@/lib/auth/permissions";
import { SidebarContent } from "./sidebar-content";

/**
 * Desktop admin sidebar — a fixed column, hidden below the `md` breakpoint
 * where the mobile drawer (`MobileNav`, opened from the topbar hamburger)
 * takes over. Both render the same `SidebarContent`.
 */
export function Sidebar({
  branding,
  permissions,
}: {
  branding: BrandingConfig;
  permissions: Permission[];
}) {
  return (
    <aside className="hidden md:flex w-60 shrink-0 bg-slate-900 text-slate-100 flex-col h-screen sticky top-0">
      <SidebarContent branding={branding} permissions={permissions} />
    </aside>
  );
}
