"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus, UserRound, X } from "lucide-react";
import type { OrgColleague } from "@/lib/customer/queries";
import { cn } from "@/lib/utils";

// Who else should be on this ticket, chosen at submission time.
//
// Two routes, kept visibly separate because they do NOT have the same outcome
// and the person choosing deserves to know that:
//
//   • a colleague from the dropdown joins IMMEDIATELY — a verified account in
//     the same organization as the ticket;
//   • a typed address goes to our team for approval first — the submitter is
//     signed in, but the address is arbitrary.
//
// The dropdown lists the submitter's own organization only. It is populated
// server-side, so no other organization's people are ever sent to the browser.

type Props = {
  colleagues: OrgColleague[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  emails: string[];
  onEmailsChange: (emails: string[]) => void;
  disabled?: boolean;
  maxTotal?: number;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ParticipantPicker({
  colleagues,
  selectedIds,
  onSelectedIdsChange,
  emails,
  onEmailsChange,
  disabled,
  maxTotal = 10,
}: Props) {
  const t = useTranslations("portal.tickets.new.participants");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const total = selectedIds.length + emails.length;
  const full = total >= maxTotal;

  const matches = colleagues.filter((c) =>
    c.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function toggleColleague(id: string) {
    setError(null);
    if (selectedIds.includes(id)) {
      onSelectedIdsChange(selectedIds.filter((x) => x !== id));
      return;
    }
    if (full) {
      setError(t("tooMany", { max: maxTotal }));
      return;
    }
    onSelectedIdsChange([...selectedIds, id]);
  }

  function addEmail() {
    const email = emailDraft.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setError(t("emailInvalid"));
      return;
    }
    if (emails.includes(email)) {
      setError(t("emailDuplicate"));
      return;
    }
    // No check here for "that address is already one of the chosen
    // colleagues": this list carries names and ids only, never addresses —
    // shipping the org's email directory to the browser to catch a rare
    // duplicate would be a bad trade. The server dedupes by address anyway,
    // processing colleagues first, so the typed copy is dropped.
    if (full) {
      setError(t("tooMany", { max: maxTotal }));
      return;
    }
    onEmailsChange([...emails, email]);
    setEmailDraft("");
    setError(null);
  }

  return (
    <div className="space-y-2">
      <div>
        <p className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {t("label")}
          <span className="ml-1 text-xs font-normal text-zinc-500">
            {t("optional")}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {t("hint")}
        </p>
      </div>

      {/* ── Chosen, as removable chips ──────────────────────────────── */}
      {total > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const c = colleagues.find((x) => x.id === id);
            return (
              <li
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-50 py-0.5 pl-2 pr-1 text-xs text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              >
                <UserRound className="size-3" aria-hidden="true" />
                {c?.name ?? id}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t("remove", { who: c?.name ?? id })}
                  onClick={() => toggleColleague(id)}
                  className="rounded-full p-0.5 hover:bg-emerald-100 dark:hover:bg-emerald-900"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {emails.map((email) => (
            <li
              key={email}
              className="inline-flex items-center gap-1 rounded-full bg-amber-50 py-0.5 pl-2 pr-1 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
            >
              {email}
              <span className="rounded bg-amber-100 px-1 text-[10px] dark:bg-amber-900/70">
                {t("needsApproval")}
              </span>
              <button
                type="button"
                disabled={disabled}
                aria-label={t("remove", { who: email })}
                onClick={() => onEmailsChange(emails.filter((e) => e !== email))}
                className="rounded-full p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── Pick from the organization ──────────────────────────────── */}
      {colleagues.length > 0 ? (
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-zinc-300 bg-white px-3 py-2 text-left text-sm text-zinc-700 hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
          >
            <span className="flex items-center gap-2">
              <UserRound className="size-4 text-zinc-400" aria-hidden="true" />
              {selectedIds.length === 0
                ? t("choose")
                : t("chosenCount", { count: selectedIds.length })}
            </span>
            <span className="text-xs text-zinc-400">
              {open ? t("close") : t("openList")}
            </span>
          </button>

          {open ? (
            <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {colleagues.length > 6 ? (
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("search")}
                  className="w-full border-b border-zinc-200 bg-transparent px-3 py-2 text-sm focus:outline-none dark:border-zinc-700"
                />
              ) : null}
              <ul className="max-h-56 overflow-y-auto py-1">
                {matches.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-zinc-500">
                    {t("noMatches")}
                  </li>
                ) : (
                  matches.map((c) => {
                    const picked = selectedIds.includes(c.id);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => toggleColleague(c.id)}
                          className={cn(
                            "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800",
                            picked && "font-medium",
                          )}
                        >
                          {c.name}
                          {picked ? (
                            <Check
                              className="size-4 text-emerald-600 dark:text-emerald-400"
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          {t("noColleagues")}
        </p>
      )}

      {/* ── Or type an address ──────────────────────────────────────── */}
      <div className="space-y-1">
        <div className="flex gap-2">
          <input
            type="email"
            value={emailDraft}
            disabled={disabled}
            onChange={(e) => {
              setEmailDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                // This picker lives inside the ticket form; Enter here must add
                // an address, not submit the ticket.
                e.preventDefault();
                addEmail();
              }
            }}
            placeholder={t("emailPlaceholder")}
            className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={addEmail}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("addEmail")}
          </button>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t("emailHint")}
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
