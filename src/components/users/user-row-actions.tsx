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
import { reactivateUser, updateUser } from "@/app/actions/users";

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
  allRoles: { id: string; name: string }[];
};

export function UserRowActions({
  user,
  isSelf,
  canEdit,
  canDeactivate,
  canReactivate,
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
