"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ClipboardList,
  GitBranch,
  History,
  Settings,
  Shield,
  ShoppingCart,
  Ticket,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  labelKey:
    | "navTickets"
    | "navProcurement"
    | "navReports"
    | "navUsers"
    | "navRoles"
    | "navHierarchy"
    | "navSettings"
    | "navAudit";
  icon: typeof Ticket;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/admin/tickets", labelKey: "navTickets", icon: Ticket },
  { href: "/admin/procurement", labelKey: "navProcurement", icon: ShoppingCart },
  { href: "/admin/reports", labelKey: "navReports", icon: ClipboardList },
  { href: "/admin/users", labelKey: "navUsers", icon: Users },
  { href: "/admin/roles", labelKey: "navRoles", icon: Shield },
  { href: "/admin/hierarchy", labelKey: "navHierarchy", icon: GitBranch },
  { href: "/admin/settings", labelKey: "navSettings", icon: Settings },
  { href: "/admin/audit", labelKey: "navAudit", icon: History },
];

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("admin.shell");

  return (
    <aside className="w-60 shrink-0 bg-slate-900 text-slate-100 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-slate-800">
        <Link
          href="/admin"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <span className="inline-block w-7 h-7 rounded-md bg-blue-500/20 border border-blue-400/30 flex items-center justify-center">
            <span className="text-blue-300 text-xs font-bold">A</span>
          </span>
          {t("brand")}
        </Link>
        <p className="text-[11px] text-slate-500 mt-1 ml-9">{t("tagline")}</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label={t("mainNavLabel")}>
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
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
    </aside>
  );
}
