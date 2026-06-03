"use client";

import { type FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createOrganization,
  updateOrganization,
} from "@/app/actions/organizations";

export type OrganizationFormInitial = {
  id: string;
  name: string;
  abbreviation: string;
  isMonthlyPlan: boolean;
  monthlyHoursIncluded: string;
  monthlyHoursBalance: string;
  contractNotes: string;
  /** Registered email domains, one per line. */
  emailDomains: string;
  isActive: boolean;
};

type Props = {
  mode: "create" | "edit";
  initial?: OrganizationFormInitial;
  /** Prefill the name in create mode (e.g. from a triaged ticket's claim). */
  defaultName?: string;
};

function parseHours(v: string): number | null {
  const trimmed = v.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function OrganizationForm({ mode, initial, defaultName }: Props) {
  const router = useRouter();
  const tFields = useTranslations("organizations.fields");
  const tForm = useTranslations("organizations.form");
  const tCommon = useTranslations("common");

  const [name, setName] = useState(initial?.name ?? defaultName ?? "");
  const [abbreviation, setAbbreviation] = useState(initial?.abbreviation ?? "");
  const [isMonthlyPlan, setIsMonthlyPlan] = useState(
    initial?.isMonthlyPlan ?? false,
  );
  const [hoursIncluded, setHoursIncluded] = useState(
    initial?.monthlyHoursIncluded ?? "",
  );
  const [hoursBalance, setHoursBalance] = useState(
    initial?.monthlyHoursBalance ?? "",
  );
  const [contractNotes, setContractNotes] = useState(
    initial?.contractNotes ?? "",
  );
  const [emailDomains, setEmailDomains] = useState(
    initial?.emailDomains ?? "",
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload = {
      name,
      abbreviation,
      isMonthlyPlan,
      monthlyHoursIncluded: isMonthlyPlan ? parseHours(hoursIncluded) : null,
      monthlyHoursBalance: isMonthlyPlan ? parseHours(hoursBalance) : null,
      contractNotes,
      emailDomains: emailDomains
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      isActive,
    };
    const res =
      mode === "create"
        ? await createOrganization(payload)
        : await updateOrganization(initial!.id, payload);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push("/admin/organizations");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="org-name">{tFields("name")}</Label>
        <Input
          id="org-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={160}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-abbreviation">{tFields("abbreviation")}</Label>
        <Input
          id="org-abbreviation"
          required
          value={abbreviation}
          onChange={(e) => setAbbreviation(e.target.value.toUpperCase())}
          maxLength={5}
          className="uppercase font-mono w-32"
          aria-describedby="org-abbreviation-hint"
        />
        <p
          id="org-abbreviation-hint"
          className="text-xs text-zinc-500 dark:text-zinc-400"
        >
          {tFields("abbreviationHint")}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-email-domains">{tFields("emailDomains")}</Label>
        <Textarea
          id="org-email-domains"
          value={emailDomains}
          onChange={(e) => setEmailDomains(e.target.value)}
          rows={3}
          placeholder={"kingsmill.com\nkingsmillfoods.com"}
          className="font-mono text-sm"
          aria-describedby="org-email-domains-hint"
        />
        <p
          id="org-email-domains-hint"
          className="text-xs text-zinc-500 dark:text-zinc-400"
        >
          {tFields("emailDomainsHint")}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="org-monthly-plan"
          type="checkbox"
          checked={isMonthlyPlan}
          onChange={(e) => setIsMonthlyPlan(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
        />
        <Label htmlFor="org-monthly-plan" className="!mb-0">
          {tFields("isMonthlyPlan")}
        </Label>
      </div>

      {isMonthlyPlan ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-md border border-zinc-200 dark:border-zinc-800 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="org-hours-included">
              {tFields("monthlyHoursIncluded")}
            </Label>
            <Input
              id="org-hours-included"
              type="number"
              min={0}
              step="0.25"
              value={hoursIncluded}
              onChange={(e) => setHoursIncluded(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-hours-balance">
              {tFields("monthlyHoursBalance")}
            </Label>
            <Input
              id="org-hours-balance"
              type="number"
              min={0}
              step="0.25"
              value={hoursBalance}
              onChange={(e) => setHoursBalance(e.target.value)}
              aria-describedby="org-hours-balance-hint"
            />
            <p
              id="org-hours-balance-hint"
              className="text-xs text-zinc-500 dark:text-zinc-400"
            >
              {tFields("monthlyHoursBalanceHint")}
            </p>
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="org-contract-notes">{tFields("contractNotes")}</Label>
        <Textarea
          id="org-contract-notes"
          value={contractNotes}
          onChange={(e) => setContractNotes(e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="org-active"
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
        />
        <Label htmlFor="org-active" className="!mb-0">
          {tFields("isActive")}
        </Label>
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
          onClick={() => router.push("/admin/organizations")}
        >
          {tCommon("cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting
            ? tForm("saving")
            : mode === "create"
              ? tForm("create")
              : tForm("save")}
        </Button>
      </div>
    </form>
  );
}
