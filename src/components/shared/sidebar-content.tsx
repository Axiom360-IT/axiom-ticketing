"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Building2,
  ChartColumnBig,
  ChevronDown,
  ClipboardList,
  Clock,
  GitBranch,
  History,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  MailWarning,
  Settings,
  Shield,
  Tags,
  ShoppingCart,
  SlidersHorizontal,
  Ticket,
  Users,
} from "lucide-react";
import { Wordmark } from "@/components/branding/wordmark";
import { ACCENT_CLASSES, type BrandingConfig } from "@/lib/branding/presets";
import type { Permission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import {
  TICKET_TYPE_ICON_COMPONENTS,
  TICKET_TYPE_ICON_SIDEBAR_COLOR,
  resolveTicketTypeIconKey,
} from "@/lib/tickets/type-icons";

type NavLabelKey =
  | "navDashboard"
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
  | "navCategories"
  | "navTypes"
  | "navAudit";

type GroupLabelKey =
  | "groupServiceDesk"
  | "groupInsights"
  | "groupAdministration";

type NavItem = {
  href: string;
  labelKey: NavLabelKey;
  icon: typeof Ticket;
  /** Vibrant per-feature icon color (a Tailwind text-class literal so JIT
   *  keeps it). Tuned for the dark sidebar surface — the 400 shade reads
   *  bright on slate-900 and stays legible when the item is active. */
  color: string;
  /** Permission required to see this link. Matches the gate enforced by the
   *  underlying page's `redirect("/admin")` so the sidebar never advertises a
   *  destination the user can't reach. Omitted for the Dashboard, which every
   *  admin can reach. */
  requires?: Permission;
};

type NavGroup = {
  labelKey: GroupLabelKey;
  /** Category icon — shown beside the header label, and (enlarged) as the sole
   *  glyph for the group when the sidebar is collapsed to its icon rail. */
  icon: typeof Ticket;
  color: string;
  items: NavItem[];
};

// Dashboard sits above the categories — it's the home surface, not a member
// of any group.
const DASHBOARD_ITEM: NavItem = {
  href: "/admin",
  labelKey: "navDashboard",
  icon: LayoutDashboard,
  color: "text-sky-400",
};

// Categorized navigation (main tab → sub-tabs). Three buckets: day-to-day
// ticket work, reporting/history, and everything administrative. Each item
// keeps its permission gate; a group with no visible items is skipped whole.
const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "groupServiceDesk",
    icon: LifeBuoy,
    color: "text-sky-400",
    items: [
      { href: "/admin/tickets", labelKey: "navTickets", icon: Ticket, color: "text-violet-400", requires: "tickets.view" },
      { href: "/admin/work-log", labelKey: "navWorkLog", icon: Clock, color: "text-amber-400", requires: "tickets.update" },
      { href: "/admin/moderation", labelKey: "navModeration", icon: MailWarning, color: "text-rose-400", requires: "tickets.update" },
      { href: "/admin/procurement", labelKey: "navProcurement", icon: ShoppingCart, color: "text-emerald-400", requires: "procurement.view" },
    ],
  },
  {
    labelKey: "groupInsights",
    icon: ChartColumnBig,
    color: "text-cyan-400",
    items: [
      { href: "/admin/reports", labelKey: "navReports", icon: ClipboardList, color: "text-cyan-400", requires: "reports.view" },
      { href: "/admin/audit", labelKey: "navAudit", icon: History, color: "text-lime-400", requires: "audit.view" },
    ],
  },
  {
    labelKey: "groupAdministration",
    icon: SlidersHorizontal,
    color: "text-fuchsia-400",
    items: [
      { href: "/admin/organizations", labelKey: "navOrganizations", icon: Building2, color: "text-teal-400", requires: "organizations.view" },
      { href: "/admin/users", labelKey: "navUsers", icon: Users, color: "text-blue-400", requires: "users.view" },
      { href: "/admin/roles", labelKey: "navRoles", icon: Shield, color: "text-fuchsia-400", requires: "roles.view" },
      { href: "/admin/hierarchy", labelKey: "navHierarchy", icon: GitBranch, color: "text-orange-400", requires: "users.view" },
      { href: "/admin/categories", labelKey: "navCategories", icon: Tags, color: "text-pink-400", requires: "settings.update" },
      { href: "/admin/types", labelKey: "navTypes", icon: Layers, color: "text-sky-400", requires: "settings.update" },
      { href: "/admin/settings", labelKey: "navSettings", icon: Settings, color: "text-indigo-400", requires: "settings.view" },
    ],
  },
];

// Flat list kept for any caller that needs the whole nav surface. Derived so it
// can't drift from the grouped view.
export const NAV_ITEMS: NavItem[] = [
  DASHBOARD_ITEM,
  ...NAV_GROUPS.flatMap((g) => g.items),
];

