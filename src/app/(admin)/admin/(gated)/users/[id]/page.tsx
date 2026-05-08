import { eq, ne } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ReactivateButton,
  ResetPasswordButton,
} from "@/components/users/account-actions";
import { DeactivateModal } from "@/components/users/deactivate-modal";
import { EditUserForm } from "@/components/users/edit-user-form";
import { ImpersonateButton } from "@/components/users/impersonate-button";
import { getDescendants, listAllRoles } from "@/app/actions/users";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { rolePermissions, userRoles } from "@/lib/db/schema/rbac";

export const dynamic = "force-dynamic";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const caller = await getSessionUser();
  if (!caller) redirect("/admin/login");

  const { id } = await params;

  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      language: users.language,
      isActive: users.isActive,
      createdById: users.createdById,
      createdAt: users.createdAt,
      deactivatedAt: users.deactivatedAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!target) notFound();

  const userScope = {
    type: "user" as const,
    user: { id: target.id, createdById: target.createdById },
  };

  const [
    canUpdate,
    canDeactivate,
    canReactivate,
    canReset,
    canImpersonate,
    allRoles,
    currentRoleRows,
  ] = await Promise.all([
    can(caller, "users.update", userScope, productionContext),
    can(caller, "users.deactivate", userScope, productionContext),
    can(caller, "users.reactivate", { type: "global" }, productionContext),
    can(caller, "users.reset_password", userScope, productionContext),
    can(caller, "users.impersonate", userScope, productionContext),
    listAllRoles(),
    db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, target.id)),
  ]);

  if (!canUpdate && !canDeactivate && !canReactivate && !canReset && !canImpersonate) {
    redirect("/admin/users");
  }

  // Roles available to this caller — drop ones whose permissions exceed the
  // caller's. Super Admin sees them all because their set is ALL_PERMISSIONS.
  const callerPermissions = caller.permissions;
  const allRoleIds = allRoles.map((r) => r.id);
  const permsByRole = new Map<string, string[]>();
  if (allRoleIds.length > 0) {
    const rows = await db
      .select({
        roleId: rolePermissions.roleId,
        permission: rolePermissions.permission,
      })
      .from(rolePermissions);
    for (const r of rows) {
      const list = permsByRole.get(r.roleId) ?? [];
      list.push(r.permission);
      permsByRole.set(r.roleId, list);
    }
  }
  const assignableRoles = allRoles.filter((r) => {
    const perms = permsByRole.get(r.id) ?? [];
    return perms.every((p) =>
      callerPermissions.has(p as Parameters<typeof callerPermissions.has>[0]),
    );
  });

  const t = await getTranslations("users.edit");
  const formatter = await getFormatter();

  // For the cascade modal: pre-load descendant counts + reassign candidates.
  let directChildrenCount = 0;
  let totalDescendantsCount = 0;
  let parentName: string | null = null;
  let reassignCandidates: { id: string; name: string; email: string }[] = [];
  if (canDeactivate) {
    const direct = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.createdById, target.id));
    directChildrenCount = direct.length;
    totalDescendantsCount = (await getDescendants(target.id)).length;
    if (target.createdById) {
      const [p] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, target.createdById))
        .limit(1);
      parentName = p?.name ?? null;
    }
    reassignCandidates = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(ne(users.id, target.id))
      .orderBy(users.name);
  }

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{target.name}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {target.isActive
            ? t("createdNote", {
                when: formatter.dateTime(target.createdAt, {
                  dateStyle: "medium",
                }),
              })
            : t("deactivatedNote", {
                when: target.deactivatedAt
                  ? formatter.dateTime(target.deactivatedAt, {
                      dateStyle: "medium",
                    })
                  : "—",
              })}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {canUpdate ? (
            <EditUserForm
              userId={target.id}
              initial={{
                name: target.name,
                email: target.email,
                language: target.language,
                roleIds: currentRoleRows.map((r) => r.roleId),
              }}
              roles={assignableRoles}
              isActive={target.isActive}
            />
          ) : (
            <div className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1">
              <div>{target.email}</div>
              <div>{target.language}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("actionsCardTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {canImpersonate && target.isActive && target.id !== caller.id ? (
            <ImpersonateButton userId={target.id} />
          ) : null}
          {canReset ? <ResetPasswordButton userId={target.id} /> : null}
          {canDeactivate && target.isActive ? (
            <>
              <Separator />
              <DeactivateModal
                userId={target.id}
                parentName={parentName}
                directChildrenCount={directChildrenCount}
                totalDescendantsCount={totalDescendantsCount}
                candidates={reassignCandidates}
              />
            </>
          ) : null}
          {canReactivate && !target.isActive ? (
            <>
              <Separator />
              <ReactivateButton userId={target.id} />
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
