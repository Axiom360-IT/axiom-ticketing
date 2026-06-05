"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  ClipboardList,
  Clock,
  GitBranch,
  History,
  MailWarning,
  Settings,
  Shield,
  ShoppingCart,
  Ticket,
  Users,
} from "lucide-react";
import { Wordmark } from "@/components/branding/wordmark";
import { ACCENT_CLASSES, type BrandingConfig } from "@/lib/branding/presets";
import type { Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  labelKey:
    | "navTickets"
    | "navWorkLog"
    | "navModeration"
    | "navProcurement"
    | "navReports"
    | "navOrganizations"
    | "navUsers"
    | "navRoles"
    | "navHierarchy"
    | "navSettings"
    | "navAudit";
  icon: typeof Ticket;
  /** Permission required to see this link. Matches the gate enforced by the
   *  underlying page's `redirect("/admin")` so the sidebar never advertises a
   *  destination the user can't reach. */
  requires: Permission;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/admin/tickets", labelKey: "navTickets", icon: Ticket, requires: "tickets.view" },
  { href: "/admin/work-log", labelKey: "navWorkLog", icon: Clock, requires: "tickets.update" },
  { href: "/admin/moderation", labelKey: "navModeration", icon: MailWarning, requires: "tickets.update" },
  { href: "/admin/procurement", labelKey: "navProcurement", icon: ShoppingCart, requires: "procurement.view" },
  { href: "/admin/reports", labelKey: "navReports", icon: ClipboardList, requires: "reports.view" },
  { href: "/admin/organizations", labelKey: "navOrganizations", icon: Building2, requires: "organizations.view" },
  { href: "/admin/users", labelKey: "navUsers", icon: Users, requires: "users.view" },
  { href: "/admin/roles", labelKey: "navRoles", icon: Shield, requires: "roles.view" },
  { href: "/admin/hierarchy", labelKey: "navHierarchy", icon: GitBranch, requires: "users.view" },
  { href: "/admin/settings", labelKey: "navSettings", icon: Settings, requires: "settings.view" },
  { href: "/admin/audit", labelKey: "navAudit", icon: History, requires: "audit.view" },
];

/**
 * The inner content of the admin nav — brand header + link list + footer.
 * Shared between the desktop `Sidebar` (a fixed column) and the mobile
 * drawer (`MobileNav`). `onNavigate` fires when a link is tapped so the
 * drawer can close itself; the desktop sidebar omits it.
 */
export function SidebarContent({
  branding,
  permissions,
  onNavigate,
}: {
  branding: BrandingConfig;
  permissions: Permission[];
  onNavigate?: () => void;
}) {
  const permSet = new Set(permissions);
  const visibleItems = NAV_ITEMS.filter((item) => permSet.has(item.requires));
  const pathname = usePathname();
  const t = useTranslations("admin.shell");
  const badge = ACCENT_CLASSES[branding.accentColor].darkBadge;
  const initial = (branding.brandName || branding.brandAccent || "")
    .charAt(0)
    .toUpperCase();

  return (
    <>
      <div className="px-5 py-5 border-b border-slate-800">
        <Link
          href="/admin"
          onClick={onNavigate}
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <span
            className={cn(
              "inline-flex w-7 h-7 rounded-md border items-center justify-center text-xs font-bold",
              badge,
            )}
          >
            {initial}
          </span>
          <Wordmark
            brandName={branding.brandName}
            brandAccent={branding.brandAccent}
            accentColor={branding.accentColor}
            size="md"
            onDark
            className="!text-base"
          />
        </Link>
        <p className="text-[11px] text-slate-500 mt-1 ml-9">{t("tagline")}</p>
      </div>

      <nav
        className="flex-1 overflow-y-auto px-3 py-3"
        aria-label={t("mainNavLabel")}
      >
        <ul className="space-y-0.5">
          {visibleItems.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                    "hover:bg-slate-800 hover:text-white",
                    active
                      ? "bg-blue-500/10 text-white border-l-2 border-blue-500 -ml-0.5 pl-[10px] font-medium"
                      : "text-slate-400 border-l-2 border-transparent",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{t(item.labelKey)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-500">
        {t("buildLine")}
      </div>
    </>
  );
}
