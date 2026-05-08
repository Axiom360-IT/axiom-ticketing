"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { updateUser } from "@/app/actions/users";
import { cn } from "@/lib/utils";

type Role = { id: string; name: string };

type Props = {
  userId: string;
  initial: {
    name: string;
    email: string;
    language: string;
    roleIds: string[];
  };
  roles: Role[];
  isActive: boolean;
};

export function EditUserForm({ userId, initial, roles, isActive }: Props) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const tFields = useTranslations("users.fields");
  const tEdit = useTranslations("users.edit");
  const tCommon = useTranslations("common");

  const [name, setName] = useState(initial.name);
  const [language, setLanguage] = useState(initial.language);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initial.roleIds),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggleRole(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await runWithReauth(
      () =>
        updateUser(userId, {
          name,
          language,
          roleIds: [...selected],
        }),
      "superAdmin",
    );
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            disabled={!isActive}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">{tFields("email")}</Label>
          <Input
            id="email"
            type="email"
            value={initial.email}
            disabled
            readOnly
          />
        </div>
      </div>

      <div className="space-y-1.5 max-w-xs">
        <Label htmlFor="language">{tFields("language")}</Label>
        <Input
          id="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          maxLength={10}
          disabled={!isActive}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{tEdit("rolesTitle")}</legend>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => {
            const on = selected.has(r.id);
            return (
              <button
                type="button"
                key={r.id}
                onClick={() => toggleRole(r.id)}
                disabled={!isActive}
                className={cn(
                  "px-3 py-1.5 rounded-full border text-sm transition-colors",
                  on
                    ? "bg-blue-600 text-white border-blue-700"
                    : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900",
                  !isActive && "opacity-50 cursor-not-allowed",
                )}
                aria-pressed={on}
              >
                {r.name}
              </button>
            );
          })}
        </div>
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
        <Button type="submit" disabled={saving || !isActive}>
          {saving ? tEdit("saving") : tEdit("saveButton")}
        </Button>
      </div>
      {gate}
    </form>
  );
}
