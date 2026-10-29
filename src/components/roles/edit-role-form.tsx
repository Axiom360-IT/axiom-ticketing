"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PermissionsMatrix } from "@/components/roles/permissions-matrix";
import { deleteRole, updateRole } from "@/app/actions/roles";
import type { Permission } from "@/lib/auth/permissions";
import type { UndelegableDisplay } from "@/lib/auth/rank";

type Props = {
  roleId: string;
  initial: {
    name: string;
    description: string;
    permissions: Permission[];
    isSystem: boolean;
  };
  callerPermissions: Permission[];
  callerHasAll: boolean;
  canDelete: boolean;
  display: UndelegableDisplay;
  /**
   * May the caller change this role AT ALL? False when the role is ranked at or
   * above them (lib/auth/rank.ts): they can look, they cannot edit its name,
   * description or permissions, and cannot delete it. Computed on the server;
   * the server action refuses regardless, this only stops the form offering a
   * save button that is certain to fail.
   */
  canEditRole: boolean;
  /** …and its permission set, which also depends on the system-role rule
   *  (Meeting-2, CR-27). */
  canEditPermissions: boolean;
};

export function EditRoleForm({
  roleId,
  initial,
  callerPermissions,
  callerHasAll,
  canDelete,
  display,
  canEditRole,
  canEditPermissions,
}: Props) {
  const router = useRouter();
  const tFields = useTranslations("roles.fields");
  const tEdit = useTranslations("roles.edit");
  const tCommon = useTranslations("common");

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [perms, setPerms] = useState<Permission[]>(initial.permissions);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isDeletePending, startDelete] = useTransition();

  const permsLocked = !canEditPermissions;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await updateRole(roleId, {
      name,
      description,
      // Send permissions unless they're locked (the action would reject).
      ...(permsLocked ? {} : { permissions: perms }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  function handleDelete() {
    if (!confirm(tEdit("deleteConfirm"))) return;
    setError(null);
    startDelete(async () => {
      const res = await deleteRole(roleId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/admin/roles");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {!canEditRole ? (
        <div className="text-xs px-3 py-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 text-amber-800 dark:text-amber-300">
          {tEdit("outranked")}
        </div>
      ) : initial.isSystem ? (
        <div className="text-xs px-3 py-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 text-amber-800 dark:text-amber-300">
          {permsLocked ? tEdit("systemBadge") : tEdit("systemEditableBadge")}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="role-name">{tFields("name")}</Label>
        <Input
          id="role-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          disabled={!canEditRole}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="role-description">{tFields("description")}</Label>
        <Textarea
          id="role-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          maxLength={500}
          disabled={!canEditRole}
        />
      </div>

      <div className="space-y-2">
        <Label>{tEdit("permissionsTitle")}</Label>
        <PermissionsMatrix
          value={perms}
          callerPermissions={callerPermissions}
          callerHasAll={callerHasAll}
          readOnly={permsLocked}
          display={display}
          onChange={setPerms}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-between items-center gap-2">
        {canDelete && canEditRole && !initial.isSystem ? (
          <Button
            type="button"
            variant="destructive"
            disabled={isDeletePending}
            onClick={handleDelete}
          >
            {isDeletePending ? tEdit("deleting") : tEdit("deleteButton")}
          </Button>
        ) : (
          <div />
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/admin/roles")}
          >
            {tCommon("cancel")}
          </Button>
          {canEditRole ? (
            <Button type="submit" disabled={saving}>
              {saving ? tEdit("saving") : tEdit("saveButton")}
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
