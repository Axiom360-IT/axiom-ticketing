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
  /** Super Admin can edit system-role permissions (Meeting-2, CR-27). */
  callerIsSuperAdmin: boolean;
};

export function EditRoleForm({
  roleId,
  initial,
  callerPermissions,
  callerHasAll,
  canDelete,
  callerIsSuperAdmin,
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

  // System-role permissions are editable only by a Super Admin (CR-27).
  const permsLocked = initial.isSystem && !callerIsSuperAdmin;

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
      {initial.isSystem ? (
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
        />
      </div>

      <div className="space-y-2">
        <Label>{tEdit("permissionsTitle")}</Label>
        <PermissionsMatrix
          value={perms}
          callerPermissions={callerPermissions}
          callerHasAll={callerHasAll}
          readOnly={permsLocked}
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
        {canDelete && !initial.isSystem ? (
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
          <Button type="submit" disabled={saving}>
            {saving ? tEdit("saving") : tEdit("saveButton")}
          </Button>
        </div>
      </div>
    </form>
  );
}
