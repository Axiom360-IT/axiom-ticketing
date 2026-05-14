import { getRecentNotifications } from "@/app/actions/notifications";
import { GlobalSearch } from "./global-search";
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
};

export async function Topbar({ user }: TopbarProps) {
  const initialNotifications = await getRecentNotifications();
  return (
    <header className="h-14 flex items-center justify-between gap-4 px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-10">
      <GlobalSearch />

      <div className="flex items-center gap-2">
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
