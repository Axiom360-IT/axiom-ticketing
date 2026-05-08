"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useReauthGate } from "@/components/shared/use-reauth-gate";
import { createUser } from "@/app/actions/users";
import { cn } from "@/lib/utils";

type Role = { id: string; name: string };

export function CreateUserForm({ roles }: { roles: Role[] }) {
  const router = useRouter();
  const { runWithReauth, gate } = useReauthGate();
  const tFields = useTranslations("users.fields");
  const tCreate = useTranslations("users.create");
  const tCommon = useTranslations("common");

  const [data, setData] = useState({
    name: "",
    email: "",
    password: "",
    language: "en",
  });
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof typeof data>(k: K, v: (typeof data)[K]) {
    setData((d) => ({ ...d, [k]: v }));
  }

  function toggleRole(id: string) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await runWithReauth(
      () =>
        createUser({
          ...data,
          roleIds: [...selectedRoles],
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
          <Label htmlFor="password">{tFields("password")}</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={12}
            value={data.password}
            onChange={(e) => update("password", e.target.value)}
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {tFields("passwordHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="language">{tFields("language")}</Label>
          <Input
            id="language"
            value={data.language}
            onChange={(e) => update("language", e.target.value)}
            maxLength={10}
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{tFields("roles")}</legend>
        <div className="flex flex-wrap gap-2">
          {roles.map((r) => {
            const on = selectedRoles.has(r.id);
            return (
              <button
                type="button"
                key={r.id}
                onClick={() => toggleRole(r.id)}
                className={cn(
                  "px-3 py-1.5 rounded-full border text-sm transition-colors",
                  on
                    ? "bg-blue-600 text-white border-blue-700"
                    : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900",
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
        <Button type="submit" disabled={submitting}>
          {submitting ? tCreate("submitting") : tCreate("submit")}
        </Button>
      </div>
      {gate}
    </form>
  );
}
