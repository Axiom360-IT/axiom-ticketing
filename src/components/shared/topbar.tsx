import { Bell, Search } from "lucide-react";
import { ProfileMenu } from "./profile-menu";

type TopbarProps = {
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
  };
};

export function Topbar({ user }: TopbarProps) {
  return (
    <header className="h-14 flex items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 sticky top-0 z-10">
      {/* Left: placeholder global search */}
      <div className="flex items-center gap-3 flex-1 max-w-md">
        <div
          className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 text-sm text-zinc-400 cursor-not-allowed"
          aria-label="Global search (M15)"
          title="Global search lands in M15"
        >
          <Search className="w-4 h-4" aria-hidden="true" />
          <span>Search…</span>
          <kbd className="ml-auto text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 font-mono">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right: bell + profile menu */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Notifications (M11)"
          title="Notification centre lands in M11"
          className="p-2 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-not-allowed"
          disabled
        >
          <Bell className="w-4 h-4" aria-hidden="true" />
        </button>

        <ProfileMenu
          user={{ name: user.name, email: user.email, roles: user.roles }}
        />
      </div>
    </header>
  );
}
