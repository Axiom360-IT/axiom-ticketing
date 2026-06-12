"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PhoneField } from "@/components/ui/phone-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { createUser } from "@/app/actions/users";
import {
  RoleMultiSelect,
  type RoleOption,
} from "@/components/users/role-multi-select";

const NO_ORG = "__none__";

export function CreateUserForm({
  roles,
  organizations,
}: {
  roles: RoleOption[];
  organizations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const tFields = useTranslations("users.fields");
  const tCreate = useTranslations("users.create");
  const tCommon = useTranslations("common");

  const [data, setData] = useState({
    name: "",
    email: "",
    phone: "",
  });
  const [organizationId, setOrganizationId] = useState(NO_ORG);
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
          organizationId: organizationId === NO_ORG ? undefined : organizationId,
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
          <Label htmlFor="phone">
            {tFields("phone")}
            <span className="ml-1 text-xs font-normal text-zinc-500">
              {tFields("phoneOptional")}
            </span>
          </Label>
          <PhoneField
            id="phone"
            value={data.phone || undefined}
            onChange={(v) => update("phone", v ?? "")}
            placeholder={tFields("phonePlaceholder")}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {tFields("phoneHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="organization">{tFields("organization")}</Label>
          <Select
            items={{
              [NO_ORG]: tFields("organizationNone"),
              ...Object.fromEntries(organizations.map((o) => [o.id, o.name])),
            }}
            value={organizationId}
            onValueChange={(v) => setOrganizationId(v ?? NO_ORG)}
          >
            <SelectTrigger id="organization">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ORG}>
                {tFields("organizationNone")}
              </SelectItem>
              {organizations.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 -mt-2">
        {tCreate("welcomeEmailHint")}
      </p>

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
