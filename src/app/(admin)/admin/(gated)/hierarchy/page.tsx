import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, exists, ne } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { roles, userRoles } from "@/lib/db/schema/rbac";

type HierarchyNode = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  roles: string[];
  children: HierarchyNode[];
  descendantCount: number;
};

export default async function HierarchyPage() {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (!(await can(user, "users.view", { type: "global" }, productionContext))) {
    redirect("/admin");
  }

  // The hierarchy is the staff org chart — it should include everyone
  // the Super Admin created and everyone THEY created, recursively,
  // regardless of whether each leaf can itself create more users. The
  // previous (`users.create` OR `roles.create`) filter was too strict:
  // in the seeded defaults only Super Admin holds either permission, so
  // every IT Director / Coordinator / Technician was filtered out and
  // the tree collapsed to a single node.
  //
  // New rule: include any user with at least one role OTHER than
  // "Customer". Pure-Customer accounts (self-registered portal users)
  // are excluded because they're not part of the staff org chart, but
  // every staff role — including custom ones — stays. A user with
  // both Customer + a staff role still qualifies (the EXISTS just needs
  // one matching non-Customer row).
  const allUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      isActive: users.isActive,
      createdById: users.createdById,
    })
    .from(users)
    .where(
      exists(
        db
          .select({ one: userRoles.userId })
          .from(userRoles)
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            and(
              eq(userRoles.userId, users.id),
              ne(roles.name, "Customer"),
            ),
          ),
      ),
    )
    .orderBy(users.name);

  const allRoles = await db
    .select({
      userId: userRoles.userId,
      roleName: roles.name,
    })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id));

  const rolesByUser = new Map<string, string[]>();
  for (const r of allRoles) {
    const list = rolesByUser.get(r.userId) ?? [];
    list.push(r.roleName);
    rolesByUser.set(r.userId, list);
  }

  // Build tree
  const nodes = new Map<string, HierarchyNode>();
  for (const u of allUsers) {
    nodes.set(u.id, {
      id: u.id,
      name: u.name,
      email: u.email,
      isActive: u.isActive,
      roles: rolesByUser.get(u.id) ?? [],
      children: [],
      descendantCount: 0,
    });
  }
  const roots: HierarchyNode[] = [];
  for (const u of allUsers) {
    const node = nodes.get(u.id)!;
    if (u.createdById && nodes.has(u.createdById)) {
      nodes.get(u.createdById)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Compute descendant counts via DFS
  function fillCounts(node: HierarchyNode): number {
    let count = 0;
    for (const c of node.children) {
      count += 1 + fillCounts(c);
    }
    node.descendantCount = count;
    return count;
  }
  for (const r of roots) fillCounts(r);

  const t = await getTranslations("admin.hierarchy");

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold sm:text-2xl">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("rootHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          {roots.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t("noUsers")}
            </p>
          ) : (
            <ul className="space-y-2">
              {roots.map((r) => (
                <HierarchyRow key={r.id} node={r} depth={0} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function HierarchyRow({
  node,
  depth,
}: {
  node: HierarchyNode;
  depth: number;
}) {
  const t = await getTranslations("admin.hierarchy");
  const initials = node.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <li>
      <Link
        href={`/admin/users/${node.id}`}
        className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
        style={{ marginLeft: Math.min(depth, 6) * 12 }}
      >
        <Avatar className="size-8 shrink-0">
          <AvatarFallback className="text-xs">{initials || "?"}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{node.name}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate min-w-0 max-w-full">
              {node.email}
            </span>
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
                node.isActive
                  ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900"
                  : "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800"
              }`}
            >
              {node.isActive ? t("statusActive") : t("statusInactive")}
            </span>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {node.roles.length > 0
              ? t("rolesLine", { roles: node.roles.join(", ") })
              : t("rolesEmpty")}
            {" · "}
            {t("descendantCount", { count: node.descendantCount })}
          </div>
        </div>
      </Link>
      {node.children.length > 0 ? (
        <ul className="space-y-2 mt-2">
          {node.children.map((c) => (
            <HierarchyRow key={c.id} node={c} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
