"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RowActionIcons } from "@/components/ui/row-actions";
import type { InviteStatus } from "@/lib/users/invite-status";
import {
  completeProvisioningAndInvite,
  reactivateUser,
  resetUserPassword,
  updateUser,
} from "@/app/actions/users";

export type UserRowSummary = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  roles: { id: string; name: string }[];
  createdAt: Date;
};

type Props = {
  user: UserRowSummary;
  isSelf: boolean;
  canEdit: boolean;
  canDeactivate: boolean;
  canReactivate: boolean;
  /** `users.reset_password`. Drives the per-row "Resend invite" icon, which
   *  reuses the exact same action the bulk bar loops over — so permission
   *  checks, role branch and audit entry are identical either way. */
  canResendInvite?: boolean;
  /** Drives the mail icon. Only accounts that haven't completed sign-up show
   *  it — a `provisioning` stub gets repaired, a pending/expired/failed invite
   *  gets resent, and an `active` account shows nothing, because there is no
   *  invite outstanding to resend. (An active customer who forgot their
   *  password is served by the bulk bar and the user detail page instead.) */
  inviteStatus?: InviteStatus;
  allRoles: { id: string; name: string }[];
};

export function UserRowActions({
  user,
  isSelf,
  canEdit,
  canDeactivate,
  canReactivate,
  canResendInvite = false,
  inviteStatus = "active",
  allRoles,
}: Props) {
  const t = useTranslations("common");
  const tDialog = useTranslations("users.rowActions");
  const tList = useTranslations("users.list");
  const formatter = useFormatter();
  const router = useRouter();

  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [resendDone, setResendDone] = useState<string | null>(null);

  const [name, setName] = useState(user.name);
  const [roleIds, setRoleIds] = useState<string[]>(user.roles.map((r) => r.id));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitEdit() {
    setError(null);
    startTransition(async () => {
      const result = await updateUser(user.id, { name, roleIds });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditOpen(false);
      router.refresh();
    });
  }

  function submitRemove() {
    setError(null);
    if (user.isActive) {
      // Deactivation has a cascade picker that lives on the detail page.
      // Send the user there with the deactivate fragment focused.
      router.push(`/admin/users/${user.id}#deactivate`);
      setRemoveOpen(false);
      return;
    }
    // Reactivation is single-step.
    startTransition(async () => {
      const result = await reactivateUser(user.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setRemoveOpen(false);
      router.refresh();
    });
  }

  function submitResend() {
    setError(null);
    setResendDone(null);
    startTransition(async () => {
      // A never-finished import stub needs its role + credentials row created
      // before an invite means anything; a finished account just needs a new
      // link. Same button either way — the admin shouldn't have to know which.
      if (isProvisioning) {
        const result = await completeProvisioningAndInvite(user.id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setResendDone(
          result.inviteSent
            ? tDialog("resendSent", { email: user.email })
            : tDialog("finishedButInviteFailed", {
                error: result.inviteError ?? tDialog("unknownError"),
              }),
        );
      } else {
        const result = await resetUserPassword(user.id);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setResendDone(tDialog("resendSent", { email: user.email }));
      }
      setResendOpen(false);
      router.refresh();
    });
  }

  // Only offered for customers: staff go through Better Auth's own reset flow,
  // and an account that has already accepted its invite has nothing to resend.
  // A provisioning stub has no roles yet, so it can't be identified by role —
  // but it is by definition an unfinished customer import, and it's precisely
  // the row that most needs this action.
  const isProvisioning = inviteStatus === "provisioning";
  // A provisioning stub has no roles yet, so it can't be identified by role —
  // but it is by definition an unfinished customer import.
  const isCustomer = user.roles.some((r) => r.name === "Customer");
  const showResend =
    canResendInvite &&
    user.isActive &&
    inviteStatus !== "active" &&
    (isCustomer || isProvisioning);

  // Self-deactivation is dangerous — the server enforces it too,
  // but hide the icon so it isn't presented as an option.
  const showRemove =
    (user.isActive && canDeactivate && !isSelf) ||
    (!user.isActive && canReactivate);
  const removeVariant: "deactivate" | "reactivate" = user.isActive
    ? "deactivate"
    : "reactivate";

  function toggleRole(roleId: string) {
    setRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId],
    );
  }

  return (
    <>
      <RowActionIcons
        ariaLabelPrefix={user.name}
        view={() => setViewOpen(true)}
        edit={canEdit ? () => setEditOpen(true) : undefined}
        resendInvite={
          showResend ? { onClick: () => setResendOpen(true), disabled: pending } : undefined
        }
        remove={
          showRemove
            ? { onClick: () => setRemoveOpen(true), variant: removeVariant }
            : undefined
        }
      />

      {/* ── View modal ─────────────────────────────────────── */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{user.name}</DialogTitle>
            <DialogDescription className="text-foreground text-sm break-all">
              {user.email}
            </DialogDescription>
          </DialogHeader>

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.status")}
            </dt>
            <dd>
              <StatusBadge
                active={user.isActive}
                tActive={tList("filterStatusActive")}
                tInactive={tList("filterStatusInactive")}
              />
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.roles")}
            </dt>
            <dd>
              {user.roles.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {user.roles.map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-zinc-100 border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800"
                    >
                      {r.name}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-zinc-400">{tList("noRoles")}</span>
              )}
            </dd>
            <dt className="text-zinc-500 dark:text-zinc-400">
              {tList("columns.createdAt")}
            </dt>
            <dd className="text-zinc-600 dark:text-zinc-300">
              {formatter.dateTime(user.createdAt, { dateStyle: "medium" })}
            </dd>
          </dl>

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewOpen(false)}>
              {t("close")}
            </Button>
            <Button
              nativeButton={false}
              render={<Link href={`/admin/users/${user.id}`} />}
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              {tDialog("openFullProfile")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit modal (name + roles) ─────────────────────── */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setName(user.name);
            setRoleIds(user.roles.map((r) => r.id));
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tDialog("editTitle", { user: user.name })}</DialogTitle>
            <DialogDescription>{tDialog("editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-600 dark:text-zinc-400">
                {tList("columns.name")}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                maxLength={120}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-zinc-600 dark:text-zinc-400">
                {tList("columns.roles")}
              </label>
              <div className="max-h-48 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-800 p-2 space-y-1">
                {allRoles.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-center gap-2 text-sm cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900 px-2 py-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={roleIds.includes(r.id)}
                      onChange={() => toggleRole(r.id)}
                      disabled={pending}
                      className="size-4 accent-blue-600"
                    />
                    <span>{r.name}</span>
                  </label>
                ))}
              </div>
            </div>
            {error ? (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            ) : null}
            <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-1">
              {tDialog("editHint")}{" "}
              <Link
                href={`/admin/users/${user.id}`}
                className="text-blue-600 dark:text-blue-400 hover:underline"
              >
                {tDialog("openFullProfile")}
              </Link>
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button onClick={submitEdit} disabled={pending}>
              {pending ? tDialog("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Resend invite confirm ──────────────────────────── */}
      <Dialog open={resendOpen} onOpenChange={setResendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isProvisioning
                ? tDialog("finishTitle", { user: user.name })
                : tDialog("resendTitle", { user: user.name })}
            </DialogTitle>
            <DialogDescription>
              {isProvisioning
                ? tDialog("finishDescription", { email: user.email })
                : tDialog("resendDescription", { email: user.email })}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResendOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button onClick={submitResend} disabled={pending}>
              {pending
                ? tDialog("resending")
                : isProvisioning
                  ? tDialog("finishConfirm")
                  : tDialog("resendConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {resendDone ? (
        <Dialog open onOpenChange={() => setResendDone(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{tDialog("resendSentTitle")}</DialogTitle>
              <DialogDescription>{resendDone}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setResendDone(null)}>{t("close")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* ── Deactivate / Reactivate confirm modal ─────────── */}
      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {user.isActive
                ? tDialog("deactivateTitle", { user: user.name })
                : tDialog("reactivateTitle", { user: user.name })}
            </DialogTitle>
            <DialogDescription>
              {user.isActive
                ? tDialog("deactivateDescription")
                : tDialog("reactivateDescription")}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveOpen(false)}
              disabled={pending}
            >
              {t("cancel")}
            </Button>
            <Button
              variant={user.isActive ? "destructive" : "default"}
              onClick={submitRemove}
              disabled={pending}
            >
              {pending
                ? user.isActive
                  ? tDialog("opening")
                  : tDialog("reactivating")
                : user.isActive
                  ? tDialog("openDeactivate")
                  : t("reactivate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatusBadge({
  active,
  tActive,
  tInactive,
}: {
  active: boolean;
  tActive: string;
  tInactive: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${
        active
          ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-900"
          : "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:border-zinc-800"
      }`}
    >
      {active ? tActive : tInactive}
    </span>
  );
}
