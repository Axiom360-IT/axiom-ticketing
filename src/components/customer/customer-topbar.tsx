"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { NotificationBell } from "@/components/shared/notification-bell";
import { authClient } from "@/lib/auth/client";
import { initials } from "@/lib/format";
import type { RecentNotificationsResult } from "@/app/actions/notifications";

type Props = {
  email: string;
  name: string;
  /** Server-resolved signed URL for the user's avatar, or null. */
  avatarUrl?: string | null;
  /** Server-fetched initial notifications payload so the bell renders
   *  with real data on the first paint instead of flashing empty. */
  initialNotifications: RecentNotificationsResult;
};

export function CustomerTopbar({
  email,
  name,
  avatarUrl,
  initialNotifications,
}: Props) {
  const t = useTranslations("portal.shell");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [signingOut, setSigningOut] = useState(false);

  function handleSignOut() {
    setSigningOut(true);
    startTransition(async () => {
      await authClient.signOut();
      router.push("/portal/sign-in");
      router.refresh();
    });
  }

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
      {/* Row 1 — identity + notifications bell + sign-out. The sidebar
          carries the main navigation on lg+; below that, row 2 below
          carries the mobile-only nav strip. */}
      <div className="px-4 py-3 flex items-center justify-between gap-4">
        <Link
          href="/portal"
          className="font-semibold text-zinc-900 dark:text-zinc-50 lg:invisible"
        >
          {tCommon("appName")}
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <NotificationBell initial={initialNotifications} />
          <Avatar className="size-7 hidden sm:flex">
            {avatarUrl ? (
              <AvatarImage src={avatarUrl} alt={name || email} />
            ) : null}
            <AvatarFallback className="text-[10px]">
              {initials(name || email)}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm text-zinc-500 dark:text-zinc-400 hidden md:inline truncate max-w-[200px]">
            {name || email}
          </span>
          <span className="sr-only" role="status">
            {t("signedInAs", { email })}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut || pending}
            // Min 44×44 tap target on mobile per WCAG 2.5.5; px-3 py-2.5
            // gives ~44px height with the icon + text.
            className="inline-flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-md px-3 py-2.5 sm:py-1 min-h-[44px] sm:min-h-0"
          >
            <LogOut className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {signingOut || pending ? t("signingOut") : t("signOut")}
            </span>
            <span className="sm:hidden sr-only">
              {signingOut || pending ? t("signingOut") : t("signOut")}
            </span>
          </button>
        </div>
      </div>

      {/* Row 2 — nav links on mobile + tablet only. The sidebar above
          `lg` covers desktop. Below `lg` we hide the sidebar entirely
          and use this strip to keep navigation reachable. */}
      <nav
        aria-label={t("myTickets")}
        className="lg:hidden flex border-t border-zinc-200 dark:border-zinc-800 text-sm"
      >
        <Link
          href="/portal"
          className="flex-1 text-center px-4 py-3 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-900 min-h-[44px]"
        >
          {t("home")}
        </Link>
        <Link
          href="/portal/tickets"
          className="flex-1 text-center px-4 py-3 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 min-h-[44px]"
        >
          {t("myTickets")}
        </Link>
        <Link
          href="/portal/profile"
          className="flex-1 text-center px-4 py-3 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-50 hover:bg-zinc-50 dark:hover:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 min-h-[44px]"
        >
          {t("profile")}
        </Link>
      </nav>
    </header>
  );
}