const COLLAPSE_STORAGE_KEY = "axiom.sidebar.collapsedGroups";

function persistCollapsed(state: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / storage disabled — collapse state just won't persist.
  }
}

/**
 * The inner content of the admin nav — brand header + grouped link list +
 * footer. Shared between the desktop `Sidebar` (a fixed column that can shrink
 * to an icon rail via `mini`) and the mobile drawer (`MobileNav`, always
 * expanded). `onNavigate` fires when a link is tapped so the drawer can close
 * itself. The collapse control itself lives in the topbar (`SidebarToggle`),
 * not here.
 *
 * Categories are collapsible and the state persists to localStorage. When the
 * whole sidebar is collapsed (`mini`), only icons show: the category glyph is
 * enlarged and its sub-items shrink, so the hierarchy stays legible in the rail.
 */
export function SidebarContent({
  branding,
  permissions,
  ticketTypes,
  onNavigate,
  mini = false,
}: {
  branding: BrandingConfig;
  permissions: Permission[];
  /** One sub-link per active ticket type, shown nested under "Tickets". */
  ticketTypes: { value: string; label: string; icon: string }[];
  onNavigate?: () => void;
  mini?: boolean;
}) {
  const permSet = new Set(permissions);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTicketType = pathname === "/admin/tickets" ? searchParams.get("type") : null;
  const t = useTranslations("admin.shell");
  const badge = ACCENT_CLASSES[branding.accentColor].darkBadge;
  const initial = (branding.brandName || branding.brandAccent || "")
    .charAt(0)
    .toUpperCase();

  const isActive = (href: string) =>
    href === "/admin"
      ? pathname === "/admin"
      : pathname === href || pathname.startsWith(`${href}/`);

  const visibleGroups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.requires || permSet.has(i.requires)),
  })).filter((g) => g.items.length > 0);

  // Persisted "which groups are collapsed" map. Starts empty (all expanded) so
  // the server and first client render agree; localStorage is read after mount.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setCollapsed(JSON.parse(raw));
    } catch {
      // Ignore malformed/unavailable storage.
    }
  }, []);

  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      persistCollapsed(next);
      return next;
    });

  return (
    <>
      <div
        className={cn(
          "border-b border-slate-800",
          mini ? "flex justify-center px-2 py-4" : "px-5 py-5",
        )}
      >
        <Link
          href="/admin"
          onClick={onNavigate}
          aria-label={mini ? t("navDashboard") : undefined}
          className={cn(
            "flex items-center",
            mini ? "justify-center" : "gap-2 text-base font-semibold tracking-tight",
          )}
        >
          {mini ? (
            <span
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md border text-sm font-bold",
                badge,
              )}
            >
              {initial}
            </span>
          ) : branding.logoUrl ? (
            // The sidebar surface is dark, so back the logo with a light plate:
            // most brand logos are drawn for a white background and would
            // otherwise vanish on the dark surface. eslint-disable: a signed R2
            // URL doesn't fit next/image's static remotePatterns.
            <div className="w-full overflow-hidden rounded-lg bg-white px-4 py-1.5 shadow-sm ring-1 ring-black/5">
              {/* object-cover crops the logo file's baked-in transparent
                  margins (many exports are padded to a square) so the mark
                  fills the plate. eslint-disable: signed R2 URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={branding.logoUrl}
                alt={branding.brandName}
                className="h-14 w-full object-cover"
              />
            </div>
          ) : (
            <>
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
            </>
          )}
        </Link>
        {mini || branding.logoUrl ? null : (
          <p className="text-[11px] text-slate-500 mt-1 ml-9">{t("tagline")}</p>
        )}
      </div>

      <nav
        className={cn("flex-1 overflow-y-auto py-3", mini ? "px-2" : "px-3")}
        aria-label={t("mainNavLabel")}
      >
        {/* Dashboard — standalone, above the categories. */}
        <ul className="space-y-0.5">
          <NavLink
            item={DASHBOARD_ITEM}
            active={isActive(DASHBOARD_ITEM.href)}
            label={t(DASHBOARD_ITEM.labelKey)}
            onNavigate={onNavigate}
            mini={mini}
            prominent
          />
        </ul>

        {visibleGroups.map((group) => {
          const open = !collapsed[group.labelKey];
          const GroupIcon = group.icon;
          return (
            <div key={group.labelKey} className="mt-3">
              <button
                type="button"
                onClick={() => toggleGroup(group.labelKey)}
                aria-expanded={open}
                aria-label={mini ? t(group.labelKey) : undefined}
                title={mini ? t(group.labelKey) : undefined}
                className={cn(
                  "flex w-full items-center rounded-md transition-colors hover:bg-slate-800/60",
                  mini ? "justify-center px-2 py-2" : "gap-2 px-3 py-1.5",
                )}
              >
                <GroupIcon
                  className={cn(
                    "shrink-0",
                    mini ? "h-6 w-6" : "h-5 w-5",
                    group.color,
                  )}
                  aria-hidden="true"
                />
                {mini ? null : (
                  <>
                    <span className="flex-1 text-left text-sm font-semibold uppercase tracking-wide text-slate-300">
                      {t(group.labelKey)}
                    </span>
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200",
                        open ? "" : "-rotate-90",
                      )}
                      aria-hidden="true"
                    />
                  </>
                )}
              </button>
              {open ? (
                <ul className={cn("space-y-0.5", mini ? "mt-1" : "mt-0.5")}>
                  {group.items.map((item) => (
                    <Fragment key={item.href}>
                      <NavLink
                        item={item}
                        active={isActive(item.href)}
                        label={t(item.labelKey)}
                        onNavigate={onNavigate}
                        mini={mini}
                      />
                      {/* Ticket-type sub-nav — only under "Tickets", only
                          expanded (a 3rd nesting level with no room for a
                          label doesn't work in the icon rail, so it's
                          skipped there; the type filter is still reachable
                          by opening Tickets itself). Rebuilt from the
                          admin-managed taxonomy on every request — add a
                          type in Settings and it gets a link here with no
                          code change. */}
                      {item.href === "/admin/tickets" &&
                      !mini &&
                      ticketTypes.length > 0 ? (
                        <li>
                          <ul className="mt-0.5 ml-[18px] space-y-0.5 border-l border-slate-800 pl-3">
                            {ticketTypes.map((type) => {
                              const iconKey = resolveTicketTypeIconKey(type.icon);
                              const Icon = TICKET_TYPE_ICON_COMPONENTS[iconKey];
                              return (
                                <NavLink
                                  key={type.value}
                                  item={{
                                    href: `/admin/tickets?type=${encodeURIComponent(type.value)}`,
                                    icon: Icon,
                                    color: TICKET_TYPE_ICON_SIDEBAR_COLOR[iconKey],
                                  }}
                                  active={activeTicketType === type.value}
                                  label={type.label}
                                  onNavigate={onNavigate}
                                  mini={false}
                                />
                              );
                            })}
                          </ul>
                        </li>
                      ) : null}
                    </Fragment>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* The collapse toggle now lives in the header (always visible); the
          footer is just the build line, hidden in the collapsed rail. */}
      {mini ? null : (
        <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-500">
          {t("buildLine")}
        </div>
      )}
    </>
  );
}

function NavLink({
  item,
  active,
  label,
  onNavigate,
  mini = false,
  prominent = false,
}: {
  /** Only `href`/`icon`/`color` are actually read here — `labelKey` isn't,
   *  since the caller already resolves `label` itself (a `NavItem` from the
   *  static nav tree, or a synthetic one for a dynamic sub-link like a
   *  ticket-type entry, which has no i18n key at all). */
  item: Pick<NavItem, "href" | "icon" | "color">;
  active: boolean;
  label: string;
  onNavigate?: () => void;
  mini?: boolean;
  /** Top-level (Dashboard) — keeps a larger glyph in the collapsed rail so it
   *  reads at the same weight as a category icon, above the smaller sub-items. */
  prominent?: boolean;
}) {
  const Icon = item.icon;
  // Top-level items (Dashboard + category glyphs) sit a size above sub-items so
  // the hierarchy reads at a glance — both collapsed and expanded.
  const iconSize = mini
    ? prominent
      ? "h-6 w-6"
      : "h-4 w-4"
    : prominent
      ? "h-5 w-5"
      : "h-4 w-4";
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-label={mini ? label : undefined}
        title={mini ? label : undefined}
        className={cn(
          "flex items-center rounded-md transition-colors hover:bg-slate-800 hover:text-white",
          prominent ? "text-sm font-medium" : "text-[13px]",
          mini ? "justify-center px-2 py-2" : "gap-3 px-3 py-2",
          active && mini && "bg-blue-500/15 text-white",
          active &&
            !mini &&
            "bg-blue-500/10 text-white border-l-2 border-blue-500 -ml-0.5 pl-[10px] font-medium",
          !active && "text-slate-400",
          !active && !mini && "border-l-2 border-transparent",
        )}
        aria-current={active ? "page" : undefined}
      >
        <Icon
          className={cn("shrink-0", iconSize, item.color)}
          aria-hidden="true"
        />
        {mini ? null : <span>{label}</span>}
      </Link>
    </li>
  );
}
