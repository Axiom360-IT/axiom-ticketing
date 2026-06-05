import type { BrandingConfig } from "@/lib/branding/presets";
import type { Permission } from "@/lib/auth/permissions";
import { getRecentNotifications } from "@/app/actions/notifications";
import { GlobalSearch } from "./global-search";
import { MobileNav } from "./mobile-nav";
import { NotificationBell } from "./notification-bell";
import { ProfileMenu } from "./profile-menu";

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
};

export async function Topbar({ user, branding, permissions }: TopbarProps) {
  const initialNotifications = await getRecentNotifications();
  return (
    <header className="h-14 flex items-center gap-2 sm:gap-4 px-3 sm:px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-10">
      {/* Hamburger — only rendered below `md`, opens the nav drawer. */}
      <MobileNav branding={branding} permissions={permissions} />

      <GlobalSearch />

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
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
