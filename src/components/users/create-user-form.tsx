"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { createUser } from "@/app/actions/users";
import {
  RoleMultiSelect,
  type RoleOption,
} from "@/components/users/role-multi-select";

export function CreateUserForm({ roles }: { roles: RoleOption[] }) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const tFields = useTranslations("users.fields");
  const tCreate = useTranslations("users.create");
  const tCommon = useTranslations("common");

  const [data, setData] = useState({
    name: "",
    email: "",
    language: "en",
  });
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof data>(k: K, v: (typeof data)[K]) {
    setData((d) => ({ ...d, [k]: v }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await runWithReauth(
      () =>
        createUser({
          ...data,
          roleIds: selectedRoles,
        }),
      "superAdmin",
    );
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/admin/users/${res.userId}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <Label htmlFor="name">{tFields("name")}</Label>
          <Input
            id="name"
            required
            value={data.name}
            onChange={(e) => update("name", e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">{tFields("email")}</Label>
          <Input
            id="email"
            type="email"
            required
            value={data.email}
            onChange={(e) => update("email", e.target.value)}
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <Label htmlFor="language">{tFields("language")}</Label>
          <Input
            id="language"
            value={data.language}
            onChange={(e) => update("language", e.target.value)}
            maxLength={10}
          />
        </div>
        <div className="space-y-1.5">
          {/* No password field — admin doesn't set the password.
              The user receives a welcome email with a setup link. */}
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-7">
            {tCreate("welcomeEmailHint")}
          </p>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{tFields("roles")}</legend>
        <RoleMultiSelect
          roles={roles}
          value={selectedRoles}
          onChange={setSelectedRoles}
        />
      </fieldset>

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
          onClick={() => router.push("/admin/users")}
        >
          {tCommon("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? tCreate("submitting") : tCreate("submit")}
        </Button>
      </div>
      {gate}
    </form>
  );
}
