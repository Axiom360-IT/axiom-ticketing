"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, Plus, Ticket, User } from "lucide-react";
import { Wordmark } from "@/components/branding/wordmark";
import { ACCENT_CLASSES, type BrandingConfig } from "@/lib/branding/presets";
import { cn } from "@/lib/utils";

// Customer-side sidebar. Mirrors the visual language of the admin sidebar
// (slate-900 panel, blue accent stripe on active item, accent-colored
// brand badge) but with only the surfaces a customer needs — Home,
// My Tickets, Profile. The "New ticket" CTA gets its own slot at the top
// because it's the highest-value action the customer can take from
// anywhere on the portal.
//
// Hidden below `lg` so mobile keeps using the topbar's second-row nav.

type NavItem = {
  href: string;
  labelKey: "home" | "myTickets" | "profile";
  icon: typeof Ticket;
  /** When true, treat the route as exact (no descendant match). The
   *  `/portal` Home item needs this — otherwise it stays active on
   *  `/portal/tickets` because that pathname `startsWith("/portal")`. */
  exact?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/portal", labelKey: "home", icon: Home, exact: true },
  { href: "/portal/tickets", labelKey: "myTickets", icon: Ticket },
  { href: "/portal/profile", labelKey: "profile", icon: User },
];

export function CustomerSidebar({ branding }: { branding: BrandingConfig }) {
  const pathname = usePathname();
  const t = useTranslations("portal.shell");
  const badge = ACCENT_CLASSES[branding.accentColor].darkBadge;
  const initial = (branding.brandName || branding.brandAccent || "")
    .charAt(0)
    .toUpperCase();

  return (
    <aside className="hidden lg:flex w-60 shrink-0 bg-slate-900 text-slate-100 flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-slate-800">
        <Link
          href="/portal"
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

      {/* Primary CTA — file a new ticket. Stands out from nav links. */}
      <div className="p-3">
        <Link
          href="/portal/tickets/new"
          className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors min-h-[44px]"
        >
          <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{t("newTicket")}</span>
        </Link>
      </div>

      <nav
        className="flex-1 overflow-y-auto px-3 py-1"
        aria-label={t("mainNavLabel")}
      >
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors min-h-[44px]",
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
    </aside>
  );
}
