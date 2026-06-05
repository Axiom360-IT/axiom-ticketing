"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  checkOrgCode,
  createOrganization,
  suggestOrgCode,
  updateOrganization,
} from "@/app/actions/organizations";
import { cn } from "@/lib/utils";

type CodeState = "idle" | "checking" | "ok" | "taken" | "invalid";

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
  // "Hours remaining" (balance) is READ-ONLY (req 8.1). It changes only through
  // logged work, the automatic monthly reset, and the admin "Add hours" control
  // on the organization page — never by typing here. Shown for reference in
  // edit mode; never part of the submitted payload.
  const hoursBalance = initial?.monthlyHoursBalance ?? "";
  const [contractNotes, setContractNotes] = useState(
    initial?.contractNotes ?? "",
  );
  const [emailDomains, setEmailDomains] = useState(
    initial?.emailDomains ?? "",
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Organization code (abbreviation) generation + live validation.
  const [codeState, setCodeState] = useState<CodeState>(
    initial?.abbreviation ? "ok" : "idle",
  );
  const [generating, setGenerating] = useState(false);
  // `true` once the code is user-controlled, which stops auto-generating it
  // from the name. Edit mode starts locked so we never clobber an existing code.
  const codeTouchedRef = useRef(mode === "edit");

  // Live availability/format check on every code change (debounced). All state
  // updates happen inside the timeout so nothing runs synchronously in the
  // effect body.
  useEffect(() => {
    const code = abbreviation.trim();
    const handle = setTimeout(async () => {
      if (!code) {
        setCodeState("idle");
        return;
      }
      setCodeState("checking");
      try {
        const res = await checkOrgCode(code, initial?.id);
        setCodeState(!res.valid ? "invalid" : res.available ? "ok" : "taken");
      } catch {
        setCodeState("idle");
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [abbreviation, initial?.id]);

  /** Derive a unique code from the name (only while the code is still auto). */
  async function autofillCodeFromName(nm: string) {
    if (codeTouchedRef.current || !nm.trim()) return;
    const res = await suggestOrgCode(nm);
    if (res.ok && !codeTouchedRef.current) setAbbreviation(res.code);
  }

  /** "Generate Code" button — request a fresh unique code, different from the
   *  current one, and lock it (so typing the name won't overwrite it). */
  async function handleGenerateCode() {
    if (!name.trim()) return;
    setGenerating(true);
    const res = await suggestOrgCode(
      name,
      abbreviation.trim() ? [abbreviation.trim()] : [],
    );
    setGenerating(false);
    if (res.ok) {
      setAbbreviation(res.code);
      codeTouchedRef.current = true;
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const payload = {
      name,
      abbreviation,
      isMonthlyPlan,
      monthlyHoursIncluded: isMonthlyPlan ? parseHours(hoursIncluded) : null,
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
          onBlur={(e) => void autofillCodeFromName(e.target.value)}
          maxLength={160}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="org-abbreviation">{tFields("abbreviation")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="org-abbreviation"
            required
            value={abbreviation}
            onChange={(e) => {
              setAbbreviation(e.target.value.toUpperCase());
              codeTouchedRef.current = true;
            }}
            maxLength={5}
            className="uppercase font-mono w-28"
            aria-describedby="org-abbreviation-hint"
            aria-invalid={
              codeState === "taken" || codeState === "invalid" ? true : undefined
            }
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleGenerateCode()}
            disabled={generating || !name.trim()}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", generating && "animate-spin")}
              aria-hidden="true"
            />
            {tFields("generateCode")}
          </Button>
          {codeState === "checking" ? (
            <span className="text-xs text-zinc-400">
              {tFields("codeChecking")}
            </span>
          ) : codeState === "ok" ? (
            <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {tFields("codeAvailable")}
            </span>
          ) : null}
        </div>
        {codeState === "taken" ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {tFields("codeTaken")}
          </p>
        ) : codeState === "invalid" ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {tFields("codeInvalid")}
          </p>
        ) : (
          <p
            id="org-abbreviation-hint"
            className="text-xs text-zinc-500 dark:text-zinc-400"
          >
            {tFields("abbreviationHint")}
          </p>
        )}
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
              required
              value={hoursIncluded}
              onChange={(e) => setHoursIncluded(e.target.value)}
            />
          </div>
          {mode === "edit" ? (
            <div className="space-y-1.5">
              <Label htmlFor="org-hours-balance">
                {tFields("monthlyHoursBalance")}
              </Label>
              {/* Read-only (req 8.1) — not an input. */}
              <output
                id="org-hours-balance"
                className="flex h-9 items-center rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm tabular-nums text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
              >
                {hoursBalance === "" ? "—" : hoursBalance}
              </output>
              <p
                id="org-hours-balance-hint"
                className="text-xs text-zinc-500 dark:text-zinc-400"
              >
                {tFields("monthlyHoursBalanceReadonlyHint")}
              </p>
            </div>
          ) : null}
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
        <Button type="submit" disabled={submitting || codeState !== "ok"}>
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
