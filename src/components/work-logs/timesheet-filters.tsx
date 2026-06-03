"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UrlFilterSelect } from "@/components/ui/url-filter-select";

type Option = { value: string; label: string };

const FILTER_KEYS = [
  "technician",
  "organization",
  "service",
  "billable",
  "from",
  "to",
] as const;

export function TimesheetFilters({
  canViewAll,
  technicianOptions,
  organizationOptions,
  serviceOptions,
  billableOptions,
  initial,
  labels,
}: {
  canViewAll: boolean;
  technicianOptions: Option[];
  organizationOptions: Option[];
  serviceOptions: Option[];
  billableOptions: Option[];
  initial: {
    technician: string;
    organization: string;
    service: string;
    billable: string;
    from: string;
    to: string;
  };
  labels: {
    technician: string;
    organization: string;
    service: string;
    billable: string;
    from: string;
    to: string;
    clear: string;
    any: string;
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const hasActive = FILTER_KEYS.some((k) => searchParams.get(k));

  function pushParam(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    // A filter change resets paging so you never land past the last page.
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  function clearAll() {
    startTransition(() => router.push(pathname));
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {canViewAll ? (
        <UrlFilterSelect
          name="technician"
          label={labels.technician}
          value={initial.technician}
          options={technicianOptions}
          anyLabel={labels.any}
        />
      ) : null}
      <UrlFilterSelect
        name="organization"
        label={labels.organization}
        value={initial.organization}
        options={organizationOptions}
        anyLabel={labels.any}
      />
      <UrlFilterSelect
        name="service"
        label={labels.service}
        value={initial.service}
        options={serviceOptions}
        anyLabel={labels.any}
      />
      <UrlFilterSelect
        name="billable"
        label={labels.billable}
        value={initial.billable}
        options={billableOptions}
        anyLabel={labels.any}
      />

      <div className="space-y-1.5">
        <label
          htmlFor="wl-from"
          className="block text-xs text-zinc-500 dark:text-zinc-400"
        >
          {labels.from}
        </label>
        <Input
          id="wl-from"
          type="date"
          value={initial.from}
          onChange={(e) => pushParam("from", e.target.value)}
          className="h-9"
          disabled={pending}
        />
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="wl-to"
          className="block text-xs text-zinc-500 dark:text-zinc-400"
        >
          {labels.to}
        </label>
        <Input
          id="wl-to"
          type="date"
          value={initial.to}
          onChange={(e) => pushParam("to", e.target.value)}
          className="h-9"
          disabled={pending}
        />
      </div>

      {hasActive ? (
        <Button
          variant="ghost"
          size="lg"
          onClick={clearAll}
          disabled={pending}
        >
          <X className="h-4 w-4" aria-hidden="true" />
          {labels.clear}
        </Button>
      ) : null}
    </div>
  );
}
