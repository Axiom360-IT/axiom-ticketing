import type { BrandingConfig } from "@/lib/branding/presets";
import type { Permission } from "@/lib/auth/permissions";
import { getRecentNotifications } from "@/app/actions/notifications";
import { GlobalSearch } from "./global-search";
import { MobileNav } from "./mobile-nav";
import { NotificationBell } from "./notification-bell";
import { ProfileMenu } from "./profile-menu";
import { SidebarToggle } from "./sidebar-toggle";

type TopbarProps = {
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
    /** Server-resolved signed URL for the user's avatar, or null. */
    avatarUrl?: string | null;
  };
  /** For the mobile nav drawer (the desktop sidebar is hidden below `md`). */
  branding: BrandingConfig;
  permissions: Permission[];
  /** Sub-nav under "Tickets" in the drawer — one link per active ticket type. */
  ticketTypes: { value: string; label: string }[];
};

export async function Topbar({ user, branding, permissions, ticketTypes }: TopbarProps) {
  const initialNotifications = await getRecentNotifications();
  return (
    <header className="h-14 flex items-center gap-2 sm:gap-4 px-3 sm:px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-10">
      {/* Desktop: collapse the sidebar to an icon rail. Below `md` the sidebar
          is hidden, so this yields to the hamburger drawer instead. */}
      <SidebarToggle />

      {/* Hamburger — only rendered below `md`, opens the nav drawer. */}
      <MobileNav branding={branding} permissions={permissions} ticketTypes={ticketTypes} />

      <GlobalSearch />

      {/* `ml-auto` pins this cluster to the far right: the search is capped at
          `max-w-md`, so without it the leftover row space would sit to the
          right of the profile menu and leave it stranded mid-row. */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">
        <NotificationBell initial={initialNotifications} />
        <ProfileMenu
          user={{
            name: user.name,
            email: user.email,
            roles: user.roles,
            avatarUrl: user.avatarUrl ?? null,
          }}
        />
      </div>
    </header>
  );
}
