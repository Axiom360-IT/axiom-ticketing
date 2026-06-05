"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addOrganizationHours } from "@/app/actions/organizations";

// Admin "Add hours" control (req 8.3) — the only manual way to move an org's
// otherwise read-only balance (req 8.1). Additive top-up for a given month.
export function AddHoursControl({ organizationId }: { organizationId: string }) {
  const t = useTranslations("organizations.addHours");
  const router = useRouter();
  const [hours, setHours] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = Number(hours.trim());
    if (!Number.isFinite(n) || n <= 0) {
      setError(t("invalid"));
      return;
    }
    setError(null);
    setPending(true);
    const res = await addOrganizationHours(organizationId, n);
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setHours("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Label htmlFor="add-hours">{t("label")}</Label>
      <div className="flex items-center gap-2">
        <Input
          id="add-hours"
          type="number"
          min="0"
          step="0.25"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder={t("placeholder")}
          className="w-32"
          aria-describedby="add-hours-hint"
        />
        <Button type="submit" size="sm" disabled={pending || hours.trim() === ""}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {pending ? t("adding") : t("add")}
        </Button>
      </div>
      <p id="add-hours-hint" className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("hint")}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
