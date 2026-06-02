import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { tickets } from "@/lib/db/schema/tickets";
import { procurementRequests } from "@/lib/db/schema/procurement";
import { users } from "@/lib/db/schema/auth";
import { cn } from "@/lib/utils";
import type { Permission } from "@/lib/auth/permissions";

// Quick-stat queries used to populate the landing dashboard. Each one
// is gated by the caller's permissions — we only run the query when
// the stat would actually be visible. `null` = caller doesn't have
// permission (placeholder rendered); a number = visible (incl. `0`).

async function getStats(perms: Set<Permission>) {
  const [openTotalRes, unassignedRes, pendingProcRes, activeUsersRes] =
    await Promise.all([
      perms.has("tickets.view")
        ? db
            .select({ value: count() })
            .from(tickets)
            .where(
              and(
                inArray(tickets.status, ["open", "in_progress"]),
                isNull(tickets.deletedAt),
              ),
            )
        : Promise.resolve(null),
      perms.has("tickets.assign")
        ? db
            .select({ value: count() })
            .from(tickets)
            .where(
              and(
                eq(tickets.status, "open"),
                isNull(tickets.assignedToId),
                isNull(tickets.deletedAt),
              ),
            )
        : Promise.resolve(null),
      perms.has("procurement.manage")
        ? db
            .select({ value: count() })
            .from(procurementRequests)
            .where(
              inArray(procurementRequests.status, [
                "awaiting_customer_payment",
                "order_pending",
              ]),
            )
        : Promise.resolve(null),
      perms.has("users.view")
        ? db
            .select({ value: count() })
            .from(users)
            .where(eq(users.isActive, true))
        : Promise.resolve(null),
    ]);

  return {
    openTickets: openTotalRes ? Number(openTotalRes[0]?.value ?? 0) : null,
    unassigned: unassignedRes ? Number(unassignedRes[0]?.value ?? 0) : null,
    pendingProcurement: pendingProcRes
      ? Number(pendingProcRes[0]?.value ?? 0)
      : null,
    activeUsers: activeUsersRes ? Number(activeUsersRes[0]?.value ?? 0) : null,
  };
}

export default async function AdminLanding() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");

  const t = await getTranslations("admin.landing");
  const stats = await getStats(user.permissions);

  const displayRoles =
    user.roleNames.size > 0 ? [...user.roleNames].join(", ") : t("noRoles");

  return (
    <div className="max-w-6xl space-y-8">
      {/* ── Welcome strip ───────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-semibold mb-1">{t("welcome")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("rolesPrefix")} <span className="font-medium">{displayRoles}</span>
        </p>
      </header>

      {/* ── Quick stats ─────────────────────────────────────────── */}
      <section
        aria-label={t("quickStatsLabel")}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        <StatCard
          label={t("statOpenTickets")}
          value={stats.openTickets}
          href="/admin/tickets?status=open,in_progress"
        />
        <StatCard
          label={t("statUnassigned")}
          value={stats.unassigned}
          href="/admin/tickets?status=open&assignee=unassigned"
          accent={
            stats.unassigned !== null && stats.unassigned > 0 ? "warning" : undefined
          }
        />
        <StatCard
          label={t("statPendingProcurement")}
          value={stats.pendingProcurement}
          href="/admin/procurement?status=awaiting_customer_payment"
          accent={
            stats.pendingProcurement !== null && stats.pendingProcurement > 0
              ? "warning"
              : undefined
          }
        />
        <StatCard
          label={t("statActiveUsers")}
          value={stats.activeUsers}
          href="/admin/users"
        />
      </section>

      {/* ── Section cards ───────────────────────────────────────── */}
      <section
        aria-label={t("sectionsLabel")}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
      >
        {user.permissions.has("tickets.view") ? (
          <SectionCard
            href="/admin/tickets"
            icon={Ticket}
            title={t("cardTicketsTitle")}
            description={t("cardTicketsDescription")}
          />
        ) : null}
        {user.permissions.has("procurement.view") ? (
          <SectionCard
            href="/admin/procurement"
            icon={ShoppingCart}
            title={t("cardProcurementTitle")}
            description={t("cardProcurementDescription")}
          />
        ) : null}
        {user.permissions.has("users.view") ? (
          <SectionCard
            href="/admin/users"
            icon={Users}
            title={t("cardUsersTitle")}
            description={t("cardUsersDescription")}
          />
        ) : null}
        {user.permissions.has("roles.view") ? (
          <SectionCard
            href="/admin/roles"
            icon={Shield}
            title={t("cardRolesTitle")}
            description={t("cardRolesDescription")}
          />
        ) : null}
        {user.permissions.has("users.view") ? (
          <SectionCard
            href="/admin/hierarchy"
            icon={GitBranch}
            title={t("cardHierarchyTitle")}
            description={t("cardHierarchyDescription")}
          />
        ) : null}
        {user.permissions.has("reports.view") ? (
          <SectionCard
            href="/admin/reports"
            icon={ClipboardList}
            title={t("cardReportsTitle")}
            description={t("cardReportsDescription")}
          />
        ) : null}
        {user.permissions.has("settings.view") ? (
          <SectionCard
            href="/admin/settings"
            icon={Settings}
            title={t("cardSettingsTitle")}
            description={t("cardSettingsDescription")}
          />
        ) : null}
        {user.permissions.has("audit.view") ? (
          <SectionCard
            href="/admin/audit"
            icon={History}
            title={t("cardAuditTitle")}
            description={t("cardAuditDescription")}
          />
        ) : null}
      </section>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  /** `null` = caller doesn't have permission for this stat; render an
   *  inert placeholder so the four-column grid stays aligned. */
  value: number | null;
  href: string;
  accent?: "warning";
}) {
  if (value === null) {
    return (
      <div
        aria-hidden="true"
        className="rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 px-4 py-3 opacity-40"
      />
    );
  }
  return (
    <Link
      href={href}
      className={cn(
        "rounded-lg border bg-white dark:bg-zinc-900 px-4 py-3 hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500",
        accent === "warning" && value > 0
          ? "border-amber-300 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30"
          : "border-zinc-200 dark:border-zinc-800",
      )}
    >
      <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
        {value}
      </p>
    </Link>
  );
}

function SectionCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof Ticket;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full transition-all group-hover:border-blue-300 group-hover:shadow-sm dark:group-hover:border-blue-700">
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="inline-flex w-9 h-9 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <Icon className="w-4 h-4" aria-hidden="true" />
            </span>
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          <CardDescription className="mt-2">{description}</CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </Link>
  );
}
