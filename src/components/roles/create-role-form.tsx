"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PermissionsMatrix } from "@/components/roles/permissions-matrix";
import { createRole } from "@/app/actions/roles";
import type { Permission } from "@/lib/auth/permissions";

type Props = {
  callerPermissions: Permission[];
  callerHasAll: boolean;
};

export function CreateRoleForm({ callerPermissions, callerHasAll }: Props) {
  const router = useRouter();
  const tFields = useTranslations("roles.fields");
  const tCreate = useTranslations("roles.create");
  const tCommon = useTranslations("common");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Permission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await createRole({
      name,
      description,
      permissions: perms,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/admin/roles/${res.roleId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
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
        <Label>{tFields("permissions")}</Label>
        <PermissionsMatrix
          value={perms}
          callerPermissions={callerPermissions}
          callerHasAll={callerHasAll}
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

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/roles")}
        >
          {tCommon("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? tCreate("submitting") : tCreate("submit")}
        </Button>
      </div>
    </form>
  );
}
