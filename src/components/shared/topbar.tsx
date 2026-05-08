import { getTranslations } from "next-intl/server";
import { Search } from "lucide-react";
import { getRecentNotifications } from "@/app/actions/notifications";
import { NotificationBell } from "./notification-bell";
import { ProfileMenu } from "./profile-menu";

type TopbarProps = {
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
  };
};

export async function Topbar({ user }: TopbarProps) {
  const t = await getTranslations("admin.shell");
  const initialNotifications = await getRecentNotifications();
  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-10">
      {/* Left: placeholder global search */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <div
          className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-400 cursor-not-allowed"
          aria-label={t("topbarSearchAriaLabel")}
          title={t("topbarSearchTitle")}
        >
          <Search className="w-4 h-4" aria-hidden="true" />
          <span>{t("topbarSearchPlaceholder")}</span>
          <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 font-mono">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right: bell + profile menu */}
      <div className="flex items-center gap-2">
        <NotificationBell initial={initialNotifications} />

        <ProfileMenu
          user={{ name: user.name, email: user.email, roles: user.roles }}
        />
      </div>
    </header>
  );
}
