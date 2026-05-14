"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    q: string;
  };
  technicians: { id: string; name: string }[];
  activeCount: number;
};

export function TicketFilters({
  initial,
  technicians,
  activeCount,
}: TicketFiltersProps) {
  const router = useRouter();
  const t = useTranslations("tickets.filters");
  const tStatus = useTranslations("tickets.status");
  const tPriority = useTranslations("tickets.priority");
  const tCategory = useTranslations("tickets.category");
  const tStream = useTranslations("tickets.stream");
  const [pending, startTransition] = useTransition();

  /** Push a new URL preserving every other filter that the caller didn't
   * change. Empty arrays / empty strings get OMITTED from the URL so the
   * canonical "no filter" form has no query param at all. */
  function pushFilters(
    patch: Partial<TicketFiltersProps["initial"]>,
  ) {
    const next = { ...initial, ...patch };
    const params = new URLSearchParams();
    if (next.q) params.set("q", next.q);
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
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/admin/tickets?${qs}` : "/admin/tickets");
    });
  }

  function clearAll() {
    startTransition(() => {
      // Preserve only the free-text search; everything else resets.
      router.push(
        initial.q ? `/admin/tickets?q=${encodeURIComponent(initial.q)}` : "/admin/tickets",
      );
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelect
        label={t("status")}
        values={initial.status}
        options={STATUSES.map((v) => ({ value: v, label: tStatus(v) }))}
        onChange={(next) => pushFilters({ status: next })}
        disabled={pending}
      />
      <MultiSelect
        label={t("priority")}
        values={initial.priority}
        options={PRIORITIES.map((v) => ({ value: v, label: tPriority(v) }))}
        onChange={(next) => pushFilters({ priority: next })}
        disabled={pending}
      />
      <MultiSelect
        label={t("category")}
        values={initial.category}
        options={CATEGORIES.map((v) => ({ value: v, label: tCategory(v) }))}
        onChange={(next) => pushFilters({ category: next })}
        disabled={pending}
      />
      <MultiSelect
        label={t("stream")}
        values={initial.stream}
        options={STREAMS.map((v) => ({ value: v, label: tStream(v) }))}
        onChange={(next) => pushFilters({ stream: next })}
        disabled={pending}
      />

      {/* Assignee — single-select. "Unassigned" is a sentinel value. */}
      <select
        value={initial.assignee}
        onChange={(e) => pushFilters({ assignee: e.target.value })}
        disabled={pending}
        aria-label={t("assignee")}
        className="h-9 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        <option value="">{t("anyAssignee")}</option>
        <option value="unassigned">{t("unassigned")}</option>
        {technicians.length > 0 ? (
          <optgroup label={t("technicians")}>
            {technicians.map((tech) => (
              <option key={tech.id} value={tech.id}>
                {tech.name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>

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

// ── MultiSelect popover ─────────────────────────────────────────────
// Reuses the existing DropdownMenu primitive (Base UI Menu under the
// hood) with CheckboxItem children. Keeps the bundle from growing a
// new Popover dependency and matches the visual treatment of every
// other dropdown in the app.

function MultiSelect({
  label,
  values,
  options,
  onChange,
  disabled,
}: {
  label: string;
  values: string[];
  options: { value: string; label: string }[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(values);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button variant="outline" size="sm" disabled={disabled}>
            <span>{label}</span>
            {selected.size > 0 ? (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[10px] px-1.5">
                {selected.size}
              </span>
            ) : null}
            <ChevronDown className="h-3.5 w-3.5 ml-0.5" aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-48">
        {options.map((opt) => (
          <DropdownMenuCheckboxItem
            key={opt.value}
            checked={selected.has(opt.value)}
            onCheckedChange={(checked) => {
              const next = checked
                ? [...values, opt.value]
                : values.filter((v) => v !== opt.value);
              onChange(next);
            }}
            // Don't auto-close so users can pick multiple in one go.
            closeOnClick={false}
          >
            {opt.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
