"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FilterCombobox,
  FilterMultiCombobox,
  type ComboOption,
} from "@/components/ui/filter-combobox";
import { BILLING_FILTER_VALUES } from "@/lib/tickets/billing-status";

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const CATEGORIES = [
  "hardware",
  "software",
  "network",
  "access",
  "other",
] as const;
const STREAMS = ["internal", "external"] as const;

type TicketFiltersProps = {
  initial: {
    status: string[];
    priority: string[];
    category: string[];
    stream: string[];
    assignee: string;
    escalated: boolean;
    from: string;
    to: string;
    billing: string[];
    org: string;
    customer: string;
    q: string;
    /** Current tab scope — preserved across filter changes so changing a
     *  filter doesn't bounce the user back to the Active tab. */
    view: "active" | "closed" | "all";
  };
  technicians: { id: string; name: string }[];
  organizations: { id: string; name: string }[];
  customers: { email: string; name: string }[];
  activeCount: number;
};

export function TicketFilters({
  initial,
  technicians,
  organizations,
  customers,
  activeCount,
}: TicketFiltersProps) {
  const router = useRouter();
  const t = useTranslations("tickets.filters");
  const tStatus = useTranslations("tickets.status");
  const tPriority = useTranslations("tickets.priority");
  const tCategory = useTranslations("tickets.category");
  const tStream = useTranslations("tickets.stream");
  const tBillingOpt = useTranslations("tickets.filters.billingOptions");
  const [pending, startTransition] = useTransition();

  const searchPh = t("searchOptions");
  const noMatches = t("noMatches");

  /** Push a new URL preserving every other filter that the caller didn't
   * change. Empty arrays / empty strings get OMITTED from the URL so the
   * canonical "no filter" form has no query param at all. */
  function pushFilters(patch: Partial<TicketFiltersProps["initial"]>) {
    const next = { ...initial, ...patch };
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
    if (next.view !== "active") params.set("view", next.view);
    if (next.status.length > 0) params.set("status", next.status.join(","));
    if (next.priority.length > 0)
      params.set("priority", next.priority.join(","));
    if (next.category.length > 0)
      params.set("category", next.category.join(","));
    if (next.stream.length > 0) params.set("stream", next.stream.join(","));
    if (next.assignee) params.set("assignee", next.assignee);
    if (next.escalated) params.set("escalated", "1");
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
    if (next.billing.length > 0) params.set("billing", next.billing.join(","));
    if (next.org) params.set("org", next.org);
    if (next.customer) params.set("customer", next.customer);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/admin/tickets?${qs}` : "/admin/tickets");
    });
  }

  function clearAll() {
    // Preserve the free-text search AND the current tab; everything else resets.
    const params = new URLSearchParams();
    if (initial.q) params.set("q", initial.q);
    if (initial.view !== "active") params.set("view", initial.view);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/admin/tickets?${qs}` : "/admin/tickets");
    });
  }

  // Single-select option lists — the first entry (value "") is the reset.
  const assigneeOptions: ComboOption[] = [
    { value: "", label: t("anyAssignee") },
    { value: "unassigned", label: t("unassigned") },
    ...technicians.map((tech) => ({ value: tech.id, label: tech.name })),
  ];
  const orgOptions: ComboOption[] = [
    { value: "", label: t("anyOrganization") },
    ...organizations.map((o) => ({ value: o.id, label: o.name })),
  ];
  const customerOptions: ComboOption[] = [
    { value: "", label: t("anyCustomer") },
    ...customers.map((c) => ({
      value: c.email,
      label: c.name && c.name !== c.email ? `${c.name} · ${c.email}` : c.email,
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterMultiCombobox
        label={t("status")}
        value={initial.status}
        options={STATUSES.map((v) => ({ value: v, label: tStatus(v) }))}
        onChange={(next) => pushFilters({ status: next })}
        disabled={pending}
        searchPlaceholder={searchPh}
        emptyMessage={noMatches}
      />
      <FilterMultiCombobox
        label={t("priority")}
        value={initial.priority}
        options={PRIORITIES.map((v) => ({ value: v, label: tPriority(v) }))}
        onChange={(next) => pushFilters({ priority: next })}
        disabled={pending}
        searchPlaceholder={searchPh}
        emptyMessage={noMatches}
      />
      <FilterMultiCombobox
        label={t("category")}
        value={initial.category}
        options={CATEGORIES.map((v) => ({ value: v, label: tCategory(v) }))}
        onChange={(next) => pushFilters({ category: next })}
        disabled={pending}
        searchPlaceholder={searchPh}
        emptyMessage={noMatches}
      />
      <FilterMultiCombobox
        label={t("stream")}
        value={initial.stream}
        options={STREAMS.map((v) => ({ value: v, label: tStream(v) }))}
        onChange={(next) => pushFilters({ stream: next })}
        disabled={pending}
        searchPlaceholder={searchPh}
        emptyMessage={noMatches}
      />
      <FilterMultiCombobox
        label={t("billing")}
        value={initial.billing}
        options={BILLING_FILTER_VALUES.map((v) => ({
          value: v,
          label: tBillingOpt(v),
        }))}
        onChange={(next) => pushFilters({ billing: next })}
        disabled={pending}
        searchPlaceholder={searchPh}
        emptyMessage={noMatches}
      />

      <FilterCombobox
        ariaLabel={t("organization")}
        value={initial.org}
        options={orgOptions}
        onChange={(v) => pushFilters({ org: v })}
        disabled={pending}
        searchPlaceholder={searchPh}
        emptyMessage={noMatches}
      />
      <FilterCombobox
        ariaLabel={t("customer")}
        value={initial.customer}
        options={customerOptions}
        onChange={(v) => pushFilters({ customer: v })}
        disabled={pending}
        searchPlaceholder={searchPh}
        emptyMessage={noMatches}
      />
      <FilterCombobox
        ariaLabel={t("assignee")}
        value={initial.assignee}
        options={assigneeOptions}
        onChange={(v) => pushFilters({ assignee: v })}
        disabled={pending}
        searchPlaceholder={searchPh}
        emptyMessage={noMatches}
      />

      {/* Escalated-only — pill toggle. */}
      <Button
        variant={initial.escalated ? "default" : "outline"}
        size="sm"
        onClick={() => pushFilters({ escalated: !initial.escalated })}
        disabled={pending}
        aria-pressed={initial.escalated}
      >
        {t("escalatedOnly")}
      </Button>

      {/* Date range — created_at on/after `from`, on/before `to`. */}
      <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        <span>{t("from")}</span>
        <input
          type="date"
          value={initial.from}
          onChange={(e) => pushFilters({ from: e.target.value })}
          disabled={pending}
          className="h-9 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
        <span>{t("to")}</span>
        <input
          type="date"
          value={initial.to}
          onChange={(e) => pushFilters({ to: e.target.value })}
          disabled={pending}
          className="h-9 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
        />
      </label>

      {activeCount > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearAll}
          disabled={pending}
          className="ml-auto"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {t("clearAll", { count: activeCount })}
        </Button>
      ) : null}
    </div>
  );
}
