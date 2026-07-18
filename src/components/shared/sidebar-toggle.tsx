"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSidebar } from "./sidebar-context";

/**
 * Collapse/expand control for the desktop sidebar, rendered in the topbar.
 * Desktop-only (`hidden md:inline-flex`) — below `md` the sidebar is hidden and
 * the hamburger drawer takes over, so there's nothing to collapse.
 */
export function SidebarToggle() {
  const { mini, toggle } = useSidebar();
  const t = useTranslations("admin.shell");
  const label = mini ? t("expandSidebar") : t("collapseSidebar");
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="hidden md:inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {mini ? (
        <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
      ) : (
        <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
}
