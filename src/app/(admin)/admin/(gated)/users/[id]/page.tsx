import { eq, ne } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ReactivateButton,
  ResetPasswordButton,
  UnlockButton,
} from "@/components/users/account-actions";
import { DeactivateModal } from "@/components/users/deactivate-modal";
import { EditUserForm } from "@/components/users/edit-user-form";
import { ImpersonateButton } from "@/components/users/impersonate-button";
import { getDescendants } from "@/app/actions/users";
import { roleOptionsFor } from "@/lib/roles/assignable";
import { EmailDeliveryAlert } from "@/components/shared/email-delivery-alert";
import { openIssuesFor } from "@/lib/email/delivery-monitor";
import { listActiveOrganizations } from "@/app/actions/organizations";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { userRoles } from "@/lib/db/schema/rbac";

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
      organizationId: users.organizationId,
      isActive: users.isActive,
      createdById: users.createdById,
      createdAt: users.createdAt,
      deactivatedAt: users.deactivatedAt,
      lockedUntil: users.lockedUntil,
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
    canUnlock,
    currentRoleRows,
  ] = await Promise.all([
    can(caller, "users.update", userScope, productionContext),
    can(caller, "users.deactivate", userScope, productionContext),
    can(caller, "users.reactivate", { type: "global" }, productionContext),
    can(caller, "users.reset_password", userScope, productionContext),
    can(caller, "users.impersonate", userScope, productionContext),
    can(caller, "users.unlock", { type: "global" }, productionContext),
    db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, target.id)),
  ]);

  if (
    !canUpdate &&
    !canDeactivate &&
    !canReactivate &&
    !canReset &&
    !canImpersonate &&
    !canUnlock
  ) {
    redirect("/admin/users");
  }

  const isLocked =
    target.lockedUntil != null && target.lockedUntil.getTime() > Date.now();

  // Roles offered to this caller: what they could assign, plus what the person
  // already holds (shown locked), per the Technical Lead's visibility policy.
  // Replaces a filter that knew about permissions but not about rank.
  const assignableRoles = await roleOptionsFor(caller, {
    heldRoleIds: currentRoleRows.map((r) => r.roleId),
  });

  // Org options for the org dropdown (CR-06), when the caller can read them.
  const orgOptions = (await can(
    caller,
    "organizations.view",
    { type: "global" },
    productionContext,
  ))
    ? (await listActiveOrganizations()).map((o) => ({ id: o.id, name: o.name }))
    : [];
  const orgName =
    orgOptions.find((o) => o.id === target.organizationId)?.name ?? null;

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
        <h1 className="text-xl font-semibold break-words sm:text-2xl">{target.name}</h1>
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
        {isLocked && target.lockedUntil ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {t("lockedNote", {
              when: formatter.dateTime(target.lockedUntil, {
                timeStyle: "short",
                dateStyle: "medium",
              }),
            })}
          </p>
        ) : null}
      </header>

      <EmailDeliveryAlert
        canAct={canUpdate}
        issues={(await openIssuesFor([target.email])).map((i) => ({
          email: i.email,
          status: i.status,
          since: i.since.toISOString(),
        }))}
      />

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
                organizationId: target.organizationId,
                roleIds: currentRoleRows.map((r) => r.roleId),
              }}
              roles={assignableRoles}
              organizations={orgOptions}
              isActive={target.isActive}
            />
          ) : (
            <div className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1">
              <div>{target.email}</div>
              {orgName ? <div>{orgName}</div> : null}
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
          {canUnlock && isLocked ? (
            <UnlockButton userId={target.id} />
          ) : null}
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
